import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceChannelDriver,collectSourceDshStream} from '../src/source-channel-driver.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {classifyFailure} from '../src/failure.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {freeEvidence} from '../src/auto-free.mjs';

const textStream=(text='source reply')=>(async function*(){
 yield {type:'block-start',index:0,blockType:'text'};
 yield {type:'text-delta',index:0,text};
 yield {type:'block-end',index:0,block:{type:'text',text}};
 yield {type:'usage',usage:{inputTokens:4,outputTokens:2,totalTokens:6}};
 yield {type:'finish',reason:{kind:'stop'}};
})();
function mockSource(rows){
 const calls=[];
 const state={rows:rows.map(x=>({...x}))};
 const embeddedPack={
  status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:state.rows}),
  listModels:async providerId=>({state:'ready',providerId,models:[{id:'qoder-chat'}]}),
  async streamNative(request){calls.push(request);return textStream()},
 };
 return {embeddedPack,calls,state};
}
test('Loomy empty or reasoning-only stop fails over to another explicitly free tier without leaking partial content',async()=>{
 for(const reasoningOnly of [false,true]){
  const rig=mockSource([{id:'l-empty',providerId:'loomy',enabled:true},{id:'q-good',providerId:'qoder',enabled:true}]);
  rig.embeddedPack.listModels=async providerId=>({state:'ready',models:providerId==='loomy'?[{id:'spark-x2.6',costMultiplier:0,priceSource:'loomy-official-model-name-ratio'}]:[{id:'qoder-chat'}]});
  rig.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{accountId:'l-empty',authVerified:true}]});
  rig.embeddedPack.streamNative=async req=>{
   rig.calls.push(req.providerId);
   assert.equal(req.model,req.providerId==='loomy'?'spark-x2.6':'qoder-chat','never invoke the non-free tier');
   if(req.providerId==='qoder')return textStream('complete fallback');
   return (async function*(){
    if(reasoningOnly){
     yield {type:'block-start',index:0,blockType:'reasoning'};
     yield {type:'reasoning-delta',index:0,text:'PRIVATE_INCOMPLETE_REASONING'};
     yield {type:'block-end',index:0};
    }
    yield {type:'finish',reason:{kind:'stop'}};
   })();
  };
  const drivers=new Map(['loomy','qoder'].map(providerId=>[providerId,createSourceChannelDriver({providerId,embeddedPack:rig.embeddedPack})]));
  const accounts=rig.state.rows.map(r=>{const id=sourceAccountOpaqueId(r.providerId,r.id);return {id,providerId:r.providerId,credentialRef:'driver:'+r.providerId+':'+id,enabled:true}});
  const config=normalizeConfig({providers:[{id:'loomy',protocol:'native-channel',models:['spark-x2.6']},{id:'qoder',protocol:'native-channel',models:['qoder-chat']}],accounts,routes:[{id:'empty-test',name:'Free test',mode:'free',maxSwitches:3,tiers:[{providerId:'loomy',model:'spark-x2.6',free:true},{providerId:'qoder',model:'paid-model',free:false},{providerId:'qoder',model:'qoder-chat',free:true}]}]});
  const adapter=createNativeRouterAdapter({configStore:{get:()=>config},channelDrivers:drivers});
  const events=[];
  for await(const event of adapter.stream({model:'chain:empty-test',sessionId:'empty-test',messages:[{role:'user',content:'hello'}]}))events.push(event);
  assert.deepEqual(rig.calls,['loomy','qoder']);
  assert.equal(events.find(e=>e.type==='text-delta')?.text,'complete fallback');
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_INCOMPLETE_REASONING/);
  assert.equal(adapter.getStatus().metrics.failedAttempts,1);
 }
});

