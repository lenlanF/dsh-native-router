import {resolveCredential} from '../accounts.mjs';
import {UpstreamError,safeRetryAfter} from '../failure.mjs';
import {visibleTools} from '../host-tools.mjs';
import {toChatMessages} from '../protocol.mjs';
import {validateModelCalls} from './openai.mjs';

function toAnthropic(options){
  const system=[];
  const messages=[];
  for(const row of toChatMessages(options)){
    if(row.role==='system'){if(row.content)system.push(row.content);continue}
    if(row.role==='tool'){
      messages.push({role:'user',content:[{type:'tool_result',tool_use_id:row.tool_call_id,content:row.content}]});
      continue;
    }
    if(row.role==='assistant'&&Array.isArray(row.tool_calls)&&row.tool_calls.length){
      const blocks=[];
      if(row.content)blocks.push({type:'text',text:row.content});
      for(const call of row.tool_calls){
        let input;try{input=JSON.parse(call.function.arguments)}catch{throw new UpstreamError('Malformed tool history',{code:'TOOL_PROTOCOL'})}
        blocks.push({type:'tool_use',id:call.id,name:call.function.name,input});
      }
      messages.push({role:'assistant',content:blocks});
      continue;
    }
    messages.push({role:row.role==='assistant'?'assistant':'user',content:row.content});
  }
  return {system:system.join('\n\n'),messages};
}
function readSse(body,accept){
  for(const frame of body.split(/\r?\n\r?\n/)){
    const lines=frame.split(/\r?\n/);
    const data=lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
    if(!data)continue;
    let parsed;try{parsed=JSON.parse(data)}catch{throw new UpstreamError('Invalid Anthropic SSE JSON',{code:'BAD_SSE'})}
    accept(parsed);
  }
}
export function decodeAnthropicResponse(body,contentType='text/event-stream'){
  const chunks=new Map();let usage={},stopReason='',sawStop=false;
  const put=(i,part)=>{chunks.set(i,part)};
  if(contentType.includes('text/event-stream')){
    readSse(body,event=>{
      if(event.type==='error')throw new UpstreamError('Anthropic stream error',{code:'STREAM'});
      if(event.type==='message_start'){
        usage={...usage,...event.message?.usage};
      }
      if(event.type==='content_block_start'){
        const block=event.content_block??{};
        if(block.type==='tool_use'){
          put(event.index,{type:'tool_use',id:block.id,name:block.name,
            raw:typeof block.input==='object' && Object.keys(block.input).length ? JSON.stringify(block.input):''});
        }else if(block.type==='text'){
          put(event.index,{type:'text',text:block.text??''});
        }else if(block.type==='thinking'){
          put(event.index,{type:'thinking',text:block.thinking??''});
        }
      }
      if(event.type==='content_block_delta'){
        const state=chunks.get(event.index);if(!state)return;
        if(state.type==='tool_use'&&event.delta?.type==='input_json_delta')state.raw+=event.delta.partial_json??'';
        if(state.type==='text'&&event.delta?.type==='text_delta')state.text+=event.delta.text??'';
        if(state.type==='thinking'&&event.delta?.type==='thinking_delta')state.text+=event.delta.thinking??'';
      }
      if(event.type==='message_delta'){
        stopReason=event.delta?.stop_reason??stopReason;
        usage={...usage,...event.usage};
      }
      if(event.type==='message_stop')sawStop=true;
    });
    if(!sawStop)throw new UpstreamError('Anthropic response ended before message_stop',{code:'TRUNCATED'});
  }else{
    let msg;try{msg=JSON.parse(body)}catch{throw new UpstreamError('Invalid Anthropic JSON',{code:'BAD_JSON'})}
    if(msg?.type==='error')throw new UpstreamError('Anthropic error response',{code:'UPSTREAM'});
    usage=msg.usage??{};stopReason=msg.stop_reason??'';
    for(const [i,block]of (msg.content??[]).entries()){
      if(block.type==='text')put(i,{type:'text',text:block.text??''});
      if(block.type==='thinking')put(i,{type:'thinking',text:block.thinking??''});
      if(block.type==='tool_use')put(i,{type:'tool_use',id:block.id,name:block.name,raw:JSON.stringify(block.input??{})});
    }
    sawStop=true;
  }
  if(!stopReason)throw new UpstreamError('Anthropic response missing stop_reason',{code:'TRUNCATED'});
  const parts=[...chunks.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v);
  const calls=parts.filter(x=>x.type==='tool_use');
  if(calls.length>8)throw new UpstreamError('More than eight tool calls',{code:'TOOL_PROTOCOL'});
  const result={
    text:parts.filter(x=>x.type==='text').map(x=>x.text).join(''),
    reasoning:parts.filter(x=>x.type==='thinking').map(x=>x.text).join(''),
    toolCalls:calls.map(x=>({id:x.id,name:x.name,arguments:x.raw||'{}'})),
    finishReason:stopReason==='tool_use'?'tool_calls':stopReason==='max_tokens'?'length':'stop',
    usage:{prompt_tokens:usage.input_tokens,completion_tokens:usage.output_tokens,
      total_tokens:(usage.input_tokens??0)+(usage.output_tokens??0)},
  };
  if(!result.text.trim()&&!result.reasoning.trim()&&!result.toolCalls.length)throw new UpstreamError('Anthropic returned empty response',{code:'EMPTY'});
  return result;
}
async function readLimit(res,signal){
  let result='',size=0;const decoder=new TextDecoder();
  for await(const chunk of res.body){
    if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
    size+=chunk.byteLength;
    if(size>16*1024*1024)throw new UpstreamError('Anthropic response exceeded size limit',{code:'RESPONSE_SIZE'});
    result+=decoder.decode(chunk,{stream:true});
  }
  return result+decoder.decode();
}
export async function requestAnthropic({provider,account,model,signal,options},{fetchImpl=fetch,env=process.env,vault}={}){
  const token=await resolveCredential(account,{env,vault});
  const tools=visibleTools(options.tools);
  if(tools.length&&!provider.supportsTools)throw new UpstreamError('This provider does not support DSH tools',{code:'TOOL_PROTOCOL'});
  const {system,messages}=toAnthropic(options);
  const body={model,max_tokens:options.maxTokens??options.max_tokens??2048,messages,stream:true};
  if(system)body.system=system;
  if(tools.length)body.tools=tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters}));
  const ctl=new AbortController();
  const cancel=()=>ctl.abort(signal?.reason??new DOMException('Aborted','AbortError'));
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>ctl.abort(new DOMException('Timeout','TimeoutError')),provider.timeoutMs);
  try{
    const res=await fetchImpl(provider.baseUrl+'/messages',{method:'POST',headers:{
      'x-api-key':token,'anthropic-version':'2023-06-01','content-type':'application/json','accept':'text/event-stream'},
      body:JSON.stringify(body),signal:ctl.signal});
    if(!res.ok)throw new UpstreamError('Anthropic HTTP '+res.status,{status:res.status,
      retryAfterMs:safeRetryAfter(res.headers?.get?.('retry-after'))});
    return validateModelCalls(decodeAnthropicResponse(await readLimit(res,signal),res.headers?.get?.('content-type')??'text/event-stream'),options.tools);
  }catch(error){
    if(ctl.signal.aborted&&!signal?.aborted)throw new UpstreamError('Anthropic request timeout',{status:408,code:'TIMEOUT'});
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
