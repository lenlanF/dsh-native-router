import test from 'node:test';
import assert from 'node:assert/strict';
import {createExistingDshChannelFacade,createPreferredSourceFacade} from '../src/existing-dsh-channels.mjs';
import {createSessionReuse} from '../src/session-reuse.mjs';
import {normalizeConfig} from '../src/config.mjs';

test('DSH WorkBuddy CN and global registered providers are visible without a shared AccountPool, but never fake logged-in accounts',async()=>{
 const host={providers:[{id:'native-router'},{id:'workbuddy'},{id:'workbuddy-global'},{id:'qoder'}],calls:0};
 const llm={listProviders(){host.calls++;return host.providers},stream(){throw Error('no stream on discovery')}};
 const ctx={llm,get:key=>key==='llm'?llm:undefined};
 const own={status:()=>({state:'disabled',channels:[]})};
 const existing=createExistingDshChannelFacade({ctx,excludedHost:own});
 const preferred=createPreferredSourceFacade({own,existing});
 const snapshot=preferred.status();
 assert.equal(snapshot.state,'disabled');
 assert.equal(snapshot.hostProviders.length,3);
 assert.deepEqual(snapshot.hostProviders.filter(p=>p.family==='workbuddy-native-plugin-route')
  .map(p=>p.providerId),['workbuddy','workbuddy-global']);
 assert.ok(snapshot.hostProviders.every(p=>p.loginVerified===false));
 assert.equal((await existing.listAccounts()).state,'unavailable');
 let cfg=normalizeConfig({sessionReuse:{enabled:true}});
 const configStore={get:()=>structuredClone(cfg),replace:next=>{cfg=normalizeConfig(next)}};
 const reuse=createSessionReuse({configStore,drivers:new Map(),embeddedPack:preferred});
 assert.deepEqual(reuse.snapshot().hostProviders.map(p=>p.providerId),
  ['workbuddy','workbuddy-global','qoder']);
 assert.equal(reuse.snapshot().autoLinked,0);
 await reuse.scan();
 assert.equal(cfg.accounts.length,0,'a registered Host provider does not prove a reusable login');
 assert.equal(cfg.providers.length,0);
 reuse.stop();existing.dispose();assert.ok(host.calls>0);
});
test('original DSH provider models are queried read-only and only on owner demand, independently of account pool',async()=>{
 const calls=[];
 const llm={
  listProviders:()=>[{id:'workbuddy'},{id:'workbuddy-global'},{id:'native-router'}],
  listModels:async provider=>{calls.push(provider);return [{id:'flash-model',provider},{id:'foreign',provider:'another-provider'}]},
 };
 const existing=createExistingDshChannelFacade({ctx:{llm,get:()=>undefined}});
 assert.deepEqual(calls,[],'listing registered host routes must not fetch remote models');
 const result=await existing.listHostModels('workbuddy-global');
 assert.equal(result.state,'ready');
 assert.deepEqual(result.models,[{id:'flash-model',name:'flash-model'}]);
 assert.equal(result.loginVerified,false);
 assert.deepEqual(calls,['workbuddy-global']);
 assert.equal((await existing.listHostModels('native-router')).state,'unavailable');
 assert.equal((await existing.listHostModels('unregistered')).state,'unavailable');
 assert.deepEqual(calls,['workbuddy-global']);
 existing.dispose();
});
test('account provenance survives source changes and rejects invalid metadata',async()=>{
 const {createAccountCenter}=await import('../src/account-center.mjs');
 const id='sp_'+'a'.repeat(24);
 let cfg=normalizeConfig({
  providers:[{id:'qoder',protocol:'native-channel',enabled:true}],
  accounts:[{id,providerId:'qoder',credentialRef:'driver:qoder:'+id,enabled:true}],
  sessionReuse:{enabled:true,linkedIds:[id],linkedOrigins:{[id]:'external-dsh-provider',malformed:'CREDENTIAL_SECRET'}},
 });
 assert.deepEqual(cfg.sessionReuse.linkedOrigins,{[id]:'external-dsh-provider'});
 const store={get:()=>structuredClone(cfg),replace:value=>(cfg=normalizeConfig(value))};
 let state={state:'mounted',borrowedExistingDsh:true};
 const center=createAccountCenter({configStore:store,getSourceStatus:()=>state});
 let source=center.list().accounts[0].origin;
 assert.equal(source.kind,'dsh-account-pool');assert.equal(source.sourceAvailable,true);
 state={state:'mounted',borrowedExistingDsh:false};
 source=center.list().accounts[0].origin;
 assert.equal(source.kind,'dsh-account-pool');assert.equal(source.sourceAvailable,false);
 cfg=normalizeConfig({...cfg,sessionReuse:{...cfg.sessionReuse,linkedOrigins:{[id]:'invalid'}}});
 source=center.list().accounts[0].origin;
 assert.equal(source.kind,'source-unverified');assert.equal(source.loginVerified,false);
});
test('DSH host route enumeration fails closed on malformed or unavailable discovery',()=>{
 for(const llm of [{listProviders:()=>{throw Error('not ready')}},{listProviders:()=>null},
  {listProviders:()=>[{id:'native-router'},{id:'\u0000invalid'},{id:''}]}]){
  const existing=createExistingDshChannelFacade({ctx:{llm,get:()=>undefined}});
  assert.deepEqual(existing.status().hostProviders,[]);
  existing.dispose();
 }
});
