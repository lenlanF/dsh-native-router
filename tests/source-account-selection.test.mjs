import test from 'node:test';
import assert from 'node:assert/strict';
import {installSourceAccountSelection} from '../src/source-account-selection.mjs';

function rig(){
 const rows=[
  {provider:'lobsterai',id:'a',credentialRef:'LOBSTER_A',enabled:true},
  {provider:'lobsterai',id:'b',credentialRef:'LOBSTER_B',enabled:true},
  {provider:'qoder',id:'third',credentialRef:'QODER_THIRD',enabled:true},
 ];
 const reads=[],selections=[];
 const credentials={
  async resolve(ref){reads.push(ref);return {value:JSON.stringify({accountRef:ref})}},
  async set(ref){reads.push('set:'+ref)},
  async unset(ref){reads.push('unset:'+ref)},
 };
 const pool={
  async listAllAccounts(){return rows.map(row=>({...row}))},
  async listAccounts(provider){return rows.filter(row=>row.provider===provider)},
  listAccountsByProvider(provider){return rows.filter(row=>row.provider===provider)},
  async getAvailableAccount(provider,model,exclude){
   selections.push({provider,model,exclude:[...(exclude??[])]});
   const row=rows.find(row=>row.provider===provider&&row.enabled&&!exclude?.has(row.id));
   if(!row)return null;
   const resolved=await credentials.resolve(row.credentialRef);
   return {entry:row,credential:JSON.parse(resolved.value)};
  },
 };
 const originalGet=pool.getAvailableAccount,originalResolve=credentials.resolve;
 const gate=installSourceAccountSelection({pool,credentials});
 return {gate,pool,credentials,rows,reads,selections,originalGet,originalResolve};
}
function source(gate,accountId,accountRef,{before,model='m1'}={}){
 return gate.streamFor({providerId:'lobsterai',accountId,credentialRef:accountRef,
  model,allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
   if(before)await before();
   // This simulates an unmodified upstream adapter calling its own source pool.
   const slot=await fixtures.getAvailableAccount('lobsterai',model);
   yield {type:'account',value:slot.entry.id};
   yield {type:'done'};
  })()});
}
let fixtures;
test('request-local account gate pins exact source account and preserves normal callers',async()=>{
 const rigged=rig();fixtures=rigged.pool;
 const {gate,pool,selections,reads}=rigged;
 try{
  const pre=await pool.getAvailableAccount('lobsterai','m1');
  assert.equal(pre.entry.id,'a');
  const result=[];
  for await(const item of source(gate,'b','LOBSTER_B'))result.push(item);
  assert.deepEqual(result,[{type:'account',value:'b'},{type:'done'}]);
  assert.equal(selections.at(-1).exclude.includes('a'),true);
  assert.equal(reads.at(-1),'LOBSTER_B');
  const post=await pool.getAvailableAccount('lobsterai','m1');
  assert.equal(post.entry.id,'a','outside request context original account routing remains unchanged');
 }finally{gate.restore()}
});
test('concurrent source requests are isolated without temporarily disabling other source accounts',async()=>{
 const r=rig();fixtures=r.pool;
 try{
  const work=async(id,ref)=>{
   const items=[];
   for await(const event of source(r.gate,id,ref,{before:()=>new Promise(resolve=>setTimeout(resolve,id==='a'?15:2))}))
    items.push(event);
   return items[0].value;
  };
  const both=await Promise.all([work('a','LOBSTER_A'),work('b','LOBSTER_B')]);
  assert.deepEqual(both,['a','b']);
  assert.equal(r.rows.filter(row=>row.enabled).length,3,'source account enable flags must remain untouched');
 }finally{r.gate.restore()}
});
test('source account guard denies cross-provider, alternate credential and unproved streams',async()=>{
 const r=rig();
 try{
  await assert.rejects(async()=>{
   for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'a',credentialRef:'LOBSTER_A',
     allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
       await r.credentials.resolve('LOBSTER_B');yield {value:'unsafe'};
     })()}))void item;
  },/another credential/);
  await assert.rejects(async()=>{
   for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'a',credentialRef:'LOBSTER_A',
     allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
       await r.pool.getAvailableAccount('qoder','m');yield {value:'unsafe'};
     })()}))void item;
  },/cross-provider/);
  await assert.rejects(async()=>{
   for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'a',credentialRef:'LOBSTER_A',
     allProviderAccountIds:['a','b'],createStream:()=> (async function*(){yield {value:'unproved'}})()}))void item;
  },/did not prove/);
 }finally{r.gate.restore()}
});
test('source guard never falls back to another credential when selected account is unavailable',async()=>{
 const r=rig();
 try{
  r.rows[1].enabled=false;
  await assert.rejects(async()=>{
   for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'b',credentialRef:'LOBSTER_B',
     allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
       const account=await r.pool.getAvailableAccount('lobsterai','m');
       // Adapter's fallback path should be unreachable: getAvailableAccount throws.
       yield {value:account?'selected':'fallback-default'};
     })()}))void item;
  },/refused the specifically selected/);
  assert.equal(r.reads.includes('LOBSTER_A'),false);
 }finally{r.gate.restore()}
});
test('source guard refuses another provider account even through list and write methods',async()=>{
 const r=rig();
 try{
  await assert.rejects(async()=>{
   for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'b',credentialRef:'LOBSTER_B',
     allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
       r.pool.listAccountsByProvider('qoder');yield {value:'bad'};
     })()}))void item;
  },/different provider/);
  await assert.rejects(async()=>{
   for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'b',credentialRef:'LOBSTER_B',
     allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
       await r.credentials.unset('LOBSTER_A');yield {value:'bad'};
     })()}))void item;
  },/another credential/);
  assert.equal(r.reads.some(ref=>ref.startsWith('unset:')),false);
 }finally{r.gate.restore()}
});
test('guard restores the exact original source methods when disconnected',async()=>{
 const r=rig();r.gate.restore();
 assert.equal(r.pool.getAvailableAccount,r.originalGet);
 assert.equal(r.credentials.resolve,r.originalResolve);
 await assert.rejects(async()=>{
  for await(const item of r.gate.streamFor({providerId:'lobsterai',accountId:'a',
   credentialRef:'LOBSTER_A',allProviderAccountIds:['a','b'],createStream:()=> (async function*(){
     yield {value:'unsafe'};
   })()}))void item;
 },/prerequisites failed/);
});

