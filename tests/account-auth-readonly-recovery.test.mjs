import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createAccountVerificationStore} from '../src/account-verification-store.mjs';

const id='sp_'+'a'.repeat(24),pid='own_loomy';
const original=normalizeConfig({
 providers:[{id:pid,name:'Loomy',protocol:'native-channel',enabled:true}],
 accounts:[{id,providerId:pid,credentialRef:'driver:'+pid+':'+id,enabled:true}],
});
function rig({read,refresh,initial=original,autoVerifyMs=15*60*1000}={}){
 let clock=Date.now(),cfg=initial,attempts=0,readCount=0;
 const configStore={get:()=>structuredClone(cfg),replace:v=>(cfg=normalizeConfig(v))};
 const store=createAccountVerificationStore();
 const driver={
  refresh:async()=>{attempts++;return refresh?.()??{state:'error'}},
  refreshAccountStatus:async()=>{readCount++;return read?.()??{state:'ready',authVerified:true}},
 };
 const center=createAccountCenter({configStore,drivers:new Map([[pid,driver]]),
  verificationStore:store,autoVerifyMs,now:()=>clock});
 return {center,configStore,store,advance:ms=>(clock+=ms),
  get attempts(){return attempts},get readCount(){return readCount}};
}

test('positive official read-only authentication corrects stale post-restart account error',async()=>{
 const r=rig();
 await r.center.verify(id);
 assert.equal(r.center.list().accounts[0].connectionState,'error');
 assert.equal(r.store.get(original.accounts[0]).state,'error');
 const result=await r.center.refreshReadOnly({force:true});
 assert.equal(result[0].authVerified,true);
 assert.equal(r.center.list().accounts[0].connectionState,'online',
  'official exact-account authenticated status should heal stale local startup failure');
 assert.ok(r.center.list().accounts[0].lastVerifiedAt>0);
 assert.equal(r.store.get(original.accounts[0]).state,'online',
  'read-only proof must persist across next DSH restart without storing credentials');
 assert.equal(r.attempts,1,'recovery does not trigger chat inference or extra login refresh');
});

