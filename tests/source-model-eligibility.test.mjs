import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceModelEligible} from '../src/source-model-eligibility.mjs';

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