test('dispose during an in-flight pinned source request keeps credential fences until it stops',async()=>{
 const r=rig();
 let enter,release;
 const entered=new Promise(resolve=>{enter=resolve});
 const paused=new Promise(resolve=>{release=resolve});
 const stream=r.gate.streamFor({providerId:'lobsterai',accountId:'b',
  credentialRef:'LOBSTER_B',allProviderAccountIds:['a','b'],
  createStream:()=> (async function*(){
   await r.pool.getAvailableAccount('lobsterai','m1');
   enter();
   await paused;
   // The guard MUST still be active even after host dispose.
   await r.pool.getAvailableAccount('lobsterai','m1');
   yield {value:'must-not-emit'};
  })()});
 const iterator=stream[Symbol.asyncIterator]();
 const pending=iterator.next();
 await entered;
 r.gate.restore();
 assert.notEqual(r.pool.getAvailableAccount,r.originalGet,'in-flight requests retain a fail-closed fence');
 release();
 await assert.rejects(pending,/no longer active|was stopped/);
 assert.equal(r.pool.getAvailableAccount,r.originalGet,'guard restores after the final stream settles');
 assert.equal(r.credentials.resolve,r.originalResolve);
});

test('a missing credential resolution never proves source ownership or releases streamed output',async()=>{
 const credentials={resolve:async()=>undefined};
 const pool={
  listAllAccounts:async()=>[{id:'a',provider:'lobsterai',enabled:true,credentialRef:'LOBSTER_A'}],
  listAccountsByProvider:()=>[{id:'a',provider:'lobsterai',enabled:true,credentialRef:'LOBSTER_A'}],
  getAvailableAccount:async()=>({
    entry:{id:'a',provider:'lobsterai',enabled:true},
    credential:{claimed:true},
  }),
 };
 const guard=installSourceAccountSelection({pool,credentials});
 try{
  const released=[];
  await assert.rejects(async()=>{
   for await(const item of guard.streamFor({providerId:'lobsterai',accountId:'a',
     credentialRef:'LOBSTER_A',allProviderAccountIds:['a'],createStream:()=> (async function*(){
       const chosen=await pool.getAvailableAccount('lobsterai','model-a');
       await credentials.resolve('LOBSTER_A');
       yield {type:'text-delta',text:chosen.credential.claimed?'FAKE_SUCCESS':'nope'};
     })()}))released.push(item);
  },/credential lookup was empty/);
  assert.deepEqual(released,[]);
 }finally{guard.restore()}
});
