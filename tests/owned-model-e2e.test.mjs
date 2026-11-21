import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

function rig({owner='own_doubao',receipt={text:'OK',finishReason:'stop',toolCalls:[]},
 accountRef,models=[{id:'chat-free',isFree:true}],onGenerate}={}){
 const id=owner==='own_doubao'?'db_'+'a'.repeat(28):
  owner==='own_workbuddy-cn'?'wbp_'+'b'.repeat(24):
  'sp_'+'c'.repeat(24);
 const ref=accountRef??'driver:'+owner+':'+id;
 let state=normalizeConfig({providers:[{id:owner,name:owner,protocol:'native-channel',
  models:['chat-free'],enabled:true}],
  accounts:[{id,providerId:owner,credentialRef:ref,enabled:true,weight:1}]});
 let calls=0,modelListCalls=0,credentialReads=0;
 const driver={
  listModels:async({account,signal})=>{
   modelListCalls++;
   assert.equal(account.id,id);
   assert.equal(account.credentialRef,ref);
   assert.equal(signal?.aborted,false);
   return models;
  },
  generate:async({account,model,options,signal})=>{
   calls++;
   assert.equal(account.id,id);
   assert.equal(model,'chat-free');
   assert.equal(options.messages[0].role,'user');
   assert.match(options.messages[0].content[0].text,/OK/);
   assert.equal(options.maxTokens,32);
   assert.equal(signal?.aborted,false);
   await onGenerate?.();
   return receipt;
  },
 };
 const center=createAccountCenter({configStore:{
  get:()=>structuredClone(state),
  replace:raw=>{state=normalizeConfig(raw);return structuredClone(state)},
 },drivers:new Map([[owner,driver]]),
  now:()=>1710000000000,
  vault:{resolve:()=>{credentialReads++;throw Error('original host secrets must not be loaded')}}});
 return {center,id,ref,driver,
  get calls(){return calls},get modelListCalls(){return modelListCalls},
  get credentialReads(){return credentialReads},
  replaceConfig:raw=>{state=normalizeConfig(raw)}};
}
test('owner-only live inference gate requires a completed response and records exact account proof',async()=>{
 const h=rig();
 assert.equal(h.center.list().accounts[0].modelTestAvailable,true);
 const result=await h.center.verifyModel(h.id);
 assert.equal(result.state,'verified');
 assert.equal(result.modelId,'chat-free');
 assert.equal(h.calls,1);
 assert.equal(h.credentialReads,0,'must not consult unrelated DSH plugin vault');
 const row=h.center.list().accounts[0];
 assert.equal(row.modelInferenceVerifiedAt,1710000000000);
 assert.equal(row.connectionState,'online');
 h.center.stop();
});
test('self-owned source channels can use the same model acceptance gate',async()=>{
 const h=rig({owner:'own_workbuddy-cn'});
 assert.equal((await h.center.verifyModel(h.id)).state,'verified');
 assert.equal(h.calls,1);
 h.center.stop();
});
test('stream without complete stop cannot claim that model inference worked',async()=>{
 const h=rig({receipt:{text:'partial',finishReason:'length',toolCalls:[]}});
 assert.equal((await h.center.verifyModel(h.id)).state,'failed');
 assert.equal(h.center.list().accounts[0].modelInferenceVerifiedAt,null);
 assert.equal(h.center.list().accounts[0].modelTestFailedAt,1710000000000);
 h.center.stop();
});
test('empty or tool-call-only upstream response cannot pass the model chat gate',async()=>{
 const h=rig({receipt:{text:'',finishReason:'stop',toolCalls:[{name:'unrequested'}]}});
 assert.equal((await h.center.verifyModel(h.id)).state,'failed');
 assert.equal(h.center.list().accounts[0].modelInferenceVerifiedAt,null);
 h.center.stop();
});
test('unlisted model is rejected and never invoked',async()=>{
 const h=rig();
 const result=await h.center.verifyModel(h.id,{modelId:'unknown'});
 assert.equal(result.state,'skipped');
 assert.equal(h.calls,0);
 h.center.stop();
});
test('old original-plugin reference cannot masquerade as a self-owned online test',async()=>{
 const h=rig({owner:'workbuddy',accountRef:'driver:workbuddy:sp_'+'c'.repeat(24)});
 await assert.rejects(()=>h.center.verifyModel(h.id),/仅独立接管/);
 assert.equal(h.calls,0);
 h.center.stop();
});
test('model success cannot be applied to account metadata that changed during inference',async()=>{
 let h;
 h=rig({onGenerate:async()=>{
  h.replaceConfig({providers:[{id:'own_doubao',name:'Owned',protocol:'native-channel',models:['chat-free']}],
   accounts:[]});
 }});
 const result=await h.center.verifyModel(h.id);
 assert.equal(result.state,'failed');
 assert.equal(h.center.list().accounts.length,0);
 h.center.stop();
});
