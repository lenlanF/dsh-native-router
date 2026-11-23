import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createAccountVerificationStore} from '../src/account-verification-store.mjs';

const ownedId='wbp_'+'a'.repeat(24);
const providerId='own_workbuddy-cn';
const binding='driver:'+providerId+':'+ownedId;
function makeConfig(){
 return normalizeConfig({
  providers:[{id:providerId,name:'Private WorkBuddy',protocol:'native-channel',
    models:['test-model'],enabled:true}],
  accounts:[{id:ownedId,providerId,credentialRef:binding,enabled:true}],
  sessionReuse:{linkedIds:[ownedId],linkedOrigins:{[ownedId]:'own-source-pack'}},
 });
}
function rig({cfg,store,now,driver}){
 let current=cfg;
 const configStore={get:()=>structuredClone(current),replace(value){current=normalizeConfig(value);return structuredClone(current)}};
 const drivers=new Map([[providerId,{refresh:driver??(async()=>({state:'online',message:'remote catalog verified'}))}]]);
 const center=createAccountCenter({configStore,drivers,verificationStore:store,now,autoVerifyMs:60000});
 return {center,configStore};
}
test('previously verified WorkBuddy remains known after reload and auto-rechecks without explicit click',async()=>{
 const home=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'dsh-reuse-state-'));
 try{
  const path=join(home,'verified.json');
  const cfg=makeConfig();let clock=Date.now(),probes=0;
  let reply={state:'online',message:'Synthetic catalog accepted'};
  const driver=async()=>{probes++;return reply};
  const first=rig({cfg,store:createAccountVerificationStore({path}),now:()=>clock,driver});
  assert.equal((await first.center.verify(ownedId)).state,'online');
  assert.equal(first.center.list().accounts[0].connectionState,'online');
  const raw=readFileSync(path,'utf8');
  assert.doesNotMatch(raw,/accessToken|refreshToken|credentialRef|Bearer|driver:|Synthetic catalog accepted/);
  assert.equal(JSON.parse(raw).checks.length,1);
  const second=rig({cfg,store:createAccountVerificationStore({path}),now:()=>clock,driver});
  assert.equal(second.center.list().accounts[0].connectionState,'online');
  assert.equal(second.center.list().accounts[0].lastVerifiedAt,clock);
  assert.equal((await second.center.autoCheckDue()).attempted,0,'a fresh success is not re-probed each page render');
  clock+=31*60*1000;
  assert.equal(second.center.list().accounts[0].connectionState,'recently_verified');
  assert.equal((await second.center.autoCheckDue()).attempted,1);
  assert.equal(second.center.list().accounts[0].connectionState,'online');
  reply={state:'error',message:'synthetic temporary outage'};
  clock+=16*60*1000;
  await second.center.autoCheckDue();
  assert.equal(second.center.list().accounts[0].connectionState,'error');
  assert.ok(second.center.list().accounts[0].lastVerifiedAt>0,'network errors preserve earlier proof');
  reply={state:'expired',message:'synthetic 401'};
  clock+=16*60*1000;
  await second.center.autoCheckDue();
  assert.equal(second.center.list().accounts[0].connectionState,'expired');
  assert.equal(probes,4);
 }finally{rmSync(home,{recursive:true,force:true})}
});
test('restart warms account name and quotas once even when persisted auth remains fresh',async()=>{
 const cfg=makeConfig(),account=cfg.accounts[0];
 const store=createAccountVerificationStore(),clock=Date.now();
 store.set(account,{state:'online',at:clock});
 let requests=0;
 const build=()=>{
  const snapshots=new Map();
  const driver={
   async refresh({account}){
    requests++;
    snapshots.set(account.id,{accountName:'官方已验证会员昵称',
     balance:81,balanceUnit:'积分',balanceCheckedAt:clock});
    return {state:'online'};
   },
   accountSnapshot:account=>snapshots.get(account.id)??{},
  };
  const configStore={get:()=>structuredClone(cfg),replace:v=>normalizeConfig(v)};
  return createAccountCenter({configStore,verificationStore:store,
   drivers:new Map([[account.providerId,driver]]),now:()=>clock});
 };
 const before=build();
 assert.equal(before.list().accounts[0].connectionState,'online');
 assert.equal(before.list().accounts[0].nickname,undefined,'post-restart memory is initially empty');
 assert.equal((await before.autoCheckDue()).attempted,1);
 assert.equal(before.list().accounts[0].nickname,'官方已验证会员昵称');
 assert.equal(before.list().accounts[0].balance,81);
 assert.equal((await before.autoCheckDue()).attempted,0,'do not query upstream on every page render');
 before.stop();
 const after=build();
 assert.equal((await after.autoCheckDue()).attempted,1,
  'a fresh Host lifetime must reconstruct its ephemeral public profile');
 assert.equal(requests,2);
 after.stop();
});
test('credential reference change invalidates earlier approval, and disable clears cached state',async()=>{
 const account=makeConfig().accounts[0],store=createAccountVerificationStore(),clock=Date.now();
 store.set(account,{state:'online',at:clock});
 assert.equal(store.get(account).state,'online');
 assert.equal(store.get({...account,credentialRef:'driver:'+providerId+':different'}),null);
 const r=rig({cfg:makeConfig(),store,now:()=>clock});
 r.center.setEnabled(ownedId,false);
 assert.equal(r.center.list().accounts[0].connectionState,'disabled');
 assert.equal(store.get(account),null);
});
test('pending read-only verification cannot reinstate an account disabled before the reply completes',async()=>{
 const account=makeConfig().accounts[0],store=createAccountVerificationStore();
 let release,started;
 const began=new Promise(resolve=>{started=resolve});
 const hold=new Promise(resolve=>{release=resolve});
 const h=rig({cfg:makeConfig(),store,now:()=>Date.now(),driver:async()=>{
   started();await hold;return {state:'online',message:'stale accepted'};
 }});
 const pending=h.center.verify(ownedId);
 await began;
 h.center.setEnabled(ownedId,false);
 release();
 const stale=await pending;
 assert.notEqual(stale.state,'online');
 assert.equal(store.get(account),null,'disabled account must not regain persisted verified state');
 h.center.setEnabled(ownedId,true);
 assert.notEqual(h.center.list().accounts[0].connectionState,'online');
 h.center.stop();
});

