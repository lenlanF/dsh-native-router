// One-time, owner-initiated in-Host account inference acceptance. The test is
// invoked by the *running DSH plugin*, not a stand-alone gateway or browser.
// A nonce in the DSH process environment and a matching short-lived owner file
// are both necessary; consumption is durable before the first model request.
import {readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';

import {retryAtomicRename} from './retry-atomic-rename.mjs';
const NONCE=/^[a-f0-9]{32}$/;
const wait=(ms,signal)=>new Promise(resolve=>{
  if(signal?.aborted)return resolve();
  const timer=setTimeout(done,ms);
  function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()}
  signal?.addEventListener('abort',done,{once:true});
});
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z_]{0,47}$/.test(value)?value:'UNKNOWN';
const BOUNDED_MAX_OUTPUT=Object.freeze({own_lingxi:32,own_zcode:64,codearts:32});
// These exact models have a checked free/gift catalog before Host can route.
// A larger budget is safe only after every potential Host account is free.
const verifiedFreeHostBudget=(providerId,modelId)=>
 (providerId==='own_loomy'&&modelId==='spark-x2.6'
  ||providerId==='own_workbuddy-cn'&&modelId==='hy4flash-free'
  ||providerId==='own_workbuddy-global'&&modelId==='deepseek-v4.1-flash')?128:32;
