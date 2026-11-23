import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenWorkDriver,QWENWORK_ID} from '../src/channels/qwenwork.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {runtimeOwnership} from '../src/account-runtime-ownership.mjs';
import {parseQwenWorkFrame} from '../src/channels/qwenwork-vendor/sse.mjs';

const JWT=(organization='',subject='qwen-member-101')=>[
 Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),
 Buffer.from(JSON.stringify({sub:subject,username:'Qwen Tester',exp:1900000000,
  ...(organization?{biz_org_id:organization}:{})})).toString('base64url'),
 'signed-fixture',
].join('.');
function rig({unauthorized=false,broken=false,failSave=false,missingVault=false,
 organization='org-1',tokenOrganization='',omitRemoteOrganization=false,
 transientPollErrors=0,tailWithoutNewline=false,rotatedOtherMember=false}={}){
 const records=new Map(),calls=[];
 let cfg=normalizeConfig({}),grantCount=0,refreshCount=0,currentOrg=organization,
   currentTime=Date.now();
 const token=JWT(tokenOrganization);
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
    if(grantCount<=transientPollErrors+1)return new Response('Temporary busy',{status:503});
   return new Response(JSON.stringify({token,
    refresh_token:'private-refresh-1234567890123456789',
    user_id:'qwen-member-101',user_name:'Qwen Tester',
    expires_at:1900000000}),{status:200});
  }
  if(path==='/api/v1/adapter/user/account-context'){
   if(unauthorized)return new Response('expired',{status:401});
   assert.match(opts.headers?.authorization??'',/^Bearer /);
   return new Response(JSON.stringify({data:{user:{id:'qwen-member-101',
     name:'Qwen Tester',username:'Qwen Tester',
     ...(omitRemoteOrganization?{}:{organization_id:currentOrg})},
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
   return new Response(JSON.stringify({device_token:rotatedOtherMember?
      JWT(tokenOrganization,'other-member'):token,
      refresh_token:'rotated-refresh-12345678901234567890',
      expires_at:1900000000}),{headers:{'content-type':'application/json'}});
  }
  if(path==='/algo/api/v2/service/pro/sse/agent_chat_generation'){
   assert.match(opts.headers?.Authorization??'',/^Bearer COSY\./);
   assert.equal(opts.headers?.['X-Model-Key'],'flash');
   assert.equal(opts.method,'POST');
   const outer={statusCodeValue:200,statusCode:'OK',body:JSON.stringify({
    choices:[{delta:{content:'千问原生回复'},finish_reason:broken?null:'stop'}]})};
   return new Response('data: '+JSON.stringify(outer)+
     (tailWithoutNewline?'':'\n\ndata: [DONE]\n\n'),
     {headers:{'content-type':'text/event-stream'}});
  }
  throw Error('Unexpected QwenWork API: '+path);
 };
 const vault=missingVault?{}:{
  async resolve(k){return records.get(k)},
  async set(k,v){records.set(k,{value:v})},
  async unset(k){records.delete(k)},
 };
 const driver=createQwenWorkDriver({vault,fetchImpl,now:()=>currentTime,
   getAccounts:()=>cfg.accounts});
 const configStore={get:()=>structuredClone(cfg),replace:newValue=>{
  if(failSave)throw Error('Simulated configuration disk failure');
  cfg=normalizeConfig(newValue);return structuredClone(cfg);
 }};
 const center=createAccountCenter({configStore,drivers:new Map([[QWENWORK_ID,driver]])});
 return {driver,center,configStore,records,calls,fetchImpl,
  setOrg(value){currentOrg=value},advance(ms){currentTime+=ms},
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
test('QwenWork restart metadata rehydrates official username and quota without paid COSY model call',async()=>{
 const h=rig();
 h.center.startQwenLogin();
 await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const owned=h.cfg.accounts[0];
 const start=h.calls.length;
 const info=await h.driver.refreshAccountStatus({account:owned});
 assert.equal(info.authVerified,true);
 assert.equal(info.state,'online');
 const row=h.driver.accountSnapshot(owned);
 assert.equal(row.nickname,'Qwen Tester');
 assert.equal(row.balance,100);
 assert.equal(row.balanceUnit,'credits');
 assert.equal(h.calls.slice(start).filter(x=>x.path.includes('account-context')).length,1);
 assert.equal(h.calls.slice(start).filter(x=>x.path.includes('/algo/')||
   x.path.includes('model/list')).length,0);
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
test('QwenWork preserves enterprise organization from JWT when official account-context omits org field',async()=>{
 const h=rig({tokenOrganization:'org-private-7',organization:'org-private-7',
  omitRemoteOrganization:true});
 h.center.startQwenLogin();
 await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const account=h.cfg.accounts[0],owned=[...h.records.values()][0].value;
 assert.equal(JSON.parse(owned).user.organization_id,'org-private-7');
 assert.equal((await h.driver.refresh({account})).state,'online');
 assert.deepEqual((await h.driver.listModels({account})).map(x=>x.id),['flash','pro']);
 h.center.stop();
});
test('QwenWork identity switching to another organization is rejected before any signed model call',async()=>{
 const h=rig({organization:'org-1'});
 h.center.startQwenLogin();await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const account=h.cfg.accounts[0];
 h.setOrg('another-team');
 assert.equal((await h.driver.refresh({account})).state,'expired');
 await assert.rejects(()=>h.driver.listModels({account}),/QwenWork/);
 assert.equal(h.calls.filter(x=>x.path.includes('/algo/api/v2/model/list')).length,0);
 assert.equal(h.cfg.accounts.length,1);
 h.center.stop();
});
test('QwenWork device grant keeps the same PKCE challenge across 503 outages with bounded retry',async()=>{
 const h=rig({transientPollErrors:2});
 const start=h.center.startQwenLogin(),url=start.loginUrl;
 assert.equal((await h.center.pollQwenLogin()).status,'waiting');
 assert.equal((await h.center.pollQwenLogin()).status,'waiting');
 assert.equal(h.grantCount,2);
 assert.equal(h.driver.loginStatus().loginUrl,url);
 assert.equal((await h.center.pollQwenLogin()).status,'waiting');
 assert.equal(h.grantCount,2,'backoff must prevent rapid retry storms');
 h.advance(3000);
 assert.equal((await h.center.pollQwenLogin()).status,'waiting');
 h.advance(5000);
 assert.equal((await h.center.pollQwenLogin()).status,'done');
 assert.equal(h.cfg.accounts.length,1);
 assert.equal(h.grantCount,4);
 h.center.stop();
});
test('QwenWork aborted config persistence cannot be re-committed from a stale completed login receipt',async()=>{
 const h=rig({failSave:true});
 h.center.startQwenLogin();await h.center.pollQwenLogin();
 await assert.rejects(()=>h.center.pollQwenLogin(),/disk failure/);
 assert.equal(h.records.size,0);
 assert.equal(h.driver.loginStatus().status,'canceled');
 assert.equal((await h.center.pollQwenLogin()).status,'canceled');
 assert.equal(h.cfg.accounts.length,0);
 h.center.stop();
});
test('QwenWork rejects switched member identity after refresh without overwriting original secret',async()=>{
 const h=rig({rotatedOtherMember:true});
 h.center.startQwenLogin();await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const account=h.cfg.accounts[0],key=[...h.records.keys()][0];
 const original=JSON.parse(h.records.get(key).value);
 h.records.set(key,{value:JSON.stringify({...original,expiresAt:Date.now()-1000})});
 const before=h.records.get(key).value;
 assert.equal((await h.driver.refresh({account})).state,'expired');
 assert.equal(h.records.get(key).value,before);
 assert.equal(h.cfg.accounts.length,1);
 h.center.stop();
});
test('QwenWork final complete response without final newline reaches DSH finish and gets proof',async()=>{
 const h=rig({tailWithoutNewline:true});
 h.center.startQwenLogin();await h.center.pollQwenLogin();await h.center.pollQwenLogin();
 const events=[];
 const adapter=createNativeRouterAdapter({configStore:h.configStore,
  channelDrivers:new Map([[QWENWORK_ID,h.driver]])});
 for await(const event of adapter.stream({model:'direct:own_qwenwork:flash',
  messages:[{role:'user',content:'你好'}]}))events.push(event);
 assert.equal(events.find(x=>x.type==='text-delta')?.text,'千问原生回复');
 assert.equal(events.at(-1)?.type,'finish');
 assert(h.driver.accountSnapshot(h.cfg.accounts[0]).modelInferenceVerifiedAt>0);
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
