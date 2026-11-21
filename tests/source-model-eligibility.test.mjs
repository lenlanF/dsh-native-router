import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceModelEligible,privateSourceAccountRoutable} from '../src/source-model-eligibility.mjs';

const row=(override={})=>({id:'sp_'+'a'.repeat(24),providerId:'codearts',
  enabled:true,origin:{kind:'independent-owned'},runtimeMode:'owned',
  connectionState:'online',...override});

test('CodeArts independently QR-authenticated login enables its own model adapter before check-in cache exists',()=>{
 assert.equal(sourceModelEligible('codearts',{accounts:[row()],sourceRows:[]}),true);
 assert.equal(sourceModelEligible('zcode',{accounts:[row()],sourceRows:[]}),false);
});
test('native own_ provider and plain legacy provider use the same verified-private-model gate',()=>{
 assert.equal(sourceModelEligible('zcode',{accounts:[row({providerId:'own_zcode'})]}),true);
 assert.equal(sourceModelEligible('codearts',{accounts:[row({providerId:'own_codearts'})]}),true);
});
test('private model gate refuses pending, unverified, disabled and linked external accounts',()=>{
 for(const change of [
  {connectionState:'pending'},{connectionState:'error'},{connectionState:'expired'},
  {connectionState:'recently_verified'},{enabled:false},{runtimeMode:'linked'},
  {origin:{kind:'dsh-account-pool'}},
  {origin:{kind:'independent-owned'},runtimeMode:'linked'},
 ]){
  assert.equal(sourceModelEligible('codearts',{accounts:[row(change)]}),false,JSON.stringify(change));
 }
});
test('existing plugin-owned source status remains eligible from authenticated fresh channel evidence',()=>{
 assert.equal(sourceModelEligible('loomy',{accounts:[],sourceRows:[{
   id:'sp_'+'1'.repeat(24),sourceAccount:true,providerId:'loomy',
   enabled:true,connectionState:'online'}]}),true);
 for(const change of [{enabled:false},{connectionState:'not_checked'},
   {sourceAccount:false},{providerId:'zcode'}]){
  assert.equal(sourceModelEligible('loomy',{sourceRows:[{
   sourceAccount:true,providerId:'loomy',enabled:true,connectionState:'online',
   ...change,
  }]}),false);
 }
});
test('authenticated source health cannot bypass external-reference ownership or explicit auth expiry',()=>{
 const id='sp_'+'a'.repeat(24);
 const account={id,providerId:'codearts',enabled:true,
  credentialRef:'driver:codearts:'+id};
 const live=row();
 assert.equal(privateSourceAccountRoutable(account,live,true),true);
 assert.equal(privateSourceAccountRoutable(account,{...live,runtimeMode:'linked'},true),false,
  'a legacy external reference with the same opaque ID must not hijack the private source');
 assert.equal(privateSourceAccountRoutable(account,{...live,origin:{kind:'dsh-account-pool'}},true),false);
 for(const state of ['expired','limited','disabled','provider_disabled','error']){
  assert.equal(privateSourceAccountRoutable(account,{...live,connectionState:state},true),false,state);
 }
 assert.equal(privateSourceAccountRoutable(account,{...live,connectionState:'pending'},true),true,
  'fresh independent source auth can settle pending local verification');
 assert.equal(privateSourceAccountRoutable(account,{...live,connectionState:'pending'},false),false);
 assert.equal(privateSourceAccountRoutable(account,{...live,connectionState:'recently_verified'},false),false);
 assert.equal(privateSourceAccountRoutable({...account,enabled:false},live,true),false);
 assert.equal(privateSourceAccountRoutable(account,{...live,enabled:false},true),false);
 assert.equal(privateSourceAccountRoutable(account,{...live,id:'another'},true),false);
});
test('unrelated account field names and untrusted model directory metadata are never authorization',()=>{
 assert.equal(sourceModelEligible('codearts',{accounts:[{
  providerId:'codearts',enabled:true,connectionState:'online',nickname:'owner',
  modelInferenceVerifiedAt:Date.now(),runtimeMode:'linked',
  origin:{kind:'independent-owned'},
 }],sourceRows:[{providerId:'codearts',enabled:true,
  connectionState:'online',sourceAccount:false}]}),false);
 assert.equal(sourceModelEligible('',{}),false);
 assert.equal(sourceModelEligible('codearts',{accounts:null,sourceRows:undefined}),false);
});
