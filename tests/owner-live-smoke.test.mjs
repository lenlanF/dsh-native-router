import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runOwnerLiveSmoke} from '../src/owner-live-smoke.mjs';

const nonce='a'.repeat(32);
const validRows=[
 {id:'wbp_'+'a'.repeat(24),providerId:'own_workbuddy-cn',enabled:true},
 {id:'sp_'+'b'.repeat(24),providerId:'own_zcode',enabled:true},
];
async function fixture(fn){
 const base=process.platform==='win32'?'E:\\Temp':tmpdir();
 mkdirSync(base,{recursive:true});
 const dir=mkdtempSync(join(base,'dsh-live-smoke-'));
 try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
function rig(dir,{listModels,verifyModel,env}={}){
 let calls=0,catalogCalls=0;
 const configStore={path:join(dir,'config.json'),get:()=>({
  providers:[{id:'own_workbuddy-cn',enabled:true},{id:'own_zcode',enabled:true}],
  accounts:validRows,
 })};
 const accountCenter={
  list:()=>({accounts:validRows.map(a=>({...a,connectionState:'online',modelTestAvailable:true}))}),
  listTestModels:async id=>{catalogCalls++;return listModels?.(id)??{state:'ready',models:[{id:'zero',free:true}]};},
  verifyModel:async(id,opts)=>{calls++;return verifyModel?.(id,opts)??{
   state:'verified',at:Date.now(),modelId:opts.modelId,usage:{completion_tokens:2}};},
 };
 const input={configStore,accountCenter,env:env??{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}};
 const request=()=>writeFileSync(join(dir,'owner-live-smoke-request.json'),
  JSON.stringify({version:1,nonce,consent:true,expiresAt:Date.now()+300000}));
 return {input,request,get calls(){return calls},get catalogCalls(){return catalogCalls},
  report:()=>JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'))};
}
test('no operator nonce never triggers real model calls',async()=>fixture(async dir=>{
 const h=rig(dir,{env:{}});h.request();
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'disabled');
 assert.equal(h.calls,0);
 assert.equal(existsSync(join(dir,'owner-live-smoke-request.json')),true);
}));
test('wrong consent and nonce cannot trigger DSH live inference',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({version:1,nonce:'b'.repeat(32),consent:true,expiresAt:Date.now()+300000}));
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'invalid_request');
 assert.equal(h.calls,0);
 assert.equal(existsSync(file),true);
}));
test('one-time DSH Host command calls only free models and records anonymized real proofs',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:id=>({state:'ready',models:id===validRows[0].id?
  [{id:'premium',free:false},{id:'Hy4-flash',free:true}]:[{id:'paid',free:false}]})});
 h.request();
 const result=await runOwnerLiveSmoke(h.input);
 assert.equal(result.state,'complete');
 assert.equal(result.verified,1);
 assert.equal(h.calls,1);
 const report=h.report();
 assert.equal(report.accounts.length,2);
 assert.equal(report.accounts[0].state,'verified');
 assert.equal(report.accounts[0].modelId,'Hy4-flash');
 assert.equal(report.accounts[1].code,'NO_CONFIRMED_FREE_MODEL');
 assert.doesNotMatch(JSON.stringify(report),/wbp_aa|sp_bb|accessToken|cookie|responsePreview/);
 assert.equal(existsSync(join(dir,'owner-live-smoke-request.json')),false);
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'already_consumed');
 assert.equal(h.calls,1,'restarting DSH must never repeat a consumed one-shot model test');
}));
test('owner can target exactly one failed slot without re-generating already proven accounts',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'official-free',free:true}]})});
 h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const original=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...original,slots:[2]}));
 const result=await runOwnerLiveSmoke(h.input);
 assert.equal(result.checked,1);
 assert.equal(result.verified,1);
 assert.equal(h.calls,1);
 assert.equal(h.report().accounts[0].slot,2);
}));
test('malformed selected slots fail closed before any inference',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const original=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...original,slots:[2,2,0]}));
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'invalid_request');
 assert.equal(h.calls,0);
 assert.equal(existsSync(file),true);
}));