test('confirmed upstream expiration supersedes old verified-online status at manual check',async()=>{
 let answer={state:'expired',authVerified:false};
 const r=rig({refresh:()=>({state:'online'}),read:()=>answer});
 await r.center.verify(id);
 const before=r.store.get(original.accounts[0]);
 assert.equal(before.state,'online');
 r.advance(60*1000);
 const reported=await r.center.refreshReadOnly({force:true});
 assert.equal(reported[0].state,'expired');
 assert.equal(r.center.list().accounts[0].connectionState,'expired',
  'definitively rejected credentials must not retain online routing qualification');
 const after=r.store.get(original.accounts[0]);
 assert.equal(after.state,'expired');
 assert.equal(after.verifiedAt,before.verifiedAt,
  'historical last-success timestamp remains informational, not current authorization');
 await r.center.refreshReadOnly();
 assert.equal(r.readCount,1,'10-minute expired cooldown suppresses further automatic status calls');
});
test('manual confirmed-online recheck extends the original verification window',async()=>{
 const r=rig({refresh:()=>({state:'online'}),read:()=>({state:'online',authVerified:true})});
 await r.center.verify(id);
 const first=r.store.get(original.accounts[0]).checkedAt;
 r.advance(12*60*1000);
 await r.center.refreshReadOnly({force:true});
 const second=r.store.get(original.accounts[0]).checkedAt;
 assert.ok(second>first,'manual successful probe must persist the new absolute timestamp');
 r.advance(5*60*1000);
 assert.equal((await r.center.autoCheckDue()).attempted,0,
  'no duplicate refresh should run at old deadline after a new official success');
 assert.equal(r.attempts,1);
});
test('ambiguous read-only transport outage cannot revoke a still-valid verified login',async()=>{
 const r=rig({refresh:()=>({state:'online'}),
  read:()=>({state:'unavailable',authVerified:false})});
 await r.center.verify(id);
 await r.center.refreshReadOnly({force:true});
 assert.equal(r.center.list().accounts[0].connectionState,'online');
 assert.equal(r.store.get(original.accounts[0]).state,'online');
});
test('a source merely returning a catalog or account metadata cannot change expired into online',async()=>{
 const r=rig({refresh:()=>({state:'expired'}),
  read:()=>({state:'ready',balance:100,modelCount:6})});
 await r.center.verify(id);
 await r.center.refreshReadOnly({force:true});
 assert.equal(r.center.list().accounts[0].connectionState,'expired');
 assert.equal(r.store.get(original.accounts[0]).state,'expired');
});
test('late official success never reauthorizes an account disabled while read-only call was in-flight',async()=>{
 let finish,started;
 const waiting=new Promise(resolve=>{finish=resolve});
 const signal=new Promise(resolve=>{started=resolve});
 const r=rig({read:async()=>{started();await waiting;return {state:'ready',authVerified:true}}});
 await r.center.verify(id);
 const pending=r.center.refreshReadOnly({force:true});
 await signal;
 r.configStore.replace({...r.configStore.get(),accounts:[{
   ...r.configStore.get().accounts[0],enabled:false}]});
 finish();await pending;
 assert.equal(r.center.list().accounts[0].connectionState,'disabled');
 assert.equal(r.store.get(original.accounts[0]).state,'error');
 r.configStore.replace({...r.configStore.get(),accounts:[{
   ...r.configStore.get().accounts[0],enabled:true}]});
 assert.equal(r.center.list().accounts[0].connectionState,'error');
});
test('self-owned source-pack accounts are not marked failed while the provider is still mounting after host restart',async()=>{
 let ready=false,calls=0;
 const cfg=normalizeConfig({providers:[{id:pid,protocol:'native-channel',enabled:true}],
  accounts:[{id,providerId:pid,credentialRef:'driver:'+pid+':'+id,enabled:true}]});
 const store=createAccountVerificationStore();
 const center=createAccountCenter({configStore:{get:()=>structuredClone(cfg),replace(){}},
  verificationStore:store,drivers:new Map([[pid,{
   isSourceBridge:true,get runtimeReady(){return ready},
   async refresh(){calls++;return {state:'online'}}}]]),now:()=>Date.now()});
 assert.equal((await center.autoCheckDue()).attempted,0,
  'private pack not ready must not poison persistent verification cache with startup error');
 assert.equal(calls,0);
 assert.equal(store.get(cfg.accounts[0]),null);
 ready=true;
 assert.equal((await center.autoCheckDue()).attempted,1);
 assert.equal(calls,1);
 assert.equal(store.get(cfg.accounts[0]).state,'online');
});
test('transient auto verification error retries after a bounded short interval, not the full healthy interval',async()=>{
 let outcome={state:'error'};
 const r=rig({refresh:()=>outcome});
 await r.center.verify(id);
 assert.equal(r.attempts,1);
 r.advance(2*60*1000);
 assert.equal((await r.center.autoCheckDue()).attempted,0);
 assert.equal(r.attempts,1);
 r.advance(2*60*1000);
 outcome={state:'online'};
 assert.equal((await r.center.autoCheckDue()).attempted,1);
 assert.equal(r.center.list().accounts[0].connectionState,'online');
 assert.equal(r.attempts,2);
 r.advance(3*60*1000);
 assert.equal((await r.center.autoCheckDue()).attempted,0,
  'successful accounts retain the original long cooldown');
});
test('confirmed expired account gets a slower retry than network errors, preventing login-refresh storms',async()=>{
 let outcome={state:'expired'};
 const r=rig({refresh:()=>outcome});
 await r.center.verify(id);
 r.advance(4*60*1000);
 assert.equal((await r.center.autoCheckDue()).attempted,0);
 r.advance(7*60*1000);
 outcome={state:'online'};
 assert.equal((await r.center.autoCheckDue()).attempted,1);
 assert.equal(r.center.list().accounts[0].connectionState,'online');
});