test('pending read-only verification cannot commit success after its provider is disabled',async()=>{
 const account=makeConfig().accounts[0],store=createAccountVerificationStore();
 let release,started;
 const began=new Promise(resolve=>{started=resolve});
 const hold=new Promise(resolve=>{release=resolve});
 const h=rig({cfg:makeConfig(),store,now:()=>Date.now(),driver:async()=>{
   started();await hold;return {state:'online',message:'stale accepted'};
 }});
 const pending=h.center.verify(ownedId);
 await began;
 const cfg=h.configStore.get();
 h.configStore.replace({...cfg,providers:cfg.providers.map(p=>({...p,enabled:false}))});
 release();
 assert.notEqual((await pending).state,'online');
 assert.equal(store.get(account),null);
 h.center.stop();
});

test('unapproved host sources and unrelated generic accounts never start automatic model probes',async()=>{
 let calls=0;
 const cfg=normalizeConfig({
  providers:[{id:'example',protocol:'openai-chat',baseUrl:'https://example.invalid'}],
  accounts:[{id:'one',providerId:'example',credentialRef:'env:SECRET'}],
 });
 const current={get:()=>structuredClone(cfg),replace:value=>normalizeConfig(value)};
 const center=createAccountCenter({configStore:current,verificationStore:createAccountVerificationStore(),
  env:{SECRET:'unused'},fetchImpl:async()=>{calls++;throw Error('must not issue request')}});
 assert.deepEqual(await center.autoCheckDue(),{attempted:0});
 assert.equal(calls,0);
});
test('damaged verification records are refused without overwriting existing contents',()=>{
 const home=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'dsh-reuse-damaged-'));
 try{
  const path=join(home,'verified.json');
  writeFileSync(path,'{damaged evidence');
  const store=createAccountVerificationStore({path});
  assert.equal(store.writable,false);
  assert.equal(store.get(makeConfig().accounts[0]),null);
  store.set(makeConfig().accounts[0],{state:'online',at:Date.now()});
  assert.equal(readFileSync(path,'utf8'),'{damaged evidence');
  }finally{rmSync(home,{recursive:true,force:true,maxRetries:20,retryDelay:100})}
});
