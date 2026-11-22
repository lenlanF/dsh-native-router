import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenWorkDriver,QWENWORK_ID} from '../src/channels/qwenwork.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {runtimeOwnership} from '../src/account-runtime-ownership.mjs';
import {parseQwenWorkFrame} from '../src/channels/qwenwork-vendor/sse.mjs';

const JWT=()=>[
 Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),
 Buffer.from(JSON.stringify({sub:'qwen-member-101',username:'Qwen Tester',exp:1900000000})).toString('base64url'),
 'signed-fixture',
].join('.');
function rig({unauthorized=false,broken=false,failSave=false,missingVault=false,organization='org-1'}={}){
 const records=new Map(),calls=[];
 let cfg=normalizeConfig({}),grantCount=0,refreshCount=0;
 const token=JWT();
 const fetchImpl=async(input,opts={})=>{
  const url=new URL(String(input)),path=url.pathname;
  calls.push({path,query:url.search,headers:opts.headers??{},method:opts.method??'GET',
   requestBody:opts.body,redirect:opts.redirect});
  assert.equal(url.origin,'https://gateway.qwenwork.cn',
   'Qwen token and COSY material cannot reach a foreign host');
  assert.equal(opts.redirect,'manual');
  if(path==='/api/v1/deviceToken/poll'){
   grantCount++;
   if(grantCount===1)return new Response('',{status:404});
   return new Response(JSON.stringify({token,
    refresh_token:'private-refresh-1234567890123456789',
    user_id:'qwen-member-101',user_name:'Qwen Tester',
    expires_at:1900000000}),{status:200});
  }
  if(path==='/api/v1/adapter/user/account-context'){
   if(unauthorized)return new Response('expired',{status:401});
   assert.match(opts.headers?.authorization??'',/^Bearer /);
   return new Response(JSON.stringify({data:{user:{id:'qwen-member-101',
     name:'Qwen Tester',username:'Qwen Tester',organization_id:organization},
    quota:{remaining:100,total:200,used:100,unit:'credits'}}}),
    {headers:{'content-type':'application/json'}});
  }
  if(path==='/api/v2/model/list'||path==='/algo/api/v2/model/list'){
   assert.match(opts.headers?.Authorization??'',/^Bearer COSY\./);
   assert.equal(opts.headers?.['Cosy-MachineId']?.length>10,true);
   return new Response(JSON.stringify({qwork:[
    {key:'flash',display_name:'Qwen 3.8 Flash',price_factor:0.1,enable:true},
    {key:'pro',display_name:'Qwen 高级',price_factor:1,enable:true},
    {key:'disabled',price_factor:0,enable:false},
   ]}),{headers:{'content-type':'application/json'}});
  }
  if(path==='/api/v1/deviceToken/refresh'){
   refreshCount++;
   return new Response(JSON.stringify({device_token:token,
     refresh_token:'rotated-refresh-12345678901234567890',
     expires_at:1900000000}),{headers:{'content-type':'application/json'}});
  }
  if(path==='/algo/api/v2/service/pro/sse/agent_chat_generation'){
   assert.match(opts.headers?.Authorization??'',/^Bearer COSY\./);
   assert.equal(opts.headers?.['X-Model-Key'],'flash');
   assert.equal(opts.method,'POST');
   const outer={statusCodeValue:200,statusCode:'OK',body:JSON.stringify({
    choices:[{delta:{content:'千问原生回复'},finish_reason:broken?null:'stop'}]})};
   return new Response('data: '+JSON.stringify(outer)+'\n\ndata: [DONE]\n\n',
    {headers:{'content-type':'text/event-stream'}});
  }
  throw Error('Unexpected QwenWork API: '+path);
 };
 const vault=missingVault?{}:{
  async resolve(k){return records.get(k)},
  async set(k,v){records.set(k,{value:v})},
  async unset(k){records.delete(k)},
 };
 const driver=createQwenWorkDriver({vault,fetchImpl,getAccounts:()=>cfg.accounts});
 const configStore={get:()=>structuredClone(cfg),replace:newValue=>{
  if(failSave)throw Error('Simulated configuration disk failure');
  cfg=normalizeConfig(newValue);return structuredClone(cfg);
 }};
 const center=createAccountCenter({configStore,drivers:new Map([[QWENWORK_ID,driver]])});
 return {driver,center,configStore,records,calls,fetchImpl,
  get cfg(){return cfg},get grantCount(){return grantCount},
  get refreshCount(){return refreshCount}};
}
test('QwenWork native device PKCE issues a user-approved URL without leaking verifier or token to UI',()=>{
 const h=rig();
 const started=h.center.startQwenLogin();
 assert.equal(started.status,'waiting');
 assert.match(started.loginUrl,/^https:\/\/gateway\.qwenwork\.cn\/device\/selectAccounts\?/);
 const url=new URL(started.loginUrl);
 assert.equal(url.searchParams.get('challenge_method'),'S256');
 assert.equal(url.searchParams.get('redirect_uri'),'qwenwork-cn://');
 assert.ok(url.searchParams.get('challenge')?.length>25);
 assert.ok(url.searchParams.get('machine_id')?.length>10);
 assert.doesNotMatch(started.loginUrl,/refresh_token|device_token|verifier|private/i);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
 h.center.stop();
});
test('QwenWork device grant stays pending on 404 then commits only remotely verified member identity',async()=>{
 const h=rig();
 h.center.startQwenLogin();
 const waiting=await h.center.pollQwenLogin();
 assert.equal(waiting.status,'waiting');
 assert.equal(h.records.size,0);
 const done=await h.center.pollQwenLogin();
 assert.equal(done.status,'done');
 assert.equal(done.account.providerId,'own_qwenwork');
 assert.equal(h.cfg.providers[0].protocol,'native-channel');
 assert.equal(h.cfg.accounts.length,1);
 assert.equal(runtimeOwnership(h.cfg.accounts[0]),'owned');
 assert.equal(h.records.size,1);
 assert.doesNotMatch(JSON.stringify(h.cfg),/private-refresh|signed-fixture|device_token|machineId/);
 const again=await h.center.pollQwenLogin();
 assert.equal(again.account.alreadyOwned,true);
 h.center.stop();
});
test('QwenWork dynamic COSY model and quota reply directly over native DSH without local shim',async()=>{
 const h=rig();
 h.center.startQwenLogin();
 await h.center.pollQwenLogin();
 await h.center.pollQwenLogin();
 const account=h.cfg.accounts[0];
 assert.equal((await h.driver.refresh({account})).state,'online');
 assert.equal(h.driver.accountSnapshot(account).balance,100);
 const catalog=await h.driver.listModels({account});
 assert.deepEqual(catalog.map(x=>x.id),['flash','pro']);
 assert.match(catalog[0].name,/x0\.10/);
 assert.match(catalog[1].name,/x1\.00/);
 assert.equal(catalog.some(x=>x.id==='disabled'),false);
 const adapter=createNativeRouterAdapter({configStore:h.configStore,
   channelDrivers:new Map([[QWENWORK_ID,h.driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'direct:own_qwenwork:flash',
  messages:[{role:'user',content:'你好'}],maxTokens:32}))events.push(event);
 assert.equal(events.find(x=>x.type==='text-delta')?.text,'千问原生回复');
 assert.equal(events.at(-1)?.type,'finish');
 assert.equal(h.driver.accountSnapshot(account).modelInferenceVerifiedAt>0,true);
 assert(h.calls.filter(x=>x.path.includes('agent_chat_generation')).length===1);
 assert(h.calls.every(x=>!x.path.includes('localhost')));
 assert(!JSON.stringify(events).includes('signed-fixture'));
 h.center.stop();
});
test('QwenWork rejects incomplete SSE as failure with no real model proof',async()=>{
 const h=rig({broken:true});
 h.center.startQwenLogin();
 await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const account=h.cfg.accounts[0];
 await assert.rejects(()=>h.driver.generate({account,model:'flash',
  options:{messages:[{role:'user',content:'你好'}]}}),/QwenWork/);
 assert.equal(h.driver.accountSnapshot(account).modelInferenceVerifiedAt,null);
 h.center.stop();
});
test('QwenWork 401 does not claim online and never publishes unverified account or model',async()=>{
 const h=rig({unauthorized:true});
 h.center.startQwenLogin();
 await h.center.pollQwenLogin();
 const result=await h.center.pollQwenLogin();
 assert.equal(result.status,'error');
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.providers.length,0);
 h.center.stop();
});
test('QwenWork native device login requires owned vault and can cancel without original client',async()=>{
 const h=rig({missingVault:true});
 assert.throws(()=>h.center.startQwenLogin(),/QwenWork/);
 assert.equal(h.records.size,0);
 h.center.stop();
});
test('QwenWork transaction rollback when DSH config persistence fails leaves no secrets',async()=>{
 const h=rig({failSave:true});
 h.center.startQwenLogin();
 await h.center.pollQwenLogin();
 await assert.rejects(h.center.pollQwenLogin(),/Simulated configuration disk failure/);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.providers.length,0);
 h.center.stop();
});
test('QwenWork same member in distinct organizations keeps independent vault account IDs',async()=>{
 const a=rig({organization:'org-1'}),b=rig({organization:'org-other'});
 for(const h of [a,b]){
  h.center.startQwenLogin();await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 }
 assert.notEqual(a.cfg.accounts[0].id,b.cfg.accounts[0].id);
 assert.equal((await a.driver.refresh({account:a.cfg.accounts[0]})).state,'online');
 assert.equal((await b.driver.refresh({account:b.cfg.accounts[0]})).state,'online');
 a.center.stop();b.center.stop();
});
test('QwenWork expiring member refresh rotates independently stored private refresh token',async()=>{
 const h=rig();h.center.startQwenLogin();await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const account=h.cfg.accounts[0],key=[...h.records.keys()][0];
 const before=JSON.parse(h.records.get(key).value);
 h.records.set(key,{value:JSON.stringify({...before,expiresAt:Date.now()-1000})});
 assert.equal((await h.driver.refresh({account})).state,'online');
 assert.equal(h.refreshCount,1);
 assert.match(h.records.get(key).value,/rotated-refresh-123456/);
 assert.equal(h.cfg.accounts[0].id,account.id);
 h.center.stop();
});
test('QwenWork envelope parser rejects malicious upstream status and preserves real finish reason',()=>{
 const fake={statusCodeValue:429,statusCode:'TOO_MANY',body:'{"code":429,"message":"private API"}'};
 assert.equal(parseQwenWorkFrame(JSON.stringify(fake)).kind,'error');
 const okay={statusCodeValue:200,statusCode:'OK',body:JSON.stringify({
  choices:[{delta:{content:'hello'},finish_reason:'stop'}]})};
 const parsed=parseQwenWorkFrame(JSON.stringify(okay));
 assert.equal(parsed.kind,'chunk');
 assert.equal(parsed.finishReason,'stop');
 assert.equal(parsed.delta.content,'hello');
});
