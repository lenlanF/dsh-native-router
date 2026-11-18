import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {attachHostFailover} from '../src/host-failover.mjs';
import {applyWith} from '../src/index.mjs';
import {sample} from './fixtures.mjs';

function bus(){
 const handlers=new Map();const log=[];
 const ctx={
  on(event,fn){handlers.set(event,fn);return()=>handlers.delete(event)},
  logger:{info:message=>log.push(message),warn:message=>log.push(message)},
  llm:{resolveCallConfig:async()=>{},registerAdapter:()=>()=>{},registerModelDiscovery:()=>()=>{},registerConfigurableProviders:()=>()=>{}},
  effect(){},
 };
 const emit=async(name,payload,next=async()=>({kind:'enter'}))=>{const fn=handlers.get(name);
   if(!fn)throw Error('No handler '+name);return fn(payload,next)};
 return {ctx,emit,handlers,log};
}
const nextTick=()=>new Promise(resolve=>setTimeout(resolve,10));
function agent(initial){
 let current={...initial};const selections=[],followups=[];
 return {id:'s1',status:'idle',model:{
   current:()=>({...current}),
   select:x=>{current={...x};selections.push(x)},
 },selections,followups,followup:x=>followups.push(x)};
}
test('native router registers a DSH provider and its host-failover listeners together',()=>{
 const {ctx,handlers}=bus();const adapters=[];
 ctx.llm.registerAdapter=(providers,adapter)=>{adapters.push({providers,adapter});return()=>{}};
 const configStore={get:()=>normalizeConfig(sample),replace:()=>normalizeConfig(sample)};
 const dispose=applyWith(ctx,{configStore,createUserMessage:async obj=>({id:'r1',...obj})});
 assert.deepEqual(adapters[0].providers,['native-router']);
 assert.equal(typeof adapters[0].adapter.prepareCall,'function');
 assert.ok(handlers.has('agent/pre-step'));
 assert.ok(handlers.has('agent/request-error'));
 dispose();assert.equal(handlers.size,0);
});
test('host-level quota failure switches DSH session to next chosen model',async()=>{
 const cfg=normalizeConfig({...sample,hostFailover:{
   enabled:true,mode:'off',priority:[{provider:'native-router',model:'chain:daily'},
    {provider:'native-router',model:'direct:alpha:gpt-like'}],
 }});
 let snapshot=cfg;const store={get:()=>structuredClone(snapshot),replace:v=>{snapshot=normalizeConfig(v)}};
 const {ctx,emit,handlers}=bus();const a=agent({provider:'native-router',model:'chain:daily'});
 ctx.agents={get:()=>a};
 const plug=attachHostFailover(ctx,{configStore:store,createUserMessage:async row=>({id:'retry-1',...row})});
 await emit('agent/request-error',{agent:a,provider:'native-router',model:'chain:daily',
  failure:{code:'QUOTA',status:402,message:'account exhausted'},signal:{aborted:false},turn:1,step:1},
  async()=>({kind:'give-up'}));
 await emit('agent/status',{agent:a,status:'idle'});
 await nextTick();
 assert.equal(a.model.current().model,'direct:alpha:gpt-like');
 assert.equal(a.followups.length,1);
 assert.equal(a.followups[0].source.kind,'retry');
 assert.ok(snapshot.hostFailover.exhaustedRoutes['native-router/chain:daily']);
 plug.dispose();assert.equal(handlers.size,0);
});
test('strict free mode rejects step if free route is missing, including paid selection',async()=>{
 const cfg=normalizeConfig({...sample,hostFailover:{
   enabled:true,mode:'free',priority:[{provider:'native-router',model:'chain:daily',free:false}],
 }});
 const {ctx,emit}=bus(),a=agent({provider:'native-router',model:'chain:daily'});
 const plug=attachHostFailover(ctx,{configStore:{get:()=>cfg,replace:()=>{}}});
 const result=await emit('agent/pre-step',{agent:a,messages:[]},async()=>({kind:'enter'}));
 assert.deepEqual(result,{kind:'reject'});
 assert.equal(a.selections.length,0);
 plug.dispose();
});
test('human message cancels queued automatic failover intent',async()=>{
 const cfg=normalizeConfig({...sample,hostFailover:{enabled:true,mode:'off',
  priority:[{provider:'native-router',model:'chain:daily'},{provider:'native-router',model:'direct:alpha:gpt-like'}]}});
 const {ctx,emit}=bus(),a=agent({provider:'native-router',model:'chain:daily'});
 ctx.agents={get:()=>a};
 const plug=attachHostFailover(ctx,{configStore:{get:()=>cfg,replace:()=>{}},createUserMessage:async()=>({id:'r1',content:[],source:{kind:'retry'}})});
 await emit('agent/request-error',{agent:a,failure:{code:'SERVER'},turn:1,step:1,signal:{aborted:false}},async()=>({kind:'give-up'}));
 await emit('agent/inbox/inserted',{agent:a,message:{source:{kind:'user'},content:[{type:'text',text:'new instruction'}]}});
 await emit('agent/status',{agent:a,status:'idle'});await nextTick();
 assert.equal(a.followups.length,0);
 plug.dispose();
});

test('built-in WorkBuddy driver is registered only while DSH plugin runs',async()=>{
 const {getNativeChannelDrivers}=await import('../src/driver-registry.mjs');
 assert.equal(getNativeChannelDrivers().has('workbuddy'),false);
 const {ctx}=bus();
 const cfg={get:()=>normalizeConfig(sample),replace:()=>normalizeConfig(sample)};
 const dispose=applyWith(ctx,{configStore:cfg,env:{USERPROFILE:'Z:\\Nonexistent\\Local',
   LOCALAPPDATA:'Z:\\Nonexistent\\Local',APPDATA:'Z:\\Nonexistent\\Roaming'},
   fetchImpl:async()=>{throw Error('No network action authorized at plugin startup')}});
 assert.equal(typeof getNativeChannelDrivers().get('workbuddy')?.discover,'function');
 assert.equal(typeof getNativeChannelDrivers().get('workbuddy')?.generate,'function');
 dispose();
 assert.equal(getNativeChannelDrivers().has('workbuddy'),false);
});
test('native router withdraws its Connection-authenticated admin routes injection on dispose',()=>{
  const {ctx}=bus();
  const installs=[],removed=[];
  ctx.registry={delete(fn){removed.push(fn);return {removed:true}}};
  ctx.inject=(names,fn)=>{assert.deepEqual(names,['connection']);installs.push(fn)};
 const cfg={get:()=>normalizeConfig(sample),replace:()=>normalizeConfig(sample)};
 const cleanup=applyWith(ctx,{configStore:cfg,channelDrivers:new Map()});
 assert.equal(installs.length,1);
 cleanup();cleanup();
 assert.equal(removed.length,1);
 assert.equal(removed[0],installs[0]);
});
