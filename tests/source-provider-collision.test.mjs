import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bundled=readFileSync(new URL('../vendor/channel-pack/pack-native.js',import.meta.url),'utf8');
const begin=bundled.indexOf('var nativeSourceAliasDisposers = new WeakMap();');
const end=bundled.indexOf('// vendor/channel-pack/src/llm-adapter.ts',begin);
assert.ok(begin>=0&&end>begin,'Independent native source registration must exist');
// Only evaluate the pure registration helper, never the source application,
// credential stores, network, login flows, or extra services.
const exported=new Function('wrapAdapterWithTokenLedger','withDeadModelPruning',
 'isDuplicateRegistrationError',bundled.slice(begin,end)+'\nreturn {registerAdapterIdempotent,rollbackNativeRouterSourceAdapters,nativeSourceAdapterStates};')(
 (_providers,adapter)=>adapter,(_providers,adapter)=>adapter,error=>error?.code==='DUPLICATE_ADAPTER');
const register=exported.registerAdapterIdempotent,
  rollback=exported.rollbackNativeRouterSourceAdapters;

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
 const states=Object.create(null);
 exported.nativeSourceAdapterStates.set(ctx,states);
 return {host,ctx,adapter,writes,registry,calls,states,
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
  ['native-router-source-workbuddy'],['native-router-source-loomy']]);
  const owned=r.registry.get('native-router-source-workbuddy');
  assert.equal(r.registry.get('workbuddy'),original);
  assert.deepEqual(owned.providerInfo('native-router-source-workbuddy'),{  id:'native-router-source-workbuddy',name:'Original workbuddy'});
 const models=await owned.listModels('native-router-source-workbuddy');
 assert.equal(models[0].provider,'native-router-source-workbuddy');
 assert.equal(models[0].id,'test-model');
  assert.equal((await owned.listModels('native-router-source-workbuddy'))[0].provider,'native-router-source-workbuddy'); assert.equal(owned.stream({provider:'native-router-source-workbuddy'}).original,'workbuddy');
  assert.deepEqual(r.calls,[['models','workbuddy'],['models','workbuddy'],['stream','workbuddy']]); assert.throws(()=>owned.stream({provider:'loomy'}),/Invalid independent source/);
 r.releaseScope();
 assert.equal(r.registry.get('workbuddy'),original);
 assert.equal(r.registry.has('native-router-source-loomy'),false);
 assert.equal(r.registry.has('native-router-source-workbuddy'),false);
});
test('source metadata returned under original provider aliases is normalized and deduplicated',async()=>{
 const r=rig(['native-router','loomy','zcode']);
 const original=r.registry.get('loomy');
 const source={
  ...r.adapter,
  listModels:async()=>[
    {provider:'loomy',id:'spark-x2.6',name:'Spark x2.6',inputModalities:['text']},
    {provider:'loomy',id:'spark-x2.6',name:'duplicate'},
    {provider:'foreign',id:'wrong',name:'foreign'},
     {provider:'loomy',id:String.fromCharCode(10),name:'control'},    {provider:'loomy',id:'glm5',name:'GLM-5',inputModalities:['text']},
  ],
 };
 assert.equal(typeof register(r.ctx,['loomy'],source),'function');
 const alias=r.registry.get('native-router-source-loomy');
 const rows=await alias.listModels('native-router-source-loomy');
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(row=>row.provider),[
   'native-router-source-loomy','native-router-source-loomy']);
 assert.deepEqual(rows.map(row=>row.id),['spark-x2.6','glm5']);
 assert.equal(r.registry.get('loomy'),original);
 r.registry.delete('loomy'); // original Cordis plugin stopped
 assert.equal(r.registry.has('native-router-source-loomy'),true,
   'independent provider must remain after original Loomy unloads');
 assert.equal((await alias.listModels('native-router-source-loomy')).length,2);
 assert.equal(alias.stream({provider:'native-router-source-loomy'}).original,'loomy');
 r.releaseScope();
 assert.equal(r.registry.has('native-router-source-loomy'),false);
});
test('DSH prepareCall and resolveModel contracts are present on every native alias',async()=>{
 const r=rig(['native-router','codearts','loomy','zcode']);
 const native={...r.adapter,
   async resolveModel(provider,model){r.calls.push(['resolve',provider,model]);
     return {provider,id:model,name:'upstream name',reasoning:{efforts:['on']}}},
   async prepareCall(provider,model){r.calls.push(['prepare',provider,model]);
     return {model:{provider,id:model,name:'upstream name',context:{contextWindow:120000}},
       stream:options=>{r.calls.push(['preparedStream',options.provider]);
         return {provider:options.provider}}};}
 };
 for(const provider of ['codearts','loomy','zcode']){
   assert.equal(typeof register(r.ctx,[provider],native),'function');
   const id='native-router-source-'+provider;
   const alias=r.registry.get(id);
   assert.equal(typeof alias.resolveModel,'function');
   assert.equal(typeof alias.prepareCall,'function');
   const model=await alias.resolveModel(id,'test-model');
   assert.equal(model.provider,id);
   assert.deepEqual(model.reasoning,{efforts:['on']});
   const prepared=await alias.prepareCall(id,'test-model');
   assert.equal(prepared.model.provider,id);
   assert.equal(prepared.model.context.contextWindow,120000);
   assert.equal(prepared.stream({provider:id}).provider,provider);
   assert.ok(r.calls.some(x=>x[0]==='prepare'&&x[1]===provider));
 }
  await assert.rejects(r.registry.get('native-router-source-loomy')
    .resolveModel('codearts','test-model'),/Invalid independent source/); r.releaseScope();
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
test('partial source registration rollback releases only aliases from THIS scope',()=>{
 const r=rig(['native-router','workbuddy','native-router-source-loomy']);
 const original=r.registry.get('workbuddy');
 register(r.ctx,['workbuddy'],r.adapter);
 assert.equal(r.registry.has('native-router-source-workbuddy'),true);
 assert.equal(register(r.ctx,['loomy'],r.adapter),undefined);
 assert.equal(r.states.loomy,'alias_occupied');
 rollback(r.ctx);
 assert.equal(r.registry.has('native-router-source-workbuddy'),false);
 assert.equal(r.registry.get('workbuddy'),original);
 assert.equal(r.registry.has('native-router-source-loomy'),true,
  'Pre-existing alias from other/older host scope must NEVER be removed');
});
test('independent internal alias collision fails closed without touching the original host',()=>{
 const r=rig(['native-router','workbuddy','native-router-source-workbuddy']);
 const original=r.registry.get('workbuddy');
 assert.equal(register(r.ctx,['workbuddy'],r.adapter),undefined);
 assert.equal(r.states.workbuddy,'alias_occupied');
 assert.equal(r.writes.length,0);
 assert.equal(r.registry.get('workbuddy'),original);
});
test('missing host provider inventory refuses source registration before any writes',()=>{
 let writes=0;
 const host={listProviders:()=>undefined,registerAdapter:()=>{writes++}};
 const ctx={llm:host,effect(){}},states={};
 exported.nativeSourceAdapterStates.set(ctx,states);
 assert.equal(register(ctx,['workbuddy'],{}),undefined);
 assert.equal(states.workbuddy,'llm_unavailable');
 assert.equal(writes,0);
});
test('one incompatible source model adapter never blocks other independent accounts from loading',()=>{
 const r=rig();
 const original=r.registry.get('workbuddy');
 const delegate=r.host.registerAdapter.bind(r.host);
 r.host.registerAdapter=(ids,adapter)=>{
   if(ids.includes('native-router-source-loomy'))throw Error('local adapter model rejected');
   return delegate(ids,adapter);
 };
 assert.equal(typeof register(r.ctx,['workbuddy'],r.adapter),'function');
 assert.equal(register(r.ctx,['loomy'],r.adapter),undefined);
 assert.equal(r.states.workbuddy,'ready');
 assert.equal(r.states.loomy,'adapter_registration_failed');
 assert.equal(r.registry.get('workbuddy'),original);
 assert.equal(r.registry.has('native-router-source-workbuddy'),true);
 assert.equal(r.registry.has('native-router-source-loomy'),false);
 rollback(r.ctx);
 assert.equal(r.registry.has('native-router-source-workbuddy'),false);
 assert.equal(r.registry.get('workbuddy'),original);
});
test('all independent adapters can reject registration without touching existing host routes',()=>{
 const r=rig();
 const old=r.registry.get('workbuddy');
 const delegate=r.host.registerAdapter.bind(r.host);
 r.host.registerAdapter=(ids,adapter)=>{
   if(ids[0]?.startsWith('native-router-source-'))throw Error('DSH refuses adapter');
   return delegate(ids,adapter);
 };
 for(const provider of ['workbuddy','loomy','qoder']){
   assert.equal(register(r.ctx,[provider],r.adapter),undefined);
   assert.equal(r.states[provider],'adapter_registration_failed');
 }
 assert.deepEqual(r.writes,[]);
 assert.equal(r.registry.get('workbuddy'),old);
});
