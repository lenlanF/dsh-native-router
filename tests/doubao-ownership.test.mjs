import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

const COOKIE='sessionid=isolated-test-session-value-abcdef; uid_tt=88220011';
function rig({rejectSave=false,rejectMember=false,wrongUserOnRotation=false}={}){
 const stored=new Map();
 let cfg=normalizeConfig({});
 const vault={
  async resolve(key){return stored.get(key)},
  async set(key,val){stored.set(key,{value:val})},
  async unset(key){stored.delete(key)},
 };
 const driver=createDoubaoDriver({vault,getAccounts:()=>cfg.accounts,
  fetchImpl:async(input,options={})=>{
  if(new URL(input).pathname!=='/passport/account/info/v2/')
   throw Error('Unexpected model call during credential ownership tests');
  const cookie=options.headers?.Cookie??'';
  return new Response(JSON.stringify(rejectMember?{code:710012001,msg:'Session expired'}:
   {code:0,data:{user_id_str:wrongUserOnRotation&&cookie.includes('rotated')?
    'different-member-202':'member-101',screen_name:'真实豆包会员'}}),
   {status:200,headers:{'content-type':'application/json'}});
 }});
 const configStore={
  get:()=>structuredClone(cfg),
  replace:value=>{
   if(rejectSave)throw Error('Simulated config persistence failure');
   cfg=normalizeConfig(value);return structuredClone(cfg);
  },
 };
 const drivers=new Map([['own_doubao',driver]]);
 const center=createAccountCenter({configStore,drivers});
 return {stored,driver,center,drivers,get config(){return cfg},
  replaceConfig:raw=>{cfg=normalizeConfig(raw)}};
}
test('Doubao failed config persistence removes only newly imported private credentials',async()=>{
 const h=rig({rejectSave:true});
 await assert.rejects(()=>h.center.addDoubaoCookie({cookie:COOKIE}),
  /Simulated config persistence failure/);
 assert.equal(h.stored.size,0,'no orphan token after failed DSH config save');
 assert.equal(h.config.accounts.length,0);
 assert.equal(h.config.providers.length,0);
 h.center.stop();
});
test('Doubao reauthorization refreshes the same independently owned account without creating duplicates',async()=>{
 const h=rig();
 const first=await h.center.addDoubaoCookie({cookie:COOKIE});
 const storedKey=[...h.stored.keys()][0];
 const original=h.stored.get(storedKey).value;
 const another=await h.center.addDoubaoCookie({cookie:COOKIE.replace('abcdef','rotated')});
 assert.equal(another.alreadyOwned,true);
 assert.equal(first.id,another.id);
 assert.notEqual(h.stored.get(storedKey).value,original,'new valid login must update the stale session');
 assert.match(h.stored.get(storedKey).value,/rotated/);
 assert.equal(h.config.accounts.length,1);
 h.center.stop();
});
test('Doubao browser profile rotation keeps server-verified member ID and account history stable',async()=>{
 const h=rig();
 const first=await h.center.addDoubaoCookie({cookie:COOKIE});
 const changed=COOKIE.replace('uid_tt=88220011','uid_tt=NEW_DEVICE_31337')
  .replace('abcdef','fresh-complete-session');
 const second=await h.center.addDoubaoCookie({cookie:changed});
 assert.equal(second.id,first.id);
 assert.equal(second.alreadyOwned,true);
 assert.equal(h.config.accounts.length,1);
 assert.equal(h.stored.size,1);
 assert.match([...h.stored.values()][0].value,/NEW_DEVICE_31337/);
 h.center.stop();
});
test('canceling a browser reauthorization restores previous credential without deleting existing account',async()=>{
 const h=rig();
 const first=await h.center.addDoubaoCookie({cookie:COOKIE});
 const key=[...h.stored.keys()][0],before=h.stored.get(key).value;
 const renewed=await h.driver.addCookie({cookie:COOKIE.replace('abcdef','browser-refresh'),stageRollback:true});
 assert.equal(renewed.id,first.id);
 assert.equal(renewed.alreadyOwned,true);
 assert.equal(typeof renewed.rollbackToken,'string');
 assert.notEqual(h.stored.get(key).value,before);
 await h.driver.rollbackCandidate({account:renewed});
 assert.equal(h.stored.get(key).value,before);
 assert.equal(h.config.accounts.length,1);
 h.center.stop();
});

test('completed browser reauthorization retains refreshed credential; stale cancellation does not roll it back',async()=>{
 const h=rig();
 const first=await h.center.addDoubaoCookie({cookie:COOKIE});
 const key=[...h.stored.keys()][0];
 const renewed=await h.driver.addCookie({cookie:COOKIE.replace('abcdef','successful-renewal'),stageRollback:true});
 h.driver.completeCandidate({account:renewed});
 const current=h.stored.get(key).value;
 await h.driver.rollbackCandidate({account:renewed});
 assert.equal(h.stored.get(key).value,current);
 assert.equal(first.id,renewed.id);
 h.center.stop();
});
test('canceled first-time browser login cleans only its own staged credential',async()=>{
 const h=rig();
 const receipt=await h.driver.addCookie({cookie:COOKIE,stageRollback:true});
 assert.equal(h.stored.size,1);
 await h.driver.rollbackCandidate({account:receipt});
 assert.equal(h.stored.size,0);
 assert.equal(h.config.accounts.length,0);
 h.center.stop();
});