function boundedModelChoice(providerId,rows,{lowestPriced=false}={}){
 const usable=(Array.isArray(rows)?rows:[]).filter(row=>typeof row?.id==='string'&&row.id.length<=120);
 if(providerId==='own_lingxi'){
  const rated=usable.filter(row=>typeof row.costMultiplier==='number'
   &&Number.isFinite(row.costMultiplier)&&row.costMultiplier>=0)
    .sort((a,b)=>a.costMultiplier-b.costMultiplier);
  if(!rated.length)return {code:'NO_OFFICIAL_RATE'};
  if(rated[0].costMultiplier>1)return {code:'RATE_OVER_LIMIT'};
  return {modelId:rated[0].id,multiplier:rated[0].costMultiplier};
 }
 if(providerId==='own_zcode'){
  const row=usable.find(x=>/^glm[-.]5[-.]3[-.]flash$/i.test(x.id));
  return row?{modelId:row.id}:{code:'NO_LOW_COST_MODEL'};
 }
   if(providerId==='codearts'){
    if(lowestPriced){
      // Only signed, fresh, exact official prices survive source catalog.
      // Never select by display order, name, rounded ratio, or paid balance.
      const rated=usable.filter(row=>row.catalogSource==='codearts-signed-official-model-catalog'
        &&row.priceSource==='codearts-official-credit-ratio'
        &&typeof row.costMultiplier==='number'&&Number.isFinite(row.costMultiplier)
        &&row.costMultiplier>=0&&row.costMultiplier<=100)
        .sort((a,b)=>a.costMultiplier-b.costMultiplier||a.id.localeCompare(b.id));
      if(!rated.length)return {code:'NO_OFFICIAL_RATE'};
      if(rated[0].costMultiplier>0.1)return {code:'RATE_OVER_LIMIT'};
      return {modelId:rated[0].id,multiplier:rated[0].costMultiplier,priceUnverified:false};
    }
    // Existing zero-only smoke contract remains unchanged.
    const preferred=['qwen3.8-flash','glm-5.3-flash','glm-4.7-flash'];
    const candidates=usable.filter(x=>preferred.includes(x.id.toLowerCase()));
    const rated=candidates.filter(x=>x.priceSource==='codearts-official-credit-ratio'
      &&typeof x.costMultiplier==='number'&&Number.isFinite(x.costMultiplier)
      &&x.costMultiplier>=0&&x.costMultiplier<=100)
      .sort((a,b)=>a.costMultiplier-b.costMultiplier);
    const row=rated[0]??preferred.map(id=>candidates.find(x=>x.id.toLowerCase()===id)).find(Boolean);
    if(!row)return {code:'NO_LOW_COST_MODEL'};
    return {modelId:row.id,priceUnverified:row.priceSource!=='codearts-official-credit-ratio'
      ||row.costMultiplier!==0,
      ...(typeof row.costMultiplier==='number'&&row.priceSource==='codearts-official-credit-ratio'
        ?{multiplier:row.costMultiplier}:{})};
   }
   return {code:'PROVIDER_NOT_ALLOWLISTED'};
}
async function boundedPaidProof({account,accountCenter,configStore,now,signal,lowestPriced=false,waitFor=wait}){
  let maxTokens=BOUNDED_MAX_OUTPUT[account.providerId];
  if(!maxTokens)return {state:'skipped',code:'PROVIDER_NOT_ALLOWLISTED'}; const driver=accountCenter.driverFor(account.providerId);
 const binding=account.credentialRef;
 const authorized=()=>configStore.get().accounts.some(a=>a.id===account.id
  &&a.providerId===account.providerId&&a.enabled&&a.credentialRef===binding);
 if(!authorized()||typeof driver?.generate!=='function'||typeof driver?.listModels!=='function')
  return {state:'skipped',code:'ACCOUNT_NOT_READY'};
 const controller=new AbortController();
 const cancel=()=>controller.abort();
 const timeout=setTimeout(cancel,75000);
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 let called=false,modelId=null,multiplier=null,priceUnverified=false,before=null;
 try{
  if(controller.signal.aborted)return {state:'skipped',code:'CANCELLED'};
   let rows;
   // DSH startup metadata may race the source model directory. These are
   // zero-cost reads; no inference is retried once a POST has started.
   for(let attempt=0;attempt<(lowestPriced?8:1);attempt++){
     if(controller.signal.aborted)return {state:'skipped',code:'CANCELLED'};
     try{
       const observed=await driver.listModels({account,signal:controller.signal});
       if(Array.isArray(observed)&&observed.length){rows=observed;break}
     }catch(error){if(!lowestPriced)throw error}
     if(lowestPriced&&attempt<7)await waitFor(2000,controller.signal);
   }
   if(!Array.isArray(rows)||!rows.length)
     return {state:'skipped',code:'CATALOG_UNAVAILABLE',maxTokens};
   const choice=boundedModelChoice(account.providerId,rows,{lowestPriced});  if(!choice.modelId)return {state:'skipped',code:choice.code};
  modelId=choice.modelId;multiplier=choice.multiplier??null;
  priceUnverified=choice.priceUnverified===true;
   // A positive numeric multiplier is NOT a hard spending ceiling. A genuinely
   // zero official CodeArts credit ratio can use a larger, single-turn budget.
   if(priceUnverified)return {state:'skipped',code:'PRICE_AND_BALANCE_UNVERIFIED',
     modelId,...(multiplier!==null?{multiplier}:{})};
   if(account.providerId==='codearts'&&(multiplier===0||lowestPriced))maxTokens=128;   // Lingxi returned 73 tokens despite maxTokens=32. This client parameter
   // is not an enforceable charge cap. No further paid smoke on nonzero rates.
   if(account.providerId==='own_lingxi'&&multiplier!==0)
    return {state:'skipped',code:'UPSTREAM_OUTPUT_CAP_UNVERIFIED',modelId,multiplier};
   if(typeof driver.refreshAccountStatus==='function'){
    before=await driver.refreshAccountStatus({account,force:true,signal:controller.signal});
     if(!['ready','online'].includes(before?.state)
       ||(typeof before?.balance==='number'&&before.balance<128
         &&!(account.providerId==='codearts'&&(multiplier===0||lowestPriced))))
      return {state:'skipped',code:'BALANCE_UNAVAILABLE_OR_LOW',modelId};
     if(lowestPriced&&(!Number.isFinite(before.balance)||before.balance<=0))
       return {state:'skipped',code:'BALANCE_UNAVAILABLE_OR_LOW',modelId};
     if(account.providerId==='own_zcode'&&(      before.authVerified!==true||before.balanceState!=='available'
      ||!Number.isFinite(before.giftedBalance)||before.giftedBalance<1024))
     return {state:'skipped',code:'NO_CONFIRMED_GIFT_BALANCE',modelId};
    if(account.providerId==='own_lingxi'&&!Number.isFinite(before.balance))
      return {state:'skipped',code:'BALANCE_UNAVAILABLE_OR_LOW',modelId};
    if(account.providerId==='codearts'&&(
      before.authVerified!==true||before.balanceState!=='available'
      ||!Number.isFinite(before.balance)))
      return {state:'skipped',code:'BALANCE_UNAVAILABLE_OR_LOW',modelId};
   } else if(account.providerId==='codearts'){
    return {state:'skipped',code:'BALANCE_UNAVAILABLE_OR_LOW',modelId};  }
  if(!authorized()||controller.signal.aborted)
   return {state:'skipped',code:'ACCOUNT_CHANGED',modelId};
  called=true;
  const reply=await driver.generate({account,model:modelId,
    options:{messages:[{role:'user',content:[{type:'text',text:'OK'}]}],
      tools:[],maxTokens,sessionId:'native-router-bounded-cost',
       ...(lowestPriced?{singleLowCostProof:true,approvedRate:multiplier}:{})},
    signal:controller.signal});
  const complete=reply?.finishReason==='stop'&&typeof reply?.text==='string'
    &&Boolean(reply.text.trim())&&!(reply.toolCalls?.length);
  const usage=reply?.usage&&typeof reply.usage==='object'
    ?Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens']
       .filter(key=>Number.isSafeInteger(reply.usage[key])&&reply.usage[key]>=0)
       .map(key=>[key,reply.usage[key]])):{};
  const base={state:complete?'verified':'failed',
   code:complete?'MODEL_REPLY_COMPLETE':reply?.finishReason==='length'
     ?'OUTPUT_LIMIT':'INCOMPLETE',modelId,maxTokens,
   ...(multiplier!==null?{multiplier}:{}),
   ...(priceUnverified?{priceUnverified:true}:{}),
   ...(Object.keys(usage).length?{usage}:{})};
  if(!authorized())return {...base,state:'failed',code:'ACCOUNT_CHANGED'};
  if(complete)return {...base,proofAt:now()};
  return base;
 }catch(error){
  return {state:called?'failed':'skipped',
   code:controller.signal.aborted?'CANCELLED':called?safeCode(error?.code):'PRECHECK_FAILED',
   ...(modelId?{modelId}:{}),maxTokens};
 }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel)}
}
async function quotaEvidence({account,accountCenter,configStore,signal}){
 if(!['own_zcode','codearts'].includes(account.providerId))
  return {state:'skipped',code:'PROVIDER_NOT_ALLOWLISTED'};
 const driver=accountCenter.driverFor?.(account.providerId);
 if(typeof driver?.refreshAccountStatus!=='function'||typeof driver?.listModels!=='function')
  return {state:'skipped',code:'OWN_DRIVER_UNAVAILABLE'};
 const binding=account.credentialRef;
 const authorized=()=>configStore.get().accounts.some(a=>a.id===account.id
   &&a.providerId===account.providerId&&a.enabled&&a.credentialRef===binding);
 if(!authorized()||signal?.aborted)return {state:'skipped',code:'ACCOUNT_CHANGED'};
 try{
  const [status,models]=await Promise.all([
   driver.refreshAccountStatus({account,force:true,signal}),
   driver.listModels({account,signal})]);
  if(!authorized()||signal?.aborted)return {state:'skipped',code:'ACCOUNT_CHANGED'};
  if(status?.authVerified!==true||!['ready','online'].includes(status.state))
   return {state:'observed',code:'OFFICIAL_AUTH_UNCONFIRMED'};
  if(!Array.isArray(models))return {state:'observed',code:'CATALOG_UNAVAILABLE'};
  if(account.providerId==='own_zcode'){
   const modelFound=models.some(row=>/^glm[-.]5[-.]3[-.]flash$/i.test(row?.id??''));
   const giftConfirmed=status.balanceState==='available'
    &&Number.isFinite(status.giftedBalance)&&status.giftedBalance>=1024;
    const previewOnly=!giftConfirmed&&Number.isInteger(status.zcodePreviewStartPlans)
      &&status.zcodePreviewStartPlans>0;
    return {state:'observed',code:giftConfirmed&&modelFound?'OFFICIAL_GIFT_AND_MODEL':
      previewOnly?'START_PLAN_PREVIEW_UNVERIFIED':'NO_CONFIRMED_GIFT_BALANCE',
      modelFound,giftConfirmed,advertisedCount:models.length,
      ...(Number.isInteger(status.zcodePlanBuckets)?{zcodePlanBuckets:status.zcodePlanBuckets}:{}),
      ...(Number.isInteger(status.zcodeFlashBuckets)?{zcodeFlashBuckets:status.zcodeFlashBuckets}:{}),
      ...(Number.isInteger(status.zcodePreviewStartPlans)?{zcodePreviewStartPlans:status.zcodePreviewStartPlans}:{})};
   }  const official=models.filter(row=>row?.priceSource==='codearts-official-credit-ratio'
    &&typeof row.costMultiplier==='number'&&Number.isFinite(row.costMultiplier)
    &&row.costMultiplier>=0&&row.costMultiplier<=100);
  const free=official.filter(row=>row.costMultiplier===0);
   const signedCatalogCount=models.filter(row=>row.catalogSource===
     'codearts-signed-official-model-catalog').length;
   const misleadingZeroDisplay=official.filter(row=>row.costMultiplier>0
     &&typeof row.name==='string'&&/x0\.00\s*$/i.test(row.name)).length;  return {state:'observed',code:free.length?'OFFICIAL_ZERO_RATE_AVAILABLE':
     official.length?'OFFICIAL_RATE_NONZERO':'NO_OFFICIAL_RATE',
     officialRateCount:official.length,zeroRateCount:free.length,
     signedCatalogCount,misleadingZeroDisplay,    ...(official.length?{lowestMultiplier:Math.min(...official.map(row=>row.costMultiplier))}:{}),
    advertisedCount:models.length};
 }catch{return {state:'observed',code:'OFFICIAL_READ_ONLY_UNAVAILABLE'}}
}
// The DSH Host path is distinct from the per-account driver call above: it
// verifies DSH llm.stream -> registered native-router -> direct channel adapter.
async function hostRouteProof({llm,adapter,configStore,accountCenter,
  providerId,modelId,signal,now}){
  if(typeof llm?.stream!=='function'||typeof adapter?.listModels!=='function')
    return {state:'skipped',code:'DSH_HOST_LLM_UNAVAILABLE'};
  // This is a PROVIDER-level route, not an exact-account route. Validate
  // the same zero-cost model for EVERY enabled account under that Provider
  // before DSH is allowed to choose among them (including auto failover).
  const config=configStore.get();
  const peers=config.accounts.filter(a=>a.enabled&&a.providerId===providerId);
  if(!peers.length||!config.providers.some(p=>p.id===providerId&&p.enabled))
    return {state:'skipped',code:'DSH_ROUTE_ACCOUNT_UNSAFE'};
  const binding=peers.map(a=>[a.id,a.credentialRef]);
  for(const peer of peers){
    const publicRow=accountCenter.list().accounts.find(a=>a.id===peer.id);
    if(!publicRow?.enabled||!publicRow.modelTestAvailable
      ||!['online','recently_verified'].includes(publicRow.connectionState))
      return {state:'skipped',code:'DSH_ROUTE_ACCOUNT_UNSAFE'};
    let catalog;
    try{catalog=await accountCenter.listTestModels(peer.id,{signal})}catch{}
    if(catalog?.state!=='ready'||!catalog.models?.some(row=>row.id===modelId&&row.free===true))
      return {state:'skipped',code:'DSH_ROUTE_COST_UNVERIFIED'};
  }
  const after=configStore.get();
  if(!after.providers.some(p=>p.id===providerId&&p.enabled)
    ||binding.some(([id,ref])=>!after.accounts.some(a=>a.id===id
      &&a.providerId===providerId&&a.credentialRef===ref&&a.enabled))
    ||after.accounts.filter(a=>a.enabled&&a.providerId===providerId).length!==binding.length)
    return {state:'skipped',code:'DSH_ROUTE_ACCOUNT_UNSAFE'};
  const route='direct:'+providerId+':'+modelId;
  const advertised=await adapter.listModels();
  if(!Array.isArray(advertised)||!advertised.some(row=>row?.id===route))
    return {state:'skipped',code:'DSH_ROUTE_NOT_ADVERTISED'};
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  const timer=setTimeout(cancel,90000);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  let content=false,finished=false,finishReason='',events=0;
  try{
    if(controller.signal.aborted)return {state:'skipped',code:'CANCELLED'};
    const stream=await llm.stream({provider:'native-router',model:route,
      messages:[{role:'user',content:[{type:'text',text:'请只回复 OK'}]}],
       maxTokens:verifiedFreeHostBudget(providerId,modelId),
       sessionId:'native-router-smoke-host',signal:controller.signal});
     if(typeof stream?.[Symbol.asyncIterator]!=='function')      return {state:'failed',code:'DSH_STREAM_UNAVAILABLE'};
    for await(const evt of stream){
      events++;
      if(events>4096||controller.signal.aborted)return {state:'failed',code:'DSH_STREAM_INTERRUPTED'};
      if(evt?.type==='text-delta'&&typeof evt.text==='string'&&evt.text.trim())content=true;
      if(evt?.type==='finish'){
        finished=true;finishReason=evt.reason?.kind??'';
      }
    }
    if(!finished||!content||finishReason!=='stop'){
      const hostPhase=!finished?'MISSING_FINISH':finishReason==='max-tokens'
        ?'MAX_TOKENS':finishReason==='tool-calls'?'TOOL_CALLS':
        !content?'NO_TEXT':'UNEXPECTED_FINISH';
      return {state:'failed',code:'DSH_STREAM_INCOMPLETE',hostPhase};
    }
    return {state:'verified',code:'DSH_HOST_ROUTE_COMPLETE',proofAt:now()};
  }catch{
    return {state:'failed',code:controller.signal.aborted?'CANCELLED':'DSH_HOST_ROUTE_FAILED'};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}

export async function runOwnerLiveSmoke({configStore,accountCenter,adapter,llm,env=process.env,
  now=()=>Date.now(),signal,waitFor=wait,logger}={}){
  const nonce=env.DSH_NATIVE_ROUTER_SMOKE_NONCE;
  if(typeof nonce!=='string'||!NONCE.test(nonce)||!configStore?.path)return {state:'disabled'};
  const directory=dirname(configStore.path);
   const requestFile=join(directory,'owner-live-smoke-request.json');
   const consumedFile=join(directory,'owner-live-smoke-consumed-'+nonce+'.json');
   const resultFile=join(directory,'owner-live-smoke-result-'+nonce+'.json');
   if(existsSync(consumedFile)||existsSync(resultFile))return {state:'already_consumed'};
  let request;
  try{
    if(!existsSync(requestFile))return {state:'not_requested'};
    if(readFileSync(requestFile).byteLength>2048)return {state:'invalid_request'};
    request=JSON.parse(readFileSync(requestFile,'utf8'));
  }catch{return {state:'invalid_request'}}
  if(request?.version!==1||request.nonce!==nonce||request.consent!==true
     ||!Number.isSafeInteger(request.expiresAt)||request.expiresAt<now()
      ||request.expiresAt>now()+15*60*1000
      ||(request.slots!==undefined&&(!Array.isArray(request.slots)
        ||request.slots.length<1||request.slots.length>16
        ||request.slots.some(slot=>!Number.isInteger(slot)||slot<1||slot>16)
         ||new Set(request.slots).size!==request.slots.length))
      ||(request.freeModelIndex!==undefined&&(!Number.isInteger(request.freeModelIndex)
        ||request.freeModelIndex<0||request.freeModelIndex>9))
      ||(request.mode!==undefined&&!['host-route','bounded-priced','quota-audit','lowest-priced'].includes(request.mode))
      ||(request.mode==='quota-audit'&&(
        (request.providers===undefined&&!Array.isArray(request.slots))||
        (request.providers!==undefined&&(
          request.slots!==undefined||!Array.isArray(request.providers)||
          request.providers.length<1||request.providers.length>2||
          request.providers.some(id=>!['own_zcode','codearts'].includes(id))||
          new Set(request.providers).size!==request.providers.length))||
        (request.providers===undefined&&(
          request.slots.length>2||request.slots.some(slot=>![7,8].includes(slot))))))
      ||(request.mode==='bounded-priced'&&(
        request.billingConsent!=='single-low-cost-call'||
        !Array.isArray(request.slots)||request.slots.length>3||
        request.slots.some(slot=>![1,7,8].includes(slot))))
      ||(request.mode==='lowest-priced'&&(
        request.billingConsent!=='single-minimum-rated-model'||
        request.slots!==undefined||request.freeModelIndex!==undefined||
        !Array.isArray(request.providers)||request.providers.length!==1||
        request.providers[0]!=='codearts'||request.maxMultiplier!==0.1)))
    return {state:'invalid_request'};
  try{renameSync(requestFile,consumedFile)}catch{return {state:'not_consumed'}}
  const report={version:1,nonce,state:'running',startedAt:now(),completedAt:null,
     runtime:request.mode==='host-route'?'dsh-llm-native-router':
       request.mode==='bounded-priced'?'dsh-plugin-native-bounded-priced':
       request.mode==='quota-audit'?'dsh-plugin-official-read-only':
        request.mode==='lowest-priced'?'dsh-plugin-one-codearts-minimum-rate':'dsh-plugin-native',
     maxOutputTokensPerCall:128,accounts:[]};
   function persist(){    const temp=resultFile+'.tmp-'+process.pid;
    try{writeFileSync(temp,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
      retryAtomicRename(temp,resultFile)}catch(e){
       try{unlinkSync(temp)}catch{}
      throw e;
    }
  }
  // A missing writable audit trail must fail closed: no unrecorded real calls.
  try{persist()}catch{return {state:'report_unavailable'}}
  const cfg=configStore.get();
  const accounts=cfg.accounts.filter(a=>a.enabled!==false&&cfg.providers.some(p=>p.id===a.providerId&&p.enabled!==false));
   if(request.mode==='lowest-priced'&&accounts.filter(a=>a.providerId==='codearts').length!==1){
     report.state='ambiguous_accounts';report.completedAt=now();persist();
     return {state:'ambiguous_accounts',checked:0,verified:0};
   }
   const maxAccounts=Math.min(accounts.length,16);
   const selectedIndexes=['quota-audit','lowest-priced'].includes(request.mode)
      &&Array.isArray(request.providers)
     ?accounts.map((_,index)=>index).filter(index=>request.providers.includes(accounts[index].providerId)).slice(0,16)
     :Array.from({length:maxAccounts},(_,index)=>index)
       .filter(index=>request.slots===undefined||request.slots.includes(index+1));   for(const index of selectedIndexes){
     if(signal?.aborted){report.state='interrupted';break}
     const account=accounts[index];
    const result={slot:index+1,providerId:account.providerId,state:'checking',code:null,
       modelId:null,freeCount:0,advertisedCount:0,
       maxOutputTokens:account.providerId==='own_loomy'?128:
         BOUNDED_MAX_OUTPUT[account.providerId]??32,       startedAt:now(),finishedAt:null};    report.accounts.push(result);persist();
    if(request.mode==='quota-audit'){
      const proof=await quotaEvidence({account,accountCenter,configStore,signal});
      result.state=proof.state;result.code=proof.code;
      for(const key of ['modelFound','giftConfirmed','officialRateCount',
        'zeroRateCount','lowestMultiplier','signedCatalogCount','misleadingZeroDisplay',
        'zcodePlanBuckets','zcodeFlashBuckets','zcodePreviewStartPlans','advertisedCount']){
        if(Object.hasOwn(proof,key))result[key]=proof[key];
      }
      result.finishedAt=now();persist();continue;
    }
    const live=accountCenter.list().accounts.find(a=>a.id===account.id&&a.providerId===account.providerId);
    if(!live?.enabled||!['online','recently_verified'].includes(live.connectionState)){
      result.state='skipped';result.code='LOGIN_NOT_VERIFIED';result.finishedAt=now();persist();continue;
    }
    if(!live.modelTestAvailable){
      result.state='skipped';result.code='NOT_OWNED_INFERENCE';result.finishedAt=now();persist();continue;
    }
     if(request.mode==='bounded-priced'||request.mode==='lowest-priced'){
       result.state='generating';persist();
       const proof=await boundedPaidProof({account,accountCenter,configStore,now,signal,
         lowestPriced:request.mode==='lowest-priced',waitFor});
       result.state=proof.state;result.code=proof.code;      result.modelId=proof.modelId??null;
      if(Number.isInteger(proof.maxTokens))result.maxOutputTokens=proof.maxTokens;
      if(typeof proof.multiplier==='number')result.multiplier=proof.multiplier;
      if(proof.priceUnverified===true)result.priceUnverified=true;
      if(proof.usage)result.usage=proof.usage;
      if(proof.proofAt)result.proofAt=proof.proofAt;
      result.finishedAt=now();persist();continue;
    }
    let catalog;
    for(let attempt=0;attempt<4&&!signal?.aborted;attempt++){
      try{catalog=await accountCenter.listTestModels(account.id,{signal});break}
      catch{if(attempt<3)await waitFor(3500,signal)}
    }
    if(signal?.aborted){result.state='interrupted';result.code='CANCELLED';result.finishedAt=now();persist();report.state='interrupted';break}
    if(!catalog||catalog.state!=='ready'){
      result.state='skipped';result.code='CATALOG_UNAVAILABLE';result.finishedAt=now();persist();continue;
    }
    result.advertisedCount=catalog.models?.length??0;
    const free=(catalog.models??[]).filter(x=>x.free===true);
    result.freeCount=free.length;
     if(!free.length){result.state='skipped';result.code='NO_CONFIRMED_FREE_MODEL';result.finishedAt=now();persist();continue}
     const chosen=request.freeModelIndex??0;
     if(chosen>=free.length){result.state='skipped';result.code='FREE_MODEL_INDEX_UNAVAILABLE';result.finishedAt=now();persist();continue}
     result.modelId=free[chosen].id;
     if(request.mode==='host-route')
       result.maxOutputTokens=verifiedFreeHostBudget(account.providerId,result.modelId);
     result.state='generating';persist();     if(request.mode==='host-route'){
       result.scope='provider';
       try{
          const proof=await hostRouteProof({llm,adapter,configStore,accountCenter,
            providerId:account.providerId,modelId:result.modelId,signal,now});
          result.state=proof.state;result.code=proof.code;
          if(['MISSING_FINISH','MAX_TOKENS','TOOL_CALLS','NO_TEXT','UNEXPECTED_FINISH'].includes(proof.hostPhase))
            result.hostPhase=proof.hostPhase;
          if(proof.proofAt)result.proofAt=proof.proofAt;
       }catch{result.state='failed';result.code='DSH_HOST_ROUTE_FAILED'}
       result.finishedAt=now();persist();continue;
     }
    try{
      const attempt=await accountCenter.verifyModel(account.id,{modelId:result.modelId,signal});
      result.state=attempt.state==='verified'?'verified':attempt.state==='skipped'?'skipped':'failed';
       result.code=attempt.code? safeCode(attempt.code):attempt.state==='verified'?'MODEL_REPLY_COMPLETE':'UNKNOWN';
        if(['NON_SSE_INCOMPLETE','NO_SSE_FRAMES','FINISH_FRAME_MISSING_DONE',
          'MISSING_DONE_AND_FINISH','DONE_MISSING_FINISH','UNCLASSIFIED_SSE',
          'UPSTREAM_FINISH_ERROR','MISSING_NATIVE_FINISH','UNCLOSED_NATIVE_BLOCK',
          'MAX_TOKENS','NO_COMPLETE_TEXT']
          .includes(attempt.streamPhase))result.streamPhase=attempt.streamPhase;      if(attempt.state==='verified'){
        result.proofAt=attempt.at;
        if(attempt.usage&&typeof attempt.usage==='object')result.usage=attempt.usage;
      }
    }catch{
      result.state='failed';result.code='MODEL_TEST_UNAVAILABLE';
    }
    result.finishedAt=now();persist();
  }
  report.completedAt=now();
  if(report.state==='running')report.state='complete';
  persist();
  logger?.info?.('dsh-native-router owner live model smoke completed: '+report.state
    +'; verified='+report.accounts.filter(x=>x.state==='verified').length
    +'; skipped='+report.accounts.filter(x=>x.state==='skipped').length
    +'; failed='+report.accounts.filter(x=>x.state==='failed').length);
  return {state:report.state,verified:report.accounts.filter(x=>x.state==='verified').length,
    checked:report.accounts.length};
}
export function scheduleOwnerLiveSmoke({configStore,accountCenter,adapter,llm,env=process.env,
  logger,initialDelayMs=15000}={}){
  if(!NONCE.test(String(env.DSH_NATIVE_ROUTER_SMOKE_NONCE??'')))return ()=>{};
  const controller=new AbortController();
  const timer=setTimeout(()=>{
     void runOwnerLiveSmoke({configStore,accountCenter,adapter,llm,env,logger,signal:controller.signal})
      .catch(()=>logger?.warn?.('dsh-native-router owner smoke could not complete; private details suppressed'));
  },initialDelayMs);
  timer.unref?.();
  return ()=>{clearTimeout(timer);controller.abort()};
}
