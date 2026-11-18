import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeOpenAIResponse,validateModelCalls,requestOpenAI} from '../src/provider/openai.mjs';
import {toChatMessages,toDshEvents} from '../src/protocol.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sample} from './fixtures.mjs';

const frame=value=>'data: '+JSON.stringify(value)+'\n\n';
function finished(text='hello'){
 return frame({choices:[{delta:{content:text},finish_reason:null}]})
  +frame({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:4,total_tokens:11}})
  +'data: [DONE]\n\n';
}
const offered=[{name:'todo_write',description:'Update the todo list',parameters:{type:'object',properties:{tasks:{type:'array'}},required:['tasks']}}];
test('OpenAI SSE stream requires finished response before any host action',()=>{
 assert.throws(()=>decodeOpenAIResponse(frame({choices:[{delta:{content:'incomplete'}}]})),/before \[DONE\]/);
 assert.throws(()=>decodeOpenAIResponse(frame({choices:[{delta:{content:'oops'}}]})+'data: [DONE]\n\n'),/finish_reason/);
 const response=decodeOpenAIResponse(finished());
 assert.equal(response.text,'hello');
 assert.equal(response.usage.total_tokens,11);
});
test('tool JSON deltas preserve ids and current DSH tool schemas',()=>{
 const body=frame({choices:[{delta:{tool_calls:[{index:0,id:'call_1',function:{name:'todo_write',arguments:'{"tasks":'}}]}}]})
  +frame({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'[]}'}}]},finish_reason:'tool_calls'}]})
  +'data: [DONE]\n\n';
 const result=validateModelCalls(decodeOpenAIResponse(body),offered);
 assert.deepEqual(result.toolCalls,[{id:'call_1',name:'todo_write',arguments:'{"tasks":[]}'}]);
 const events=[...toDshEvents(result)];
 assert.equal(events.find(e=>e.type==='tool-call-delta').name,'todo_write');
 assert.deepEqual(events.at(-1).reason,{kind:'tool-calls'});
});
test('unadvertised tool and invalid JSON object are both rejected atomically',()=>{
 assert.throws(()=>validateModelCalls({toolCalls:[{id:'1',name:'bash',arguments:'{}'}]},offered),/Unadvertised/);
 assert.throws(()=>validateModelCalls({toolCalls:[{id:'1',name:'todo_write',arguments:'[1,2]'}]},offered),/Malformed/);
 assert.throws(()=>validateModelCalls({toolCalls:[{id:'1',name:'todo_write',arguments:'{"broken":'}]},offered),/Malformed/);
});
test('tool history is translated to OpenAI assistant tool_calls followed by role=tool',()=>{
 const result=toChatMessages({system:'Only authorized tools',messages:[
  {role:'assistant',content:[{type:'tool-call',id:'call_12',name:'todo_write',arguments:{tasks:[]}}]},
  {role:'tool',toolCallId:'call_12',content:[{type:'text',text:'{"ok":true}'}]},
 ]});
 assert.equal(result[1].tool_calls[0].function.name,'todo_write');
 assert.equal(result[2].role,'tool');
 assert.equal(result[2].tool_call_id,'call_12');
});
test('native OpenAI requester forwards current offered tools without execution',async()=>{
 const bodies=[],urls=[];
 const fake=async(url,args)=>{urls.push(url);bodies.push(JSON.parse(args.body));
  return new Response(finished('ok'),{status:200,headers:{'content-type':'text/event-stream'}});
 };
 const p=normalizeConfig(sample).providers[0],a=normalizeConfig(sample).accounts[0];
 const response=await requestOpenAI({provider:p,account:a,model:'gpt-like',options:{
  tools:offered,system:'system',messages:[{role:'user',content:[{type:'text',text:'test'}]}]},
 },{fetchImpl:fake,env:{NATIVE_ROUTER_TEST_KEY:'fake-test-only'}});
 assert.equal(response.text,'ok');assert.equal(urls[0],'https://api.example.invalid/v1/chat/completions');
 assert.equal(bodies[0].tools[0].function.name,'todo_write');
 assert.equal(bodies[0].model,'gpt-like');
});
test('model discovery and direct model selection both register under native-router',async()=>{
 const cfg=normalizeConfig(sample),configStore={get:()=>cfg};
 const urls=[];
 const adapter=createNativeRouterAdapter({configStore,env:{NATIVE_ROUTER_TEST_KEY:'fake-test-only',LOCAL_TEST_KEY:'fake-local'},
  fetchImpl:async(url,args)=>{urls.push(url);return new Response(finished('confirmed'),{headers:{'content-type':'text/event-stream'}})}});
 const models=await adapter.listModels();
 assert.ok(models.some(m=>m.id==='chain:daily'));
 assert.ok(models.some(m=>m.id==='direct:alpha:gpt-like'));
 const generated=[];
 for await(const e of adapter.stream({model:'chain:daily',sessionId:'session1',messages:[{role:'user',content:'hello'}]}))generated.push(e);
 assert.equal(generated.find(e=>e.type==='text-delta').text,'confirmed');
 assert.deepEqual(generated.at(-1).reason,{kind:'stop'});
});
test('only complete response from fallback account can be shown to DSH',async()=>{
 const cfg=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'pinned'}]}),seen=[];
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},env:{NATIVE_ROUTER_TEST_KEY:'test-key'},
   vault:{resolve:async()=>({value:'fake-vault-key'})},
   fetchImpl:async()=>{
    seen.push(true);
    if(seen.length===1)return new Response(frame({choices:[{delta:{tool_calls:[{index:0,id:'partial',function:{name:'todo_write',arguments:'{"tasks":'}}]}}]}),{headers:{'content-type':'text/event-stream'}});
    return new Response(finished('healthy'),{headers:{'content-type':'text/event-stream'}});
   }});
 const output=[];
 for await (const event of adapter.stream({model:'chain:daily',tools:offered,system:'s',messages:[{role:'user',content:'go'}]}))output.push(event);
 assert.equal(seen.length,2);
 assert.equal(output.some(e=>e.type==='tool-call-delta'),false);
 assert.equal(output.find(e=>e.type==='text-delta').text,'healthy');
});
test('unknown tool never enters DSH event stream',async()=>{
 const cfg=normalizeConfig({...sample,accounts:[sample.accounts[0]]});
 const bad=frame({choices:[{delta:{tool_calls:[{index:0,id:'c',function:{name:'shell_that_does_not_exist',arguments:'{}'}}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n';
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},env:{NATIVE_ROUTER_TEST_KEY:'x'},
   fetchImpl:async()=>new Response(bad,{headers:{'content-type':'text/event-stream'}})});
 const events=[];
 await assert.rejects(async()=>{
  for await(const e of adapter.stream({model:'chain:daily',tools:offered,messages:[{role:'user',content:'go'}]}))events.push(e);
 },/Unadvertised/);
 assert.equal(events.length,0);
});

test('non-advertised direct model IDs cannot bypass DSH configured model catalog',async()=>{
 const cfg=normalizeConfig(sample);
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},env:{NATIVE_ROUTER_TEST_KEY:'test'}});
 let calls=0;
 await assert.rejects(async()=>{
  for await(const _event of adapter.stream({model:'direct:alpha:expensive-unlisted',messages:[{role:'user',content:'go'}]}))calls++;
 },/not advertised/);
 assert.equal(calls,0);
});
