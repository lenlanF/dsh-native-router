import test from 'node:test';
import assert from 'node:assert/strict';
import {registerAuthenticatedRouterRoutes,invokeTrustedHandler} from '../src/connection-routes.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';

function fixture(overrides={}){ const routes=new Map(),seen=[];
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
   async listModels(){return [{id:'autofree',name:'AutoFree'}, {id:'chain:manual',name:'Manual'}]},
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
   hostProviderInventory:{
     status(){return {hostProviders:[{providerId:'workbuddy'},{providerId:'lingxi'}]}},
     async listHostModels(providerId){return {state:'ready',providerId,
       models:providerId==='workbuddy'?[{id:'hy4-free',name:'Hy4 · x0.00'}]:
         [{id:'test-native'}],loginVerified:false}},
    },
    ...overrides,
  });  async function request(path,{method='GET',body,origin='http://127.0.0.1:12237',host='127.0.0.1:12237'}={}){
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
test('plugin-owned real-model test catalog and call are exposed ONLY through authenticated DSH Connection',async()=>{
 let modelCalls=0,generations=0;
 const f=fixture({accountCenter:{list:()=>({accounts:[],channels:[],pools:[]}),
  listTestModels:async id=>{modelCalls++;assert.equal(id,'owned-one');
   return {state:'ready',models:[{id:'zero',name:'Zero',free:true,evidence:'来源明确标记免费'}],freeCount:1}},
  verifyModel:async(id,{modelId})=>{generations++;assert.equal(id,'owned-one');
   assert.equal(modelId,'zero');return {state:'verified',modelId:'zero',responsePreview:'OK'}},
 }});
 let response=await f.request('/channels/accounts/models',{method:'POST',body:{accountId:'owned-one'}});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.result.freeCount,1);
 assert.equal(modelCalls,1);
 assert.equal(generations,0,'catalog endpoint never generates tokens');
 response=await f.request('/channels/accounts/models',{method:'POST',
  origin:'http://evil.invalid',body:{accountId:'owned-one'}});
 assert.equal(response.status,403);
 assert.equal(modelCalls,1);
 response=await f.request('/channels/accounts/action',{method:'POST',body:{
  action:'model-test',accountId:'owned-one',modelId:'zero'}});
 assert.equal(response.status,200);
 assert.equal((await response.json()).result.responsePreview,'OK');
 assert.equal(generations,1);
 await f.dispose();
});
test('source login is visible in channel inventory without original plugin or config duplication',async()=>{
 const opaque=sourceAccountOpaqueId('loomy','loomy-local-01');
 let scans=0;
 const f=fixture({
   accountCenter:{list:()=>({accounts:[],channels:[],pools:[]})},
   embeddedPack:{status:()=>({state:'mounted',modelAdapterReady:['loomy']}),
     listAccounts:async()=>({state:'ready',accounts:[{
       providerId:'loomy',id:'loomy-local-01',nickname:'自主Loomy账号',
       enabled:true,balance:108,balanceUnit:'积分',
     }]})},
   checkinCenter:{async refreshSources(){scans++},snapshot:()=>({today:'2026-11-19',
     accounts:[{id:opaque,providerId:'loomy',sourceAccount:true,
       nickname:'自主Loomy账号',balance:108,balanceUnit:'积分',
       connectionState:'online',checkinState:'success'}]})},
   hostProviderInventory:{status:()=>({hostProviders:[]})},
 });
 const response=await f.request('/channels/accounts');
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.accounts.length,1);
 const item=data.accounts[0];
 assert.equal(item.id,opaque);
  assert.equal(item.providerId,'loomy'); assert.equal(item.nickname,'自主Loomy账号');
 assert.equal(item.balance,108);
 assert.equal(item.connectionState,'online');
 assert.equal(item.managed,false);
  assert.equal(data.channels.some(c=>c.id==='loomy'),true); assert.equal(f.store.get().accounts.length,0);
 assert.equal(scans,0,'Opening a snapshot must not wait on official refresh');
 await f.request('/runtime/refresh',{method:'POST',body:{}});
 assert.equal(scans,1);
 assert.doesNotMatch(JSON.stringify(data),/access_token|zcode_jwt|password/i);
 await f.dispose();
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
test('scoped external directory excludes internal routes and distinguishes empty external catalogs',async()=>{
 const calls=[];
 const f=fixture({hostProviderInventory:{status:()=>({hostProviders:['native-router','native-router-source-qoder','own_mimo_desktop','qoder','loomy','external'].map(providerId=>({providerId}))}),
  listHostModels:async id=>{calls.push(id);return {state:'ready',models:id==='qoder'?[]:[{id:'model'}]}}}});
 try{
  const result=await (await f.request('/host/catalog/external')).json();
  assert.deepEqual(result.providers.map(p=>p.id),['qoder','loomy','external']);
  assert.equal(result.providers[0].state,'empty');assert.equal(result.providers[0].directoryVisible,false);
  assert.equal(result.providers[1].directoryVisible,true);assert.equal(result.providers[1].directoryScope,'external');
  assert.deepEqual(calls.sort(),['external','loomy','qoder']);
 }finally{await f.dispose()}
});
test('directory counts full official models independently from aggregation allowlist',async()=>{
 const f=fixture({hostProviderInventory:{
  status:()=>({hostProviders:[{providerId:'workbuddy'}]}),
  listHostModels:async providerId=>({state:'ready',providerId,models:[{id:'first'},{id:'second'}]})
 }});
 try{
  const cfg=f.store.get();cfg.hostModelSelection={workbuddy:['first']};f.store.replace(cfg);
  const result=await (await f.request('/host/catalog')).json();
  const row=result.providers.find(p=>p.id==='workbuddy');
  assert.equal(row.discoveredCount,2);assert.equal(row.allowedCount,1);
  assert.deepEqual(row.models.map(x=>x.id),['first']);
  const single=await (await f.request('/host/models',{method:'POST',body:{providerId:'workbuddy'}})).json();
  assert.equal(single.result.availableModels.length,2);
  assert.equal(single.result.models.length,1);
 }finally{await f.dispose()}
});

test('all DSH Providers and their models are selectable in Agent-level failover without shadow credentials',async()=>{

 const f=fixture();
 const rejected=await f.request('/host/catalog',{origin:'https://attacker.invalid'});
 assert.equal(rejected.status,403);
 const result=await f.request('/host/catalog');
 assert.equal(result.status,200);
 const data=await result.json();
 assert.deepEqual(data.providers.map(p=>p.id),['native-router','workbuddy','lingxi']);
 assert.equal(data.providers.find(p=>p.id==='native-router').models[0].id,'autofree');
 assert.equal(data.providers.find(p=>p.id==='workbuddy').models[0].id,'hy4-free');
 assert.match(data.providers.find(p=>p.id==='workbuddy').models[0].freeHint,/x0.00/);
 assert.equal(data.providers.find(p=>p.id==='lingxi').models[0].id,'test-native');
 assert.equal(f.store.get().accounts.length,0);
 assert.equal(f.store.get().hostFailover.priority.length,0,
  'Merely enumerating models cannot mutate a failover priority chain');
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
test('background acceptance is owner-only, origin checked, and supports status and cancel',async()=>{
 let started=0,cancelled=0;
 const f=fixture({ownerAcceptance:{
  snapshot:()=>({state:'idle'}),
  start:body=>{started++;assert.equal(body.consent,true);return {state:'running'}},
  cancel:id=>{cancelled++;assert.equal(id,'a'.repeat(32));return {state:'running'}},
 }});
 const request={action:'start',requestId:'a'.repeat(32),mode:'inventory',consent:true};
 assert.equal((await f.request('/acceptance')).status,200);
 assert.equal((await f.request('/acceptance',{method:'POST',origin:'https://evil.invalid',body:request})).status,403);
 assert.equal(started,0);
 assert.equal((await f.request('/acceptance',{method:'POST',body:request})).status,202);
 assert.equal(started,1);
 assert.equal((await f.request('/acceptance',{method:'POST',body:{action:'cancel',requestId:request.requestId}})).status,200);
 assert.equal(cancelled,1);
 await f.dispose();
});