test('opt-in source discovery returns stable opaque references; import copies NO credentials',async()=>{
 const rig=mockSource([{id:'user-with-token-path',providerId:'qoder',nickname:'Source Qoder',
  enabled:true,credentialRef:'NO_LEAK'}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const candidates=await driver.discover();
 assert.equal(candidates.length,1);
 assert.match(candidates[0].id,/^sp_[a-f0-9]{24}$/);
 assert.doesNotMatch(JSON.stringify(candidates),/NO_LEAK|user-with-token-path/);
 await assert.rejects(()=>driver.importCandidate({candidateId:candidates[0].id}),/consent/);
 const account=await driver.importCandidate({candidateId:candidates[0].id,consent:true});
 assert.deepEqual(account,{id:candidates[0].id,credentialRef:'driver:qoder:'+candidates[0].id});
 assert.deepEqual(await driver.listModels({account:{...account,providerId:'qoder'}}),[{id:'qoder-chat'}]);
 const other=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack});
 await assert.rejects(()=>other.importCandidate({candidateId:candidates[0].id,consent:true}),/no longer exists/);
});
test('ZCode legacy private Start Plan remains inspectable but never grants third-party inference',async()=>{
 const rig=mockSource([{id:'gift-01',providerId:'zcode',enabled:true}]);
 rig.embeddedPack.listModels=async()=>({state:'ready',models:[
   {id:'GLM-5.3-Flash',name:'GLM 5.3 Flash'},{id:'glm-5.3',name:'GLM 5.3'}]});
  let giftedBalance=5000,balance=5000,authenticated=true;  rig.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{
   accountId:'gift-01',authVerified:authenticated,balanceState:'available',balance,giftedBalance,
 }]});
 const driver=createSourceChannelDriver({providerId:'zcode',accountProviderId:'own_zcode',
   embeddedPack:rig.embeddedPack});
 const id=sourceAccountOpaqueId('zcode','gift-01');
 const account={id,providerId:'own_zcode',credentialRef:'driver:own_zcode:'+id};
 const rows=await driver.listModels({account});
 for(const row of rows){assert.equal(row.accessRestriction,'OFFICIAL_CLIENT_ONLY');assert.equal(freeEvidence(row,'own_zcode'),null);}
 for(const model of rows.map(x=>x.id))await assert.rejects(()=>driver.generate({account,model,options:{freeOnly:true}}),error=>error.code==='OFFICIAL_CLIENT_ONLY');
 const facts=await driver.refreshAccountStatus({account});assert.equal(facts.giftedBalance,5000);assert.equal(facts.authVerified,true);
 assert.equal(rig.calls.length,0,'restricted source must not send inference');
});
test('CodeArts model list preserves verified exact official credit ratio and rejects invented prices',async()=>{
 const src=mockSource([{id:'official-c',providerId:'codearts',enabled:true}]);
 src.embeddedPack.listModels=async()=>({state:'ready',models:[
   {id:'glm-5.3-flash',name:'GLM · x0.00',costMultiplier:0.003,
    priceSource:'codearts-official-credit-ratio',catalogSource:'codearts-signed-official-model-catalog'},  {id:'qwen3.8-flash',name:'Qwen · x0.00',costMultiplier:0,
    priceSource:'codearts-official-credit-ratio'},
  {id:'fake-free',name:'Fake · x0.00',costMultiplier:0,
    priceSource:'untrusted-cache'},
 ]});
 const driver=createSourceChannelDriver({providerId:'codearts',
  accountProviderId:'codearts',embeddedPack:src.embeddedPack});
 const id=sourceAccountOpaqueId('codearts','official-c');
 const rows=await driver.listModels({account:{id,providerId:'codearts',
  credentialRef:'driver:codearts:'+id}});
 assert.equal(rows[0].costMultiplier,0.003,'rounded x0.00 is not a true zero');
 assert.equal(rows[1].costMultiplier,0);
 assert.equal(rows[0].catalogSource,'codearts-signed-official-model-catalog'); assert.equal(rows[2].costMultiplier,undefined,'unsupported price source is ignored');
});

test('CodeArts one-post proof rechecks official minimum, pins account and blocks rate changes',async()=>{
 const src=mockSource([{id:'paid-one',providerId:'codearts',enabled:true}]);
 const official=(id,rate)=>({id,catalogSource:'codearts-signed-official-model-catalog',
  priceSource:'codearts-official-credit-ratio',costMultiplier:rate});
 let rates=[official('only-cheapest',0.07),official('other',0.09)];
 src.embeddedPack.listModels=async()=>({state:'ready',providerId:'codearts',models:rates});
 src.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{
  accountId:'paid-one',authVerified:true,balanceState:'available',balance:10}]});
 const driver=createSourceChannelDriver({providerId:'codearts',accountProviderId:'codearts',
   embeddedPack:src.embeddedPack});
 const id=sourceAccountOpaqueId('codearts','paid-one');
 const account={id,providerId:'codearts',credentialRef:'driver:codearts:'+id};
 const options={messages:[{role:'user',content:'OK'}],maxTokens:128,
   sessionId:'native-router-bounded-cost',singleLowCostProof:true,approvedRate:0.07};
 const result=await driver.generate({account,model:'only-cheapest',options});
 assert.equal(result.finishReason,'stop');assert.equal(src.calls.length,1);
 assert.equal(src.calls[0].singleShotPriceProof,true);
 assert.equal(src.calls[0].reasoningEffort,'off');
 rates=[official('other',0.06),official('only-cheapest',0.07)];
 await assert.rejects(()=>driver.generate({account,model:'only-cheapest',options}),/price|minimum|最低|Lowest|changed/i);
 assert.equal(src.calls.length,1,'fee change must prevent a second charged request');
});
test('source channel preserves explicit nonfree and pricing conflict even when positive free flags or gift evidence exist',async()=>{
 const src=mockSource([{id:'loomy-gift',providerId:'loomy',enabled:true}]);
 src.embeddedPack.listModels=async()=>({state:'ready',models:[{id:'spark-x2.6',isFree:false,upstreamFreeLabel:true,pricingConflict:true}]});
 src.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{accountId:'loomy-gift',authVerified:true,balanceState:'available',loomyDailyGift:5000}]});
 const driver=createSourceChannelDriver({providerId:'loomy',accountProviderId:'own_loomy',embeddedPack:src.embeddedPack});
 const id=sourceAccountOpaqueId('loomy','loomy-gift'),account={id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id};
 const row=(await driver.listModels({account}))[0];
 assert.equal(row.isFree,false);assert.equal(row.pricingConflict,true);assert.equal(freeEvidence(row,'own_loomy'),null);
});
test('Loomy daily gift is independently visible and is not a zero-rate assertion',async()=>{
 const src=mockSource([{id:'loomy-gift',providerId:'loomy',enabled:true}]);
 src.embeddedPack.listModels=async()=>({state:'ready',models:[
  {id:'spark-x2.6',name:'Spark X2.6'},{id:'qwen3.8-flash',name:'Paid Qwen'}]});
 let gift=5000,authenticated=true,total=15000;
 src.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{
  accountId:'loomy-gift',authVerified:authenticated,balanceState:'available',
  balance:total,loomyDailyGift:gift,
 }]});
 const driver=createSourceChannelDriver({providerId:'loomy',accountProviderId:'own_loomy',
   embeddedPack:src.embeddedPack});
 const id=sourceAccountOpaqueId('loomy','loomy-gift');
 const account={id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id};
 const rows=await driver.listModels({account});
 assert.equal(rows[0].giftAllowance,'loomy-daily-gift');assert.equal(freeEvidence(rows[0],'own_loomy'),null);
 assert.equal(freeEvidence(rows[1],'own_loomy'),null,'other models never inherit gifted allowance');
 gift=100;total=22000;
 assert.equal(freeEvidence((await driver.listModels({account}))[0],'own_loomy'),null,
   'large paid permanent balance cannot replace insufficient daily free gift');
 gift=5000;authenticated=false;
 assert.equal(freeEvidence((await driver.listModels({account}))[0],'own_loomy'),null,
   'no authentic gift evidence, no billing-risk inference');
 assert.equal(src.calls.length,0);
});

