import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

function rig({models,providerId='own_workbuddy-cn',onGenerate}={}){
 const id='wbp_'+'a'.repeat(24);
 let cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',
  name:'Owned member channel',enabled:true}],accounts:[{
  id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true,
 }]});
 let generates=0,lists=0;
 const driver={listModels:async()=>{lists++;return structuredClone(models??[])},
  generate:async args=>{generates++;return onGenerate?.(args)??{
   text:'OK',finishReason:'stop',toolCalls:[],usage:{prompt_tokens:3,completion_tokens:2},
  }}};
 const configStore={get:()=>structuredClone(cfg),replace:x=>(cfg=normalizeConfig(x))};
 const center=createAccountCenter({configStore,
  drivers:new Map([[providerId,driver]]),now:()=>Date.now()});
 return {center,id,providerId,configStore,
  get generates(){return generates},get lists(){return lists}};
}
test('model-test defaults to a truly zero-rate model and never sends the earlier paid model',async()=>{
 const h=rig({models:[
  {id:'model-billed',name:'Premium',pricing:{input:1,output:2}},
  {id:'model-zero',name:'Hy4 flash · x0.00'},
 ]});
 const catalog=await h.center.listTestModels(h.id);
 assert.equal(catalog.models.length,2);
 assert.equal(catalog.models[0].free,false);
 assert.equal(catalog.models[1].free,true);
 const result=await h.center.verifyModel(h.id);
 assert.equal(result.state,'verified');
 assert.equal(result.modelId,'model-zero');
 assert.equal(h.generates,1);
 assert.equal(result.responsePreview,'OK');
 assert.equal(result.usage.completion_tokens,2);
 h.center.stop();
});
test('unknown-price model does not issue any real generation even with an exact chosen model ID',async()=>{
 const h=rig({models:[{id:'unknown',name:'not clearly rated'}]});
 const result=await h.center.verifyModel(h.id,{modelId:'unknown'});
 assert.equal(result.state,'skipped');
 assert.equal(result.code,'COST_NOT_CONFIRMED_FREE');
 assert.equal(h.generates,0);
 h.center.stop();
});
test('user-paid exclusion blocks even an upstream free marker',async()=>{
 const h=rig({models:[{id:'claimed-free',isFree:true}]});
 h.configStore.replace({...h.configStore.get(),freePool:{models:[{
  providerId:h.providerId,model:'claimed-free',free:false,
 }]}});
 const rows=await h.center.listTestModels(h.id);
 assert.equal(rows.models[0].free,false);
 const result=await h.center.verifyModel(h.id);
 assert.equal(result.state,'skipped');
 assert.equal(h.generates,0);
 h.center.stop();
});
test('source explicitly certified zero token prices are eligible for real minimal model test',async()=>{
 const h=rig({models:[{id:'zero-prices',pricing:{input:0,output:0}}]});
 assert.equal((await h.center.verifyModel(h.id,{modelId:'zero-prices'})).state,'verified');
 assert.equal(h.generates,1);
 h.center.stop();
});
test('when no free model is demonstrable model test must be skipped rather than marked as a failed account login',async()=>{
 const h=rig({models:[{id:'paid',name:'expensive',pricing:{input:5,output:5}}]});
 const before=h.center.list().accounts[0].connectionState;
 const result=await h.center.verifyModel(h.id);
 assert.equal(result.state,'skipped');
 assert.equal(h.generates,0);
 assert.equal(h.center.list().accounts[0].connectionState,before);
 assert.equal(h.center.list().accounts[0].modelTestFailedAt,null);
 h.center.stop();
});
test('changing owner free policy before a pending generation returns cannot certify or publish old reply',async()=>{
 let release,start;const started=new Promise(resolve=>{start=resolve});
 const waiting=new Promise(resolve=>{release=resolve});
 const h=rig({models:[{id:'zero',isFree:true}],onGenerate:async()=>{
  start();await waiting;
  return {text:'OK',finishReason:'stop',toolCalls:[]};
 }});
 const promise=h.center.verifyModel(h.id);
 await started;
 h.configStore.replace({...h.configStore.get(),freePool:{models:[{
  providerId:h.providerId,model:'zero',free:false,
 }]}});
 release();
 const result=await promise;
 assert.notEqual(result.state,'verified');
 assert.equal(h.center.list().accounts[0].modelInferenceVerifiedAt,null);
 h.center.stop();
});
