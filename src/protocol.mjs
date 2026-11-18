import {normalizedArguments,stringifyToolValue} from './host-tools.mjs';
const INJECTED=/<(system-reminder|working-context|environment-context|command-message|local-command-stdout)\b[\s\S]*?<\/\1>/gi;
export function flattenContent(content){
  if(typeof content==='string')return content.replace(INJECTED,'').trim();
  if(!Array.isArray(content))return '';
  return content.map(b=>{
    if(typeof b==='string')return b.replace(INJECTED,'');
    if(b?.type==='text' || b?.type==='reasoning')return String(b.text??'').replace(INJECTED,'');
    return '';
  }).filter(Boolean).join('\n');
}
export function toChatMessages(options={}){
  const messages=[];
  const system=flattenContent(options.system);
  if(system)messages.push({role:'system',content:system});
  for(const row of options.messages??[]){
    if(!row||typeof row!=='object')continue;
    const role=['system','developer','user','assistant','tool'].includes(row.role)?(row.role==='developer'?'system':row.role):'user';
    const blocks=Array.isArray(row.content)?row.content:[];
    const calls=[];
    for(const block of blocks.filter(b=>b?.type==='tool-call')){
      const id=block.id??block.toolCallId,args=normalizedArguments(block.arguments);
      if(typeof id==='string'&&id&&typeof block.name==='string'&&block.name&&args!==null){
        calls.push({id,type:'function',function:{name:block.name,arguments:args}});
      }
    }
    const body=flattenContent(blocks.length?blocks.filter(b=>b?.type!=='tool-call'&&b?.type!=='tool-result'):row.content);
    if(calls.length)messages.push({role:'assistant',content:body,tool_calls:calls});
    else if(body)messages.push(role==='tool'&&row.toolCallId?{role:'tool',tool_call_id:row.toolCallId,content:body}:{role,content:body});
    for(const block of blocks.filter(b=>b?.type==='tool-result')){
      const text=stringifyToolValue(block.content??block.text??block.result??block.output);
      if(!text)continue;
      const id=block.toolCallId??block.tool_call_id??block.id??row.toolCallId;
      messages.push(typeof id==='string'&&id?{role:'tool',tool_call_id:id,content:text}:{role:'user',content:'[DSH tool result without matching ID] '+text});
    }
  }
  return messages;
}
export function* toDshEvents(output){
  let index=0;
  for(const [kind,text] of [['reasoning',output.reasoning],['text',output.text]]){
    if(!text)continue;
    yield {type:'block-start',index,blockType:kind};
    yield {type:kind==='reasoning'?'reasoning-delta':'text-delta',index,text};
    yield {type:'block-end',index,block:{type:kind,text}};
    index++;
  }
  for(const call of output.toolCalls??[]){
    yield {type:'block-start',index,blockType:'tool-call'};
    yield {type:'tool-call-delta',index,id:call.id,name:call.name,argumentsDelta:call.arguments};
    yield {type:'block-end',index,block:{type:'tool-call',id:call.id,name:call.name,arguments:call.arguments}};
    index++;
  }
  if(output.usage)yield {type:'usage',usage:{
    inputTokens:output.usage.prompt_tokens,outputTokens:output.usage.completion_tokens,totalTokens:output.usage.total_tokens,
  }};
  yield {type:'finish',reason:output.toolCalls?.length?{kind:'tool-calls'}:
    output.finishReason==='length'?{kind:'max-tokens'}:{kind:'stop'}};
}