for(const [channel,own,model,giftKey,minGift] of [
  ['loomy','own_loomy','spark-x2.6','loomyDailyGift',2000],
]){
  test(channel+' native smoke cannot issue a charged request if its gift is spent between catalog and generation',async()=>{
   const src=mockSource([{id:'safe-gift',providerId:channel,enabled:true}]);  let gift=5000;
  src.embeddedPack.listModels=async()=>({state:'ready',models:[{id:model,name:'Gift model'}]});
   src.embeddedPack.readSourceStatuses=async(_provider,_id,options)=>{
    assert.equal(options.includeActivities,false,'free inference must not block on unrelated activity endpoints');
    return {state:'ready',accounts:[{accountId:'safe-gift',authVerified:true,balanceState:'available',balance:50000,[giftKey]:gift}]};
   };
  const driver=createSourceChannelDriver({providerId:channel,accountProviderId:own,embeddedPack:src.embeddedPack});
  const id=sourceAccountOpaqueId(channel,'safe-gift');
  const account={id,providerId:own,credentialRef:'driver:'+own+':'+id};
  const advertised=await driver.listModels({account});
  assert.equal(advertised[0].giftAllowance,'loomy-daily-gift');assert.equal(freeEvidence(advertised[0],own),null);
  gift=minGift-1;
  await assert.rejects(()=>driver.generate({account,model,options:{
    sessionId:'native-router-test-fake',maxTokens:32,messages:[{role:'user',content:'OK'}]
  }}),/gift|free/i);
   assert.equal(src.calls.length,0,'no upstream model generation when gift has expired');
   await assert.rejects(()=>driver.generate({account,model,options:{
     sessionId:'ordinary-free-chain',freeOnly:true,maxTokens:32,
     messages:[{role:'user',content:'OK'}]
   }}),/gift|free/i);
   assert.equal(src.calls.length,0,'free-only route must recheck gifts, never spend permanent credits');  gift=5000;
  src.embeddedPack.listModels=async()=>({state:'ready',models:[{id:model,priceSource:'loomy-official-model-name-ratio',costMultiplier:0}]});
  const actual=await driver.generate({account,model,options:{
    sessionId:'native-router-test-fake',maxTokens:32,messages:[{role:'user',content:'OK'}]
  }});
  assert.equal(actual.text,'source reply');
   assert.equal(src.calls.length,1,'only a current official zero-rate catalog allows strict free generation');
   if(channel==='loomy')assert.equal(src.calls[0].reasoningEffort,'none',
     'Loomy owner smoke must request no-thinking mode for minimal usage');
   src.embeddedPack.listModels=async()=>({state:'ready',models:[{id:model,priceSource:'loomy-official-model-name-ratio',costMultiplier:.1}]});
   await assert.rejects(()=>driver.generate({account,model,options:{freeOnly:true,messages:[{role:'user',content:'OK'}]}}),{code:'COST_NOT_CONFIRMED_FREE'});assert.equal(src.calls.length,1); });
}