test('true DSH Host llm.stream path validates a free provider route without repeating account direct tests',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'official-zero',free:true}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),
  mode:'host-route',slots:[1]}));
 const calls=[];
 const llm={async *stream(request){calls.push(request);
  yield {type:'text-delta',text:'OK'};
  yield {type:'finish',reason:{kind:'stop'}};
 }};
 const adapter={listModels:async()=>[{id:'direct:own_workbuddy-cn:official-zero'}]};
 const result=await runOwnerLiveSmoke({...h.input,llm,adapter});
 assert.equal(result.verified,1);
 assert.equal(h.calls,0,'host LLM route must not secretly issue account direct test');
 assert.equal(calls.length,1);
 assert.equal(calls[0].provider,'native-router');
 assert.equal(calls[0].model,'direct:own_workbuddy-cn:official-zero');
 assert.equal(calls[0].maxTokens,32);
 assert.equal(h.report().runtime,'dsh-llm-native-router');
 assert.equal(h.report().accounts[0].scope,'provider');
 assert.equal(h.report().accounts[0].code,'DSH_HOST_ROUTE_COMPLETE');
 assert.doesNotMatch(JSON.stringify(h.report()),/responsePreview|cookie|FAKE_PRIVATE/);
}));
test('real zero-rate WorkBuddy host smoke has a larger bounded reply budget without changing paid channels',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'hy4flash-free',free:true}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),
  mode:'host-route',slots:[1]}));
 const calls=[];
 const llm={async *stream(request){calls.push(request);
  yield {type:'text-delta',text:'OK'};
  yield {type:'finish',reason:{kind:'stop'}};
 }};
 const adapter={listModels:async()=>[{id:'direct:own_workbuddy-cn:hy4flash-free'}]};
 const result=await runOwnerLiveSmoke({...h.input,llm,adapter});
 assert.equal(result.verified,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].maxTokens,128);
 assert.equal(h.report().accounts[0].maxOutputTokens,128);
 assert.equal(h.report().accounts[0].code,'DSH_HOST_ROUTE_COMPLETE');
}));
test('host Provider with multiple accounts cannot bill an unverified priced peer',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:id=>({state:'ready',models:[{id:'official-zero',free:id===validRows[0].id}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),
  mode:'host-route',slots:[1]}));
 let sends=0;
 const llm={async *stream(){sends++;yield {type:'text-delta',text:'should not send'}}};
 const adapter={listModels:async()=>[{id:'direct:own_workbuddy-cn:official-zero'}]};
 const original=h.input.configStore.get;
 h.input.configStore.get=()=>({...original(),providers:[{id:'own_workbuddy-cn',enabled:true}],
   accounts:[{...validRows[0]}, {...validRows[1],id:'wbp_'+'b'.repeat(24),providerId:'own_workbuddy-cn'}]});
  const baseList=h.input.accountCenter.list;
  h.input.accountCenter.list=()=>({accounts:[...baseList().accounts,{
    id:'wbp_'+'b'.repeat(24),providerId:'own_workbuddy-cn',enabled:true,
    connectionState:'online',modelTestAvailable:true,
  }]});
  const result=await runOwnerLiveSmoke({...h.input,adapter,llm});
 assert.equal(result.verified,0);
 assert.equal(sends,0);
 assert.equal(h.report().accounts[0].code,'DSH_ROUTE_COST_UNVERIFIED');
}));