test('canceled older browser login does not erase a more recent authorized session',async()=>{
 const h=rig();
 const staged=await h.driver.addCookie({cookie:COOKIE,stageRollback:true});
 const recent=COOKIE.replace('abcdef','newer-authorized-session');
 await h.driver.addCookie({cookie:recent});
 await h.driver.rollbackCandidate({account:staged});
 assert.equal(h.stored.size,1);
 assert.match([...h.stored.values()][0].value,/newer-authorized-session/);
 h.center.stop();
});

test('legacy rc.30 account keeps its original ID after changing browser device profile',async()=>{
 const h=rig();
 const id='db_'+createHash('sha256').update('dsh-native-router-doubao\0'+'88220011').digest('hex').slice(0,28);
 const key='NATIVE_ROUTER_DOUBAO_'+id.slice(3).toUpperCase();
 h.stored.set(key,{value:JSON.stringify({cookie:COOKIE,uid:'member-101'})});
 h.replaceConfig({providers:[{id:'own_doubao',protocol:'native-channel',name:'豆包'}],
  accounts:[{id,providerId:'own_doubao',credentialRef:'driver:own_doubao:'+id}]});
 const changed=COOKIE.replace('uid_tt=88220011','uid_tt=DIFFERENT_BROWSER_912')
  .replace('abcdef','new-valid-session');
 const receipt=await h.center.addDoubaoCookie({cookie:changed});
 assert.equal(receipt.id,id);
 assert.equal(receipt.alreadyOwned,true);
 assert.equal(h.config.accounts.length,1);
 assert.equal(h.stored.size,1);
 assert.match(h.stored.get(key).value,/DIFFERENT_BROWSER_912/);
 h.center.stop();
});

test('Doubao first-time session without trustworthy remote member UID is rejected',async()=>{
 const stored=new Map(),vault={resolve:async key=>stored.get(key),
  set:async(key,value)=>stored.set(key,{value}),unset:async key=>stored.delete(key)};
 const driver=createDoubaoDriver({vault,fetchImpl:async()=>new Response(
  JSON.stringify({code:0,data:{screen_name:'somebody'}}),{status:200})});
 await assert.rejects(driver.addCookie({cookie:COOKIE}),/not verified by remote server/i);
 assert.equal(stored.size,0);
});
test('Doubao refuses a syntactically valid but remotely expired session before saving',async()=>{
 const h=rig({rejectMember:true});
 await assert.rejects(()=>h.center.addDoubaoCookie({cookie:COOKIE}),
  /not verified by remote server/i);
 assert.equal(h.stored.size,0);
 assert.equal(h.config.providers.length,0);
 assert.equal(h.config.accounts.length,0);
 h.center.stop();
});

test('Doubao different remote UID with the same local device cookie gets an isolated account',async()=>{
 const h=rig({wrongUserOnRotation:true});
 const first=await h.center.addDoubaoCookie({cookie:COOKIE});
 const storedKey=[...h.stored.keys()][0],previous=h.stored.get(storedKey).value;
 const another=await h.center.addDoubaoCookie({cookie:COOKIE.replace('abcdef','rotated')});
 assert.notEqual(first.id,another.id);
 assert.equal(h.stored.get(storedKey).value,previous);
 assert.equal(h.config.accounts.length,2);
 h.center.stop();
});
test('Doubao login polling commits a true private receipt and cannot leak Cookie into config',async()=>{
 const h=rig();
 const receipt=await h.driver.addCookie({cookie:COOKIE});
 const wrapper={...h.driver,loginStatus:()=>({status:'done',account:receipt})};
 const center=createAccountCenter({configStore:{get:()=>structuredClone(h.config),
  replace:value=>{const cfg=normalizeConfig(value);Object.assign(h.config,cfg);return cfg}},
  drivers:new Map([['own_doubao',wrapper]])});
 const done=await center.pollDoubaoLogin();
 assert.equal(done.status,'done');
 assert.equal(done.account.id,receipt.id);
 assert.equal(h.config.accounts.length,1);
 assert.equal(h.config.providers[0].protocol,'native-channel');
 assert.doesNotMatch(JSON.stringify(h.config),/isolated-test-session-value/);
 assert.equal((await center.pollDoubaoLogin()).account.alreadyOwned,true);
 center.stop();h.center.stop();
});
test('Doubao login polling rolls back newly captured Cookie after config failure',async()=>{
 const h=rig({rejectSave:true});
 const receipt=await h.driver.addCookie({cookie:COOKIE});
 const wrapper={...h.driver,loginStatus:()=>({status:'done',account:receipt})};
 const center=createAccountCenter({configStore:{
  get:()=>structuredClone(h.config),replace:()=>{throw Error('Simulated config persistence failure')}},
  drivers:new Map([['own_doubao',wrapper]])});
 await assert.rejects(()=>center.pollDoubaoLogin(),/Simulated config persistence failure/);
 assert.equal(h.stored.size,0);
 center.stop();h.center.stop();
});
