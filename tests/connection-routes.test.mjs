import test from 'node:test';
import assert from 'node:assert/strict';
import {registerAuthenticatedRouterRoutes,invokeTrustedHandler} from '../src/connection-routes.mjs';
import {normalizeConfig} from '../src/config.mjs';

function fixture(){
 const routes=new Map(),seen=[];
 let cfg=normalizeConfig({});
 let invalidations=0,freeRefreshes=0,adoptedId=null;
 const verifiedIds=[];
 const adoptionCalls=[];
 const api={
  fetch:{register:row=>{
   assert.ok(row.path.startsWith('/api/plugins/dsh-native-router/'));
   assert.deepEqual(row.methods,['GET','POST']);
   assert.equal(row.requestBody,'buffered');
   assert.equal(routes.has(row.path),false);
   routes.set(row.path,row);
   seen.push(row);
   return async()=>{routes.delete(row.path)};
  }},
 };
 const ctx={get:name=>name==='connection'?api:undefined};
 const store={get:()=>structuredClone(cfg),replace:v=>(cfg=normalizeConfig(v))};
 const dispose=registerAuthenticatedRouterRoutes(ctx,{configStore:store,
  adapter:{getStatus:()=>({active:true}),invalidateCatalog(){invalidations++},
   autoFreeSnapshot:()=>({state:'ready',models:[{providerId:'workbuddy',model:'free',evidence:'来源明确标记免费'}],catalog:[]}),
   async refreshAutoFree(){freeRefreshes++;return {state:'ready',models:[{providerId:'workbuddy',model:'free',evidence:'来源明确标记免费'}],catalog:[]}}},
  accountCenter:{list:()=>({accounts:[],channels:[]}),find:()=>{},
    async verify(id){verifiedIds.push(id);return {id,state:'online',message:'模拟独立账号验证结果'}}},
  checkinCenter:{snapshot:()=>({today:'2026-11-17',accounts:[],groups:[]}),
    async refreshSources(){},async run(){return {record:{state:'pending_confirmation'}}}},
   embeddedPack:{status:()=>({state:'disabled'}),listAccounts:()=>({state:'disabled',accounts:[]})},
   accountAdoption:{async preview(){return {state:'ready',accounts:[
    {providerId:'qoder',accountId:'original-qoder',label:'Qoder',portable:true,
      ...(adoptedId?{ownedAccountId:adoptedId}:{})}]};},
    async adopt(request){adoptionCalls.push(request);return {state:'stored_unverified',
      activation:'requires_original_stop_and_host_restart'};}},
   hostProviderInventory:{async listHostModels(providerId){return {state:'ready',providerId,models:[{id:'test-native'}],loginVerified:false}}},
 });
  async function request(path,{method='GET',body,origin='http://127.0.0.1:12237',host='127.0.0.1:12237'}={}){
   const route=routes.get('/api/plugins/dsh-native-router'+path);
   assert.ok(route,'expected authenticated path '+path);
   return route.fetch(new Request('http://127.0.0.1:12237/api/plugins/dsh-native-router'+path,{
    method,headers:{host,origin,
     ...body===undefined?{}:{'content-type':'application/json'}},
    ...body===undefined?{}:{body:JSON.stringify(body)},
   }));
  }
 return {ctx,store,dispose,routes,seen,request,adoptionCalls,
   setAdoptedId(id){adoptedId=id},verifiedIds,
   get invalidations(){return invalidations},get freeRefreshes(){return freeRefreshes}};
}
test('DSH native admin registers ONLY authenticated Connection exact Fetch paths, no unauthenticated WebServer routes',async()=>{
 const f=fixture();
 assert.ok(f.routes.size>=9);
 assert.ok(f.seen.every(row=>row.path.startsWith('/api/')));
 const response=await f.request('/config');
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.ok,true);
 assert.equal(data.config.checkin.autoEnabled,false);
 const status=await f.request('/status');
 assert.equal(status.status,200);
 assert.equal((await status.json()).embeddedPack.state,'disabled');
 await f.dispose();
 assert.equal(f.routes.size,0);
});
test('Connection-attached config changes preserve origin check and fail closed for hostile source',async()=>{
 const f=fixture(),payload=f.store.get();
 payload.hostFailover.enabled=true;
 let answer=await f.request('/config',{method:'POST',origin:'http://attacker.invalid',body:payload});
 assert.equal(answer.status,403);
 assert.equal(f.store.get().hostFailover.enabled,false);
 answer=await f.request('/config',{method:'POST',body:payload});
 assert.equal(answer.status,200);
 assert.equal(f.invalidations,1);
 assert.equal(f.store.get().hostFailover.enabled,true);
 const wrong=await f.request('/config',{method:'DELETE'});
 assert.equal(wrong.status,405);
 await f.dispose();
});
test('authenticated source check-in action preserves pending receipt and rejects oversized bodies',async()=>{
 const f=fixture();
 const body=await f.request('/checkins');
 assert.equal(body.status,200);
 assert.equal((await body.json()).today,'2026-11-17');
 const sign=await f.request('/checkins/action',{method:'POST',body:{action:'run',accountId:'fake'}});
 assert.equal(sign.status,200);
 assert.equal((await sign.json()).result.record.state,'pending_confirmation');
 const tooLong={action:'run',accountId:'z'.repeat(1050000)};
 const res=await f.request('/checkins/action',{method:'POST',body:tooLong});
 assert.equal(res.status,413);
 await f.dispose();
});
test('authenticated host-native model browsing rejects cross-origin requests and returns no credentials',async()=>{
 const rig=fixture();
 const denied=await rig.request('/host/models',{method:'POST',body:{providerId:'workbuddy-global'},origin:'https://attacker.invalid'});
 assert.equal(denied.status,403);
 const response=await rig.request('/host/models',{method:'POST',body:{providerId:'workbuddy-global'}});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.deepEqual(data.result.models,[{id:'test-native'}]);
 assert.equal(data.result.loginVerified,false);
 assert.equal(data.result.providerId,'workbuddy-global');
 await rig.dispose();
});
test('AutoFree model-pool GET is read-only and owner refresh rejects cross-origin mutation',async()=>{
 const f=fixture();
 const got=await f.request('/models/autofree');
 assert.equal(got.status,200);
 assert.equal((await got.json()).result.models[0].model,'free');
 const denied=await f.request('/models/autofree/refresh',{method:'POST',origin:'https://attacker.invalid'});
 assert.equal(denied.status,403);assert.equal(f.freeRefreshes,0);
 const ok=await f.request('/models/autofree/refresh',{method:'POST'});
 assert.equal(ok.status,200);assert.equal(f.freeRefreshes,1);
 assert.equal(f.store.get().routes.length,0);
 await f.dispose();
});
 test('same-page batch verification touches only owner-adopted enabled accounts',async()=>{
 const f=fixture();
 const noAccounts=await f.request('/channels/adopt/verify',{method:'POST'});
 assert.equal(noAccounts.status,200);assert.equal((await noAccounts.json()).attempted,0);
 const refused=await f.request('/channels/adopt/verify',{method:'POST',origin:'https://attacker.invalid'});
 assert.equal(refused.status,403);
 const cfg=f.store.get();
 cfg.providers.push({id:'own_qoder',name:'Qoder 自有',protocol:'native-channel',models:['qoder-free']});
 cfg.accounts.push({id:'owned_qoder_test',providerId:'own_qoder',credentialRef:'driver:own_qoder:owned_qoder_test',enabled:true});
 f.store.replace(cfg);f.setAdoptedId('owned_qoder_test');
 const checked=await f.request('/channels/adopt/verify',{method:'POST'});
 assert.equal(checked.status,200);
 const body=await checked.json();
 assert.equal(body.attempted,1);
 assert.equal(body.results[0].state,'online');
 assert.deepEqual(f.verifiedIds,['owned_qoder_test']);
 assert.equal(f.store.get().routes.length,0);
 await f.dispose();
});
test('closed Connection route registration cannot expose admin routes when connection absent',()=>{
 assert.throws(()=>registerAuthenticatedRouterRoutes({get:()=>undefined},{configStore:{get:()=>normalizeConfig({})}}),
  /authenticated Fetch registration is required/);
});
test('authenticated reuse scan refuses disabled opt-in and hostile origins before local session discovery',async()=>{
 const f=fixture();
 const bad=await f.request('/channels/reuse/scan',{method:'POST',body:{},
  origin:'http://attacker.invalid'});
 assert.equal(bad.status,403);
 const blocked=await f.request('/channels/reuse/scan',{method:'POST',body:{}});
 assert.equal(blocked.status,409);
 assert.equal((await blocked.json()).ok,false);
 await f.dispose();
});
test('owner-only transfer endpoints require explicit account consent and never return original credential references',async()=>{
 const f=fixture();
 const deny=await f.request('/channels/adopt/preview',{
  origin:'https://attacker.invalid'});
 assert.equal(deny.status,403);
 const preview=await f.request('/channels/adopt/preview');
 assert.equal(preview.status,200);
 const snap=await preview.json();
 assert.deepEqual(snap.result.accounts,[{providerId:'qoder',
  accountId:'original-qoder',label:'Qoder',portable:true}]);
 assert.doesNotMatch(JSON.stringify(snap),/PRIVATE_SOURCE_REF|TOP_SECRET/);
 const missing=await f.request('/channels/adopt',{method:'POST',
  body:{providerId:'qoder',accountId:'original-qoder'}});
 assert.equal(missing.status,400);
 const cross=await f.request('/channels/adopt',{method:'POST',
  body:{providerId:'qoder',accountId:'original-qoder',consent:true},
  origin:'http://evil.invalid'});
 assert.equal(cross.status,403);
 const permitted=await f.request('/channels/adopt',{method:'POST',
  body:{providerId:'qoder',accountId:'original-qoder',consent:true}});
 assert.equal(permitted.status,200);
 const result=await permitted.json();
 assert.equal(result.result.state,'stored_unverified');
 assert.deepEqual(f.adoptionCalls,[{providerId:'qoder',accountId:'original-qoder',consent:true}]);
 await f.dispose();
});
test('authenticated remote HTTPS DSH Host can save config, while HTTP remote and mismatched Origins remain denied',async()=>{
 const f=fixture(),payload=f.store.get();
 payload.hostFailover.enabled=true;
 const remote='dsh.example.invalid';
 let result=await f.request('/config',{method:'POST',origin:'http://'+remote,host:remote,body:payload});
 assert.equal(result.status,403,'unencrypted public remote origin must not change admin config');
 assert.equal(f.store.get().hostFailover.enabled,false);
 result=await f.request('/config',{method:'POST',origin:'https://attacker.example.invalid',host:remote,body:payload});
 assert.equal(result.status,403,'Host and Origin must match exactly');
 result=await f.request('/config',{method:'POST',origin:'https://'+remote,host:remote,body:payload});
 assert.equal(result.status,200,'DSH Connection has already admitted owner; remote HTTPS is legitimate');
 assert.equal(f.store.get().hostFailover.enabled,true);
 assert.equal(f.invalidations,1);
 await f.dispose();
});
test('authenticated Connection adapter replies HTTP 500 on sync and async handler exceptions without leaking secrets',async()=>{
 for(const handler of [
  ()=>{throw Error('PRIVATE_SECRET_SHOULD_NOT_LEAK')},
  async()=>{await Promise.resolve();throw Error('PRIVATE_SECRET_SHOULD_NOT_LEAK')},
 ]){
  const response=await invokeTrustedHandler(handler,new Request('https://dsh.example.invalid/api/plugins/dsh-native-router/config'));
  assert.equal(response.status,500);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.text();
  assert.match(body,/Admin API operation failed/);
  assert.doesNotMatch(body,/PRIVATE_SECRET_SHOULD_NOT_LEAK/);
 }
});
