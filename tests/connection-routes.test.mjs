import test from 'node:test';
import assert from 'node:assert/strict';
import {registerAuthenticatedRouterRoutes,invokeTrustedHandler} from '../src/connection-routes.mjs';
import {normalizeConfig} from '../src/config.mjs';

function fixture(){
 const routes=new Map(),seen=[];
 let cfg=normalizeConfig({});
 let invalidations=0;
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
  adapter:{getStatus:()=>({active:true}),invalidateCatalog(){invalidations++}},
  accountCenter:{list:()=>({accounts:[],channels:[]}),find:()=>{}},
  checkinCenter:{snapshot:()=>({today:'2026-11-17',accounts:[],groups:[]}),
    async refreshSources(){},async run(){return {record:{state:'pending_confirmation'}}}},
   embeddedPack:{status:()=>({state:'disabled'}),listAccounts:()=>({state:'disabled',accounts:[]})},
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
 return {ctx,store,dispose,routes,seen,request,get invalidations(){return invalidations}};
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
