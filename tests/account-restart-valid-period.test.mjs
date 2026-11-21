import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createAccountVerificationStore} from '../src/account-verification-store.mjs';
import {createSourceCheckinCenter} from '../src/source-checkins.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';

const rawId='session-reboot-1', id=sourceAccountOpaqueId('loomy',rawId);
const makeConfig=()=>normalizeConfig({providers:[{id:'own_loomy',protocol:'native-channel',enabled:true}],
 accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,enabled:true}]});
const location=()=>mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'dsh-restart-reuse-'));
const runner=({configStore,verificationStore,clock,counters,autoVerifyMs=15*60*1000})=>{
 const driver={isSourceBridge:true,runtimeReady:true,
  async refresh(){counters.verify++;return {state:'online'}},
  async refreshAccountStatus(){counters.readonly++;return {state:'ready',authVerified:true}}};
 return createAccountCenter({configStore,verificationStore,now:clock,autoVerifyMs,
  drivers:new Map([['own_loomy',driver]])});
};
test('across THREE DSH lifetimes, fresh persisted login is inherited without any upstream account call',async()=>{
 const folder=location();try{
  const file=join(folder,'account-verification.json'), cfg=makeConfig();
  const configStore={get:()=>structuredClone(cfg),replace(){}},counters={verify:0,readonly:0};
  let clock=Date.now();
  const first=runner({configStore,verificationStore:createAccountVerificationStore({path:file}),
   counters,clock:()=>clock});
  await first.verify(id);first.stop();
  assert.equal(counters.verify,1);
  for(let reboot=0;reboot<3;reboot++){
   clock+=60*1000;
   const center=runner({configStore,verificationStore:createAccountVerificationStore({path:file}),
    counters,clock:()=>clock});
   assert.equal(center.list().accounts[0].connectionState,'online');
   await center.autoCheckDue();
   await center.refreshReadOnly();
   assert.equal(counters.verify,1,'restart inside TTL cannot trigger login verification');
   assert.equal(counters.readonly,0,'restart inside TTL cannot trigger second official read-only probe');
   assert.equal(center.list().accounts[0].connectionState,'online');
   center.stop();
  }
  clock+=20*60*1000;
  const expired=runner({configStore,verificationStore:createAccountVerificationStore({path:file}),
   counters,clock:()=>clock});
  await expired.refreshReadOnly();
  assert.equal(counters.readonly,1,'after TTL, one read-only proof is allowed');
  await expired.autoCheckDue();
  assert.equal(counters.verify,1,'fresh read-only proof prevents an immediate second login refresh');
  await expired.refreshReadOnly({force:true});
  assert.equal(counters.readonly,2,'explicit manual refresh bypasses cached period');
  expired.stop();
 }finally{rmSync(folder,{recursive:true,force:true})}
});

test('real account/check-in startup timers reuse a fresh stored login without a network retry',async()=>{
 const cfg=makeConfig(),verificationStore=createAccountVerificationStore();
 verificationStore.set(cfg.accounts[0],{state:'online',at:Date.now()});
 const configStore={get:()=>structuredClone(cfg),replace(){}},counters={verify:0,readonly:0};
 const accountCenter=runner({configStore,verificationStore,clock:()=>Date.now(),counters});
 let statusCalls=0;
 const sourcePack={status:()=>({state:'mounted'}),listAccounts:async()=>({state:'ready',accounts:[{
   id:rawId,providerId:'loomy',enabled:true}]}),
  readSourceStatuses:async()=>{statusCalls++;return {state:'ready',accounts:[{
   accountId:rawId,authVerified:true}]}}};
 const checkinCenter=createCheckinCenter({configStore,accountCenter,sourcePack,
  verificationStore,store:{all:()=>[],blocked:false},intervalMs:60000});
 try{
  checkinCenter.start();accountCenter.start();
  await new Promise(resolve=>setTimeout(resolve,5200));
  assert.deepEqual(counters,{verify:0,readonly:0});
  assert.equal(statusCalls,0,'even five-second postboot verification timer must not query within TTL');
  assert.equal(checkinCenter.snapshot().accounts[0].connectionState,'online');
 }finally{checkinCenter.stop();accountCenter.stop()}
});
test('new credential binding never inherits old verified state, even before old TTL expires',async()=>{
 const cfg=makeConfig(),before=structuredClone(cfg),counters={verify:0,readonly:0};
 let state=cfg;
 const configStore={get:()=>structuredClone(state),replace:v=>(state=normalizeConfig(v))};
 const verificationStore=createAccountVerificationStore(),clock=()=>Date.now();
 const first=runner({configStore,verificationStore,clock,counters});
 await first.verify(id);first.stop();
 state=normalizeConfig({...before,accounts:[{...before.accounts[0],
  credentialRef:'driver:own_loomy:sp_'+'b'.repeat(24)}]});
 const after=runner({configStore,verificationStore,clock,counters});
 assert.equal(after.list().accounts[0].connectionState,'not_checked');
 await after.refreshReadOnly();
 assert.equal(counters.readonly,1,'new binding must receive official validation');
 after.stop();
});

