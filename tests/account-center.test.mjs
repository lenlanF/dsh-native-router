import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {REFERENCE_CHANNELS} from '../src/channels.mjs';
import {sample} from './fixtures.mjs';

function fixture({config=sample,fetchImpl,drivers}={}){
 let cfg=normalizeConfig(config),changed=0,invalidated=0;
 const configStore={get:()=>structuredClone(cfg),replace(value){changed++;cfg=normalizeConfig(value);return structuredClone(cfg)}};
 const adapter={invalidateCatalog(){invalidated++}};
 const center=createAccountCenter({configStore,adapter,drivers:drivers??new Map(),
  env:{NATIVE_ROUTER_TEST_KEY:'test-key-a1',LOCAL_TEST_KEY:'test-key-l1'},
  vault:{resolve:async()=>({value:'test-key-a2'})},
  fetchImpl:fetchImpl??(async()=>new Response(JSON.stringify({data:[{id:'gpt-like'}]}),{status:200,
     headers:{'content-type':'application/json'}}))});
 return {center,configStore,adapter,get changed(){return changed},get invalidated(){return invalidated}};
}
test('channel roster includes existing accounts and reference-only channels without false login readiness',()=>{
 const {center}=fixture(),view=center.list();
 assert.equal(view.accounts.length,3);
 assert.equal(view.channels.filter(ch=>ch.referenceOnly).length,REFERENCE_CHANNELS.length);
 assert.ok(view.channels.some(x=>x.id==='workbuddy'&&x.adapterReady===false&&x.loginAvailable===false));
 assert.ok(view.accounts.every(a=>a.connectionState==='not_checked'));
 assert.equal(view.pools.find(x=>x.providerId==='alpha').enabled,2);
});
test('credential validation really probes /models and returns no tokens in public JSON',async()=>{
 const seen=[];
 const {center}=fixture({fetchImpl:async (url,options)=>{
  seen.push({url,authorization:options.headers.authorization});
  return new Response('{"data":[]}',{status:200,headers:{'content-type':'application/json'}});
 }});
 const login=await center.verify('a1',{login:true});
 assert.equal(login.state,'online');
 assert.equal(login.manualKeyVerification,true);
 assert.equal(seen[0].url,'https://api.example.invalid/v1/models');
 assert.equal(seen[0].authorization,'Bearer test-key-a1');
 const shown=JSON.stringify(center.list());
 assert.doesNotMatch(shown,/test-key-a1/);
 assert.match(shown,/"connectionState":"online"/);
 assert.equal(center.list().pools.find(x=>x.providerId==='alpha').verified,1);
});
test('probe maps revoked credential and rate limits to distinct account states',async()=>{
 let status=401;
 const {center}=fixture({fetchImpl:async()=>new Response('',{status})});
 assert.equal((await center.verify('a1')).state,'expired');
 status=429;
 assert.equal((await center.verify('a1')).state,'limited');
});
test('enable and disable change only the selected account, then invalidate model catalog',()=>{
 const f=fixture();
 f.center.setEnabled('a1',false);
 const current=f.configStore.get();
 assert.equal(current.accounts.find(a=>a.id==='a1').enabled,false);
 assert.equal(current.accounts.find(a=>a.id==='a2').enabled,true);
 assert.equal(f.invalidated,1);
 assert.throws(()=>f.center.setEnabled('a1','false'),/boolean/);
 assert.equal(f.center.list().accounts.find(a=>a.id==='a1').connectionState,'disabled');
});
test('logout rejects explicitly pinned account and never widens the model account pool',async()=>{
 const config={...sample,routes:[{...sample.routes[0],tiers:[
  {providerId:'alpha',model:'gpt-like',accountIds:['a1']}]}]};
 const f=fixture({config});
 await assert.rejects(()=>f.center.logout('a1'),e=>e.status===409);
 assert.equal(f.configStore.get().accounts.length,3);
 assert.deepEqual(f.configStore.get().routes[0].tiers[0].accountIds,['a1']);
});
test('logout detaches unused account metadata but cannot revoke external env key',async()=>{
 const f=fixture();
 const result=await f.center.logout('a1');
 assert.deepEqual({detached:result.detached,revoked:result.revokedUpstream},{detached:true,revoked:false});
 assert.equal(f.configStore.get().accounts.some(a=>a.id==='a1'),false);
 assert.ok(f.configStore.get().accounts.some(a=>a.id==='a2'));
});
test('optional channel discovery does not run without a native driver and does not auto-import candidates',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.center.discover('alpha'),e=>e.status===501);
 const drivers=new Map([['alpha',{discover:async()=>[
   {id:'candidate-01',label:'Desktop user',source:'user-app',cookie:'SHOULD_NOT_EXPOSE'}]}]]);
 const added=fixture({drivers});
 const list=await added.center.discover('alpha');
 assert.equal(list.candidates.length,1);
 assert.equal(list.imported,0);
 assert.equal(list.candidates[0].requiresConsent,true);
 assert.doesNotMatch(JSON.stringify(list),/SHOULD_NOT_EXPOSE/);
 assert.equal(added.configStore.get().accounts.length,3);
});
test('refresh-all checks configured enabled accounts only and preserves per-account errors',async()=>{
 const f=fixture({fetchImpl:async (url,opts)=>{
  if(opts.headers.authorization==='Bearer test-key-a1')return new Response('',{status:401});
  return new Response('{"data":[]}',{status:200});
 }});
 const r=await f.center.refreshAll();
 assert.equal(r.attempted,3);
 assert.equal(r.results.find(x=>x.id==='a1').state,'expired');
 assert.ok(r.results.some(x=>x.state==='online'));
});
