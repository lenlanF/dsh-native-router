import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCredential} from '../src/accounts.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {createRoutingEngine} from '../src/router.mjs';
import {sample} from './fixtures.mjs';

test('credential refs read current env only, not persisted plaintext',async()=>{
 const account=normalizeConfig(sample).accounts[0];
 assert.equal(await resolveCredential(account,{env:{NATIVE_ROUTER_TEST_KEY:'test-value'}}),'test-value');
 await assert.rejects(()=>resolveCredential(account,{env:{}}),error=>error.code==='CREDENTIAL');
});
test('host credential service errors do not leak token-bearing exceptions',async()=>{
 const account=normalizeConfig(sample).accounts[1];
 await assert.rejects(()=>resolveCredential(account,{vault:{resolve:async()=>{throw Error('private backend secret123')}}}),
   error=>error.code==='CREDENTIAL'&&!String(error.message).includes('secret123'));
});
test('missing credential on one account advances to healthy account without touching another provider',async()=>{
 const cfg=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'pinned'}]});
 let tried=0;
 const request=async({account})=>{
   tried++;
   await resolveCredential(account,{env:{},vault:account.credentialRef.startsWith('host:')?
     {resolve:async()=>({value:'stub-token'})}:undefined});
   return account.id;
 };
 const engine=createRoutingEngine({getConfig:()=>cfg,request});
 const x=await engine.execute('daily');
 assert.equal(x,'a2');
 assert.equal(tried,2);
});
