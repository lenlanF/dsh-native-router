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
 }finally{rmSync(home,{recursive:true,force:true})}
});
