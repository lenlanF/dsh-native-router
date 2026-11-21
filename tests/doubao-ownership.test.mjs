import test from 'node:test';
import assert from 'node:assert/strict';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

const COOKIE='sessionid=isolated-test-session-value-abcdef; uid_tt=88220011';
function rig({rejectSave=false,rejectMember=false,wrongUserOnRotation=false}={}){
 const stored=new Map();
 const vault={
  async resolve(key){return stored.get(key)},
  async set(key,val){stored.set(key,{value:val})},
  async unset(key){stored.delete(key)},
 };
 const driver=createDoubaoDriver({vault,fetchImpl:async(input,options={})=>{
  if(new URL(input).pathname!=='/passport/account/info/v2/')
   throw Error('Unexpected model call during credential ownership tests');
  const cookie=options.headers?.Cookie??'';
  return new Response(JSON.stringify(rejectMember?{code:710012001,msg:'Session expired'}:
   {code:0,data:{user_id_str:wrongUserOnRotation&&cookie.includes('rotated')?
    'different-member-202':'member-101',screen_name:'真实豆包会员'}}),
   {status:200,headers:{'content-type':'application/json'}});
 }});
 let cfg=normalizeConfig({});
 const configStore={
  get:()=>structuredClone(cfg),
  replace:value=>{
   if(rejectSave)throw Error('Simulated config persistence failure');
   cfg=normalizeConfig(value);return structuredClone(cfg);
  },
 };
 const drivers=new Map([['own_doubao',driver]]);
 const center=createAccountCenter({configStore,drivers});
 return {stored,driver,center,drivers,get config(){return cfg}};
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
test('Doubao refuses a syntactically valid but remotely expired session before saving',async()=>{
 const h=rig({rejectMember:true});
 await assert.rejects(()=>h.center.addDoubaoCookie({cookie:COOKIE}),
  /not verified by remote server/i);
 assert.equal(h.stored.size,0);
 assert.equal(h.config.providers.length,0);
 assert.equal(h.config.accounts.length,0);
 h.center.stop();
});

test('Doubao same local uid_tt never overwrites another remotely verified identity',async()=>{
 const h=rig({wrongUserOnRotation:true});
 await h.center.addDoubaoCookie({cookie:COOKIE});
 const storedKey=[...h.stored.keys()][0],previous=h.stored.get(storedKey).value;
 await assert.rejects(()=>h.center.addDoubaoCookie({cookie:COOKIE.replace('abcdef','rotated')}),
  /identity mismatch/i);
 assert.equal(h.stored.get(storedKey).value,previous);
 assert.equal(h.config.accounts.length,1);
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
