import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {createEmbeddedChannelPack} from '../src/embedded-pack.mjs';

const home=mkdtempSync('E:\\Temp\\dsh-native-router-isolated-alpha14-synthetic-');
process.once('exit',()=>rmSync(home,{recursive:true,force:true}));
const env={DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1',
 DSH_OPENAI_GATEWAY_ENABLED:'0',DSH_REASONING_LOOP_AUTO_RESUME:'0',
 DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE:'1',
 DSH_HOME:home,DSH_CHANNEL_PACK_STATE_DIR:home};
const spin=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({initialChecked=false,afterChecked=true,available=true,enabled=true}={}){
 let active=false,claimed=false;
 const calls=[];
 const pool={async listAllAccounts(){return [
  {id:'acct-a',provider:'qoder',enabled:true},
  {id:'acct-b',provider:'qoder',enabled},
 ]}};
 const ops={
  async status(provider,accountId){
   calls.push('status:'+provider+':'+accountId);
   return {ok:true,value:{accounts:[{accountId,status:{available,
     active:true,todayCheckedIn:claimed?afterChecked:initialChecked}}]}};
  },
  async claim(provider,accountId){
   calls.push('claim:'+provider+':'+accountId);
   claimed=true;
   return {ok:true,value:{results:[{accountId,outcome:{kind:'claimed',credit:5}}]}};
  },
 };
 const scope={get(key,strict){
  if(key==='llm')return {listProviders:async()=>[]};
  if(!active)return undefined;
  if(key==='accountPool')return pool;
  if(key==='nativeRouterSourceCheckins')return ops;
  return undefined;
 }};
 scope.llm={listProviders:async()=>[]};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_,cb){cb(scope)}},
  getConfig:()=>({embeddedPack:{enabled:true}}),env,loadPack:async()=>({apply(){active=true}})});
 bridge.attach();await spin();await spin();
 assert.equal(bridge.status().state,'mounted');
 return {bridge,calls,pool,ops};
}
test('source daily check-in targets one account; only server status proves today success',async()=>{
 const f=await fixture();
 const result=await f.bridge.checkinAccount({providerId:'qoder',sourceAccountId:'acct-b'});
 assert.equal(result.confirmed,true);
 assert.deepEqual(f.calls,['status:qoder:acct-b','claim:qoder:acct-b','status:qoder:acct-b']);
 f.bridge.dispose();
});
test('claimed receipt with no verified server status remains pending, never success',async()=>{
 const f=await fixture({afterChecked:false});
 const result=await f.bridge.checkinAccount({providerId:'qoder',sourceAccountId:'acct-b'});
 assert.equal(result.confirmed,undefined);
 assert.equal(result.state,'pending_confirmation');
 assert.equal(f.calls.length,3);
 f.bridge.dispose();
});
test('unknown server check-in status causes zero claim attempts',async()=>{
 const f=await fixture({available:false});
 const result=await f.bridge.checkinAccount({providerId:'qoder',sourceAccountId:'acct-b'});
  assert.equal(result.state,'failed','unknown read-only status does not mean a claim was submitted');
 assert.deepEqual(f.calls,['status:qoder:acct-b']);
 f.bridge.dispose();
});
test('confirmed status is honored even when the source omits availability metadata',async()=>{
  const checked=await fixture({initialChecked:true,available:false});
  const result=await checked.bridge.checkinAccount({
    providerId:'qoder',sourceAccountId:'acct-b'});
  assert.equal(result.confirmed,true);
  assert.deepEqual(checked.calls,['status:qoder:acct-b']);
  checked.bridge.dispose();
});
test('already-checked-in account is not claimed twice; disabled/unsupported accounts rejected',async()=>{
 const checked=await fixture({initialChecked:true});
 const result=await checked.bridge.checkinAccount({providerId:'qoder',sourceAccountId:'acct-b'});
 assert.equal(result.confirmed,true);
 assert.deepEqual(checked.calls,['status:qoder:acct-b']);
 assert.equal((await checked.bridge.checkinAccount({providerId:'cline',sourceAccountId:'acct-b'})).state,'unsupported');
 assert.equal((await checked.bridge.checkinAccount({providerId:'qoder',sourceAccountId:'unknown'})).state,'unavailable');
 checked.bridge.dispose();
 const disabled=await fixture({enabled:false});
 assert.equal((await disabled.bridge.checkinAccount({providerId:'qoder',sourceAccountId:'acct-b'})).state,'unavailable');
 assert.equal(disabled.calls.length,0);
 disabled.bridge.dispose();
});