test('on expiry, concurrent startup health requests and an auto tick share ONE official account probe',async()=>{
 const cfg=makeConfig();
 const store=createAccountVerificationStore(),configStore={get:()=>structuredClone(cfg),replace(){}},now=()=>Date.now();
 let signalStart,finish,statusCalls=0,verifyCalls=0;
 const started=new Promise(resolve=>{signalStart=resolve});
 const waiting=new Promise(resolve=>{finish=resolve});
 const driver={isSourceBridge:true,runtimeReady:true,
  async refreshAccountStatus(){statusCalls++;signalStart();await waiting;
   return {state:'ready',authVerified:true}},
  async refresh(){verifyCalls++;return {state:'online'}}};
 const center=createAccountCenter({configStore,verificationStore:store,now,
  drivers:new Map([['own_loomy',driver]])});
 const first=center.refreshReadOnly();
 await started;
 const second=center.refreshReadOnly();
 assert.equal((await center.autoCheckDue()).attempted,0,
  'startup auto-tick must not race an in-flight official status check');
 finish();
 const [one,two]=await Promise.all([first,second]);
 assert.equal(one[0].authVerified,true);
 assert.equal(two[0].authVerified,true);
 assert.equal(statusCalls,1,'two simultaneous startup/render checks must share the same probe');
 assert.equal(verifyCalls,0,'a fresh official proof suppresses duplicate login refresh');
 assert.equal(store.get(cfg.accounts[0]).state,'online');
 center.stop();
});
test('stored negative source auth inherits short retry window, not the full healthy TTL',async()=>{
 const cfg=makeConfig(),start=Date.now();let clock=start,remote=0;
 const verificationStore=createAccountVerificationStore();
 verificationStore.set(cfg.accounts[0],{state:'error',at:start});
 const configStore={get:()=>structuredClone(cfg)};
 const pack={listAccounts:async()=>({state:'ready',accounts:[{
  providerId:'loomy',id:rawId,enabled:true}]}),
  readSourceStatuses:async()=>{remote++;return {state:'ready',accounts:[{
   accountId:rawId,authVerified:true}]}}};
 const fresh=createSourceCheckinCenter({sourcePack:pack,verificationStore,configStore,
  store:{all:()=>[],blocked:false},now:()=>clock});
 await fresh.refresh();
 assert.equal(remote,0,'recent failed state stays cached until the three-minute retry period');
 clock+=4*60*1000;
 await fresh.refresh();
 assert.equal(remote,1,'negative state expired and may be rechecked in the same DSH lifetime');
 assert.equal(fresh.snapshot()[0].connectionState,'online');
 fresh.stop();
});
test('source status from official channel is reused after restart for a known bound member, no repeated credits/status call',async()=>{
 const cfg=makeConfig(),clock=()=>Date.now(),verificationStore=createAccountVerificationStore();
 verificationStore.set(cfg.accounts[0],{state:'online',at:clock()});
 const configStore={get:()=>structuredClone(cfg)};
 let listCalls=0,remoteCalls=0;
 const pack={listAccounts:async()=>{listCalls++;return {state:'ready',accounts:[{
  providerId:'loomy',id:rawId,enabled:true,nickname:'Known source'}]}},
  readSourceStatuses:async()=>{remoteCalls++;return {state:'ready',accounts:[{
  accountId:rawId,authVerified:true,todayCheckedIn:false}]}}};
 const store={all:()=>[],blocked:false};
 for(let reboot=0;reboot<3;reboot++){
  const center=createSourceCheckinCenter({sourcePack:pack,configStore,store,now:clock,
    verificationStore});
  const view=await center.refresh();
  assert.equal(view[0].connectionState,'online','the known bound account retains online state');
  assert.equal(remoteCalls,0,'channel status probe is not repeated simply due to restarting DSH');
  center.stop();
 }
 assert.equal(listCalls,3,'enumerating locally owned sessions is okay and is not a remote auth probe');
 const manual=createSourceCheckinCenter({sourcePack:pack,configStore,store,now:clock,
  verificationStore});
 await manual.refresh({force:true});
 assert.equal(remoteCalls,1,'user explicitly forces source status refresh');
 manual.stop();
});
