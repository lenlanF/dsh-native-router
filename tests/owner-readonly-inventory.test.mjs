import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerReadOnlyInventory} from '../src/owner-readonly-inventory.mjs';
test('all-channel read-only inventory is exact-account and never calls inference or daily claim',async()=>{
 const account={id:'private_account_ref',providerId:'own_loomy'};
 const reads=[],driver={
  refreshAccountStatus:async({account:a})=>{assert.equal(a,account);
    reads.push('status');return {state:'ready',authVerified:true,balanceState:'available'}},
  listModels:async({account:a})=>{assert.equal(a,account);reads.push('models');
    return [{id:'spark-x2.6',freeAllowance:'loomy-daily-gift'},
      {id:'paid',upstreamFreeLabel:false}]},
  generate(){throw Error('must never call')},
  checkIn(){throw Error('must never call')},
  claim(){throw Error('must never call')},
 };
 const result=await ownerReadOnlyInventory({account,driver});
 assert.equal(result.code,'OFFICIAL_ACCOUNT_AND_CATALOG');
 assert.equal(result.authVerified,true);
 assert.equal(result.officialFreeCandidates,1);
 assert.equal(result.advertisedCount,2);
 assert.deepEqual(reads,['status','models']);
 assert.doesNotMatch(JSON.stringify(result),/private_account_ref|spark-x2.6|paid/);
});
test('read-only inventory refuses stale official auth, guessed free catalog and unknown rates',async()=>{
 const account={providerId:'codearts',id:'private'};
 const driver={refreshAccountStatus:async()=>({state:'ready',authVerified:false}),
  listModels:async()=>[{id:'a',name:'zero x0.00',costMultiplier:0.0007,
    priceSource:'codearts-official-credit-ratio'},
    {id:'b',costMultiplier:0,priceSource:'codearts-official-credit-ratio'},
    {id:'c',costMultiplier:0,priceSource:'arbitrary-nonofficial'}]};
 const r=await ownerReadOnlyInventory({account,driver});
 assert.equal(r.code,'OFFICIAL_ACCOUNT_UNCONFIRMED');
 assert.equal(r.exactOfficialZeroRateCount,1);
 assert.equal(r.exactOfficialRateCount,2);
 assert.equal(r.officialFreeCandidates,1);
});
test('ZCode inventory distinguishes current grant preview from fully confirmed safe gift',async()=>{
 const account={providerId:'own_zcode'};
 const driver={refreshAccountStatus:async()=>({state:'ready',authVerified:true,
     balanceState:'available',zcodePreviewStartPlans:1,giftedBalance:0}),
   listModels:async()=>[{id:'GLM-5.3-Flash'}]};
 const r=await ownerReadOnlyInventory({account,driver});
 assert.equal(r.zcodePreviewStartPlans,1);
 assert.equal(r.zcodeGiftConfirmed,false);
 assert.equal(r.officialFreeCandidates,0);
});
test('owned WorkBuddy CN/global authenticated signed model catalog is read-only proof without refreshAccountStatus',async()=>{
 for(const providerId of ['own_workbuddy-cn','own_workbuddy-global']){
  const account={providerId,id:'WB_TEST'};
  const seen=[];
  const driver={refresh:async({account:a})=>{assert.equal(a,account);seen.push('refresh');
     return {state:'online'}},
   listModels:async({account:a})=>{assert.equal(a,account);seen.push('listModels');
     return [{id:'hy4flash-free',upstreamFreeLabel:true},
       {id:'plain-paid',upstreamFreeLabel:false}]},
   generate:()=>{throw Error('must not generate')},
  };
  const r=await ownerReadOnlyInventory({account,driver});
  assert.equal(r.code,'OFFICIAL_ACCOUNT_AND_CATALOG');
  assert.equal(r.authProofType,'workbuddy_signed_remote_catalog');
  assert.equal(r.advertisedCount,2);assert.equal(r.officialFreeCandidates,1);
  assert.deepEqual(seen,['refresh','listModels']);
  assert.doesNotMatch(JSON.stringify(r),/WB_TEST|hy4flash-free/);
 }
});
test('failed WorkBuddy catalog auth or unsupported other-channel refresh cannot create proof',async()=>{
 const account={providerId:'own_workbuddy-cn'};
 const expired=await ownerReadOnlyInventory({account,driver:{
  refresh:async()=>({state:'expired'}),listModels:async()=>[{id:'zero',free:true}]}});
 assert.equal(expired.authVerified,false);
 assert.equal(expired.code,'OFFICIAL_ACCOUNT_UNCONFIRMED');
 const unsupported=await ownerReadOnlyInventory({account:{providerId:'non-workbuddy'},driver:{
  refresh:async()=>({state:'online'}),listModels:async()=>[]}});
 assert.equal(unsupported.code,'OFFICIAL_READER_MISSING');
});
test('Lingxi official credit or todays claimable task validates auth; empty ready is not verified',async()=>{
 const account={providerId:'own_lingxi'};
 for(const status of [{state:'ready',balance:0},
   {state:'ready',taskStatus:'claimed'},{state:'ready',taskStatus:'claimable'}]){
   const driver={refreshAccountStatus:async()=>status,listModels:async()=>[{id:'model'}]};
   const r=await ownerReadOnlyInventory({account,driver});
   assert.equal(r.authVerified,true);
   assert.equal(r.authProofType,'lingxi_official_balance_or_daily_task');
   assert.equal(r.balanceObserved,typeof status.balance==='number');
 }
 for(const status of [{state:'ready',taskStatus:'unknown'},
   {state:'unavailable',balance:1},{state:'ready',balance:-10}]){
   const r=await ownerReadOnlyInventory({account,driver:{
    refreshAccountStatus:async()=>status,listModels:async()=>[{id:'model'}]}});
   assert.equal(r.authVerified,false);
 }
});
test('catalog free double evidence is counted once per model',async()=>{
 const driver={refreshAccountStatus:async()=>({state:'ready',authVerified:true}),
  listModels:async()=>[
   {id:'a',upstreamFreeLabel:true,priceSource:'codearts-official-credit-ratio',costMultiplier:0},
   {id:'b',priceSource:'codearts-official-credit-ratio',costMultiplier:0},
   {id:'c',costMultiplier:0.001,priceSource:'codearts-official-credit-ratio'}]};
 const r=await ownerReadOnlyInventory({account:{providerId:'codearts'},driver});
 assert.equal(r.officialFreeCandidates,2);
 assert.equal(r.exactOfficialZeroRateCount,2);
 assert.equal(r.exactOfficialRateCount,3);
});
test('unavailable, invalid and cancelled per-account status are fail closed and do not access model stream',async()=>{
 assert.equal((await ownerReadOnlyInventory({account:{},driver:{}})).code,'OFFICIAL_READER_MISSING');
 const ctrl=new AbortController();ctrl.abort();
 assert.equal((await ownerReadOnlyInventory({account:{},driver:{
  refreshAccountStatus:async()=>{throw Error('must not read')},
  listModels:async()=>{throw Error('must not read')}} ,signal:ctrl.signal})).code,'CANCELLED');
 const down=await ownerReadOnlyInventory({account:{},driver:{
  refreshAccountStatus:async()=>{throw Error('secret header')},
  listModels:async()=>{throw Error('never')}}});
 assert.equal(down.code,'OFFICIAL_STATUS_UNAVAILABLE');
 assert.doesNotMatch(JSON.stringify(down),/secret header/);
});

