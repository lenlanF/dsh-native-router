import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createAccountAdoption} from '../src/account-adoption.mjs';
import {ownedAdoptionIdentity} from '../src/secure-source-adoption.mjs';

function rig({storeKind='file',sourceOnline=true,ownedEnabled=true}={}){
 const orig={id:'qoder-original-01',provider:'qoder',credentialRef:'OLD_QODER_REF',
  nickname:'Original Qoder',enabled:true,refreshable:true};
 const credentials=new Map([['OLD_QODER_REF','TOP_SECRET_ACCOUNT_TOKEN']]);
 const calls=[];
 const vault={
  resolve:async key=>credentials.has(key)?{value:credentials.get(key)}:undefined,
  set:async(key,value)=>{calls.push('set:'+key);credentials.set(key,value)},
  unset:async key=>{calls.push('unset:'+key);credentials.delete(key)},
 };
 const entries=[];
 const pool={store:{kind:storeKind},listAllAccounts:async()=>structuredClone(entries),
  addAccount:async entry=>{calls.push('add-account');entries.push(structuredClone(entry))}};
 const source={
  portableAccounts:async()=>({state:sourceOnline?'ready':'unavailable',
   accounts:sourceOnline?[{providerId:'qoder',accountId:orig.id,
    label:orig.nickname,portable:true}]:[]}),
  portableCredentialSource:async(providerId,accountId)=>sourceOnline
   &&providerId===orig.provider&&accountId===orig.id?{
    providerId,sourceAccountId:accountId,credentialRef:orig.credentialRef,
    nickname:orig.nickname,refreshable:orig.refreshable}:null,
 };
 let cfg=normalizeConfig({embeddedPack:{enabled:ownedEnabled},
  providers:[{id:'qoder',protocol:'dsh-host',models:['qoder-flash'],enabled:true}],
  routes:[{id:'native_qoder',mode:'priority',enabled:true,tiers:[{
   providerId:'qoder',model:'qoder-flash',accountIds:[],free:false}]}]});
 const configStore={get:()=>structuredClone(cfg),replace:x=>(cfg=normalizeConfig(x))};
 let invalidated=0;
 const ownPack={status:()=>({state:'mounted',skippedProviders:['qoder']}),
  ownedAdoptionContext:()=>({pool,credentials:vault})};
 const adoption=createAccountAdoption({configStore,originalSource:source,ownedPack:ownPack,
  adapter:{invalidateCatalog(){invalidated++}},makeCredentialRef:x=>x});
 return {adoption,configStore,entries,calls,credentials,source,
  get cfg(){return cfg},get invalidated(){return invalidated},disableSource(){
   sourceOnline=false;credentials.delete('OLD_QODER_REF');
  }};
}
test('owner-consented account adoption stores a distinct private encrypted-vault reference and survives original logout/uninstall',async()=>{
 const r=rig();
 const preview=await r.adoption.preview();
 assert.equal(preview.accounts.length,1);
 assert.doesNotMatch(JSON.stringify(preview),/OLD_QODER_REF|TOP_SECRET/);
 const result=await r.adoption.adopt({providerId:'qoder',accountId:'qoder-original-01',consent:true});
 assert.equal(result.state,'stored_unverified');
 assert.equal(result.activation,'requires_original_stop_and_host_restart');
 assert.equal(result.originalAccountUnchanged,true);
 assert.equal(r.cfg.providers[0].protocol,'dsh-host','original provider remains unchanged');
 assert.equal(r.cfg.providers.find(p=>p.id==='own_qoder').protocol,'native-channel');
 assert.equal(r.cfg.routes[0].tiers[0].providerId,'qoder');
 assert.equal(r.cfg.routes[0].tiers[1].providerId,'own_qoder');
 assert.ok(r.cfg.routes.some(route=>route.id==='owned_qoder'&&route.enabled));
 assert.equal(r.cfg.accounts.length,1);
 assert.equal(r.cfg.accounts[0].providerId,'own_qoder');
 assert.equal(r.cfg.accounts[0].credentialRef,'driver:own_qoder:'+sourceAccountOpaqueId('qoder',r.entries[0].id));
 const dest=ownedAdoptionIdentity('qoder','qoder-original-01').credentialName;
 assert.equal(r.credentials.get(dest),'TOP_SECRET_ACCOUNT_TOKEN');
 assert.equal(r.credentials.get('OLD_QODER_REF'),'TOP_SECRET_ACCOUNT_TOKEN');
 assert.doesNotMatch(JSON.stringify(result)+JSON.stringify(r.cfg)+JSON.stringify(r.entries),
  /TOP_SECRET_ACCOUNT_TOKEN|OLD_QODER_REF/);
 r.disableSource();
 assert.equal(r.credentials.get('OLD_QODER_REF'),undefined);
 assert.equal(r.credentials.get(dest),'TOP_SECRET_ACCOUNT_TOKEN',
  'owned credential remains available after original plugin credential deletion');
 assert.equal(r.entries[0].provider,'qoder');
 assert.equal(r.cfg.sessionReuse.linkedOrigins[r.cfg.accounts[0].id],'own-source-pack');
 assert.equal(r.invalidated,1);
 const repeated=await r.adoption.adopt({providerId:'qoder',accountId:'qoder-original-01',consent:true});
 assert.equal(repeated.state,'stored_unverified','owner can safely reconcile a completed private copy');
 assert.equal(r.entries.length,1,'no duplicate account or credential overwrite');
});
test('adoption never scans secrets or writes credentials without per-account consent and durable source storage',async()=>{
 const r=rig();
 const noConsent=await r.adoption.adopt({providerId:'qoder',accountId:'qoder-original-01'});
 assert.equal(noConsent.state,'consent_required');
 assert.deepEqual(r.calls,[]);
 const memory=rig({storeKind:'memory'});
 assert.equal((await memory.adoption.adopt({
  providerId:'qoder',accountId:'qoder-original-01',consent:true})).state,'unavailable');
 assert.deepEqual(memory.calls,[]);
 const off=rig({ownedEnabled:false});
 assert.equal((await off.adoption.adopt({providerId:'qoder',accountId:'qoder-original-01',consent:true})).state,'native_login_disabled');
 assert.deepEqual(off.calls,[]);
});
test('original plugin-owned sessions without portable AccountPool credential cannot be falsely adopted',async()=>{
 const r=rig({sourceOnline:false});
 assert.equal((await r.adoption.adopt({
  providerId:'qoder',accountId:'qoder-original-01',consent:true})).state,'not_transferable');
 assert.equal((await r.adoption.adopt({
  providerId:'workbuddy-global',accountId:'private',consent:true})).state,'unsupported');
 assert.deepEqual(r.calls,[]);
});
test('after original plugin disappears, owned channel serves the model from its private credential store',async()=>{
 const {createSourceChannelDriver}=await import('../src/source-channel-driver.mjs');
 const {createNativeRouterAdapter}=await import('../src/adapter.mjs');
 const r=rig();
 assert.equal((await r.adoption.adopt({providerId:'qoder',
  accountId:'qoder-original-01',consent:true})).state,'stored_unverified');
 r.disableSource();
 const privateRef=ownedAdoptionIdentity('qoder','qoder-original-01').credentialName;
 const ownPack={
  status:()=>({state:'mounted',channels:['qoder']}),
  listAccounts:async()=>({state:'ready',accounts:r.entries.map(entry=>({
   id:entry.id,providerId:entry.provider,enabled:entry.enabled,nickname:entry.nickname}))}),
  listModels:async providerId=>({state:'ready',providerId,models:[{id:'qoder-flash'}]}),
  streamNative:async ({providerId,sourceAccountId,model})=>{
   assert.equal(providerId,'qoder');
   assert.equal(sourceAccountId,r.entries[0].id);
   assert.equal(model,'qoder-flash');
   assert.equal(r.credentials.get('OLD_QODER_REF'),undefined);
   assert.equal(r.credentials.get(privateRef),'TOP_SECRET_ACCOUNT_TOKEN');
   return (async function*(){
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:'owned channel completed'};
    yield {type:'block-end',index:0,block:{type:'text',text:'owned channel completed'}};
    yield {type:'finish',reason:{kind:'stop'}};
   })();
  },
 };
 const driver=createSourceChannelDriver({providerId:'qoder',accountProviderId:'own_qoder',
  embeddedPack:ownPack});
 const adapter=createNativeRouterAdapter({configStore:r.configStore,
  channelDrivers:new Map([['own_qoder',driver]]),
  env:{},vault:{resolve:async()=>{throw Error('no original credential access')}}});
 const listed=await adapter.listModels();
 assert.ok(listed.some(m=>m.id==='chain:owned_qoder'),
   'owned model is published after original provider has gone');
 const events=[];
 for await(const item of adapter.stream({model:'chain:owned_qoder',
  messages:[{role:'user',content:[{type:'text',text:'hello'}]}]}))events.push(item);
 assert.equal(events.find(x=>x.type==='text-delta')?.text,'owned channel completed');
 assert.deepEqual(events.at(-1),{type:'finish',reason:{kind:'stop'}});
});
test('adopted account keeps its own daily check-in binding after the original source disappears',async()=>{
 const {createSourceCheckinCenter}=await import('../src/source-checkins.mjs');
 const r=rig();
 assert.equal((await r.adoption.adopt({providerId:'qoder',
  accountId:'qoder-original-01',consent:true})).state,'stored_unverified');
 r.disableSource();
 const own=r.entries[0],history=[],calls=[];
 const sourcePack={
  status:()=>({state:'mounted',channels:['qoder']}),
  listAccounts:async()=>({state:'ready',accounts:[{
   id:own.id,providerId:own.provider,nickname:own.nickname,enabled:true}]}),
  checkinAccount:async args=>{calls.push(args);return {confirmed:true,message:'今日签到确认'}},
 };
 const center=createSourceCheckinCenter({sourcePack,configStore:r.configStore,
  store:{all:()=>[...history],append:entry=>(history.push(entry),entry)},
  now:()=>Date.parse('2026-11-18T04:00:00Z')});
 const state=await center.refresh();
 assert.equal(state.length,1);
 assert.equal(state[0].checkinSupported,true);
 assert.equal(state[0].autoCheckin,true);
 const opaqueId=sourceAccountOpaqueId('qoder',own.id);
 const result=await center.run(opaqueId);
 assert.equal(result.record.state,'success');
 assert.deepEqual(calls,[{providerId:'qoder',sourceAccountId:own.id}]);
 assert.equal(r.credentials.get('OLD_QODER_REF'),undefined);
 center.stop();
});
