import {resolveCredential} from './accounts.mjs';
import {describeChannels,automaticPools} from './channels.mjs';
import {publicAccountName,publicBalance,publicMaskedPhone} from './account-facts.mjs';
import {runtimeOwnership} from './account-runtime-ownership.mjs';
import {verificationWithinPeriod} from './account-verification-store.mjs';
import {freeEvidence} from './auto-free.mjs';
import {classifyFailure} from './failure.mjs';
import {publicAccountMessage,publicAccountFailureMessage} from './public-diagnostics.mjs';

const MAX_PROBE_MS=15000, AUTO_VERIFY_MS=15*60*1000, FRESH_MS=30*60*1000;
function accountNotFound(id){const e=new Error('Account not configured: '+String(id).slice(0,80));e.status=404;return e}
export function createAccountCenter({
 configStore,adapter,drivers=new Map(),fetchImpl=fetch,env=process.env,vault,now=()=>Date.now(),
   getSourceStatus=()=>({state:'unavailable'}),verificationStore,publicFactsStore,
   autoVerifyMs=AUTO_VERIFY_MS,
   readOnlyTimeoutMs=8000,readOnlyConcurrency=4,}={}){
  if(!configStore?.get||!configStore?.replace)throw Error('ConfigStore must support get and replace');
   const checks=new Map(),pending=new Set(),discoverCache=new Map(),profileWarmup=new Map(),
    inferenceProof=new Map(),inferenceFailures=new Map(),readOnlyPending=new Map();
  let automaticTimer=null,initialTimer=null,autoBusy=false,disposed=false;
  const storedFor=account=>verificationStore?.get?.(account)??null;
  function checkFor(account){
    const stored=storedFor(account),cached=checks.get(account.id);
    const live=cached?.bindingRef===account.credentialRef?cached:null;
    if(live){
     const lastSuccess=live.state==='online'?live.at:stored?.verifiedAt??null;
     if(live.state==='online'&&now()-live.at>FRESH_MS)
      return {...live,state:'recently_verified',verifiedAt:lastSuccess,
       message:'上次鉴权成功，后台即将复核'};
     return {...live,verifiedAt:lastSuccess};
    }
   if(!stored)return {state:'not_checked',at:null,verifiedAt:null,message:'尚未完成首次鉴权复核'};
   const fresh=stored.state!=='online'||now()-stored.checkedAt<=FRESH_MS;
   return {state:fresh?stored.state:'recently_verified',at:stored.checkedAt,
     verifiedAt:stored.verifiedAt,
     message:fresh&&stored.state==='online'?'最近鉴权通过（由渠道自行维护登录态）':
       stored.state==='expired'?'上次确认授权失效，后台将继续检查':
       stored.state==='online'?'此前鉴权通过，后台将自动复核，无需手工验证':
       '上次连接检查未成功，后台将自动复核'};
   }
 const driverFor=providerId=>drivers instanceof Map?drivers.get(providerId):drivers?.[providerId];
 // The legacy public CodeArts/WorkBuddy ID can refer to an independently
 // owned QR account. Only its exact private source driver can establish this;
 // a configured provenance string alone does not make an account owned.
 const runtimeMode=account=>runtimeOwnership(account)==='owned'
   ||driverFor(account?.providerId)?.isPrivateSourceBound?.(account)===true
     ?'owned':runtimeOwnership(account);
 function originOf(account,cfg){
   const ref=account.credentialRef,linked=cfg.sessionReuse?.linkedIds?.includes(account.id)===true;
   // Once migrated, original-plugin information is provenance only.
   if(runtimeMode(account)==='owned')
     return {kind:'independent-owned',label:'聚合路由自有账号 · 授权已独立接管',
       sourceAvailable:true,loginVerified:false};  if(ref==='driver:workbuddy:'+account.id&&account.id.startsWith('wb_'))
   return {kind:'desktop-session',label:'WorkBuddy / CodeBuddy 桌面客户端 · 只读会话',loginVerified:false};
  if(ref==='driver:codearts:'+account.id&&account.id.startsWith('ca_'))
   return {kind:'desktop-session',label:'CodeArts 本地授权引用',loginVerified:false};
  if(ref==='driver:'+account.providerId+':'+account.id&&account.id.startsWith('sp_')){
   const recorded=cfg.sessionReuse?.linkedOrigins?.[account.id];
   const origin=recorded==='external-dsh-provider'?'dsh-account-pool':
     recorded==='own-source-pack'?'embedded-account-pool':'source-unverified';
   const nowSource=getSourceStatus();
   const current=nowSource?.borrowedExistingDsh?'dsh-account-pool':
     nowSource?.state==='mounted'?'embedded-account-pool':'source-unavailable';
   return {kind:origin,label:origin==='dsh-account-pool'?'DSH 原有渠道插件账号池':
     origin==='embedded-account-pool'?'聚合路由内置来源账号池':'原账号池类型尚未记录 · 需确认',
     sourceAvailable:origin===current,loginVerified:false};
  }
  return {kind:linked?'linked-reference':ref.startsWith('env:')?'environment-reference':
    ref.startsWith('host:')?'host-reference':'driver-reference',
    label:linked?'复用的已有账号引用':ref.startsWith('env:')?'环境变量凭据引用':
      ref.startsWith('host:')?'DSH 凭据保管库引用':'原生驱动引用',loginVerified:false};
 }
 // Persist authorized facts at the point of successful refresh. A page read
 // is not required, and a late reply from an old binding must never be saved.
 function observeRefreshedFacts(account,driver,observedAt){
   if(disposed||!publicFactsStore||typeof driver?.accountSnapshot!=='function')return;
   try{
     const live=driver.accountSnapshot(account)??{};
     if(live.authVerified===false)return;
     publicFactsStore.observe(account,live,{verifiedAt:observedAt});
   }catch{}
 }
 function list(){
   const cfg=configStore.get(),registered=describeChannels(cfg,drivers instanceof Map?drivers:new Map(Object.entries(drivers??{})));
   const statusMap=new Map(cfg.accounts.map(account=>[account.id,checkFor(account)]));
   return {
     channels:registered.map(channel=>{
       const accounts=cfg.accounts.filter(a=>a.providerId===channel.id);
       return {...channel,providerEnabled:cfg.providers.find(p=>p.id===channel.id)?.enabled??false,
         totalAccounts:accounts.length,enabledAccounts:accounts.filter(a=>a.enabled).length};
     }),
     accounts:cfg.accounts.map(account=>{
       const provider=cfg.providers.find(p=>p.id===account.providerId);
       const driver=driverFor(provider.id);
         const check=statusMap.get(account.id);
          // The account inventory is purely self-owned after migration.
          // NEVER inspect the installed original plugin while rendering state.
          let live={};
          try{live=typeof driver?.accountSnapshot==='function'?
            driver.accountSnapshot(account)??{}:{}}catch{}
             // Driver refreshes may transiently return an empty/partial
             // snapshot. Capture only sanitized, identity-bound public facts;
             // never replace a known name or balance with an outage/empty row.
             try{publicFactsStore?.observe?.(account,live)}catch{}
             const cached=publicFactsStore?.get?.(account)??null;
             const official=publicBalance(live),previous=publicBalance(cached);
             const hasLive=Number.isFinite(official.balance)&&official.balance>=0;
             const hasPrevious=Number.isFinite(previous.balance)&&previous.balance>=0;
             const latest=hasLive&&(!hasPrevious||
               (official.balanceCheckedAt??0)>=(previous.balanceCheckedAt??0));
             const fromCache=!latest&&hasPrevious;
             const balance=fromCache?{...previous,balanceState:'cached',
               balanceStale:true}:official;
             if(hasLive&&!fromCache&&Number.isFinite(official.balanceCheckedAt)
                 &&now()-official.balanceCheckedAt>FRESH_MS){
               balance.balanceState='cached';balance.balanceStale=true;
             }
             const liveName=publicAccountName(live);
             const livePhone=publicMaskedPhone(live);
             const name=liveName||cached?.name||publicAccountName(account);
             const maskedPhone=livePhone||publicMaskedPhone(cached);
             const profileFromCache=!liveName&&Boolean(cached?.name)||(!name&&!livePhone&&Boolean(maskedPhone));
             // A valid entitlement may expose ONLY remaining units (or only
             // the provisioned/used values). Never discard that official
             // evidence simply because the provider omitted a total.
             const quotaWindows=Array.isArray(live.quotaWindows)?live.quotaWindows.slice(0,12)
               .filter(x=>x&&typeof x.label==='string'&&x.label.trim()
                 &&(['left','total','used'].some(key=>Number.isFinite(x[key])&&x[key]>=0)
                   ||Number.isFinite(x.remainingPercent)&&x.remainingPercent>=0&&x.remainingPercent<=100))
               .map(x=>({
                 ...(typeof x.kind==='string'?{kind:x.kind.slice(0,24)}:{}),
                 label:x.label.trim().slice(0,50),
                 ...(Number.isFinite(x.remainingPercent)&&x.remainingPercent>=0&&x.remainingPercent<=100?{remainingPercent:x.remainingPercent}:{}),
                 ...Object.fromEntries(['left','total','used']
                   .filter(key=>Number.isFinite(x[key])&&x[key]>=0)
                   .map(key=>[key,x[key]])),
                 ...(typeof x.unit==='string'&&x.unit.trim().length<=24
                   ?{unit:x.unit.trim()}:{}),
                 ...(Number.isFinite(x.endAt)&&x.endAt>0?{endAt:x.endAt}:{})
               })):[];
          const lastProof=inferenceProof.get(account.id);
          const lastFailure=inferenceFailures.get(account.id);
          const persistentProof=verificationStore?.getModelTest?.(account);
          const verifiedAt=lastProof?.credentialRef===account.credentialRef?lastProof.at:null;
          const failedAt=Math.max(lastFailure?.credentialRef===account.credentialRef
            ?lastFailure.at:0,persistentProof?.failedAt??0)||null;
          const bestProof=Math.max(verifiedAt??0,persistentProof?.at??0,
           Number.isFinite(live.modelInferenceVerifiedAt)&&live.modelInferenceVerifiedAt>0?
            live.modelInferenceVerifiedAt:0);
           return {id:account.id,providerId:account.providerId,providerName:provider.name,
             ...(name?{nickname:name}:{}),
             ...(maskedPhone?{maskedPhone}:{}),
             profileState:name||maskedPhone?profileFromCache?'cached':'verified':'not_returned',
             ...balance,quotaWindows,
             ...(balance.balanceUnit==='积分'
               &&Number.isFinite(fromCache?cached?.expiringPoints:live.expiringPoints)
               &&(fromCache?cached.expiringPoints:live.expiringPoints)>0
               &&Number.isFinite(fromCache?cached?.expiringAt:live.expiringAt)
               &&(fromCache?cached.expiringAt:live.expiringAt)>now()?
                {expiringPoints:fromCache?cached.expiringPoints:live.expiringPoints,
                 expiringAt:fromCache?cached.expiringAt:live.expiringAt}:{}),
             ...(typeof live.planName==='string'&&live.planName?{planName:live.planName.slice(0,72)}:{}),
             ...(typeof live.membershipPlanName==='string'&&live.membershipPlanName?{membershipPlanName:live.membershipPlanName.slice(0,72)}:{}),
             ...(typeof live.membershipState==='string'?{membershipState:live.membershipState}:{}),
             ...(Number.isFinite(live.membershipPercentRemaining)?{membershipPercentRemaining:live.membershipPercentRemaining}:{}),
             ...(Number.isFinite(live.membershipResetAt)?{membershipResetAt:live.membershipResetAt}:{}),
              ...(Number.isFinite(live.quotaCheckedAt)?{quotaCheckedAt:live.quotaCheckedAt}:{}),
              ...(typeof live.usageState==='string'?{usageState:live.usageState}:{}),
              ...(Number.isFinite(live.usagePercentRemaining)?{usagePercentRemaining:live.usagePercentRemaining}:{}),
              ...(Number.isFinite(live.usageResetAt)?{usageResetAt:live.usageResetAt}:{}),
              ...(Number.isFinite(live.usageCheckedAt)?{usageCheckedAt:live.usageCheckedAt}:{}),
              ...(typeof live.creditFetchState==='string'?{creditFetchState:live.creditFetchState}:{}),
              ...(Number.isFinite(live.benefitsCheckedAt)?{benefitsCheckedAt:live.benefitsCheckedAt}:{}),
              ...(Array.isArray(live.benefits)?{benefits:live.benefits.slice(0,48).filter(x=>
                (['gift','compensation'].includes(x?.kind)
                ||/^workbuddy_growth_(?:task|travel)_[a-f0-9]{24}$/.test(x?.kind)
                ||/^doubao_task_[a-f0-9]{24}$/.test(x?.kind))
                &&typeof x.active==='boolean'
                &&typeof x.claimed==='boolean').map(x=>({kind:x.kind,
                ...(typeof x.name==='string'?{name:x.name.slice(0,80)}:{}),
                active:x.active,claimed:x.claimed,
                ...(Number.isFinite(x.credit)?{credit:x.credit}:{}),
                ...(Number.isFinite(x.endAt)?{endAt:x.endAt}:{})}))}:{}),
              ...(['claimed','claimable','not_confirmed','not_offered','unavailable'].includes(live.activityState)?
                {activityState:live.activityState}:{}),
              ...(Number.isFinite(live.activityCheckedAt)?{activityCheckedAt:live.activityCheckedAt}:{}),
              // The official entitlement must be fresh; an old positive
              // flag must not survive a failed read-only refresh or restart.
              ...(typeof live.activityClaimable==='boolean'
                &&Number.isSafeInteger(live.activityCheckedAt)
                &&live.activityCheckedAt<=now()
                &&now()-live.activityCheckedAt<=15*60*1000
                ?{activityClaimable:live.activityClaimable}:{}),
              ...(typeof live.activityActive==='boolean'?
                {activityActive:live.activityActive}:{}),
              ...(Number.isInteger(live.activityTaskCount)&&live.activityTaskCount>=0
                &&live.activityTaskCount<=99?{activityTaskCount:live.activityTaskCount}:{}),
              ...(live.activityTaskExecutionState==='requires_verified_executor'
                ?{activityTaskExecutionState:'requires_verified_executor'}:{}),
              modelInferenceVerifiedAt:failedAt&&failedAt>=bestProof?null:bestProof||null,
             modelTestFailedAt:failedAt??null,
            upstreamCheckinDate:live.checkinDate??null,
            upstreamCheckinOutcome:live.checkinOutcome??null,
            upstreamCheckinSource:live.checkinDate?'own-driver-live':'unknown',
            enabled:account.enabled&&provider.enabled,configuredEnabled:account.enabled,
            weight:account.weight,runtimeMode:runtimeMode(account),
             reusedExistingSession:cfg.sessionReuse?.linkedIds?.includes(account.id)===true,
             origin:originOf(account,cfg),          credentialKind:account.credentialRef.startsWith('env:')?'env':account.credentialRef.startsWith('driver:')?'driver':'host',
         checkedAt:check.at,lastVerifiedAt:check.verifiedAt,
         connectionState:!account.enabled?'disabled':!provider.enabled?'provider_disabled':check.state,
         message:!account.enabled?'此账号已停用':!provider.enabled?'所属渠道已停用':check.message,
         busy:pending.has(account.id),
         modelTestAvailable:runtimeMode(account)==='owned'&&provider.protocol==='native-channel'
          &&typeof driver?.listModels==='function'&&typeof driver?.generate==='function',
         loginAvailable:!!driver?.login||['openai-chat','anthropic-messages'].includes(provider.protocol),
         refreshAvailable:!!driver?.refresh||['openai-chat','anthropic-messages'].includes(provider.protocol),
         checkinAvailable:typeof driver?.checkIn==='function',
       };
     }),
      pools:automaticPools(cfg,statusMap),
       checkedAt:now(),
       verificationCache:{state:verificationStore?(verificationStore.writable?'ready':'degraded'):'memory'},
   };
 }
 function find(id){
   const cfg=configStore.get(),account=cfg.accounts.find(a=>a.id===id);
   if(!account)throw accountNotFound(id);
   const provider=cfg.providers.find(p=>p.id===account.providerId);
   if(!provider)throw Error('Account provider not configured');
   return {account,provider,cfg,driver:driverFor(provider.id)};
 }
  async function basicProbe({account,provider},signal){    const token=await resolveCredential(account,{env,vault});
   const headers=provider.protocol==='anthropic-messages'
     ?{'x-api-key':token,'anthropic-version':'2023-06-01'}
     :{authorization:'Bearer '+token};
   const url=provider.baseUrl+'/models';
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.min(provider.timeoutMs??MAX_PROBE_MS,MAX_PROBE_MS));
   try{
      const result=await fetchImpl(url,{method:'GET',headers,signal:signal?AbortSignal.any([controller.signal,signal]):controller.signal});     if(!result?.ok){
       if(result.status===401||result.status===403)return {state:'expired',message:'鉴权失败（HTTP '+result.status+'），请核对凭据'};
       if(result.status===429)return {state:'limited',message:'上游暂时限流（HTTP 429）'};
       return {state:'error',message:'模型目录检测失败（HTTP '+Number(result.status||0)+'），并不代表模型推理不可用'};
     }
     return {state:'online',message:'已通过上游模型目录鉴权验证'};
   }finally{clearTimeout(timeout)}
 }
   async function verify(id,{login=false,signal}={}){
    if(pending.has(id)){const e=new Error('Account operation already in progress');e.status=409;throw e}
   const entry=find(id);
   if(readOnlyPending.get(id)?.credentialRef===entry.account.credentialRef){
     const error=new Error('Account read-only refresh already in progress');error.status=409;throw error;
   }
   if(!entry.account.enabled||!entry.provider.enabled){const e=new Error('Account or provider is disabled');e.status=409;throw e}
   const method=login?'login':'refresh',driver=entry.driver;
   if(!driver?.[method]&&!['openai-chat','anthropic-messages'].includes(entry.provider.protocol)){
     const e=new Error('此渠道尚未接入原生登录或刷新适配器');e.status=501;throw e
   }
    pending.add(id);checks.set(id,{state:'checking',at:now(),bindingRef:entry.account.credentialRef,
      message:login?'正在校验账号授权':'正在刷新账号状态'});
   let result;
   const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
   const onAbort=()=>controller.abort();
   signal?.addEventListener('abort',onAbort,{once:true});
   if(signal?.aborted)controller.abort();
   try{
     const task=driver?.[method]?driver[method]({
       provider:entry.provider,account:entry.account,
       resolveCredential:()=>resolveCredential(entry.account,{env,vault}),signal:controller.signal,
     }):basicProbe(entry,controller.signal);
      const aborted=new Promise((_,reject)=>{
        const fail=()=>reject(Error('连接校验超时或已取消'));
        if(controller.signal.aborted)fail();
        else controller.signal.addEventListener('abort',fail,{once:true});
      });
      result=await Promise.race([task,aborted]);
     if(!['online','expired','limited','error','client_required','pending'].includes(result?.state))throw Error('Invalid account driver response');
      result={state:result.state,message:publicAccountMessage(result.state),at:now()};
   }catch(error){
      result={state:'error',message:publicAccountFailureMessage(error),at:now()};
   }finally{
     clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);pending.delete(id);
    }
     const stillBound=stillAuthorizedAccount(entry);
    if(disposed||!stillBound){
      checks.delete(id);
      return {id,state:'error',at:now(),message:'账号绑定已改变，等待重新校验'};
    }
    checks.set(id,{...result,bindingRef:entry.account.credentialRef});
    try{verificationStore?.set?.(entry.account,result)}catch{}
    if(result.state==='online'&&!controller.signal.aborted)
      observeRefreshedFacts(entry.account,driver,result.at);
    return {id,...result,manualKeyVerification:!driver?.[method]};
  }
 // Model verification uses this plugin's own account/driver, never a
 // borrowed client or original-plugin process. Free price must be explicit.
 function modelTestEvidence(row,providerId){
   const rules=configStore.get().freePool??{};
   const explicit=(rules.models??[]).find(x=>x.providerId===providerId&&x.model===row.id);
   if(explicit)return explicit.free?'用户手动声明免费（费用由用户确认）':null;
   if((rules.providerIds??[]).includes(providerId))
     return '用户手动声明该渠道免费（费用由用户确认）';
   return freeEvidence(row,providerId);
 }
 // Unattended acceptance never uses owner-marked free overrides as proof.
 // Conflicting positive rates (including duplicate model rows) fail closed.
 function officialTestEvidence(row,providerId,rows){
   const explicit=(configStore.get().freePool?.models??[])
     .find(x=>x.providerId===providerId&&x.model===row.id);
   if(explicit?.free===false)return null;
   const positive=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')
     &&Number.isFinite(Number(value))&&Number(value)>0;
   const peers=rows.filter(x=>x?.id===row.id);
   if(peers.some(x=>x.free===false||x.isFree===false||positive(x.costMultiplier)
     ||[x.pricing,x.price,x.cost].some(price=>price&&typeof price==='object'
       &&['input','output','prompt','completion','inputCost','outputCost'].some(k=>positive(price[k])))
     ||(/^own_workbuddy(?:-|$)/.test(providerId)&&
       /(?:^|[\s·(])x\s*(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)(?:$|[\s·)])/i.test(x.name??''))))return null;
   if(providerId==='codearts'&&row.priceSource==='codearts-official-credit-ratio'
     &&row.costMultiplier===0)return 'CodeArts 官方零积分倍率';
   return freeEvidence(row,providerId);
 }
 function eligibleTestRow(row,providerId,{officialOnly=false,rows=[]}={}){
   if(typeof row?.id!=='string'||!row.id.trim()||row.id.length>120
      ||/[\u0000-\u001f]/.test(row.id))return null;
   const evidence=officialOnly?officialTestEvidence(row,providerId,rows):modelTestEvidence(row,providerId);
   return {id:row.id,name:typeof row.name==='string'&&row.name.length<=120
     ?row.name:row.id,free:Boolean(evidence),...(evidence?{evidence}:{})};
 }
 function assertTestAccount(id){
   const found=find(id),{account,provider,driver}=found;
   if(!account.enabled||!provider.enabled||runtimeMode(account)!=='owned'
     ||provider.protocol!=='native-channel'||typeof driver?.listModels!=='function'
     ||typeof driver?.generate!=='function'){
     const error=new Error('仅独立接管并启用的自有模型账号允许真实推理验证');
     error.status=409;throw error;
   }
   return found;
 }
  // Model discovery is not execution permission: check the current owned binding
  // again before real inference and when publishing catalog or replies.
   function stillAuthorizedAccount({account,provider}){
     const current=configStore.get();
     return !disposed&&current.accounts.some(row=>row.id===account.id
       &&row.providerId===account.providerId&&row.credentialRef===account.credentialRef
       &&row.enabled)&&current.providers.some(row=>row.id===provider.id
       &&row.enabled&&row.protocol===provider.protocol);
   }
   function stillAuthorizedTestAccount(entry){
     return stillAuthorizedAccount(entry)&&entry.provider.protocol==='native-channel';
   }
  async function listTestModels(id,{signal,officialOnly=false}={}){
   if(pending.has(id)){
     const error=new Error('Account operation already running');error.status=409;throw error;
   }
   const {account,provider,driver}=assertTestAccount(id);
   const controller=new AbortController();
   const stop=()=>controller.abort();
   const timer=setTimeout(stop,10000);
   signal?.addEventListener('abort',stop,{once:true});
   if(signal?.aborted)stop();
   const cancelled=new Promise((_,reject)=>{
     const done=()=>reject(Error('独立模型目录查询已取消或超时'));
     if(controller.signal.aborted)done();
     else controller.signal.addEventListener('abort',done,{once:true});
   });
   try{
     const raw=await Promise.race([Promise.resolve().then(()=>driver.listModels({
       account,provider,signal:controller.signal})),cancelled]);
     const models=[],seen=new Set();
     for(const row of Array.isArray(raw)?raw:[]){
       const candidate=eligibleTestRow(row,provider.id,{officialOnly,rows:Array.isArray(raw)?raw:[]});
       if(!candidate||seen.has(candidate.id))continue;
       seen.add(candidate.id);models.push(candidate);
       if(models.length>=60)break;
     }
      if(!stillAuthorizedTestAccount({account,provider})){
        const error=new Error('账号授权已改变，旧模型目录已取消');
        error.status=409;throw error;
      }
      return {state:'ready',models,freeCount:models.filter(x=>x.free).length,
        message:'仅明确免费模型允许发送最小真实请求；未知价格不测试'};
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop)}
 }
 async function verifyModel(id,{modelId,signal,officialOnly=false}={}){
  if(pending.has(id)){const error=new Error('Account operation already running');error.status=409;throw error}
  const {account,provider,driver}=assertTestAccount(id);
  const feePolicy=JSON.stringify(configStore.get().freePool??{});
  if(modelId!==undefined&&(typeof modelId!=='string'||modelId.length>120)){
   const error=new Error('Invalid model ID');error.status=400;throw error;
  }
  pending.add(id);
  const controller=new AbortController();
   let timedOut=false,generationStarted=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},90000);
  const abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const cancelled=new Promise((_,reject)=>{
   const rejectAborted=()=>reject(new Error('Model verification timed out or was canceled'));
   if(controller.signal.aborted)rejectAborted();
   else controller.signal.addEventListener('abort',rejectAborted,{once:true});
  });
  try{
   const rows=await Promise.race([driver.listModels({account,provider,signal:controller.signal}),cancelled]);
   const catalog=Array.isArray(rows)?rows:[];
   const evidenceFor=row=>officialOnly?officialTestEvidence(row,provider.id,catalog):modelTestEvidence(row,provider.id);
   const models=catalog.filter(row=>eligibleTestRow(row,provider.id,{officialOnly,rows:catalog}));
   const chosen=modelId?models.find(row=>row.id===modelId):
     models.find(row=>evidenceFor(row));
   if(!chosen){
     if(models.length&&(!modelId||models.some(row=>row.id===modelId)))
       return {id,state:'skipped',code:'COST_NOT_CONFIRMED_FREE',at:now(),
         message:'没有确认免费的模型；未发送真实推理请求，也未消耗模型额度'};
     return {id,state:'skipped',code:'MODEL_NOT_IN_CATALOG',at:now(),
       message:'指定模型不在该自有账号的实时目录中；未发送请求'};
   }
   const evidence=evidenceFor(chosen);
   if(!evidence)return {id,state:'skipped',code:'COST_NOT_CONFIRMED_FREE',at:now(),
     message:'模型费用尚未确认为免费或已被人工排除；未发送请求'};
   if(feePolicy!==JSON.stringify(configStore.get().freePool??{}))
     return {id,state:'skipped',code:'FEE_RULE_CHANGED',at:now(),
       message:'免费声明已变化；未发送模型调用'};
    if(!stillAuthorizedTestAccount({account,provider}))
      return {id,state:'skipped',code:'ACCOUNT_CHANGED',at:now(),
        message:'账号已停用或凭据绑定已改变；未发送真实推理请求'};
     generationStarted=true;
     const reply=await Promise.race([driver.generate({account,provider,model:chosen.id,
     options:{messages:[{role:'user',content:[{type:'text',text:'请只回复 OK'}]}],
      maxTokens:(provider.id==='own_loomy'&&chosen.id==='spark-x2.6')||
        (officialOnly&&['own_workbuddy-cn','own_workbuddy-global'].includes(provider.id))?128:32,
      sessionId:'native-router-test-'+id},signal:controller.signal}),cancelled]);    if(reply?.finishReason!=='stop'||typeof reply?.text!=='string'||!reply.text.trim()
      ||(Array.isArray(reply.toolCalls)&&reply.toolCalls.length))
     throw Object.assign(new Error('Model reply was incomplete'),{
       code:'TRUNCATED',safeStreamPhase:reply?.finishReason==='length'?'MAX_TOKENS':'NO_COMPLETE_TEXT'});    if(!stillAuthorizedTestAccount({account,provider})
      ||feePolicy!==JSON.stringify(configStore.get().freePool??{})
      ||!evidenceFor(chosen))
       return {id,state:'failed',code:'ACCOUNT_OR_FEE_CHANGED',at:now(),
        message:'账号授权或免费规则在调用期间已改变；旧回复已丢弃，可能已发生一次请求，但未记录成功'};
    const at=now(),status={state:'online',at,bindingRef:account.credentialRef,
    message:'本插件自有账号已完成独立真实模型对话验证'};
   inferenceProof.set(id,{at,credentialRef:account.credentialRef,modelId:chosen.id});
   inferenceFailures.delete(id);
   checks.set(id,status);
   try{
     verificationStore?.set?.(account,status);
     verificationStore?.setModelTest?.(account,{at,modelId:chosen.id});
   }catch{}
   adapter?.invalidateCatalog?.();
   const rawUsage=reply?.usage;
   const usage=rawUsage&&typeof rawUsage==='object'
     ?Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens']
       .filter(k=>Number.isSafeInteger(rawUsage[k])&&rawUsage[k]>=0)
       .map(k=>[k,rawUsage[k]])):{};
   return {id,state:'verified',modelId:chosen.id,at,evidence,
     responsePreview:reply.text.trim().slice(0,120),usage,
     message:'已通过自有账号真实完成一次最小模型回复（不是模型目录模拟）'};
   }catch(error){
    const at=now();
    if(!generationStarted)return {id,state:'skipped',at,
      code:stillAuthorizedTestAccount({account,provider})?'CATALOG_UNAVAILABLE':'ACCOUNT_CHANGED',
      message:'本账号只读模型目录不可用或授权已变更；未发送实际生成，保留此前的成功记录'};
    if(!stillAuthorizedTestAccount({account,provider}))
      return {id,state:'failed',at,code:'ACCOUNT_CHANGED',
        message:'实际生成请求已发出但账号授权已变更；旧结果不写入模型验证记录'};
    inferenceProof.delete(id);
   inferenceFailures.set(id,{at,credentialRef:account.credentialRef});
   try{verificationStore?.setModelTestFailure?.(account,{at})}catch{}
   const code=timedOut?'TIMEOUT':classifyFailure(error,controller.signal).code;
   const meanings={AUTH:'渠道拒绝本账号授权',CREDENTIAL:'自有凭据失效或不可读取',
     QUOTA:'账号额度不足',RATE_LIMIT:'官方接口正在限流',
     PROVIDER_NOT_READY:'渠道模型适配器尚未就绪',
      OUTPUT_LIMIT:'模型触及本次小额验收的输出预算，并非流连接中断',     TIMEOUT:'模型调用超时',TRANSPORT:'渠道网络连接失败',
     SERVER:'渠道服务暂时异常',CANCELLED:'请求被取消',
     INVALID_REQUEST:'模型请求格式不受支持',
     UNKNOWN:'模型没有返回完整的成功回复'};
    return {id,state:'failed',at,code,
       ...(['STREAM_CLOSED','OUTPUT_LIMIT'].includes(code)&&['NON_SSE_INCOMPLETE','NO_SSE_FRAMES',         'FINISH_FRAME_MISSING_DONE','MISSING_DONE_AND_FINISH',
         'DONE_MISSING_FINISH','UNCLASSIFIED_SSE','UPSTREAM_FINISH_ERROR',
         'MISSING_NATIVE_FINISH','UNCLOSED_NATIVE_BLOCK','MAX_TOKENS','NO_COMPLETE_TEXT']
         .includes(error?.safeStreamPhase)
          ?{streamPhase:error.safeStreamPhase}:{}),      message:(meanings[code]??meanings.UNKNOWN)+'；没有将该模型标记为实测成功'};
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);
  }
 }
 function setEnabled(id,enabled){
   if(typeof enabled!=='boolean'){const e=new Error('enabled must be boolean');e.status=400;throw e}
   const {cfg}=find(id);
   const next={...cfg,accounts:cfg.accounts.map(a=>a.id===id?{...a,enabled}:a)};
   configStore.replace(next);
    if(!enabled){checks.delete(id);inferenceProof.delete(id);inferenceFailures.delete(id);
      try{verificationStore?.forget?.(id)}catch{}}
    adapter?.invalidateCatalog?.();
   return {id,enabled,changed:true};
 }
 async function logout(id){
   const {cfg,account,provider,driver}=find(id);
   const references=cfg.routes.filter(route=>route.tiers.some(tier=>tier.accountIds?.includes(id))).map(route=>route.id);
   if(references.length){const e=new Error('账号被模型链条引用：'+references.join(', ')+'；先在链条中移除引用再退出');e.status=409;throw e}
   if(pending.has(id)){const e=new Error('Account operation already in progress');e.status=409;throw e}
   let outcome=null;
   if(typeof driver?.logout==='function'){
     pending.add(id);
     try{outcome=await driver.logout({provider,account})}finally{pending.delete(id)}
   }
    // Explicit logout always wins over stale independent source-pack sessions,
    // even when the account was never imported via session reuse. AutoFree
    // cannot re-create a private account the owner intentionally detached.
    configStore.replace({...cfg,accounts:cfg.accounts.filter(a=>a.id!==id),
      sessionReuse:{...cfg.sessionReuse,
        linkedIds:(cfg.sessionReuse?.linkedIds??[]).filter(x=>x!==id),
        ignoredIds:[...new Set([...(cfg.sessionReuse?.ignoredIds??[]),id])].slice(-200)}});
    checks.delete(id);inferenceProof.delete(id);inferenceFailures.delete(id);
    try{verificationStore?.forget?.(id)}catch{}
    try{publicFactsStore?.forget?.(account)}catch{}
    adapter?.invalidateCatalog?.();
   return {id,detached:true,revokedUpstream:outcome?.revokedUpstream===true,
      message:outcome?.revokedUpstream===true?'已确认撤销渠道授权并解除插件关联':
        '已解除插件账号引用；外部登录态或上游凭据未确认撤销'};
 }
 async function discover(providerId){
   const cfg=configStore.get(),provider=cfg.providers.find(p=>p.id===providerId);
   const driver=driverFor(providerId);
   // A self-owned Desktop session can be discovered before provider creation.
   const bootstrap=!provider&&providerId==='own_mimo_desktop'
     &&driver?.independentProvider===providerId;
   if((!provider&&!bootstrap)||provider?.protocol==='dsh-host'||!driver?.discover){const e=new Error('此渠道未提供经过验证的本机账号发现适配器');e.status=501;throw e}
   const candidates=await driver.discover({provider:provider??{
     id:providerId,name:driver.providerName,protocol:'native-channel'}});
   if(!Array.isArray(candidates))throw Error('Discovery adapter returned invalid candidates');
   // No secrets or filesystem details are handed to the browser.
   const publicCandidates=candidates.slice(0,50).map(row=>({
      id:String(row.id??'').slice(0,80),
      label:publicAccountName({label:row.label})||'名称待获取',
     source:String(row.source??'').slice(0,80),requiresConsent:true,
   }));
   discoverCache.set(providerId,{at:now(),ids:new Set(publicCandidates.map(x=>x.id))});
   return {providerId,candidates:publicCandidates,imported:0};
 }
 async function importCandidate(providerId,candidateId){
   if(typeof candidateId!=='string'||candidateId.length>100){const e=new Error('Invalid candidateId');e.status=400;throw e}
   const cache=discoverCache.get(providerId);
   if(!cache||now()-cache.at>10*60*1000||!cache.ids.has(candidateId)){
     const e=new Error('候选账号尚未在本轮发现，或确认窗口已过期；请重新扫描');e.status=409;throw e;
   }
   const cfg=configStore.get(),provider=cfg.providers.find(p=>p.id===providerId);
   const driver=driverFor(providerId);
   const bootstrap=!provider&&providerId==='own_mimo_desktop'
     &&driver?.independentProvider===providerId;
   if((!provider&&!bootstrap)||(provider&&provider.protocol!=='native-channel'&&bootstrap)
     ||typeof driver?.importCandidate!=='function'){
     const e=new Error('渠道未提供安全的账号导入驱动');e.status=501;throw e;
   }
    // A reference to another DSH plugin's account pool is NOT an independent
    // takeover. Keep discovery read-only; users must explicitly migrate the
    // credential into own_* via account-adoption or log in here directly.
    if(candidateId.startsWith('sp_')&&!providerId.startsWith('own_')){
      const e=new Error('仅发现来源账号，不能以旧插件引用冒充独立接管；请使用账号接管或在本插件自主登录');
      e.status=409;throw e;
    }
    const result=await driver.importCandidate({provider,candidateId,consent:true});
   if(!result||typeof result!=='object'||typeof result.id!=='string'||
     typeof result.credentialRef!=='string'||!result.credentialRef.startsWith('driver:'+providerId+':')){
     throw new Error('渠道导入返回无效的凭据引用，已拒绝写入');
   }
   if(cfg.accounts.some(a=>a.id===result.id||a.credentialRef===result.credentialRef)){
     const e=new Error('账号已存在，不重复导入');e.status=409;throw e;
   }
   const newAccount={id:result.id,providerId,credentialRef:result.credentialRef,
     enabled:true,autoCheckin:false,weight:1};
   const providers=bootstrap?[...cfg.providers,{id:providerId,
     name:driver.providerName,protocol:'native-channel',enabled:true,
     models:[...(driver.candidateModels??[])],supportsTools:true}]:cfg.providers;
   try{configStore.replace({...cfg,providers,accounts:[...cfg.accounts,newAccount]})}
   catch(error){await driver?.rollbackCandidate?.({account:newAccount});throw error}
   adapter?.invalidateCatalog?.();
   // Preserve the remaining independently approved discovery candidates:
   // importing one account must not force rescanning the entire channel pool.
   cache.ids.delete(candidateId);
   if(cache.ids.size===0)discoverCache.delete(providerId);
    scheduleFirstAuthentication(newAccount.id);
    return {id:newAccount.id,providerId,enabled:true,
     message:'已接入并启用原有授权引用；首次鉴权已排队，模型调用仍需独立确认'};
 }
 function scheduleFirstAuthentication(id){
   setImmediate(()=>{
     if(disposed||!automaticTimer)return;
     try{
       const {account,provider,driver}=find(id);
       if(!account.enabled||!provider.enabled||verificationWithinPeriod(storedFor(account),now(),autoVerifyMs)
         ||pending.has(id)||readOnlyPending.has(id))return;
       const operation=typeof driver?.refreshAccountStatus==='function'
         ?refreshReadOnly({accountId:id}):verify(id);
       void operation.catch(()=>{});
     }catch{}
   });
 }
 async function refreshAll({providerIds,skipVerified=false}={}){
   const allowed=providerIds===undefined?null:new Set(providerIds);
   const eligible=list().accounts.filter(a=>a.enabled&&a.refreshAvailable&&(!allowed||allowed.has(a.providerId)));
   const ids=eligible.filter(a=>!skipVerified||a.connectionState!=='online').map(a=>a.id);
   const results=[];
   for(const id of ids){try{results.push(await verify(id))}catch(e){results.push({id,state:'error',message:publicAccountFailureMessage(e)})}}
   return {attempted:ids.length,skipped:eligible.length-ids.length,results};
 }

 // A normal completed native route is real inference evidence too. Keep
 // exact account binding and authorization checks, and never store response
 // bodies, prompts, credentials, or route identifiers in the proof cache.
 function observeRoutedInference({account,provider,model,output,failure,signal}={}){
   if(disposed||signal?.aborted||provider?.protocol!=='native-channel'||
      !account||runtimeMode(account)!=='owned'||!stillAuthorizedAccount({account,provider})||
      typeof model!=='string'||!model.trim()||model.length>120||/[\u0000-\u001f]/.test(model))return false;
   const at=now();
   if(output){
     const complete=output.finishReason==='stop'&&typeof output.text==='string'&&Boolean(output.text.trim())
       ||output.finishReason==='tool_calls'&&Array.isArray(output.toolCalls)&&output.toolCalls.length>0;
     if(!complete)return false;
     const status={state:'online',at,bindingRef:account.credentialRef,
       message:'已完成聚合路由真实模型调用'};
     checks.set(account.id,status);
     inferenceProof.set(account.id,{at,credentialRef:account.credentialRef,modelId:model});
     inferenceFailures.delete(account.id);
     try{verificationStore?.set?.(account,status);verificationStore?.setModelTest?.(account,{at,modelId:model})}catch{}
     return true;
   }
   const code=failure?.code;
   if(!['AUTH','CREDENTIAL','QUOTA','RATE_LIMIT','STREAM_CLOSED','TRANSPORT','SERVER','TIMEOUT','TOOL_PROTOCOL','EMPTY'].includes(code))return false;
   const previous=inferenceProof.get(account.id)??verificationStore?.getModelTest?.(account);
   if(previous?.modelId&&previous.modelId!==model&&!['AUTH','CREDENTIAL','QUOTA'].includes(code))return false;
   inferenceProof.delete(account.id);
   inferenceFailures.set(account.id,{at,credentialRef:account.credentialRef});
   try{verificationStore?.setModelTestFailure?.(account,{at})}catch{}
   return true;
 }
 async function autoCheckDue(){
  if(disposed||autoBusy)return {attempted:0};
  autoBusy=true;let attempted=0;
  try{
   const cfg=configStore.get(),linked=new Set(cfg.sessionReuse?.linkedIds??[]);
   // Only previously checked or explicitly adopted accounts; no host shadow
   // accounts, no inference calls, no original-plugin login or logout.
   for(const account of cfg.accounts){
    if(disposed||attempted>=20)break;
    const provider=cfg.providers.find(p=>p.id===account.providerId);
    if(!account.enabled||provider?.enabled!==true||provider.protocol==='dsh-host'
      ||(!linked.has(account.id)&&!account.providerId.startsWith('own_')
        &&!storedFor(account)))continue;
    const driver=driverFor(account.providerId);
    if(typeof driver?.refresh!=='function'
      &&!['openai-chat','anthropic-messages'].includes(provider.protocol))continue;
    // Cordis native source adapters attach asynchronously after this plugin
    // starts. A not-yet-mounted PRIVATE pack is not an authentication failure:
    // defer the verification and preserve the last known bound status.
    if(driver?.isSourceBridge===true&&driver.runtimeReady!==true)continue;
    const last=storedFor(account),fresh=verificationWithinPeriod(last,now(),autoVerifyMs);
    const cacheKey=account.id+'\0'+account.credentialRef;
    if(pending.has(account.id)||
       readOnlyPending.get(account.id)?.credentialRef===account.credentialRef)continue;
    // Persistent verification proves an earlier login, but the driver snapshot
    // is memory-only. Without this one-time hydration, the whole page shows
    // "account 1 / balance unknown" after every DSH restart for up to 30 min.
    if(fresh){
     let facts={};
     try{facts=driver?.accountSnapshot?.(account)??{}}catch{}
     const named=Boolean(publicAccountName(facts)||publicMaskedPhone(facts));
     const metadataIncomplete=!named||Boolean(publicFactsStore&&!publicFactsStore.get(account)?.observation)||
       ['own_mimo_desktop','own_doubao'].includes(account.providerId)
       && !Number.isFinite(facts.balance)&&
          facts.membershipState===undefined&&
          facts.balanceState!=='not_supported'&&
          facts.balanceState!=='not_returned';
     const lastWarmup=profileWarmup.get(cacheKey)??0;
     if(typeof driver?.accountSnapshot==='function'&&metadataIncomplete&&
        (lastWarmup===0||now()-lastWarmup>=autoVerifyMs)){
      profileWarmup.set(cacheKey,now());
      attempted++;
      try{await verify(account.id)}catch{}
     }
     continue;
    }
     attempted++;
     try{await verify(account.id)}catch{}
    }
   }finally{autoBusy=false}
  return {attempted};
 }
   async function refreshReadOnly({force=false,accountId=null}={}){
     const cfg=configStore.get();
     const targets=cfg.accounts.filter(account=>{
       const p=cfg.providers.find(row=>row.id===account.providerId);
       return account.enabled&&p?.enabled===true
         &&(accountId===null||account.id===accountId)
         &&typeof driverFor(account.providerId)?.refreshAccountStatus==='function';
     }).slice(0,120);
     const results=new Array(targets.length);
     let cursor=0;
     // Bounded parallelism avoids N * timeout UI stalls and a burst of
     // upstream checks. Errors are isolated to the affected account.
     async function worker(){
       while(cursor<targets.length&&!disposed){
          const at=cursor++,account=targets[at];
          if(pending.has(account.id)){results[at]={state:'busy',authVerified:false};continue;}
          const driver=driverFor(account.providerId);
          const previous=storedFor(account);
          // A persisted ONLINE proof is not a persisted profile or quota.
          // After each Host restart, every native owned account starts with
          // an empty in-memory snapshot; skipping this request caused
          // "官方未返回" indefinitely despite a valid authenticated session.
          let snapshot={};
          try{snapshot=driver?.accountSnapshot?.(account)??{}}catch{}
          const hydrated=Number.isFinite(snapshot.profileCheckedAt)||
            Number.isFinite(snapshot.verifiedAt)||
            Number.isFinite(snapshot.balanceCheckedAt)||
            Number.isFinite(snapshot.quotaCheckedAt)||
            Number.isFinite(snapshot.usageCheckedAt)||
            Number.isFinite(snapshot.checkedAt);
          const binding=account.id+'\0'+account.credentialRef;
          const lastWarmup=profileWarmup.get(binding)??0;
          // A quota refresh timestamp cannot prove the profile nickname was
          // recovered. Recheck incomplete public identity once per normal
          // verification period, not on every accounts-page navigation.
          const named=Boolean(publicAccountName(snapshot,account)||publicMaskedPhone(snapshot));
          const needsProfileHydration=previous?.state==='online'&&
            typeof driver?.accountSnapshot==='function'&&(!hydrated||!named||
               Boolean(publicFactsStore&&!publicFactsStore.get(account)?.observation))&&
            (!lastWarmup||now()-lastWarmup>=autoVerifyMs);
          if(!force&&verificationWithinPeriod(previous,now(),autoVerifyMs)
              &&!needsProfileHydration){
            results[at]={state:previous.state,checkedAt:previous.checkedAt,
              authVerified:previous.state==='online',cached:true};
            continue;
          }
          if(needsProfileHydration)profileWarmup.set(binding,Math.max(1,now()));
          const active=readOnlyPending.get(account.id);
          if(active?.credentialRef===account.credentialRef){
            results[at]=await active.promise;
            continue;
          }
          const request=(async()=>{
            const controller=new AbortController();
            let timeout;
            try{
              const remote=await Promise.race([
                Promise.resolve().then(()=>driverFor(account.providerId)
                  .refreshAccountStatus({account,force,signal:controller.signal})),
                new Promise(resolve=>{timeout=setTimeout(()=>{
                  controller.abort();resolve({state:'unavailable'});
                },Math.min(30000,Math.max(10,readOnlyTimeoutMs)));}),
              ]);
              // Only an explicit per-account official authentication decision
              // updates the durable status: positive auth, or a definitive
              // credential expiration. Transport outages, catalog metadata and
              // missing accounts are NOT proof that login was revoked.
              const positive=remote?.authVerified===true
                &&['ready','online'].includes(remote?.state);
              const expired=remote?.authVerified===false&&remote?.state==='expired';
              if(!disposed&&!controller.signal.aborted&&!pending.has(account.id)
                &&(positive||expired)){
                const current=configStore.get(),bound=current.accounts.find(x=>x.id===account.id
                  &&x.providerId===account.providerId&&x.credentialRef===account.credentialRef
                  &&x.enabled===true);
                if(bound&&current.providers.some(x=>x.id===account.providerId&&x.enabled===true)){
                  if(positive)observeRefreshedFacts(account,driver,now());
                  const previous=checkFor(account),state=positive?'online':'expired';
                  // A manual successful refresh must start a NEW absolute
                  // cycle; otherwise the old deadline causes a duplicate
                  // auto-probe minutes later. Negative status uses its own
                  // shorter persisted retry period.
                  if(force||previous.state!==state||
                    !verificationWithinPeriod(storedFor(account),now(),autoVerifyMs)){
                    const at=now(),proof={state,at,bindingRef:account.credentialRef,
                      message:positive?'本账号官方只读接口确认授权仍然有效':
                        '本账号官方接口明确确认授权已过期'};
                    checks.set(account.id,proof);
                    try{verificationStore?.set?.(account,proof)}catch{}
                    if(previous.state!==state)adapter?.invalidateCatalog?.();
                  }
                }
              }
              return remote;
            }catch{return {state:'unavailable'}}
            finally{clearTimeout(timeout)}
          })();
          readOnlyPending.set(account.id,{credentialRef:account.credentialRef,promise:request});
          try{results[at]=await request}
          finally{
            if(readOnlyPending.get(account.id)?.promise===request)
              readOnlyPending.delete(account.id);
          }       }
     }
      await Promise.all(Array.from({length:Math.min(
        Math.max(1,readOnlyConcurrency),12,targets.length)},()=>worker()));
     return results.filter(Boolean);
   }
    // A completed browser membership login is NOT yet configured until its
    // independently owned vault receipt has been atomically bound to config.
    async function commitMimoDesktopAccount(receipt){
      const id=String(receipt?.id??'');
      if(receipt?.providerId!=='own_mimo_desktop'||!/^sp_[a-f0-9]{24}$/.test(id)
        ||receipt.credentialRef!=='driver:own_mimo_desktop:'+id)
        throw Error('Invalid MiMo membership account receipt');
      const cfg=configStore.get(),previous=cfg.accounts.find(x=>x.id===id);
      if(previous){
        if(previous.providerId!=='own_mimo_desktop'||previous.credentialRef!==receipt.credentialRef)
          throw Error('MiMo membership binding conflict');
        return {id,providerId:'own_mimo_desktop',alreadyOwned:true};
      }
      if(cfg.providers.some(x=>x.id==='own_mimo_desktop'&&x.protocol!=='native-channel'))
        throw Error('MiMo membership provider ID conflict');
      const driver=driverFor('own_mimo_desktop');
      if(driver?.independentProvider!=='own_mimo_desktop')throw Error('MiMo owner driver unavailable');
      const providers=cfg.providers.some(x=>x.id==='own_mimo_desktop')?cfg.providers:
        [...cfg.providers,{id:'own_mimo_desktop',name:driver.providerName,
          protocol:'native-channel',models:[...(driver.candidateModels??[])],
          enabled:true,supportsTools:true}];
      const account={id,providerId:'own_mimo_desktop',credentialRef:receipt.credentialRef,
        enabled:true,autoCheckin:false,weight:1};
      try{configStore.replace({...cfg,providers,accounts:[...cfg.accounts,account]})}
      catch(error){if(receipt.alreadyOwned!==true)
         await driver.rollbackCandidate?.({account});throw error}
      adapter?.invalidateCatalog?.();
      scheduleFirstAuthentication(id);
       return {id,providerId:'own_mimo_desktop',stored:true};
    }
    async function startMimoLogin({region='cn'}={}){
      const driver=driverFor('own_mimo_desktop');
       if(driver?.independentProvider!=='own_mimo_desktop'||driver.runtimeReady!==true
         ||typeof driver.startLogin!=='function')
        throw Error('MiMo membership browser login unavailable');
      return driver.startLogin({region});
    }
     async function pollMimoLogin(){
       const driver=driverFor('own_mimo_desktop'),status=driver?.loginStatus?.();
       if(!status)throw Error('MiMo browser login status unavailable');
       if(status.status!=='done'||!status.account)return status;
       try{return {...status,account:await commitMimoDesktopAccount(status.account)}}
       catch(error){
         try{await driver.cancelLogin?.()}catch{}
         throw error;
       }
     }
     async function cancelMimoLogin(){
       return await driverFor('own_mimo_desktop')?.cancelLogin?.()??{status:'idle'};
     }
    function ensureDoubaoProvider(){
      const cfg=configStore.get(),provider=cfg.providers.find(p=>p.id==='own_doubao');
      if(provider){
        if(provider.protocol!=='native-channel')throw Error('Doubao provider ID collides with non-native provider');
        return {state:'existing',providerId:'own_doubao'};
      }
      if(typeof driverFor('own_doubao')?.generate!=='function')throw Error('Doubao native adapter unavailable');
      configStore.replace({...cfg,providers:[...cfg.providers,{
        id:'own_doubao',name:'豆包工作 · 独立来源',
        protocol:'native-channel',baseUrl:'',models:[],enabled:true,supportsTools:false}]});
      adapter?.invalidateCatalog?.();
      return {state:'created',providerId:'own_doubao'};
    }
    async function commitDoubaoAccount(result){
      if(result?.providerId!=='own_doubao'||typeof result.id!=='string'
        ||!/^db_[a-f0-9]{28}$/.test(result.id)||
          result.credentialRef!=='driver:own_doubao:'+result.id)
        throw Error('Invalid self-owned Doubao account receipt');
      const cfg=configStore.get();
      const prev=cfg.accounts.find(x=>x.id===result.id);
      if(prev){
        if(prev.providerId!=='own_doubao'||prev.credentialRef!==result.credentialRef)
          throw Error('Doubao account identifier conflict');
        driverFor('own_doubao')?.completeCandidate?.({account:result});
        return {id:prev.id,alreadyOwned:true};
      }
      if(cfg.providers.some(p=>p.id==='own_doubao'&&p.protocol!=='native-channel'))
        throw Error('Doubao provider ID conflict');
      const providers=cfg.providers.some(p=>p.id==='own_doubao')?cfg.providers:
        [...cfg.providers,{id:'own_doubao',name:'豆包工作 · 独立来源',
          protocol:'native-channel',baseUrl:'',models:[],enabled:true,supportsTools:false}];
      const account={id:result.id,providerId:'own_doubao',credentialRef:result.credentialRef,
        enabled:true,autoCheckin:false,weight:1};
       try{configStore.replace({...cfg,providers,accounts:[...cfg.accounts,account]})}
       catch(error){
         await driverFor('own_doubao')?.rollbackCandidate?.({account:{
           ...account,alreadyOwned:result.alreadyOwned===true,
           ...(result.rollbackToken?{rollbackToken:result.rollbackToken}:{})}});
         throw error;
       }
      driverFor('own_doubao')?.completeCandidate?.({account:result});
      adapter?.invalidateCatalog?.();
      scheduleFirstAuthentication(result.id);
       return {id:result.id,providerId:'own_doubao',stored:true};
    }
     async function addDoubaoCookie({cookie}={}){
       const driver=driverFor('own_doubao');
       if(typeof driver?.addCookie!=='function')throw Error('Doubao native adapter unavailable');
       const receipt=await driver.addCookie({cookie,stageRollback:true});
       try{return await commitDoubaoAccount(receipt)}
       catch(error){
         // Includes collisions rejected before configStore.replace() was called.
         try{await driver.rollbackCandidate?.({account:receipt})}catch{}
         throw error;
       }
     }
    async function startDoubaoLogin(){
      const driver=driverFor('own_doubao');
      if(driver?.runtimeReady!==true||typeof driver.startLogin!=='function')
        throw Error('Doubao browser login unavailable without its owned credentials');
      // Do not create a configured account/provider merely because a login window opened.
      return driver.startLogin();
    }
     async function pollDoubaoLogin(){
       const driver=driverFor('own_doubao');
       const status=driver?.loginStatus?.();
       if(!status)throw Error('Doubao login service unavailable');
       if(status.status!=='done'||!status.account)return status;
       try{return {...status,account:await commitDoubaoAccount(status.account)}}
       catch(error){
         try{await driver.cancelLogin?.()}catch{}
         throw error;
       }
     }
     async function cancelDoubaoLogin(){
       return await driverFor('own_doubao')?.cancelLogin?.()??{status:'idle'};
     }
    async function commitMeooAccount(result){
      if(result?.providerId!=='own_meoo_web'||typeof result.id!=='string'
        ||!/^mw_[a-f0-9]{28}$/.test(result.id)
        ||result.credentialRef!=='driver:own_meoo_web:'+result.id)
        throw Error('Invalid Meoo-owned account receipt');
      const cfg=configStore.get(),prior=cfg.accounts.find(x=>x.id===result.id),
        driver=driverFor('own_meoo_web');
      if(prior){
        if(prior.providerId!=='own_meoo_web'||prior.credentialRef!==result.credentialRef)
          throw Error('Meoo account ownership conflict');
        driver?.completeCandidate?.({account:result});
        return {id:prior.id,providerId:'own_meoo_web',alreadyOwned:true};
      }
      if(cfg.providers.some(x=>x.id==='own_meoo_web'&&x.protocol!=='native-channel'))
        throw Error('Meoo provider ID is owned by another adapter');
      const providers=cfg.providers.some(x=>x.id==='own_meoo_web')?cfg.providers:
        [...cfg.providers,{id:'own_meoo_web',name:'秒悟网页版 · 独立会员',
          protocol:'native-channel',baseUrl:'',models:[],enabled:true,supportsTools:false}];
      const account={id:result.id,providerId:'own_meoo_web',
        credentialRef:result.credentialRef,enabled:true,autoCheckin:false,weight:1};
      try{configStore.replace({...cfg,providers,accounts:[...cfg.accounts,account]})}
      catch(error){
        await driver?.rollbackCandidate?.({account:{...account,
          alreadyOwned:result.alreadyOwned===true,
          ...(result.rollbackToken?{rollbackToken:result.rollbackToken}:{})}});
        throw error;
      }
      driver?.completeCandidate?.({account:result});
      adapter?.invalidateCatalog?.();
      scheduleFirstAuthentication(account.id);
       return {id:account.id,providerId:'own_meoo_web',stored:true};
    }
     async function addMeooCookie({cookie}={}){
       const driver=driverFor('own_meoo_web');
       if(driver?.runtimeReady!==true||typeof driver.addCookie!=='function')
         throw Error('Meoo persistent credential vault unavailable');
       const receipt=await driver.addCookie({cookie,stageRollback:true});
       try{return await commitMeooAccount(receipt)}
       catch(error){
         // Never leave an unconfigured private cookie after a Provider conflict.
         try{await driver.rollbackCandidate?.({account:receipt})}catch{}
         throw error;
       }
     }
    async function startMeooLogin(){
      const driver=driverFor('own_meoo_web');
      if(driver?.runtimeReady!==true||typeof driver.startLogin!=='function')
        throw Error('Meoo member browser login unavailable');
      return driver.startLogin();
    }
     async function pollMeooLogin(){
       const driver=driverFor('own_meoo_web');
       const status=driver?.loginStatus?.();
       if(!status)throw Error('Meoo login status unavailable');
       if(status.status!=='done'||!status.account)return status;
       try{return {...status,account:await commitMeooAccount(status.account)}}
       catch(error){
         // A failed config write already rolled back the staged vault record.
         // Invalidate the cached "done" receipt so polling cannot recreate an
         // account row whose secret has been removed.
         try{await driver.cancelLogin?.()}catch{}
         throw error;
       }
     }
     async function cancelMeooLogin(){
       return await driverFor('own_meoo_web')?.cancelLogin?.()??{status:'idle'};
     }
    async function commitQwenAccount(receipt){
      if(receipt?.providerId!=='own_qwenwork'||!/^qw_[a-f0-9]{28}$/.test(String(receipt.id??''))
        ||receipt.credentialRef!=='driver:own_qwenwork:'+receipt.id)
        throw Error('Invalid QwenWork member receipt');
      const cfg=configStore.get(),previous=cfg.accounts.find(a=>a.id===receipt.id),
        driver=driverFor('own_qwenwork');
      if(previous){
        if(previous.providerId!=='own_qwenwork'||previous.credentialRef!==receipt.credentialRef)
          throw Error('QwenWork member identity conflict');
        driver?.completeCandidate?.({account:receipt});
        return {id:previous.id,providerId:'own_qwenwork',alreadyOwned:true};
      }
      if(cfg.providers.some(x=>x.id==='own_qwenwork'&&x.protocol!=='native-channel'))
        throw Error('QwenWork provider is foreign');
      const providers=cfg.providers.some(x=>x.id==='own_qwenwork')?cfg.providers:
        [...cfg.providers,{id:'own_qwenwork',name:'千问办公 · 独立自有账号',
          protocol:'native-channel',baseUrl:'',models:[],enabled:true,supportsTools:false}];
      const account={id:receipt.id,providerId:'own_qwenwork',
        credentialRef:receipt.credentialRef,enabled:true,autoCheckin:false,weight:1};
      try{configStore.replace({...cfg,providers,accounts:[...cfg.accounts,account]})}
      catch(error){
        await driver?.rollbackCandidate?.({account:{...account,
          ...(receipt.rollbackToken?{rollbackToken:receipt.rollbackToken}:{})}});
        throw error;
      }
      driver?.completeCandidate?.({account:receipt});
      adapter?.invalidateCatalog?.();
      scheduleFirstAuthentication(account.id);
       return {id:account.id,providerId:'own_qwenwork',stored:true};
    }
    function startQwenLogin(){
      const driver=driverFor('own_qwenwork');
      if(driver?.runtimeReady!==true||typeof driver.startLogin!=='function')
        throw Error('QwenWork PKCE device grant unavailable');
      return driver.startLogin();
    }
     async function pollQwenLogin(){
       const driver=driverFor('own_qwenwork');
       if(typeof driver?.pollLogin!=='function')throw Error('QwenWork device polling unavailable');
       const status=await driver.pollLogin();
       if(status.status!=='done'||!status.account)return status;
       try{return {...status,account:await commitQwenAccount(status.account)}}
       catch(error){
         // Never expose a stale completed OAuth receipt after rollback.
         try{await driver.cancelLogin?.()}catch{}
         throw error;
       }
     }
    async function cancelQwenLogin(){
      return await driverFor('own_qwenwork')?.cancelLogin?.()??{status:'idle'};
    }
    // One-off local session adoption or browser OAuth. No Magpie runtime and
    // no AWS commercial API access key; DSH owns the binding and refresh.
    async function commitAwsQuickAccount(receipt){
      const id=String(receipt?.id??''),pid='own_aws_quick';
      if(receipt?.providerId!==pid||!/^aq_[a-f0-9]{28}$/.test(id)||
         receipt.credentialRef!=='driver:'+pid+':'+id)
        throw Error('Invalid Amazon Quick owner receipt');
      const cfg=configStore.get(),driver=driverFor(pid);
      if(driver?.independentProvider!==pid)throw Error('Amazon Quick native driver unavailable');
      const previous=cfg.accounts.find(a=>a.id===id);
      if(previous){
        if(previous.providerId!==pid||previous.credentialRef!==receipt.credentialRef)
          throw Error('Amazon Quick owner account collision');
        driver.completeCandidate?.({account:receipt});
        return {id,providerId:pid,alreadyOwned:true};
      }
      if(cfg.providers.some(p=>p.id===pid&&p.protocol!=='native-channel'))
        throw Error('Amazon Quick Provider ID already belongs to another protocol');
      const providers=cfg.providers.some(p=>p.id===pid)?cfg.providers:
        [...cfg.providers,{id:pid,name:'Amazon Quick · 独立自有会员',
          protocol:'native-channel',models:[],enabled:true,supportsTools:true}];
      const account={id,providerId:pid,credentialRef:receipt.credentialRef,
        enabled:true,autoCheckin:false,weight:1};
      try{configStore.replace({...cfg,providers,accounts:[...cfg.accounts,account]})}
      catch(error){
        await driver.rollbackCandidate?.({account:{...account,
          ...(receipt.rollbackToken?{rollbackToken:receipt.rollbackToken}:{})}});
        throw error;
      }
      driver.completeCandidate?.({account:receipt});
      adapter?.invalidateCatalog?.();
      scheduleFirstAuthentication(id);
       return {id,providerId:pid,stored:true};
    }
    async function importAwsQuickLocal(){
      const driver=driverFor('own_aws_quick');
      if(driver?.runtimeReady!==true||typeof driver.importLocal!=='function')
        throw Error('Amazon Quick private vault unavailable');
      const staged=await driver.importLocal();
      try{return await commitAwsQuickAccount(staged)}
      catch(error){await driver.rollbackCandidate?.({account:staged});throw error}
    }
    async function startAwsQuickLogin(){
      const driver=driverFor('own_aws_quick');
      if(driver?.runtimeReady!==true||typeof driver.startLogin!=='function')
        throw Error('Amazon Quick OAuth unavailable');
      return driver.startLogin();
    }
    async function pollAwsQuickLogin(){
      const driver=driverFor('own_aws_quick');
      if(!driver?.pollLogin)throw Error('Amazon Quick login status unavailable');
      const status=await driver.pollLogin();
      if(status.status!=='done'||!status.account)return status;
      try{return {...status,account:await commitAwsQuickAccount(status.account)}}
      catch(error){try{await driver.cancelLogin?.()}catch{}throw error}
    }
    async function submitAwsQuickLogin({callbackUrl}={}){
      const driver=driverFor('own_aws_quick');
      if(typeof driver?.submitLogin!=='function')throw Error('Amazon Quick callback unavailable');
      return driver.submitLogin({callbackUrl});
    }
    async function cancelAwsQuickLogin(){
      return await driverFor('own_aws_quick')?.cancelLogin?.()??{status:'idle'};
    }
    function start(){
      // Runtime startup must NEVER consult original-plugin files, metadata or
      // account pools. One-time migration belongs to explicit adoption only.
  if(disposed||automaticTimer)return stop;
  // A cheap local eligibility check each minute allows failed startup probes
  // to recover at their shorter bounded retry interval. Actual network
  // requests still obey the per-account cooldown above.
  automaticTimer=setInterval(()=>void autoCheckDue().catch(()=>{}),60000);
  automaticTimer.unref?.();
   initialTimer=setTimeout(()=>{initialTimer=null;void autoCheckDue().catch(()=>{});
     void refreshReadOnly().catch(()=>{});},5000);
  initialTimer.unref?.();
  return stop;
 }
 function stop(){
  disposed=true;
  if(automaticTimer)clearInterval(automaticTimer);
  if(initialTimer)clearTimeout(initialTimer);
  automaticTimer=null;initialTimer=null;
 }
  return {list,verify,verifyModel,listTestModels,observeRoutedInference,setEnabled,logout,discover,importCandidate,refreshAll,refreshReadOnly,autoCheckDue,start,stop,drivers,driverFor,find,commitMimoDesktopAccount,startMimoLogin,pollMimoLogin,cancelMimoLogin,ensureDoubaoProvider,addDoubaoCookie,startDoubaoLogin,pollDoubaoLogin,cancelDoubaoLogin,commitMeooAccount,addMeooCookie,startMeooLogin,pollMeooLogin,cancelMeooLogin,commitQwenAccount,startQwenLogin,pollQwenLogin,cancelQwenLogin,commitAwsQuickAccount,importAwsQuickLocal,startAwsQuickLogin,pollAwsQuickLogin,submitAwsQuickLogin,cancelAwsQuickLogin};
}