test('selected zero-cost model index invokes only the exact second free catalog entry',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[
  {id:'billed',free:false},{id:'free-one',free:true},{id:'free-two',free:true}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),freeModelIndex:1,slots:[1]}));
 const result=await runOwnerLiveSmoke(h.input);
 assert.equal(result.verified,1);
 assert.equal(h.calls,1);
 assert.equal(h.report().accounts[0].modelId,'free-two');
}));
test('free model index rejects invalid input or out-of-range before generation',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'only',free:true}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 const original=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...original,freeModelIndex:-1}));
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'invalid_request');
 assert.equal(h.calls,0);
 assert.equal(existsSync(file),true);
 writeFileSync(file,JSON.stringify({...original,freeModelIndex:3,slots:[1]}));
 assert.equal((await runOwnerLiveSmoke(h.input)).verified,0);
 assert.equal(h.calls,0);
 assert.equal(h.report().accounts[0].code,'FREE_MODEL_INDEX_UNAVAILABLE');
}));
test('DSH max-tokens refusal records only safe reason enum, no upstream text',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'free',free:true}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),mode:'host-route',slots:[1]}));
 const adapter={listModels:async()=>[{id:'direct:own_workbuddy-cn:free'}]};
 const llm={async *stream(){yield {type:'text-delta',text:'PRIVATE_RESPONSE'};
  yield {type:'finish',reason:{kind:'max-tokens'}};}};
 assert.equal((await runOwnerLiveSmoke({...h.input,adapter,llm})).verified,0);
 assert.equal(h.report().accounts[0].code,'DSH_STREAM_INCOMPLETE');
 assert.equal(h.report().accounts[0].hostPhase,'MAX_TOKENS');
 assert.doesNotMatch(JSON.stringify(h.report()),/PRIVATE_RESPONSE/);
}));

test('DSH Host llm.stream cannot be mistaken for completion if stream is partial',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'free',free:true}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),
  mode:'host-route',slots:[1]}));
 const adapter={listModels:async()=>[{id:'direct:own_workbuddy-cn:free'}]};
 const llm={async *stream(){yield {type:'text-delta',text:'partial'}}};
 const result=await runOwnerLiveSmoke({...h.input,adapter,llm});
 assert.equal(result.verified,0);
 assert.equal(h.calls,0);
 assert.equal(h.report().accounts[0].code,'DSH_STREAM_INCOMPLETE');
}));
test('host mode rejects missing route or unknown-paid model before any DSH inference',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>({state:'ready',models:[{id:'paid',free:false}]})});
 h.request();const file=join(dir,'owner-live-smoke-request.json');
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),
  mode:'host-route',slots:[1]}));
 let sends=0;
 const llm={async *stream(){sends++;yield {type:'text-delta',text:'unexpected'}}};
 const result=await runOwnerLiveSmoke({...h.input,llm,adapter:{listModels:async()=>[]}});
 assert.equal(result.verified,0);
 assert.equal(sends,0);
 assert.equal(h.report().accounts[0].code,'NO_CONFIRMED_FREE_MODEL');
}));