test('independent Loomy verifier uses only own account pool and authenticated credit status',async()=>{
 const rig=mockSource([{id:'loomy-own-01',providerId:'loomy',nickname:'Loomy 自有',
   enabled:true}]);
 let remoteCalls=0,originalStopped=true;
 rig.embeddedPack.status=()=>({state:'mounted',modelAdapterReady:['loomy']});
 rig.embeddedPack.readSourceStatuses=async (providerId,sourceAccountId)=>{
   assert.equal(originalStopped,true);
   assert.equal(providerId,'loomy');
   assert.equal(sourceAccountId,'loomy-own-01','only the exact owned account is queried');
   remoteCalls++;
   return {state:'ready',accounts:[{accountId:'loomy-own-01',authVerified:true}]};
 };
 const driver=createSourceChannelDriver({providerId:'loomy',
   accountProviderId:'own_loomy',embeddedPack:rig.embeddedPack});
 const account={id:sourceAccountOpaqueId('loomy','loomy-own-01'),providerId:'own_loomy',
   credentialRef:'driver:own_loomy:'+sourceAccountOpaqueId('loomy','loomy-own-01')};
 assert.equal((await driver.refresh({account})).state,'online');
 assert.equal(remoteCalls,1);
 rig.embeddedPack.readSourceStatuses=async()=>({state:'unavailable',accounts:[]});
 const uncertain=await driver.refresh({account});
 assert.equal(uncertain.state,'pending','unknown must not be represented as online');
 assert.equal(rig.calls.length,0,'metadata verification cannot invoke inference');
 rig.embeddedPack.status=()=>({state:'mounted',modelAdapterUnready:['loomy']});
 assert.equal((await driver.refresh({account})).state,'error');
});
test('CodeArts and ZCode autonomous logins verify only on authenticated upstream status',async()=>{
 for(const providerId of ['codearts','zcode']){
   const row={providerId,id:'owned-01',enabled:true,nickname:'user'};
   const src=mockSource([row]);
   let verified=true,attempts=0;
   src.embeddedPack.status=()=>({state:'mounted',modelAdapterReady:[providerId]});
   src.embeddedPack.readSourceStatuses=async()=>{attempts++;
     return {state:'ready',accounts:[{accountId:row.id,
       authVerified:verified}]};};
   const id=sourceAccountOpaqueId(providerId,row.id),owner='own_'+providerId;
   const driver=createSourceChannelDriver({providerId,accountProviderId:owner,
     embeddedPack:src.embeddedPack});
   const account={id,providerId:owner,credentialRef:'driver:'+owner+':'+id};
   assert.equal((await driver.refresh({account})).state,'online');
   verified=false;
   assert.equal((await driver.refresh({account})).state,'pending');
   assert.equal(attempts,2);
   assert.equal(src.calls.length,0,'read-only verification must not call inference');
 }
});
test('single enabled source account streams through existing DSH LLM with host tool metadata only',async()=>{
 const rig=mockSource([{id:'qoder-a',providerId:'qoder',enabled:true,connectionState:'not_checked'}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const source=(await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true}));
 const account={...source,providerId:'qoder'};
 const output=await driver.generate({account,model:'qoder-chat',options:{
  system:'Allowed context',messages:[{role:'user',content:[{type:'text',text:'hello'}]}],
  tools:[{name:'read_file',description:'Read an authorized file',parameters:{type:'object',properties:{path:{type:'string'}}}}],
  maxTokens:256,
 }});
 assert.deepEqual(output,{text:'source reply',reasoning:'',toolCalls:[],finishReason:'stop',
  usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}});
 assert.equal(rig.calls.length,1);
 assert.equal(rig.calls[0].providerId,'qoder');
 assert.equal(rig.calls[0].sourceAccountId,'qoder-a');
 assert.equal(rig.calls[0].model,'qoder-chat');
 assert.equal(rig.calls[0].messages[0].role,'system');
 assert.equal(rig.calls[0].messages[1].role,'user');
 assert.deepEqual(rig.calls[0].tools,[{name:'read_file',description:'Read an authorized file',
  parameters:{type:'object',properties:{path:{type:'string'}}}}]);
 assert.doesNotMatch(JSON.stringify(rig.calls[0]),/NO_LEAK|credentialRef|accessToken/);
});
test('max-token native output never marks the independent account as model-proven',async()=>{
 const rig=mockSource([{id:'qoder-bounded',providerId:'qoder',enabled:true}]);
 let maxTokens=true;
 rig.embeddedPack.streamNative=async()=>async function*(){
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'partial'};
  yield {type:'block-end',index:0,block:{type:'text',text:'partial'}};
  yield {type:'finish',reason:{kind:maxTokens?'max-tokens':'stop'}};
 }();
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const id=sourceAccountOpaqueId('qoder','qoder-bounded');
 const account={id,providerId:'qoder',credentialRef:'driver:qoder:'+id};
 const first=await driver.generate({account,model:'qoder-chat',
  options:{messages:[{role:'user',content:'OK'}],maxTokens:32}});
 assert.equal(first.finishReason,'length');
 assert.equal(driver.accountSnapshot(account).modelInferenceVerifiedAt,null,
  'truncated model output is NOT complete account inference proof');
 maxTokens=false;
 const second=await driver.generate({account,model:'qoder-chat',
  options:{messages:[{role:'user',content:'OK'}],maxTokens:32}});
 assert.equal(second.finishReason,'stop');
 assert.ok(driver.accountSnapshot(account).modelInferenceVerifiedAt>0);
});
test('source bridge refuses ambiguous multiple enabled accounts and disabled/stale references',async()=>{
 const rig=mockSource([{id:'q-a',providerId:'qoder',enabled:true},
  {id:'q-b',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const acc=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const account={...acc,providerId:'qoder'};
 await assert.rejects(()=>driver.generate({account,model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),/multiple enabled/);
 assert.equal(rig.calls.length,0);
 rig.state.rows[0].enabled=false;rig.state.rows[1].enabled=false;
 await assert.rejects(()=>driver.generate({account,model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),/disabled/);
 rig.state.rows.splice(0);
 await assert.rejects(()=>driver.listModels({account}),/stale/);
 assert.equal(rig.calls.length,0);
});
test('native DSH tool-call reconstruction strictly enforces advertised tools',async()=>{
 const stream=async function*(){
  yield {type:'block-start',index:1,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:1,id:'t1',name:'read_file',argumentsDelta:'{"path":'};
  yield {type:'tool-call-delta',index:1,id:'t1',argumentsDelta:'"README.md"}'};
  yield {type:'block-end',index:1,block:{type:'tool-call',id:'t1',name:'read_file',arguments:'{"path":"README.md"}'}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
 };
 const offered=[{name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}}}}];
 const result=await collectSourceDshStream(stream(),{tools:offered});
 assert.deepEqual(result.toolCalls,[{id:'t1',name:'read_file',arguments:'{"path":"README.md"}'}]);
 assert.equal(result.finishReason,'tool_calls');
 await assert.rejects(()=>collectSourceDshStream(stream(),{tools:[]}),/Unadvertised tool call/);
});
test('stalled native stream responds to cancellation even when next and return never settle',async()=>{
 const controller=new AbortController();let returned=0;
 const stalled={[Symbol.asyncIterator](){return this},next(){return new Promise(()=>{})},return(){returned++;return new Promise(()=>{})}};
 const pending=collectSourceDshStream(stalled,{signal:controller.signal});
 controller.abort();
 let timer;try{
  await assert.rejects(Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cancellation did not settle')),250)})]),e=>e.code==='CANCELLED');
  assert.equal(returned,1);
 }finally{clearTimeout(timer)}
});
test('native stream exposes only validated progress stages while preserving complete text',async()=>{
 const progress=[];
 async function* stream(){
  yield {type:'block-start',index:0,blockType:'reasoning'};
  yield {type:'reasoning-delta',index:0,text:'fixture reasoning'};
  yield {type:'block-end',index:0};
  yield {type:'block-start',index:1,blockType:'text'};
  yield {type:'text-delta',index:1,text:'OK'};
  yield {type:'block-end',index:1};
  yield {type:'finish',reason:{kind:'stop'}};
 }
 const reply=await collectSourceDshStream(stream(),{onProgress:p=>progress.push(p)});
 assert.equal(reply.text,'OK');assert.equal(reply.finishReason,'stop');
 assert.deepEqual(progress,['STREAM_FIRST_EVENT','STREAM_REASONING','STREAM_TEXT','STREAM_FINISH']);
});
test('incomplete, failed, invalid and oversized upstream DSH streams never release a partial answer',async()=>{
 async function* partial(){yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'partial'};yield {type:'block-end',index:0};}
 async function* failed(){yield {type:'finish',reason:{kind:'error',failure:{message:'SECRET_REMOTE'}}};}
 async function* oversized(){yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'x'.repeat(16*1024*1024+1)};}
 await assert.rejects(()=>collectSourceDshStream(partial()),/before complete finish/);
 await assert.rejects(()=>collectSourceDshStream(failed()),/did not complete successfully/);
 await assert.rejects(()=>collectSourceDshStream(oversized()),/exceeded size/);
});
test('native source finish failure preserves only structured quota/rate-limit/provider codes for safe fallback',async()=>{
 for(const [code,expected] of [
  ['ACCOUNT_QUOTA','QUOTA'],['RATE_LIMIT','RATE_LIMIT'],
  ['PROVIDER_NOT_READY','PROVIDER_NOT_READY']]){
  const broken=(async function*(){
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text:'DO_NOT_EXPOSE_PARTIAL'};
   yield {type:'block-end',index:0};
   yield {type:'finish',reason:{kind:'error',failure:{code,message:'Bearer SECRET_SESSION'}}};
  })();
  await assert.rejects(()=>collectSourceDshStream(broken),error=>{
   const reason=classifyFailure(error);
   assert.equal(reason.code,expected);
   assert.equal(reason.retryable,true);
   assert.doesNotMatch(error.message,/SECRET_SESSION|DO_NOT_EXPOSE_PARTIAL/);
   return true;
  });
 }
});
test('source channel through native-router chain delivers DSH stream with no separate proxy',async()=>{
 const rig=mockSource([{id:'qoder-a',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const approved=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const cfg=normalizeConfig({providers:[{id:'qoder',name:'Qoder Source',protocol:'native-channel',models:['qoder-chat'],
    enabled:true,supportsTools:true}],accounts:[{id:approved.id,providerId:'qoder',
    credentialRef:approved.credentialRef,enabled:true}],routes:[{id:'source',name:'Source chain',
    tiers:[{providerId:'qoder',model:'qoder-chat'}],enabled:true,mode:'priority'}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map([['qoder',driver]])});
 const output=[];
 for await(const event of adapter.stream({model:'chain:source',sessionId:'isolated-1',
  messages:[{role:'user',content:[{type:'text',text:'test'}]}]}))output.push(event);
 assert.equal(output.some(x=>x.type==='text-delta'&&x.text==='source reply'),true);
 assert.equal(output.at(-1).type,'finish');
 assert.equal(output.at(-1).reason.kind,'stop');
 assert.equal(rig.calls.length,1);
});
test('account console only imports independently owned channel-pool accounts',async()=>{
  const rig=mockSource([{id:'qoder-primary',providerId:'qoder',nickname:'Primary',enabled:true}]);
  const driver=createSourceChannelDriver({providerId:'qoder',
    accountProviderId:'own_qoder',embeddedPack:rig.embeddedPack});
  let state=normalizeConfig({embeddedPack:{enabled:true},providers:[{id:'own_qoder',
   name:'Qoder',protocol:'native-channel',enabled:true,models:['qoder-chat']}]});
 let invalidations=0;
 const store={get:()=>structuredClone(state),replace:input=>{
  state=normalizeConfig(input);return structuredClone(state);
 }};
  const center=createAccountCenter({configStore:store,drivers:new Map([['own_qoder',driver]]),
   adapter:{invalidateCatalog(){invalidations++}}});
  const discovered=await center.discover('own_qoder');
 assert.equal(discovered.candidates.length,1);
 assert.equal(discovered.imported,0);
 assert.equal(store.get().accounts.length,0);
  const imported=await center.importCandidate('own_qoder',discovered.candidates[0].id);
 assert.equal(imported.enabled,true);
 assert.equal(store.get().accounts[0].enabled,true);
 assert.equal(store.get().accounts[0].autoCheckin,false);
  assert.match(store.get().accounts[0].credentialRef,/^driver:own_qoder:sp_[a-f0-9]{24}$/);
 assert.doesNotMatch(JSON.stringify(store.get()),/qoder-primary|SECRET/);
  await assert.rejects(()=>center.importCandidate('own_qoder',discovered.candidates[0].id));
 assert.equal(store.get().accounts[0].enabled,true);
 assert.ok(invalidations>=1);
 const configured=store.get();
 state=normalizeConfig({...configured,routes:[{id:'sourceRoute',name:'Source',
   mode:'priority',enabled:true,tiers:[{providerId:'own_qoder',model:'qoder-chat'}]}]});
  const adapter=createNativeRouterAdapter({configStore:store,channelDrivers:new Map([['own_qoder',driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'chain:sourceRoute',
  messages:[{role:'user',content:[{type:'text',text:'Hello'}]}]}))events.push(event);
 assert.equal(events.some(x=>x.type==='text-delta'&&x.text==='source reply'),true);
 assert.equal(rig.calls.length,1);
});
test('source stream status 429 triggers existing native-router fallback without leaking partial output or credentials',async()=>{
 const rig=mockSource([{id:'qoder-primary',providerId:'qoder',enabled:true}]);
 let started=0;
 rig.embeddedPack.streamNative=async()=>{started++;return (async function*(){
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'discard this partial output'};
  yield {type:'block-end',index:0};
  yield {type:'finish',reason:{kind:'error',failure:{status:429,message:'Bearer SECRET_ACCESS'}}};
 })()};
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const approved=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const nextDriver={generate:async()=>({text:'fallback-success',reasoning:'',toolCalls:[],finishReason:'stop'})};
 const config=normalizeConfig({providers:[
  {id:'qoder',protocol:'native-channel',models:['qoder-chat']},
  {id:'other',protocol:'native-channel',models:['backup-model']}
 ],accounts:[
  {id:approved.id,providerId:'qoder',credentialRef:approved.credentialRef},
  {id:'backup',providerId:'other',credentialRef:'driver:other:backup'}
 ],routes:[{id:'fall',name:'fall',mode:'priority',tiers:[
  {providerId:'qoder',model:'qoder-chat'},
  {providerId:'other',model:'backup-model'}
 ],maxSwitches:2}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},
  channelDrivers:new Map([['qoder',driver],['other',nextDriver]])});
 const events=[];
 for await(const event of adapter.stream({model:'chain:fall',
  messages:[{role:'user',content:[{type:'text',text:'Question'}]}]}))events.push(event);
 assert.equal(started,1);
 assert.equal(events.some(x=>x.type==='text-delta'&&x.text==='fallback-success'),true);
 assert.doesNotMatch(JSON.stringify(events),/discard this partial output|SECRET_ACCESS/);
 const metrics=adapter.getStatus().metrics;
 assert.equal(metrics.failedAttempts,1);
 assert.equal(metrics.successfulTurns,1);
});
test('a private source throwing a structured quota code before streaming also falls back without exposing credentials',async()=>{
 const rig=mockSource([{id:'qoder-source',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const candidate=(await driver.discover())[0];
 const adopted=await driver.importCandidate({candidateId:candidate.id,consent:true});
 rig.embeddedPack.streamNative=async()=>{
  throw Object.assign(Error('Bearer SENSITIVE_SESSION'),{code:'ACCOUNT_QUOTA'});
 };
 await assert.rejects(()=>driver.generate({account:{...adopted,providerId:'qoder'},
  model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),error=>{
   assert.equal(classifyFailure(error).code,'QUOTA');
   assert.doesNotMatch(error.message,/SENSITIVE_SESSION/);
   return true;
 });
});
test('raw upstream native error messages are hidden while bounded HTTP codes are preserved',async()=>{
 const rig=mockSource([{id:'qoder-a',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const ref=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 rig.embeddedPack.streamNative=async()=>{throw Object.assign(Error('Bearer SECRET_JWT  at C:\\private\\tokens'),{status:429})};
 await assert.rejects(()=>driver.generate({account:{...ref,providerId:'qoder'},
  model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),error=>
    error.status===429&&!/SECRET_JWT|private/.test(error.message));
});
test('source channels disappear from model catalog and account controls whenever isolated mount is unavailable',async()=>{
 let ready=false;
 const rig=mockSource([{id:'qoder-01',providerId:'qoder',enabled:true}]);
 rig.embeddedPack.status=()=>({state:ready?'mounted':'blocked'});
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const ref=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const config=normalizeConfig({providers:[{id:'qoder',protocol:'native-channel',models:['qoder-chat']}],
  accounts:[{id:ref.id,providerId:'qoder',credentialRef:ref.credentialRef}],
  routes:[{id:'source',name:'source',tiers:[{providerId:'qoder',model:'qoder-chat'}]}]});
 const {createCatalog}=await import('../src/catalog.mjs');
 const {describeChannels}=await import('../src/channels.mjs');
 const map=new Map([['qoder',driver]]);
 const catalog=createCatalog({getConfig:()=>config,channelDrivers:map,ttlMs:600000});
 assert.equal((await catalog.list()).length,0);
 assert.equal(describeChannels(config,map).find(x=>x.id==='qoder').adapterReady,false);
 assert.equal(describeChannels(config,map).find(x=>x.id==='qoder').discoveryAvailable,false);
 ready=true;
 assert.equal((await catalog.list()).length,2,'mount state must immediately invalidate cached empty catalog');
 assert.equal(describeChannels(config,map).find(x=>x.id==='qoder').adapterReady,true);
 ready=false;
 assert.equal((await catalog.list()).length,0,'unmount must hide the source chain immediately');
});
test('registered experimental source drivers are lifetime-bound and never displace baseline WorkBuddy driver',async()=>{
 const {applyWith}=await import('../src/index.mjs');
 const {getNativeChannelDrivers}=await import('../src/driver-registry.mjs');
 const before=[...getNativeChannelDrivers().keys()].sort();
 const configured=normalizeConfig({embeddedPack:{enabled:true}});
 const store={get:()=>configured,replace:()=>configured};
 const ctx={
  llm:{registerAdapter:()=>()=>{},registerModelDiscovery:()=>()=>{},registerConfigurableProviders:()=>()=>{}},
  on:()=>()=>{},effect(){},logger:{info(){},warn(){}},
 };
 const history={blocked:false,error:null,all:()=>[],append:()=>{throw Error('No check-in execution authorized')}};
 const dispose=applyWith(ctx,{configStore:store,checkinStore:history,env:{}});
 try{
  const drivers=getNativeChannelDrivers();
  assert.equal(drivers.get('qoder')?.isSourceBridge,true);
  assert.equal(drivers.get('qoder')?.runtimeReady,false);
  assert.equal(typeof drivers.get('workbuddy')?.generate,'function');
  assert.equal(drivers.get('workbuddy')?.isSourceBridge,undefined);
  assert.equal(drivers.get('codearts')?.isSourceBridge,undefined);
 }finally{dispose()}
 assert.deepEqual([...getNativeChannelDrivers().keys()].sort(),before);
});


test('experimental two-account source chain switches on 429 without publishing partial response',async()=>{
 const rows=[
  {id:'lob-a',providerId:'lobsterai',nickname:'A',enabled:true},
  {id:'lob-b',providerId:'lobsterai',nickname:'B',enabled:true},
 ];
 const calls=[];
 const embeddedPack={
  status:()=>({state:'mounted',experimentalMultiAccountProviders:['lobsterai']}),
  listAccounts:async()=>({state:'ready',accounts:rows}),
  listModels:async()=>({state:'ready',models:[{id:'lobster-chat'}]}),
  streamNative:async req=>{
   calls.push(req.sourceAccountId);
   if(calls.length===1)return (async function*(){
     yield {type:'block-start',index:0,blockType:'text'};
     yield {type:'text-delta',index:0,text:'SECRET_PARTIAL_FROM_FAILED_ACCOUNT'};
     yield {type:'block-end',index:0};
     yield {type:'finish',reason:{kind:'error',
       failure:{status:429,message:'Bearer SECRET_SOURCE_ACCESS'}}};
   })();
   return textStream('fallback-source-account-'+req.sourceAccountId);
  },
 };
 const driver=createSourceChannelDriver({providerId:'lobsterai',embeddedPack});
 const imported=await Promise.all(rows.map(async row=>
  driver.importCandidate({candidateId:sourceAccountOpaqueId('lobsterai',row.id),consent:true})));
 const config=normalizeConfig({providers:[
  {id:'lobsterai',protocol:'native-channel',models:['lobster-chat'],supportsTools:true}
 ],accounts:imported.map(row=>({...row,providerId:'lobsterai',enabled:true})),
 routes:[{id:'multi',mode:'priority',name:'Multi-account',
   tiers:[{providerId:'lobsterai',model:'lobster-chat'}],maxSwitches:2}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},
  channelDrivers:new Map([['lobsterai',driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'chain:multi',sessionId:'source-multi-test',
   messages:[{role:'user',content:[{type:'text',text:'Hello'}]}]}))events.push(event);
 assert.equal(calls.length,2);
 assert.notEqual(calls[0],calls[1]);
 assert.equal(events.some(evt=>evt.type==='text-delta'
   &&evt.text==='fallback-source-account-'+calls[1]),true);
 assert.doesNotMatch(JSON.stringify(events),/SECRET_PARTIAL|SECRET_SOURCE_ACCESS/);
 const result=adapter.getStatus();
 assert.equal(result.metrics.failedAttempts,1);
 assert.equal(result.metrics.successfulTurns,1);
});

test('Loomy stalled opening is bounded and cooldown prevents a second POST',async()=>{
 const rig=mockSource([{id:'l1',providerId:'loomy',enabled:true}]);let opens=0,requestSignal;
 rig.embeddedPack.streamNative=async req=>{opens++;requestSignal=req.signal;return new Promise(()=>{})};
 const driver=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack,streamIdleTimeoutMs:30});
 const id=sourceAccountOpaqueId('loomy','l1'),account={id,providerId:'loomy',credentialRef:'driver:loomy:'+id};
 const input={account,model:'test',options:{messages:[{role:'user',content:'OK'}]}};
 await assert.rejects(driver.generate(input),{code:'TIMEOUT'});assert.equal(requestSignal.aborted,true);
 await assert.rejects(driver.generate(input),error=>error.code==='RATE_LIMIT'&&error.retryAfterMs>0);assert.equal(opens,1);
});
test('Loomy active stream excludes parallel calls and preserves the official rate window',async()=>{
 const rig=mockSource([{id:'l2',providerId:'loomy',enabled:true}]);let opens=0,release,started;
 const entered=new Promise(r=>{started=r});
 rig.embeddedPack.streamNative=async()=>{opens++;started();await new Promise(r=>{release=r});throw Object.assign(Error('rate limit'),{code:'RATE_LIMIT',retryAfterMs:180000})};
 const driver=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack});
 const id=sourceAccountOpaqueId('loomy','l2'),account={id,providerId:'loomy',credentialRef:'driver:loomy:'+id};
 const input={account,model:'test',options:{messages:[{role:'user',content:'OK'}]}};
 const first=driver.generate(input);await entered;
 await assert.rejects(driver.generate(input),{code:'SOURCE_BUSY'});release();await assert.rejects(first,{code:'RATE_LIMIT'});
 await assert.rejects(driver.generate(input),error=>error.code==='RATE_LIMIT'&&error.retryAfterMs>170000);assert.equal(opens,1);
});
test('Loomy cooling or busy account rejects before redundant catalog and account preflight',async()=>{
 const rig=mockSource([{id:'l-free',providerId:'loomy',enabled:true}]);let catalogs=0,statuses=0,opens=0,release,started;
 const entered=new Promise(r=>{started=r});
 rig.embeddedPack.listModels=async()=>{catalogs++;return {state:'ready',models:[{id:'safe',costMultiplier:0,priceSource:'loomy-official-model-name-ratio'}]}};
 rig.embeddedPack.readSourceStatuses=async()=>{statuses++;return {state:'ready',accounts:[{accountId:'l-free',authVerified:true}]}};
 rig.embeddedPack.streamNative=async()=>{opens++;started();await new Promise(r=>{release=r});throw Object.assign(Error('rate limit'),{code:'RATE_LIMIT',retryAfterMs:180000})};
 const driver=createSourceChannelDriver({providerId:'loomy',accountProviderId:'own_loomy',embeddedPack:rig.embeddedPack});
 const id=sourceAccountOpaqueId('loomy','l-free'),account={id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id};
 const input={account,model:'safe',options:{freeOnly:true,messages:[{role:'user',content:'OK'}]}};
 const first=driver.generate(input);await entered;
 try{await assert.rejects(driver.generate(input),{code:'SOURCE_BUSY'})}finally{release();await assert.rejects(first,{code:'RATE_LIMIT'})}
 await assert.rejects(driver.generate(input),{code:'RATE_LIMIT'});
 assert.deepEqual([catalogs,statuses,opens],[1,1,1]);
});

test('native stream progress resets idle watchdog; a hung read is cancelled',async()=>{
 const rig=mockSource([{id:'l3',providerId:'loomy',enabled:true}]);let cancelled=false;
 rig.embeddedPack.streamNative=async req=>{req.signal.addEventListener('abort',()=>{cancelled=true});return (async function*(){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'partial'};await new Promise(()=>{});})()};
 const driver=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack,streamIdleTimeoutMs:30});
 const id=sourceAccountOpaqueId('loomy','l3');
 await assert.rejects(driver.generate({account:{id,providerId:'loomy',credentialRef:'driver:loomy:'+id},model:'test',options:{messages:[{role:'user',content:'OK'}]}}),{code:'TIMEOUT'});assert.equal(cancelled,true);
});

test('cancelled source status read does not erase valid prior account evidence',async()=>{
 const rig=mockSource([{id:'cancel-status',providerId:'loomy',enabled:true}]);
 rig.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{accountId:'cancel-status',authVerified:true,balance:100,balanceState:'available'}]});
 const driver=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack});
 const id=sourceAccountOpaqueId('loomy','cancel-status'),account={id,providerId:'loomy',credentialRef:'driver:loomy:'+id};
 assert.equal((await driver.refresh({account})).state,'online');
 await driver.generate({account,model:'demo',options:{messages:[{role:'user',content:'OK'}]}});
 const before=driver.accountSnapshot(account);const controller=new AbortController();controller.abort();
 assert.equal((await driver.refreshAccountStatus({account,signal:controller.signal})).state,'unavailable');
 assert.deepEqual(driver.accountSnapshot(account),before);
});

test('historical successful inference never overrides current failed source authentication',async()=>{
 const rig=mockSource([{id:'reauth',providerId:'loomy',enabled:true}]);
 let online=true;rig.embeddedPack.readSourceStatuses=async()=>({state:'ready',accounts:[{accountId:'reauth',authVerified:online,balance:100,balanceState:'available'}]});
 const driver=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack});
 const id=sourceAccountOpaqueId('loomy','reauth'),account={id,providerId:'loomy',credentialRef:'driver:loomy:'+id};
 assert.equal((await driver.refresh({account})).state,'online');await driver.generate({account,model:'demo',options:{messages:[{role:'user',content:'OK'}]}});
 assert.ok(driver.accountSnapshot(account).modelInferenceVerifiedAt>0);online=false;
 assert.equal((await driver.refresh({account})).state,'pending');assert.equal(driver.accountSnapshot(account).modelInferenceVerifiedAt,null);
 assert.equal(driver.accountSnapshot(account).authVerified,false);assert.equal(driver.accountSnapshot(account).balanceState,'cached');
});
