import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccountVerificationStore} from '../src/account-verification-store.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

test('true zero-price model proof persists across DSH restarts without retesting or leaking response/credentials',async()=>{
 const dir=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'dsh-model-proof-'));
 try{
  const file=join(dir,'account-verification.json'),now=Date.now();
  const id='wbp_'+'c'.repeat(24),providerId='own_workbuddy-cn';
  const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel'}],
   accounts:[{id,providerId,credentialRef:'driver:'+providerId+':'+id}]});

  const configStore={get:()=>structuredClone(cfg),replace:()=>{}};
  const driver={listModels:async()=>[{id:'safe-test-model',isFree:true}],
   generate:async()=>({text:'OK',finishReason:'stop',toolCalls:[]})};
  const store=createAccountVerificationStore({path:file});
  const first=createAccountCenter({configStore,verificationStore:store,
   drivers:new Map([[providerId,driver]])});
  assert.equal((await first.verifyModel(id)).state,'verified');
  first.stop();
  const readAfterRestart=createAccountVerificationStore({path:file});
  assert.equal(readAfterRestart.getModelTest(cfg.accounts[0]).state,'verified');
  const reloaded=createAccountCenter({configStore,verificationStore:readAfterRestart,
   drivers:new Map([[providerId,driver]])});
  assert.ok(reloaded.list().accounts[0].modelInferenceVerifiedAt>=now);
  reloaded.stop();
  const replacement={...cfg.accounts[0],credentialRef:'driver:'+providerId+':wbp_'+ 'd'.repeat(24)};
  assert.equal(readAfterRestart.getModelTest(replacement),null,
   'a changed credential cannot inherit old completed inference');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('read-only catalog outage must not erase the last actually successful model generation proof',async()=>{
 const dir=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'dsh-model-catalog-'));
 try{
  const file=join(dir,'checks.json'),id='wbp_'+'f'.repeat(24),providerId='own_workbuddy-cn';
  const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel'}],
   accounts:[{id,providerId,credentialRef:'driver:'+providerId+':'+id}]});
  let catalogError=false,generations=0,clock=Date.now();
  const configStore={get:()=>structuredClone(cfg),replace:()=>{}};
  const driver={listModels:async()=>{
    if(catalogError)throw Object.assign(Error('read-only timeout'),{code:'TIMEOUT'});
    return [{id:'confirmed-free',isFree:true}];
   },generate:async()=>{generations++;return {text:'OK',finishReason:'stop',toolCalls:[]}}};
  const store=createAccountVerificationStore({path:file});
  const center=createAccountCenter({configStore,verificationStore:store,
   drivers:new Map([[providerId,driver]]),now:()=>clock});
  assert.equal((await center.verifyModel(id)).state,'verified');
  const firstProof=center.list().accounts[0].modelInferenceVerifiedAt;
  clock+=1000;catalogError=true;
  const second=await center.verifyModel(id);
  assert.equal(second.state,'skipped','no generation occurred, report read-only catalog failure as skip');
  assert.equal(second.code,'CATALOG_UNAVAILABLE');
  assert.equal(generations,1);
  assert.equal(center.list().accounts[0].modelInferenceVerifiedAt,firstProof);
  center.stop();
  const restarted=createAccountCenter({configStore,
   verificationStore:createAccountVerificationStore({path:file}),
   drivers:new Map([[providerId,driver]]),now:()=>clock});
  assert.equal(restarted.list().accounts[0].modelInferenceVerifiedAt,firstProof);
  restarted.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('a failed later real model turn remains the latest outcome after DSH restarts instead of resurrecting old success',async()=>{
 const dir=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'dsh-model-failure-'));
 try{
  const file=join(dir,'checks.json'),id='wbp_'+'e'.repeat(24),providerId='own_workbuddy-cn';
  const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel'}],
    accounts:[{id,providerId,credentialRef:'driver:'+providerId+':'+id}]});
  let clock=Date.now(),fail=false;
  const configStore={get:()=>structuredClone(cfg),replace:()=>{}};
  const driver={listModels:async()=>[{id:'confirmed-free',isFree:true}],
   generate:async()=>fail?{text:'partial',finishReason:'length',toolCalls:[]}:
     {text:'OK',finishReason:'stop',toolCalls:[]}};
  const storage=createAccountVerificationStore({path:file});
  const first=createAccountCenter({configStore,verificationStore:storage,
   drivers:new Map([[providerId,driver]]),now:()=>clock});
  assert.equal((await first.verifyModel(id)).state,'verified');
  clock+=1000;fail=true;
  assert.equal((await first.verifyModel(id)).state,'failed');
  assert.equal(first.list().accounts[0].modelInferenceVerifiedAt,null);
  first.stop();
  const restarted=createAccountCenter({configStore,
   verificationStore:createAccountVerificationStore({path:file}),
   drivers:new Map([[providerId,driver]]),now:()=>clock});
  assert.equal(restarted.list().accounts[0].modelInferenceVerifiedAt,null);
  assert.ok(restarted.list().accounts[0].modelTestFailedAt>=clock);
  restarted.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

