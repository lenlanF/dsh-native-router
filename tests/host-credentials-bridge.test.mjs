import test from 'node:test';
import assert from 'node:assert/strict';
import {ownCredentialRef} from '../src/credential-ref.mjs';
import {createHostCredentialBridge} from '../src/credentials-bridge.mjs';
import {createOwnedRetryMessage} from '../src/host-failover.mjs';

test('credential name builder equals the DSH 0.2.2 runtime brand (validated name and identity string)',()=>{
 for(const name of ['NATIVE_ROUTER_PRIVATE_ABC','NATIVE_ROUTER_WB_8CE2','CODEARTS_ACCOUNT_123']){
  assert.equal(ownCredentialRef(name),name);
 }
 for(const bad of [null,undefined,'',123,'a-b','1_FIRST','TOKEN\nVALUE','../credentials','A B']){
  assert.throws(()=>ownCredentialRef(bad),/Invalid DSH credential reference name/);
 }
});
test('Credentials bridge is unavailable until the Host service is injected and fails safely',async()=>{
 let callback,cleanup,cleared=false;
 const ctx={
  get:()=>undefined,
  inject(names,fn){assert.deepEqual(names,['credentials']);callback=fn},
  registry:{delete(fn){assert.equal(fn,callback);cleared=true}},
 };
 const bridge=createHostCredentialBridge({ctx});
 assert.equal(bridge.status().available,false);
 assert.throws(()=>bridge.vault.resolve('OWN_REF'),error=>error.code==='CREDENTIALS_UNAVAILABLE');
 const store=new Map(),api={
  async resolve(ref){return store.has(ref)?{value:store.get(ref)}:undefined},
  async set(ref,value){store.set(ref,value)},
  async unset(ref){store.delete(ref)},
 };
 callback({get:()=>api,effect(fn){cleanup=fn()}});
 assert.equal(bridge.status().available,true);
 const ref=ownCredentialRef('NATIVE_ROUTER_PRIVATE_TEST');
 await bridge.vault.set(ref,'TEST_FAKE_SECRET_NOT_REAL');
 assert.equal((await bridge.vault.resolve(ref)).value,'TEST_FAKE_SECRET_NOT_REAL');
 await bridge.vault.unset(ref);
 assert.equal(await bridge.vault.resolve(ref),undefined);
 cleanup();
 assert.equal(bridge.status().available,false);
 bridge.dispose();
 assert.equal(cleared,true);
 assert.equal(bridge.status().available,false);
});
test('provided DSH Credentials service remains isolated and is never auto-disposed',()=>{
 const vault={resolve:()=>undefined,set:()=>{},unset:()=>{}};
 let injections=0;
 const bridge=createHostCredentialBridge({ctx:{inject(){injections++}},provided:vault});
 assert.equal(injections,0);
 assert.equal(bridge.status().available,true);
 bridge.dispose();
 assert.equal(typeof vault.resolve,'function');
});
test('standalone retry message has the DSH user message shape without dynamic @deepseek-ai import',()=>{
 const a=createOwnedRetryMessage({content:[],source:{kind:'retry'}});
 const b=createOwnedRetryMessage({content:[],source:{kind:'retry'}});
 assert.match(a.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.notEqual(a.id,b.id);
 assert.equal(a.role,'user');
 assert.deepEqual(a.content,[]);
 assert.deepEqual(a.source,{kind:'retry'});
 assert.equal(Object.isFrozen(a),true);
 assert.equal(Object.isFrozen(a.content),true);
 assert.equal(Object.isFrozen(a.source),true);
});
