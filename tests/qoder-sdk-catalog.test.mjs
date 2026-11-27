import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQoderSdkModels,readQoderSdkCatalog,QODER_SDK_REALMS} from '../src/channels/qoder-sdk-catalog.mjs';
const account={userId:'fixture-member',organization:'fixture-org',apiProvider:'firstParty'};
const row=(value,priceFactor,isFree=true,extra={})=>({value,displayName:value,isEnabled:true,priceFactor,isFree,...extra});
test('Qoder official SDK catalog retains positive rates and distinguishes promotions and conflicts from zero-rate models',()=>{
 const models=normalizeQoderSdkModels([row('free',0),row('paid',0.5,false),row('discount',0,true,{promotion:{active:true,before_promotion_price_factor:1}}),row('conflict',0),row('conflict',1,false),row('disabled',0,true,{isEnabled:false}),row('auto',0),row('missing',undefined),row('flag',0,undefined),row('disabled-peer',0),row('disabled-peer',0,true,{isEnabled:false})]);
 assert.deepEqual(models.map(x=>x.id),['free','paid','discount','conflict','missing','flag','disabled-peer']);
 assert.equal(models[0].zeroRateVerified,true);
 assert.equal(models[1].costMultiplier,0.5);
 assert.equal(models[2].promotion,true);assert.equal(models[2].zeroRateVerified,false);
 assert.equal(models[3].pricingConflict,true);assert.equal(models[3].zeroRateVerified,false);
 assert.equal(models[4].pricingIncomplete,true);assert.equal(models[6].pricingConflict,true);
});
function mockSdk({accounts=[account,account],rows=[row('free',0)],hang=false}={}){
 const calls=[];let controller;
 const sdk={accessToken:pat=>({type:'accessToken',pat}),query({prompt,options}){
  calls.push('query');controller=options.abortController;
  assert.equal(options.auth.type,'accessToken');assert.deepEqual(options.settingSources,[]);
  assert.deepEqual(options.tools,[]);assert.equal(options.persistSession,false);
  // No user content is ever emitted; cleanup ends the async input.
  (async()=>{for await(const _ of prompt)calls.push('MESSAGE')})();
  return {async initializationResult(){calls.push('init')},async accountInfo(){calls.push('account');return accounts.shift()},async getAvailableModels(opts){
   calls.push('catalog');assert.equal(opts.fetchStrategy,'live');
   if(hang)return new Promise(()=>{});return rows;
  }};
 }};
 return {sdk,calls,aborted:()=>controller?.signal.aborted};
}
const args={realm:'qoder',pat:'fixture-pat-not-a-secret',expectedAccount:{userId:account.userId,organization:account.organization},cwd:'.'};
test('Qoder SDK read is bound to authenticated subject before and after catalog; no prompt and cleanup',async()=>{
 for(const realm of Object.keys(QODER_SDK_REALMS)){
  const r=mockSdk(),result=await readQoderSdkCatalog({...args,realm,sdk:r.sdk});
  assert.equal(result.state,'ready');assert.equal(result.realm,realm);assert.equal(result.models[0].zeroRateVerified,true);
  assert.deepEqual(r.calls,['query','init','account','catalog','account']);assert.equal(r.aborted(),true);
  assert.doesNotMatch(JSON.stringify(result),/fixture-member|fixture-org|fixture-pat/);
 }
});
test('Qoder SDK foreign account, organization drift, absent user, BYOK and missing authorization never publish a catalog',async()=>{
 for(const accounts of [[{...account,userId:'other'}],[account,{...account,organization:'foreign'}],[{}],[{...account,apiKeySource:'user'}],[{...account,apiProvider:'bedrock'}]]){
  const r=mockSdk({accounts});
  assert.notEqual((await readQoderSdkCatalog({...args,sdk:r.sdk})).state,'ready');assert.equal(r.aborted(),true);
 }
 const r=mockSdk();
 assert.equal((await readQoderSdkCatalog({...args,pat:undefined,sdk:r.sdk})).state,'unavailable');
 assert.equal(r.calls.length,0);
});
test('Qoder SDK hanging catalog is bounded and aborts SDK without logging underlying errors',async()=>{
 const r=mockSdk({hang:true});
 const result=await readQoderSdkCatalog({...args,sdk:r.sdk,timeoutMs:100});
 assert.deepEqual(result,{state:'unavailable',models:[]});assert.equal(r.aborted(),true);
});
