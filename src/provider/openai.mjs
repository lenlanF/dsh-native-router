import {resolveCredential} from '../accounts.mjs';
import {UpstreamError,safeRetryAfter} from '../failure.mjs';
import {openAiTools, normalizedArguments,visibleTools} from '../host-tools.mjs';
import {toChatMessages} from '../protocol.mjs';

const MAX_RESPONSE_BYTES=16*1024*1024;
function trimError(s){return String(s).replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._~-]{15,}/gi,'[REDACTED]').slice(0,300)}
async function readCapped(response,signal) {
  if(!response.body)return await response.text();
  let length=0,text='';
  const decoder=new TextDecoder();
  for await(const bytes of response.body){
    if(signal?.aborted)throw signal.reason ?? new DOMException('Aborted','AbortError');
    length+=bytes.byteLength;
    if(length>MAX_RESPONSE_BYTES)throw new UpstreamError('Upstream response size exceeded 16 MiB',{code:'RESPONSE_SIZE'});
    text+=decoder.decode(bytes,{stream:true});
  }
  return text+decoder.decode();
}
function aggregatePayload(payload,state){
  const choice=payload?.choices?.[0];
  if(!choice)return;
  const delta=choice.delta??choice.message??{};
  if(typeof delta.content==='string')state.text+=delta.content;
  if(typeof delta.reasoning_content==='string')state.reasoning+=delta.reasoning_content;
  if(choice.finish_reason)state.finishReason=choice.finish_reason;
  if(payload.usage)state.usage=payload.usage;
  for(const row of delta.tool_calls??[]){
    if(!Number.isInteger(row.index) || row.index<0 || row.index>31)throw new UpstreamError('Invalid streamed tool index',{code:'TOOL_PROTOCOL'});
    const call=state.calls.get(row.index)??{id:'',name:'',arguments:''};
    if(row.id)call.id=row.id;
    if(row.function?.name)call.name+=row.function.name;
    if(row.function?.arguments)call.arguments+=row.function.arguments;
    state.calls.set(row.index,call);
  }
}
export function decodeOpenAIResponse(body,contentType='text/event-stream'){
  const state={text:'',reasoning:'',finishReason:'',usage:null,calls:new Map()};
  if(contentType.includes('text/event-stream')){
    const events=body.split(/\r?\n\r?\n/);
    let done=false;
    for(const event of events){
      const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!data)continue;
      if(data==='[DONE]'){done=true;continue}
      let value;
      try{value=JSON.parse(data)}catch{throw new UpstreamError('Invalid upstream SSE JSON frame',{code:'BAD_SSE'})}
      if(value?.error)throw new UpstreamError('Upstream stream error: '+trimError(value.error.message),{code:'STREAM'});
      aggregatePayload(value,state);
    }
    if(!done)throw new UpstreamError('Upstream SSE response ended before [DONE]',{code:'TRUNCATED'});
  }else{
    let response;try{response=JSON.parse(body)}catch{throw new UpstreamError('Invalid upstream JSON',{code:'BAD_JSON'})}
    if(response?.error)throw new UpstreamError('Upstream error: '+trimError(response.error.message),{code:'UPSTREAM'});
    const choice=response?.choices?.[0],message=choice?.message;
    if(message){
      state.text=typeof message.content==='string'?message.content:'';
      state.reasoning=typeof message.reasoning_content==='string'?message.reasoning_content:'';
      state.finishReason=choice.finish_reason??'';
      state.usage=response.usage??null;
      for(const [index,call] of (message.tool_calls??[]).entries())state.calls.set(index,{
        id:call.id,name:call.function?.name,arguments:call.function?.arguments??'{}'});
    }else aggregatePayload(response,state);
  }
  if(!state.finishReason)throw new UpstreamError('Upstream response is missing finish_reason',{code:'TRUNCATED'});
  if(state.calls.size>8)throw new UpstreamError('More than eight tool calls in one model response',{code:'TOOL_PROTOCOL'});
  const calls=[...state.calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call);
  if(!state.text.trim()&&!state.reasoning.trim()&&!calls.length)throw new UpstreamError('Model produced an empty response',{code:'EMPTY'});
  return {text:state.text,reasoning:state.reasoning,toolCalls:calls,finishReason:state.finishReason,usage:state.usage};
}
export function validateModelCalls(output,offered){
  const allowed=new Set(visibleTools(offered).map(t=>t.name));
  const toolCalls=[];
  for(const call of output.toolCalls??[]){
    if(typeof call.name!=='string'||!allowed.has(call.name))throw new UpstreamError('Unadvertised tool call rejected',{code:'TOOL_PROTOCOL'});
    const args=normalizedArguments(call.arguments);
    if(args===null || typeof call.id!=='string' || !call.id)throw new UpstreamError('Malformed tool arguments or id rejected',{code:'TOOL_PROTOCOL'});
    toolCalls.push({id:call.id,name:call.name,arguments:args});
  }
  return {...output,toolCalls};
}
export async function requestOpenAI({provider,account,model,signal,options}, {fetchImpl=fetch,env=process.env,vault}={}) {
  const token=await resolveCredential(account,{env,vault});
  if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
  const hostTools=visibleTools(options.tools);
  if(hostTools.length&&!provider.supportsTools)throw new UpstreamError('Provider does not support DSH tool calls',{code:'TOOL_PROTOCOL'});
  const body={model,messages:toChatMessages(options),stream:true,...(hostTools.length?{tools:openAiTools(hostTools),tool_choice:options.toolChoice??'auto'}:{})};
  const maxTokens=options.maxTokens??options.max_tokens;
  if(Number.isInteger(maxTokens)&&maxTokens>0)body.max_tokens=maxTokens;
  const timeout=new AbortController();
  const cancel=()=>timeout.abort(signal?.reason??new DOMException('Aborted','AbortError'));
  signal?.addEventListener('abort',cancel,{once:true});
  const clock=setTimeout(()=>timeout.abort(new DOMException('Upstream timeout','TimeoutError')),provider.timeoutMs);
  try{
    const result=await fetchImpl(provider.baseUrl+'/chat/completions',{
      method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'text/event-stream'},
      body:JSON.stringify(body),signal:timeout.signal,
    });
    if(!result.ok){
      const raw=await readCapped(result,signal).catch(()=>result.statusText);
      let message='HTTP '+result.status;try{const parsed=JSON.parse(raw);message+=': '+trimError(parsed.error?.message??'')}catch{}
      throw new UpstreamError(message,{status:result.status,retryAfterMs:safeRetryAfter(result.headers?.get?.('retry-after'))});
    }
    const raw=await readCapped(result,signal);
    return validateModelCalls(decodeOpenAIResponse(raw,result.headers?.get?.('content-type')??'text/event-stream'),options.tools);
  }catch(error){
    if(timeout.signal.aborted && !signal?.aborted)throw new UpstreamError('Upstream request timeout',{status:408,code:'TIMEOUT'});
    throw error;
  }finally{clearTimeout(clock);signal?.removeEventListener('abort',cancel)}
}
