import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {normalizeConfig} from '../src/config.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';

async function httpServer(t,handler){
 const server=createServer(handler);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close()});
 return 'http://127.0.0.1:'+server.address().port+'/v1';
}
const sse=(value)=>'data: '+JSON.stringify(value)+'\n\n';
test('real HTTP: partial tool-call SSE disconnect is never executed, second account recovers',async t=>{
 const seen=[];
 const url=await httpServer(t,(req,res)=>{
  if(req.url==='/v1/models'){
   res.writeHead(200,{'content-type':'application/json'});
   return res.end(JSON.stringify({data:[{id:'example-native'}]}));
  }
  seen.push(req.headers.authorization);
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(req.headers.authorization==='Bearer first-key'){
   res.write(sse({choices:[{delta:{tool_calls:[{index:0,id:'call_incomplete',
    function:{name:'read',arguments:'{"file":"'}}]}}]}));
   setTimeout(()=>res.destroy(),10);
   return;
  }
  res.end(sse({choices:[{delta:{content:'Safe fallback'},finish_reason:'stop'}]})+'data: [DONE]\n\n');
 });
 const config=normalizeConfig({
  providers:[{id:'local',baseUrl:url,models:[],supportsTools:true}],
  accounts:[{id:'first',providerId:'local',credentialRef:'env:FIRST_KEY'},
    {id:'second',providerId:'local',credentialRef:'env:SECOND_KEY'}],
  routes:[{id:'safe',mode:'pinned',tiers:[{providerId:'local',model:'example-native'}]}],
 });
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},env:{FIRST_KEY:'first-key',SECOND_KEY:'second-key'}});
 const discovered=await adapter.listModels();
 assert.ok(discovered.some(m=>m.id==='direct:local:example-native'));
 const events=[];
 for await(const e of adapter.stream({model:'chain:safe',tools:[{name:'read',parameters:{type:'object',properties:{file:{type:'string'}}}}],
  messages:[{role:'user',content:'read'}]}))events.push(e);
 assert.deepEqual(seen,['Bearer first-key','Bearer second-key']);
 assert.equal(events.find(x=>x.type==='text-delta').text,'Safe fallback');
 assert.equal(events.some(x=>x.type==='tool-call-delta'),false);
});
test('real HTTP: current DSH tool list replaces previous-turn tools without stale retention',async t=>{
 const received=[];
 const url=await httpServer(t,async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));received.push(data);
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(data.tools?.length){
   res.end(sse({choices:[{delta:{tool_calls:[{index:0,id:'tool1',function:{name:'todo_write',arguments:'{}'}}]},
    finish_reason:'tool_calls'}]})+'data: [DONE]\n\n');
  }else{
   res.end(sse({choices:[{delta:{content:'ordinary completion'},finish_reason:'stop'}]})+'data: [DONE]\n\n');
  }
 });
 const config=normalizeConfig({providers:[{id:'local',baseUrl:url,models:['mock']}],
  accounts:[{id:'a',providerId:'local',credentialRef:'env:KEY'}],
  routes:[{id:'chain',tiers:[{providerId:'local',model:'mock'}]}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},env:{KEY:'local-key'}});
 const first=[],second=[];
 for await(const e of adapter.stream({model:'chain:chain',tools:[{name:'todo_write',parameters:{type:'object',properties:{}}}],
   messages:[{role:'user',content:'start'}]}))first.push(e);
 for await(const e of adapter.stream({model:'chain:chain',tools:[],
   messages:[{role:'user',content:'continue'}]}))second.push(e);
 assert.equal(first.filter(e=>e.type==='tool-call-delta').length,1);
 assert.equal(second.filter(e=>e.type==='tool-call-delta').length,0);
 assert.equal(received[0].tools[0].function.name,'todo_write');
 assert.equal('tools' in received[1],false);
});