test('duplicate source model rows count one official model and ignore missing IDs',async()=>{
 const driver={refreshAccountStatus:async()=>({state:'ready',authVerified:true}),
  listModels:async()=>[
   {id:'same',costMultiplier:0,priceSource:'codearts-official-credit-ratio'},
   {id:'same',upstreamFreeLabel:true},
   {id:'paid',costMultiplier:0.07,priceSource:'codearts-official-credit-ratio'},
   {id:'paid',costMultiplier:0.07,priceSource:'codearts-official-credit-ratio'},
   {upstreamFreeLabel:true},{id:'',free:true},
  ]};
 const result=await ownerReadOnlyInventory({account:{providerId:'codearts'},driver});
 assert.equal(result.advertisedCount,2);
 assert.equal(result.exactOfficialRateCount,2);
 assert.equal(result.exactOfficialZeroRateCount,1);
 assert.equal(result.officialFreeCandidates,1);
});
test('ZCode gifted tokens are not confirmed without official auth, spendable ledger and matching model',async()=>{
 const account={providerId:'own_zcode'};
 const baseline={state:'ready',authVerified:true,balanceState:'available',giftedBalance:4096};
 for(const status of [
   {...baseline,authVerified:false},
   {...baseline,balanceState:'unknown'},
   {...baseline,giftedBalance:0},
 ]){
   const result=await ownerReadOnlyInventory({account,driver:{
    refreshAccountStatus:async()=>status,
    listModels:async()=>[{id:'GLM-5.3-Flash'}],
   }});
   assert.equal(result.zcodeGiftConfirmed,false);
 }
 const wrongModel=await ownerReadOnlyInventory({account,driver:{
  refreshAccountStatus:async()=>baseline,listModels:async()=>[{id:'paid-model'}],
 }});
 assert.equal(wrongModel.zcodeGiftConfirmed,false);
 const valid=await ownerReadOnlyInventory({account,driver:{
  refreshAccountStatus:async()=>baseline,listModels:async()=>[{id:'GLM-5.3-Flash'}],
 }});
 assert.equal(valid.zcodeGiftConfirmed,true);
});
test('cancelled read-only model catalogue never persists a successful account proof',async()=>{
 const abort=new AbortController();
 const result=await ownerReadOnlyInventory({account:{providerId:'codearts'},signal:abort.signal,driver:{
  refreshAccountStatus:async()=>({state:'ready',authVerified:true}),
  listModels:async()=>{abort.abort();return [{id:'safe',free:true}]},
 }});
 assert.equal(result.code,'CANCELLED');
 assert.equal(result.state,'skipped');
});
