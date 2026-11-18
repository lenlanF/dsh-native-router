import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime} from '@deepseek-ai/dsh-llm';
import {apply as applySourcePack} from '../vendor/channel-pack/pack.js';
import {installSourceAccountSelection} from '../src/source-account-selection.mjs';
import {channelPackIsolationReason} from '../src/channel-pack-isolation.mjs';

// Development-only upstream pool contract test. Must run ONLY on a precreated
// EMPTY dedicated E:\\Temp isolated profile. Creates two FAKE accounts in that
// profile only; does not perform OAuth, sign-ins or any network model generation.
assert.equal(channelPackIsolationReason(process.env),'');
assert.equal(process.env.DSH_OPENAI_GATEWAY_ENABLED,'0');
assert.equal(process.env.DSH_REASONING_LOOP_AUTO_RESUME,'0');
const ctx=new Context();
new LlmRuntime(ctx);
const reads=[],writes=[];
const credentials={
 async resolve(ref){
  reads.push(ref);
  const fixture=ref==='ALPHA12_FAKE_A'?'a':ref==='ALPHA12_FAKE_B'?'b':null;
  return fixture?{value:JSON.stringify({fixture})}:undefined;
 },
 async describe(){return {source:'offline-fixture'}},
 async set(){writes.push('set');throw Error('FAKE_ACCOUNT_NO_CREDENTIAL_WRITE')},
 async unset(){writes.push('unset');throw Error('FAKE_ACCOUNT_NO_CREDENTIAL_DELETION')},
};
ctx.provide('credentials',credentials);
ctx.provide('commands',{register(){return ()=>{}}});
const mount=scope=>applySourcePack(scope,{disableOpencode:true});
let guard=null,pool=null,fixtureOwned=false;
try{
 const fiber=ctx.inject(['credentials','commands','llm'],mount);
 await fiber;
 pool=ctx.get('accountPool',false);
 assert.equal(typeof pool?.addAccount,'function');
 assert.equal((await pool.listAllAccounts()).length,0,'refuse fixture insertion into nonempty account pool');
 fixtureOwned=true; // Only our newly created synthetic rows may be cleared in finally.
 const entry=id=>({id:'alpha12-'+id,provider:'lobsterai',enabled:true,
  credentialRef:'ALPHA12_FAKE_'+id.toUpperCase(),nickname:'offline-'+id});
 await pool.addAccount(entry('a'));
 await pool.addAccount(entry('b'));
 assert.equal((await pool.listAllAccounts()).length,2);
 const pre=await pool.getAvailableAccount('lobsterai','fixture-model');
 assert.equal(pre?.entry?.id,'alpha12-a');
 const credentialProxy=ctx.get('credentials',false);
 guard=installSourceAccountSelection({pool,credentials:credentialProxy});
 const config={providerId:'lobsterai',accountId:'alpha12-b',
  credentialRef:'ALPHA12_FAKE_B',model:'fixture-model',
  allProviderAccountIds:['alpha12-a','alpha12-b']};
 const results=[];
 for await(const item of guard.streamFor({...config,
  createStream:()=> (async function*(){
   const choice=await pool.getAvailableAccount('lobsterai','fixture-model');
   assert.equal(choice?.entry?.id,'alpha12-b');
   yield {accountId:choice.entry.id,fixture:choice.credential.fixture};
  })()}))results.push(item);
 assert.deepEqual(results,[{accountId:'alpha12-b',fixture:'b'}]);
 const after=await pool.getAvailableAccount('lobsterai','fixture-model');
 assert.equal(after.entry.id,'alpha12-a','other requests preserve upstream default selection');
 await pool.updateAccount('alpha12-b',{
  modelRateLimits:{'fixture-model':Date.now()+600000}});
 let released=0;
 await assert.rejects(async()=>{
  for await(const event of guard.streamFor({...config,
   createStream:()=> (async function*(){
    const choice=await pool.getAvailableAccount('lobsterai','fixture-model');
    if(choice)yield {choice:choice.entry.id};
   })()})){released++;void event;}
 },/refused the specifically selected source account/);
 assert.equal(released,0,'rate-limited source must not leak events or fall back');
 assert.deepEqual(writes,[]);
 assert.equal(reads.filter(ref=>ref==='ALPHA12_FAKE_A').length,2,
  'unscoped pre/post calls read source A only, never inside pinned B');
 console.log(JSON.stringify({result:'PASS',runtime:'real pinned source AccountPool',
  syntheticAccounts:2,selectedAccount:results[0].accountId,
  unscopedAccount:after.entry.id,rateLimitFallback:'blocked',credentialWrites:0}));
}finally{
 guard?.restore();
 if(pool&&fixtureOwned){await pool.writeAccounts([]);assert.equal((await pool.listAllAccounts()).length,0)}
 ctx.registry.delete(mount);
 await new Promise(resolve=>setTimeout(resolve,60));
 assert.equal(ctx.get('accountPool',false),undefined);
}
process.exit(0);