test('temporary read-only catalog error is retried without generating until free proof exists',async()=>fixture(async dir=>{
 let tries=0;
 const h=rig(dir,{listModels:id=>{
  if(id===validRows[0].id&&++tries<3)throw Error('fake catalog outage');
  return {state:'ready',models:id===validRows[0].id?[{id:'free',free:true}]:[]};
 }});
 h.request();
 const result=await runOwnerLiveSmoke({...h.input,waitFor:async()=>{}});
 assert.equal(result.verified,1);
 assert.equal(h.calls,1);
 assert.ok(h.catalogCalls>=4);
}));
test('paid single-shot requires explicit billing acknowledgement and allowlisted slots',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const row=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...row,mode:'bounded-priced',slots:[1]}));
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'invalid_request');
 assert.equal(h.calls,0);
 writeFileSync(file,JSON.stringify({...row,mode:'bounded-priced',
   billingConsent:'single-low-cost-call',slots:[2]}));
 assert.equal((await runOwnerLiveSmoke(h.input)).state,'invalid_request');
 assert.equal(h.calls,0);
}));
test('bounded Lingxi selects official x0.00 model and sends at most one short request',async()=>fixture(async dir=>{ const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const row=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...row,mode:'bounded-priced',
   billingConsent:'single-low-cost-call',slots:[1]}));
 let generated=0,selected;
 const a={id:'pr_'+'a'.repeat(28),providerId:'own_lingxi',enabled:true,
  credentialRef:'driver:own_lingxi:pr_'+'a'.repeat(28)};
 const driver={listModels:async()=>[{id:'costly',costMultiplier:1.7},
     {id:'cheapest',costMultiplier:0}],   refreshAccountStatus:async()=>({state:'ready',balance:1000}),
   generate:async req=>{generated++;selected=req;return {text:'PRIVATE_REPLY',
    finishReason:'stop',toolCalls:[],usage:{completion_tokens:1}}}};
 const configStore={path:join(dir,'config.json'),get:()=>({
   accounts:[a],providers:[{id:'own_lingxi',enabled:true}]})};
 const accountCenter={list:()=>({accounts:[{...a,connectionState:'online',
   modelTestAvailable:true}]}),driverFor:()=>driver};
 assert.equal((await runOwnerLiveSmoke({configStore,accountCenter,
   env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}})).verified,1);
 assert.equal(generated,1);assert.equal(selected.model,'cheapest');
 assert.equal(selected.options.maxTokens,32);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
  assert.equal(report.accounts[0].multiplier,0); assert.doesNotMatch(JSON.stringify(report),/PRIVATE_REPLY|pr_aaaaaaaa|credentialRef/);
}));
test('Lingxi positive multiplier never triggers another paid smoke when upstream ignores token limit',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const requestPath=join(dir,'owner-live-smoke-request.json');
 const request=JSON.parse(readFileSync(requestPath,'utf8'));
 writeFileSync(requestPath,JSON.stringify({...request,mode:'bounded-priced',
  billingConsent:'single-low-cost-call',slots:[1]}));
 const account={id:'pr_'+'b'.repeat(28),providerId:'own_lingxi',enabled:true,
  credentialRef:'driver:own_lingxi:pr_'+'b'.repeat(28)};
 let sends=0,checks=0;
 const driver={listModels:async()=>[{id:'official-low-rate',costMultiplier:0.1}],
  refreshAccountStatus:async()=>{checks++;return {state:'ready',balance:10000}},
  generate:async()=>{sends++;throw Error('should not send to uncapped charged model')}};
 const configStore={path:join(dir,'config.json'),get:()=>({
  accounts:[account],providers:[{id:'own_lingxi',enabled:true}]})};
 const accountCenter={list:()=>({accounts:[{...account,connectionState:'online',
  modelTestAvailable:true}]}),driverFor:()=>driver};
 const result=await runOwnerLiveSmoke({configStore,accountCenter,
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.verified,0);
 assert.equal(sends,0);assert.equal(checks,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].code,'UPSTREAM_OUTPUT_CAP_UNVERIFIED');
 assert.equal(report.accounts[0].multiplier,0.1);
}));
test('ZCode aggregate paid balance cannot substitute for verified Start Plan gifted tokens',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const requestPath=join(dir,'owner-live-smoke-request.json');
 const request=JSON.parse(readFileSync(requestPath,'utf8'));
 writeFileSync(requestPath,JSON.stringify({...request,mode:'bounded-priced',
  billingConsent:'single-low-cost-call',slots:[7]}));
 const account={id:'sp_'+'c'.repeat(24),providerId:'own_zcode',enabled:true,
  credentialRef:'driver:own_zcode:sp_'+'c'.repeat(24)};
 let calls=0;
 const driver={listModels:async()=>[{id:'GLM-5.3-Flash'}],
  refreshAccountStatus:async()=>({state:'ready',authVerified:true,balanceState:'available',
    balance:999999,giftedBalance:0}),
  generate:async()=>{calls++;throw Error('paid fallback forbidden')}};
  const placeholders=Array.from({length:6},(_,i)=>({id:'pad-'+i,
   providerId:'padding',enabled:true,credentialRef:'driver:padding:pad-'+i}));
  const configStore={path:join(dir,'config.json'),get:()=>({
   accounts:[...placeholders,account],
   providers:[{id:'padding',enabled:true},{id:'own_zcode',enabled:true}]})};
  const accountCenter={list:()=>({accounts:[...placeholders,{...account,
   connectionState:'online',modelTestAvailable:true}]}),driverFor:()=>driver}; const result=await runOwnerLiveSmoke({configStore,accountCenter,
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.verified,0);assert.equal(calls,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].code,'NO_CONFIRMED_GIFT_BALANCE');
}));
test('CodeArts model and positive account balance cannot bypass unknown-rate gate',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const original=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...original,mode:'bounded-priced',
  billingConsent:'single-low-cost-call',slots:[1]}));
 const a={id:'ca_SAMPLE',providerId:'codearts',enabled:true,
  credentialRef:'driver:codearts:ca_SAMPLE'};
 let calls=0;
 const driver={listModels:async()=>[{id:'glm-5.3-flash'}],
  refreshAccountStatus:async()=>({state:'ready',balance:999999}),
  generate:async()=>{calls++;throw Error('should not charge')}};
 const configStore={path:join(dir,'config.json'),get:()=>({
  accounts:[a],providers:[{id:'codearts',enabled:true}]})};
 const accountCenter={list:()=>({accounts:[{...a,connectionState:'online',
  modelTestAvailable:true}]}),driverFor:()=>driver};
 const result=await runOwnerLiveSmoke({configStore,accountCenter,
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.verified,0);
 assert.equal(calls,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].code,'PRICE_AND_BALANCE_UNVERIFIED');
}));
test('CodeArts exact official x0 has one native inference, rounded x0.00 with positive rate has none',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const original=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...original,mode:'bounded-priced',
   billingConsent:'single-low-cost-call',slots:[1]}));
 const a={id:'ca_VERIFIED',providerId:'codearts',enabled:true,
  credentialRef:'driver:codearts:ca_VERIFIED'};
 let calls=0,selected=null;
 const driver={listModels:async()=>[
   {id:'glm-5.3-flash',costMultiplier:0.004,priceSource:'codearts-official-credit-ratio'},
   {id:'qwen3.8-flash',costMultiplier:0,priceSource:'codearts-official-credit-ratio'}],
  refreshAccountStatus:async()=>({state:'ready',balanceState:'available',authVerified:true,balance:500}),
  generate:async request=>{calls++;selected=request;return {text:'ORIGINAL_REPLY',
    finishReason:'stop',toolCalls:[],usage:{completion_tokens:2}}}};
 const configStore={path:join(dir,'config.json'),get:()=>({
   accounts:[a],providers:[{id:'codearts',enabled:true}]})};
 const accountCenter={list:()=>({accounts:[{...a,connectionState:'online',
   modelTestAvailable:true}]}),driverFor:()=>driver};
 const result=await runOwnerLiveSmoke({configStore,accountCenter,
   env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.verified,1);assert.equal(calls,1);
 assert.equal(selected.model,'qwen3.8-flash');
 assert.equal(selected.options.maxTokens,128);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].multiplier,0);
 assert.doesNotMatch(JSON.stringify(report),/ORIGINAL_REPLY|ca_VERIFIED|credentialRef/);
}));
test('CodeArts official nonzero relative multiplier never bypasses missing absolute spending cap',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();const file=join(dir,'owner-live-smoke-request.json');
 const row=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...row,mode:'bounded-priced',slots:[1],
   billingConsent:'single-low-cost-call'}));
 const a={id:'ca_PAID',providerId:'codearts',enabled:true,
   credentialRef:'driver:codearts:ca_PAID'};
 let requests=0;
 const driver={listModels:async()=>[{id:'glm-5.3-flash',name:'GLM · x0.00',
   costMultiplier:0.003,priceSource:'codearts-official-credit-ratio'}],
  refreshAccountStatus:async()=>({state:'ready',balanceState:'available',authVerified:true,balance:999999}),
  generate:async()=>{requests++;throw Error('unknown billing limit')}};
 const configStore={path:join(dir,'config.json'),get:()=>({
  accounts:[a],providers:[{id:'codearts',enabled:true}]})};
 const accountCenter={list:()=>({accounts:[{...a,connectionState:'online',modelTestAvailable:true}]}),
   driverFor:()=>driver};
 const result=await runOwnerLiveSmoke({configStore,accountCenter,
   env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.verified,0);assert.equal(requests,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].code,'PRICE_AND_BALANCE_UNVERIFIED');
 assert.equal(report.accounts[0].multiplier,0.003);
}));
test('owner-approved lowest nonzero CodeArts model produces one complete private proof',async()=>fixture(async dir=>{
 const a={id:'ca_min',providerId:'codearts',enabled:true,credentialRef:'driver:codearts:ca_min'};
 const req={version:1,nonce,consent:true,mode:'lowest-priced',
  billingConsent:'single-minimum-rated-model',providers:['codearts'],maxMultiplier:0.1,
  expiresAt:Date.now()+300000};
 writeFileSync(join(dir,'owner-live-smoke-request.json'),JSON.stringify(req));
 const model=(id,rate)=>({id,catalogSource:'codearts-signed-official-model-catalog',
  priceSource:'codearts-official-credit-ratio',costMultiplier:rate});
  let sends=0,selected,metadata=0;
  const driver={listModels:async()=>{
    metadata++;
    if(metadata<3)throw Error('source model list busy at startup');
    return [model('costly',0.3),{id:'invented',priceSource:'guessed',costMultiplier:0},
      model('lowest',0.07),model('second',0.09)];
  },  refreshAccountStatus:async()=>({state:'ready',authVerified:true,balanceState:'available',balance:10}),
  generate:async input=>{sends++;selected=input;return {text:'OK',finishReason:'stop',
   usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}}}};
 const args={configStore:{path:join(dir,'config.json'),get:()=>({
   accounts:[a],providers:[{id:'codearts',enabled:true}]})},
  accountCenter:{driverFor:()=>driver,list:()=>({accounts:[{...a,
   connectionState:'online',modelTestAvailable:true}]})},
   env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce},waitFor:async()=>{}};
  const result=await runOwnerLiveSmoke(args);
  assert.equal(result.verified,1);assert.equal(sends,1);
  assert.equal(metadata,3); assert.equal(selected.model,'lowest');assert.equal(selected.options.approvedRate,0.07);
 assert.equal(selected.options.singleLowCostProof,true);
 assert.equal(selected.options.maxTokens,128);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].code,'MODEL_REPLY_COMPLETE');
 assert.equal(report.accounts[0].multiplier,0.07);
 assert.equal(report.accounts[0].usage.total_tokens,6);
 assert.doesNotMatch(JSON.stringify(report),/ca_min|credentialRef/);
 assert.equal((await runOwnerLiveSmoke(args)).state,'already_consumed');
 assert.equal(sends,1);
}));
test('minimum paid CodeArts mode requires exact consent and hard relative-rate gate',async()=>fixture(async dir=>{
 const a={id:'ca_fake',providerId:'codearts',enabled:true,credentialRef:'driver:codearts:ca_fake'};
 const path=join(dir,'owner-live-smoke-request.json');
 const base={version:1,nonce,consent:true,mode:'lowest-priced',
   billingConsent:'single-minimum-rated-model',providers:['codearts'],maxMultiplier:0.1,
   expiresAt:Date.now()+300000};
 let calls=0;
 const args={configStore:{path:join(dir,'config.json'),get:()=>({
  accounts:[a],providers:[{id:'codearts',enabled:true}]})},
  accountCenter:{driverFor:()=>({
    listModels:async()=>[{id:'too-much',
      catalogSource:'codearts-signed-official-model-catalog',
      priceSource:'codearts-official-credit-ratio',costMultiplier:0.2}],
    refreshAccountStatus:async()=>({state:'ready',authVerified:true,balanceState:'available',balance:500}),
    generate:async()=>{calls++;throw Error('must not infer')}
  }),list:()=>({accounts:[{...a,connectionState:'online',modelTestAvailable:true}]})},
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}};
 for(const invalid of [{billingConsent:'single-low-cost-call'},
   {maxMultiplier:0.2},{providers:['own_zcode']},{slots:[8]}]){
   writeFileSync(path,JSON.stringify({...base,...invalid}));
   assert.equal((await runOwnerLiveSmoke(args)).state,'invalid_request');
 }
 writeFileSync(path,JSON.stringify(base));
 assert.equal((await runOwnerLiveSmoke(args)).verified,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.accounts[0].code,'RATE_OVER_LIMIT');
 assert.equal(calls,0);
}));
test('explicit read-only quota audit gathers only safe fee and gift evidence, with zero inference',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const original=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...original,mode:'quota-audit',slots:[7,8]}));
 const padding=Array.from({length:6},(_,i)=>({id:'p'+i,
  providerId:'padding',credentialRef:'driver:padding:p'+i,enabled:true}));
 const z={id:'z_safe',providerId:'own_zcode',credentialRef:'driver:own_zcode:z_safe',enabled:true};
 const c={id:'c_safe',providerId:'codearts',credentialRef:'driver:codearts:c_safe',enabled:true};
 const accounts=[...padding,z,c];
 const configStore={path:join(dir,'config.json'),get:()=>({
  providers:[{id:'padding',enabled:true},{id:'own_zcode',enabled:true},{id:'codearts',enabled:true}],
  accounts})};
 let inference=0;
 const zDriver={refreshAccountStatus:async()=>({state:'ready',authVerified:true,
   balanceState:'available',giftedBalance:2800,balance:900000}),
   listModels:async()=>[{id:'GLM-5.3-Flash'}],
   generate:async()=>{inference++;throw Error('forbidden')}};
 const cDriver={refreshAccountStatus:async()=>({state:'ready',authVerified:true,
   balanceState:'available',balance:100}),
    listModels:async()=>[{id:'glm-5.3-flash',name:'GLM · x0.00',
     costMultiplier:0.003,priceSource:'codearts-official-credit-ratio'}],   generate:async()=>{inference++;throw Error('forbidden')}};
 const accountCenter={driverFor:id=>id==='own_zcode'?zDriver:cDriver,
  list:()=>({accounts:accounts.map(row=>({...row,connectionState:'online',modelTestAvailable:true}))})};
 const result=await runOwnerLiveSmoke({configStore,accountCenter,
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.verified,0);assert.equal(inference,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(report.runtime,'dsh-plugin-official-read-only');
 assert.deepEqual(report.accounts.map(x=>x.code),['OFFICIAL_GIFT_AND_MODEL','OFFICIAL_RATE_NONZERO']);
 assert.equal(report.accounts[0].giftConfirmed,true);
  assert.equal(report.accounts[1].lowestMultiplier,0.003);
  assert.equal(report.accounts[1].misleadingZeroDisplay,1); assert.doesNotMatch(JSON.stringify(report),/c_safe|z_safe|credentialRef|accountId/);
}));
test('read-only provider selector survives reordered accounts beyond the first 16 slots',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const req=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...req,mode:'quota-audit',providers:['codearts','own_zcode']}));
 const padding=Array.from({length:19},(_,i)=>({id:'pad'+i,providerId:'padding',credentialRef:'driver:padding:pad'+i,enabled:true}));
 const c={id:'credit_named',providerId:'codearts',enabled:true,credentialRef:'driver:codearts:credit_named'};
 const z={id:'start_named',providerId:'own_zcode',enabled:true,credentialRef:'driver:own_zcode:start_named'};
 const accounts=[...padding,c,z];
 const configStore={path:join(dir,'config.json'),get:()=>({
  providers:[{id:'padding',enabled:true},{id:'codearts',enabled:true},{id:'own_zcode',enabled:true}],accounts})};
 let paidCalls=0;
 const drivers={codearts:{
  refreshAccountStatus:async()=>({state:'ready',authVerified:true,balanceState:'available',balance:500}),
  listModels:async()=>[{id:'glm-5.3-flash',catalogSource:'codearts-signed-official-model-catalog'}],
  generate:async()=>{paidCalls++;throw Error('must not generate')}
 },own_zcode:{
  refreshAccountStatus:async()=>({state:'ready',authVerified:true,balanceState:'available',giftedBalance:2000}),
  listModels:async()=>[{id:'GLM-5.3-Flash'}],
  generate:async()=>{paidCalls++;throw Error('must not generate')}
 }};
 const result=await runOwnerLiveSmoke({configStore,
  accountCenter:{driverFor:id=>drivers[id],list:()=>({accounts:[]})},
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 assert.equal(result.checked,2);assert.equal(result.verified,0);assert.equal(paidCalls,0);
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.deepEqual(report.accounts.map(row=>row.providerId),['codearts','own_zcode']);
 assert.deepEqual(report.accounts.map(row=>row.code),['NO_OFFICIAL_RATE','OFFICIAL_GIFT_AND_MODEL']);
 assert.equal(report.accounts[0].signedCatalogCount,1);
 assert.doesNotMatch(JSON.stringify(report),/credit_named|start_named|credentialRef/);
}));
test('claimable ZCode gift is diagnosed without executing grant claim or model inference',async()=>fixture(async dir=>{
 const h=rig(dir);h.request();
 const file=join(dir,'owner-live-smoke-request.json');
 const row=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...row,mode:'quota-audit',providers:['own_zcode']}));
 const a={id:'zg_one',providerId:'own_zcode',enabled:true,
  credentialRef:'driver:own_zcode:zg_one'};
 let calls=0;
 const driver={refreshAccountStatus:async()=>({state:'ready',authVerified:true,
   balanceState:'available',balance:0,zcodePlanBuckets:0,zcodeFlashBuckets:0,
   zcodePreviewStartPlans:2}),
  listModels:async()=>[{id:'GLM-5.3-Flash'}],
  generate:async()=>{calls++;throw Error('inference forbidden')},
  checkIn:async()=>{calls++;throw Error('claim not requested')}};
 const result=await runOwnerLiveSmoke({
  configStore:{path:join(dir,'config.json'),get:()=>({
   providers:[{id:'own_zcode',enabled:true}],accounts:[a]})},
  accountCenter:{list:()=>({accounts:[]}),driverFor:()=>driver},
  env:{DSH_NATIVE_ROUTER_SMOKE_NONCE:nonce}});
 const report=JSON.parse(readFileSync(join(dir,'owner-live-smoke-result-'+nonce+'.json'),'utf8'));
 assert.equal(result.checked,1);assert.equal(result.verified,0);
 assert.equal(report.accounts[0].code,'START_PLAN_PREVIEW_UNVERIFIED');
 assert.equal(report.accounts[0].zcodePreviewStartPlans,2);
 assert.equal(calls,0);
}));
test('unknown or unavailable price and catalog errors are reported but never billed',async()=>fixture(async dir=>{
 const h=rig(dir,{listModels:()=>{throw Error('model catalog failed') }});
 h.request();
 const result=await runOwnerLiveSmoke({...h.input,waitFor:async()=>{}});
 assert.equal(result.checked,2);
 assert.equal(result.verified,0);
 assert.equal(h.calls,0);
 assert.deepEqual(h.report().accounts.map(x=>x.code),['CATALOG_UNAVAILABLE','CATALOG_UNAVAILABLE']);
}));
