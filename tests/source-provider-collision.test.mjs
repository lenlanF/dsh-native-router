import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bundled=readFileSync(new URL('../vendor/channel-pack/pack-native.js',import.meta.url),'utf8');
const begin=bundled.indexOf('function registerAdapterIdempotent(ctx, providers, adapter, warn) {');
const end=bundled.indexOf('// vendor/channel-pack/src/llm-adapter.ts',begin);
assert.ok(begin>=0&&end>begin,'Independent native source registration must exist');
// Only evaluate the pure registration helper, never the source application,
// credential stores, network, login flows, or extra services.
const register=new Function('wrapAdapterWithTokenLedger','withDeadModelPruning',
 'isDuplicateRegistrationError',bundled.slice(begin,end)+'\nreturn registerAdapterIdempotent;')(
 (_providers,adapter)=>adapter,(_providers,adapter)=>adapter,error=>error?.code==='DUPLICATE_ADAPTER');

function rig(initial=['native-router','workbuddy']){
 const registry=new Map(initial.map(id=>[id,{providerInfo:()=>({id,name:id})}]));
 const writes=[],calls=[],scopedCleanup=[];
 const host={
  listProviders:()=>[...registry.keys()].map(id=>({id})),
  registerAdapter:(ids,adapter)=>{
   for(const id of ids)if(registry.has(id))throw Object.assign(Error('duplicate'),{code:'DUPLICATE_ADAPTER'});
   writes.push({ids,adapter});
   for(const id of ids)registry.set(id,adapter);
   return ()=>{for(const id of ids)registry.delete(id)};
  },
 };
 const adapter={
  providerInfo:id=>({id,name:'Original '+id}),
  providerRetryPolicy:()=>undefined,
  listModels:async id=>{calls.push(['models',id]);return [{id:'test-model',provider:id}]},
  stream:options=>{calls.push(['stream',options.provider]);return {original:options.provider}},
 };
 const ctx={llm:host,effect(factory){const dispose=factory();scopedCleanup.push(dispose)}};
 return {host,ctx,adapter,writes,registry,calls,
  releaseScope(){for(const dispose of scopedCleanup.reverse())dispose?.()}};
}

test('host installed WorkBuddy remains untouched while source WorkBuddy and Loomy each expose independent login routes',async()=>{
 const r=rig();
 const original=r.registry.get('workbuddy');
 const first=register(r.ctx,['workbuddy'],r.adapter);
 assert.deepEqual(r.writes.map(x=>x.ids),[['native-router-source-workbuddy']]);
 assert.equal(r.registry.get('workbuddy'),original);
 const second=register(r.ctx,['loomy'],r.adapter);
 assert.deepEqual(r.writes.map(x=>x.ids),[
  ['native-router-source-workbuddy'],['native-router-source-loomy'],['loomy']]);
 assert.equal(r.registry.get('workbuddy'),original);
 const owned=r.registry.get('native-router-source-workbuddy');
 assert.deepEqual(owned.providerInfo('native-router-source-workbuddy'),{
  id:'native-router-source-workbuddy',name:'Original workbuddy · 聚合路由自有'});
 assert.equal((await owned.listModels('native-router-source-workbuddy'))[0].provider,'workbuddy');
 assert.equal(owned.stream({provider:'native-router-source-workbuddy'}).original,'workbuddy');
 assert.deepEqual(r.calls,[['models','workbuddy'],['stream','workbuddy']]);
 assert.throws(()=>owned.stream({provider:'loomy'}),/Invalid independent source/);
 r.releaseScope();
 assert.equal(r.registry.get('workbuddy'),original);
 assert.equal(r.registry.has('native-router-source-loomy'),false);
 assert.equal(r.registry.has('native-router-source-workbuddy'),false);
});
test('repeat DSH plugin loading after Cordis scope cleanup does not leak previously owned aliases',()=>{
 const r=rig();
 for(let i=0;i<3;i++){
   const release=register(r.ctx,['workbuddy'],r.adapter);
   assert.equal(r.registry.has('native-router-source-workbuddy'),true);
   release();
   assert.equal(r.registry.has('native-router-source-workbuddy'),false);
 }
 assert.equal(r.registry.has('workbuddy'),true);
});
test('independent internal alias collision fails closed without touching the original host',()=>{
 const r=rig(['native-router','workbuddy','native-router-source-workbuddy']);
 const original=r.registry.get('workbuddy');
 assert.throws(()=>register(r.ctx,['workbuddy'],r.adapter),/internal adapter alias already occupied/);
 assert.equal(r.writes.length,0);
 assert.equal(r.registry.get('workbuddy'),original);
});
test('missing host provider inventory refuses source registration before any writes',()=>{
 let writes=0;
 const host={listProviders:()=>undefined,registerAdapter:()=>{writes++}};
 assert.throws(()=>register({llm:host,effect(){}},['workbuddy'],{}),/Host provider inventory unavailable/);
 assert.equal(writes,0);
});