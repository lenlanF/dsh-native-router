// One-time, owner-initiated in-Host account inference acceptance. The test is
// invoked by the *running DSH plugin*, not a stand-alone gateway or browser.
// A nonce in the DSH process environment and a matching short-lived owner file
// are both necessary; consumption is durable before the first model request.
import {readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';

const NONCE=/^[a-f0-9]{32}$/;
const wait=(ms,signal)=>new Promise(resolve=>{
  if(signal?.aborted)return resolve();
  const timer=setTimeout(done,ms);
  function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()}
  signal?.addEventListener('abort',done,{once:true});
});
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z_]{0,47}$/.test(value)?value:'UNKNOWN';
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
      maxTokens:32,sessionId:'native-router-smoke-host',signal:controller.signal});
    if(typeof stream?.[Symbol.asyncIterator]!=='function')
      return {state:'failed',code:'DSH_STREAM_UNAVAILABLE'};
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
      ||(request.mode!==undefined&&request.mode!=='host-route'))return {state:'invalid_request'};
  try{renameSync(requestFile,consumedFile)}catch{return {state:'not_consumed'}}
  const report={version:1,nonce,state:'running',startedAt:now(),completedAt:null,
     runtime:request.mode==='host-route'?'dsh-llm-native-router':'dsh-plugin-native',
     maxOutputTokensPerCall:32,accounts:[]};
  function persist(){
    const temp=resultFile+'.tmp-'+process.pid;
    try{writeFileSync(temp,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
      renameSync(temp,resultFile)}catch(e){
       try{unlinkSync(temp)}catch{}
      throw e;
    }
  }
  // A missing writable audit trail must fail closed: no unrecorded real calls.
  try{persist()}catch{return {state:'report_unavailable'}}
  const cfg=configStore.get();
  const accounts=cfg.accounts.filter(a=>a.enabled!==false&&cfg.providers.some(p=>p.id===a.providerId&&p.enabled!==false));
  const maxAccounts=Math.min(accounts.length,16);
   const selectedIndexes=Array.from({length:maxAccounts},(_,index)=>index)
     .filter(index=>request.slots===undefined||request.slots.includes(index+1));
   for(const index of selectedIndexes){
     if(signal?.aborted){report.state='interrupted';break}
     const account=accounts[index];
    const result={slot:index+1,providerId:account.providerId,state:'checking',code:null,
      modelId:null,freeCount:0,advertisedCount:0,startedAt:now(),finishedAt:null};
    report.accounts.push(result);persist();
    const live=accountCenter.list().accounts.find(a=>a.id===account.id&&a.providerId===account.providerId);
    if(!live?.enabled||!['online','recently_verified'].includes(live.connectionState)){
      result.state='skipped';result.code='LOGIN_NOT_VERIFIED';result.finishedAt=now();persist();continue;
    }
    if(!live.modelTestAvailable){
      result.state='skipped';result.code='NOT_OWNED_INFERENCE';result.finishedAt=now();persist();continue;
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
     result.state='generating';persist();
     if(request.mode==='host-route'){
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
         'MISSING_DONE_AND_FINISH','DONE_MISSING_FINISH','UNCLASSIFIED_SSE']
         .includes(attempt.streamPhase))result.streamPhase=attempt.streamPhase;
      if(attempt.state==='verified'){
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
