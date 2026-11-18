import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {requestAnthropic,decodeAnthropicResponse} from '../src/provider/anthropic.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';

const frame=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify({type:event,...data})+'\n\n';
function fullMessage(){
 return frame('message_start',{message:{usage:{input_tokens:12}}})
  +frame('content_block_start',{index:0,content_block:{type:'text',text:''}})
  +frame('content_block_delta',{index:0,delta:{type:'text_delta',text:'Hello from Anthropic'}})
  +frame('content_block_stop',{index:0})
  +frame('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})
  +frame('message_stop',{});
}
const offered=[{name:'read',description:'Read a file',parameters:{type:'object',properties:{file:{type:'string'}},required:['file']}}];
test('Anthropic Messages native SSE returns text and standardized usage',()=>{
 const out=decodeAnthropicResponse(fullMessage());
 assert.equal(out.text,'Hello from Anthropic');
 assert.equal(out.finishReason,'stop');
 assert.equal(out.usage.total_tokens,17);
});
test('Anthropic Messages tool_use input_json_delta returns DSH native tool call',()=>{
 const s=frame('message_start',{message:{usage:{input_tokens:10}}})
  +frame('content_block_start',{index:0,content_block:{type:'tool_use',id:'toolu_1',name:'read',input:{}}})
  +frame('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:'{"file":"E:/Temp/example.txt"}'}})
  +frame('content_block_stop',{index:0})
  +frame('message_delta',{delta:{stop_reason:'tool_use'},usage:{output_tokens:3}})
  +frame('message_stop',{});
 const out=decodeAnthropicResponse(s);
 assert.deepEqual(out.toolCalls,[{id:'toolu_1',name:'read',arguments:'{"file":"E:/Temp/example.txt"}'}]);
 assert.equal(out.finishReason,'tool_calls');
});
test('Anthropic incomplete stream does not release tool calls',()=>{
 const partial=frame('content_block_start',{index:0,content_block:{type:'tool_use',id:'toolu',name:'read',input:{}}});
 assert.throws(()=>decodeAnthropicResponse(partial),/message_stop/);
});
test('Anthropic requester transforms native DSH tools and history, never executes tools',async()=>{
 const sent=[];
 const provider={id:'anthropic',protocol:'anthropic-messages',baseUrl:'https://api.anthropic.com/v1',supportsTools:true,timeoutMs:5000};
 const account={id:'a1',providerId:'anthropic',credentialRef:'env:ANTHROPIC_TEST_KEY'};
 const result=await requestAnthropic({provider,account,model:'claude-test',
   options:{tools:offered,system:'Use allowed tools only',maxTokens:400,
    messages:[{role:'assistant',content:[{type:'tool-call',id:'tool_123',name:'read',arguments:{file:'A.txt'}}]},
      {role:'tool',toolCallId:'tool_123',content:'file contents'},
      {role:'user',content:'What changed?'}]}},
 {fetchImpl:async(url,args)=>{
   sent.push({url,body:JSON.parse(args.body),headers:args.headers});
   return new Response(fullMessage(),{headers:{'content-type':'text/event-stream'}});
 },env:{ANTHROPIC_TEST_KEY:'test-only'}});
 assert.equal(result.text,'Hello from Anthropic');
 assert.equal(sent[0].headers['anthropic-version'],'2023-06-01');
 assert.equal(sent[0].body.tools[0].input_schema.type,'object');
 assert.deepEqual(sent[0].body.messages[0].content[0],{type:'tool_use',id:'tool_123',name:'read',input:{file:'A.txt'}});
 assert.equal(sent[0].body.messages[1].content[0].tool_use_id,'tool_123');
});
test('native DSH router supports Anthropic and OpenAI-compatible providers in the same chain',async()=>{
 const cfg=normalizeConfig({
  providers:[{id:'anth',protocol:'anthropic-messages',baseUrl:'https://api.anthropic.com/v1',models:['claude-test']},
    {id:'oai',protocol:'openai-chat',baseUrl:'https://api.fake.invalid/v1',models:['gpt-test']}],
  accounts:[{id:'anth-a',providerId:'anth',credentialRef:'env:ANTH_KEY'},
    {id:'oai-a',providerId:'oai',credentialRef:'env:OAI_KEY'}],
  routes:[{id:'cross',mode:'priority',tiers:[{providerId:'anth',model:'claude-test'},
    {providerId:'oai',model:'gpt-test'}]}],
 });
 const requests=[];
 const router=createNativeRouterAdapter({configStore:{get:()=>cfg},env:{ANTH_KEY:'test',OAI_KEY:'test'},
  fetchImpl:async url=>{
   requests.push(url);
   return url.includes('anthropic')?new Response('',{status:429}):
     new Response('data: '+JSON.stringify({choices:[{delta:{content:'fallback to GPT'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',
      {headers:{'content-type':'text/event-stream'}});
  }});
 const events=[];
 for await(const e of router.stream({model:'chain:cross',messages:[{role:'user',content:'hi'}]}))events.push(e);
 assert.equal(events.find(e=>e.type==='text-delta').text,'fallback to GPT');
 assert.deepEqual(requests,['https://api.anthropic.com/v1/messages','https://api.fake.invalid/v1/chat/completions']);
});

test('Anthropic dynamic model discovery uses x-api-key and native version header',async()=>{
 const cfg=normalizeConfig({providers:[{id:'claude',protocol:'anthropic-messages',baseUrl:'https://api.anthropic.com/v1',models:[]}],
  accounts:[{id:'a',providerId:'claude',credentialRef:'env:CLAUDE_KEY'}],routes:[]});
 const seen=[];
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},env:{CLAUDE_KEY:'dummy'},
  fetchImpl:async(url,opts)=>{seen.push({url,headers:opts.headers});return new Response(
   JSON.stringify({data:[{id:'claude-from-server'}]}),{headers:{'content-type':'application/json'}})}});
 const models=await adapter.listModels();
 assert.equal(seen[0].url,'https://api.anthropic.com/v1/models');
 assert.equal(seen[0].headers['x-api-key'],'dummy');
 assert.equal(seen[0].headers['anthropic-version'],'2023-06-01');
 assert.ok(models.some(m=>m.id==='direct:claude:claude-from-server'));
});
