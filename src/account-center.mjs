import {resolveCredential} from './accounts.mjs';
import {describeChannels,automaticPools} from './channels.mjs';

const MAX_PROBE_MS=15000;
function concise(message){return String(message??'').replace(/(?:Bearer\s+|sk-)[\w.~+-]{12,}/gi,'[REDACTED]').slice(0,160)}
function accountNotFound(id){const e=new Error('Account not configured: '+String(id).slice(0,80));e.status=404;return e}
export function createAccountCenter({
 configStore,adapter,drivers=new Map(),fetchImpl=fetch,env=process.env,vault,now=()=>Date.now(),
 getSourceStatus=()=>({state:'unavailable'}),
}={}){
  if(!configStore?.get||!configStore?.replace)throw Error('ConfigStore must support get and replace');
  const checks=new Map(),pending=new Set(),discoverCache=new Map();
 const driverFor=providerId=>drivers instanceof Map?drivers.get(providerId):drivers?.[providerId];
 function originOf(account,cfg){
  const ref=account.credentialRef,linked=cfg.sessionReuse?.linkedIds?.includes(account.id)===true;
  if(ref==='driver:workbuddy:'+account.id&&account.id.startsWith('wb_'))
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
 function list(){
   const cfg=configStore.get(),registered=describeChannels(cfg,drivers instanceof Map?drivers:new Map(Object.entries(drivers??{})));
   return {
     channels:registered.map(channel=>{
       const accounts=cfg.accounts.filter(a=>a.providerId===channel.id);
       return {...channel,providerEnabled:cfg.providers.find(p=>p.id===channel.id)?.enabled??false,
         totalAccounts:accounts.length,enabledAccounts:accounts.filter(a=>a.enabled).length};
     }),
     accounts:cfg.accounts.map(account=>{
       const provider=cfg.providers.find(p=>p.id===account.providerId);
       const driver=driverFor(provider.id);
       const check=checks.get(account.id)??{state:'not_checked',at:null,message:'未执行连接验证'};
       return {id:account.id,providerId:account.providerId,providerName:provider.name,
         enabled:account.enabled&&provider.enabled,configuredEnabled:account.enabled,weight:account.weight,
          reusedExistingSession:cfg.sessionReuse?.linkedIds?.includes(account.id)===true,
          origin:originOf(account,cfg),
          credentialKind:account.credentialRef.startsWith('env:')?'env':account.credentialRef.startsWith('driver:')?'driver':'host',
         checkedAt:check.at,connectionState:!account.enabled?'disabled':!provider.enabled?'provider_disabled':check.state,
         message:!account.enabled?'此账号已停用':!provider.enabled?'所属渠道已停用':check.message,
         busy:pending.has(account.id),loginAvailable:!!driver?.login||['openai-chat','anthropic-messages'].includes(provider.protocol),
         refreshAvailable:!!driver?.refresh||['openai-chat','anthropic-messages'].includes(provider.protocol),
         checkinAvailable:typeof driver?.checkIn==='function',
       };
     }),
     pools:automaticPools(cfg,checks),
     checkedAt:now(),
   };
 }
 function find(id){
   const cfg=configStore.get(),account=cfg.accounts.find(a=>a.id===id);
   if(!account)throw accountNotFound(id);
   const provider=cfg.providers.find(p=>p.id===account.providerId);
   if(!provider)throw Error('Account provider not configured');
   return {account,provider,cfg,driver:driverFor(provider.id)};
 }
 async function basicProbe({account,provider}){
   const token=await resolveCredential(account,{env,vault});
   const headers=provider.protocol==='anthropic-messages'
     ?{'x-api-key':token,'anthropic-version':'2023-06-01'}
     :{authorization:'Bearer '+token};
   const url=provider.baseUrl+'/models';
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.min(provider.timeoutMs??MAX_PROBE_MS,MAX_PROBE_MS));
   try{
     const result=await fetchImpl(url,{method:'GET',headers,signal:controller.signal});
     if(!result?.ok){
       if(result.status===401||result.status===403)return {state:'expired',message:'鉴权失败（HTTP '+result.status+'），请核对凭据'};
       if(result.status===429)return {state:'limited',message:'上游暂时限流（HTTP 429）'};
       return {state:'error',message:'模型目录检测失败（HTTP '+Number(result.status||0)+'），并不代表模型推理不可用'};
     }
     return {state:'online',message:'已通过上游模型目录鉴权验证'};
   }finally{clearTimeout(timeout)}
 }
 async function verify(id,{login=false}={}){
   if(pending.has(id)){const e=new Error('Account operation already in progress');e.status=409;throw e}
   const entry=find(id);
   if(!entry.account.enabled||!entry.provider.enabled){const e=new Error('Account or provider is disabled');e.status=409;throw e}
   const method=login?'login':'refresh',driver=entry.driver;
   if(!driver?.[method]&&!['openai-chat','anthropic-messages'].includes(entry.provider.protocol)){
     const e=new Error('此渠道尚未接入原生登录或刷新适配器');e.status=501;throw e
   }
   pending.add(id);checks.set(id,{state:'checking',at:now(),message:login?'正在校验账号授权':'正在刷新账号状态'});
   let result;
   try{
     result=driver?.[method]?await driver[method]({
       provider:entry.provider,account:entry.account,resolveCredential:()=>resolveCredential(entry.account,{env,vault}),
     }):await basicProbe(entry);
     if(!['online','expired','limited','error','client_required','pending'].includes(result?.state))throw Error('Invalid account driver response');
     result={state:result.state,message:concise(result.message??'操作已返回状态'),at:now()};
   }catch(error){
     result={state:'error',message:error?.code==='CREDENTIAL'?'登录凭据不可用':concise(error?.message??'网络检查失败'),at:now()};
   }finally{pending.delete(id)}
   checks.set(id,result);
   return {id,...result,manualKeyVerification:!driver?.[method]};
 }
 function setEnabled(id,enabled){
   if(typeof enabled!=='boolean'){const e=new Error('enabled must be boolean');e.status=400;throw e}
   const {cfg}=find(id);
   const next={...cfg,accounts:cfg.accounts.map(a=>a.id===id?{...a,enabled}:a)};
   configStore.replace(next);
   if(!enabled)checks.delete(id);
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
    const autoLinked=cfg.sessionReuse?.linkedIds?.includes(id)===true;
    configStore.replace({...cfg,accounts:cfg.accounts.filter(a=>a.id!==id),
      sessionReuse:autoLinked?{...cfg.sessionReuse,
        linkedIds:cfg.sessionReuse.linkedIds.filter(x=>x!==id),
        ignoredIds:[...new Set([...cfg.sessionReuse.ignoredIds,id])].slice(-200)}:cfg.sessionReuse});
   checks.delete(id);
   adapter?.invalidateCatalog?.();
   return {id,detached:true,revokedUpstream:outcome?.revokedUpstream===true,
     message:outcome?.message??(outcome?.revokedUpstream===true?'已撤销渠道授权并解除插件关联':
       '已解除插件中的账号引用；外部登录态及上游凭据没有被撤销')};
 }
 async function discover(providerId){
   const cfg=configStore.get(),provider=cfg.providers.find(p=>p.id===providerId);
   const driver=driverFor(providerId);
   if(!provider||!driver?.discover){const e=new Error('此渠道未提供经过验证的本机账号发现适配器');e.status=501;throw e}
   const candidates=await driver.discover({provider});
   if(!Array.isArray(candidates))throw Error('Discovery adapter returned invalid candidates');
   // No secrets or filesystem details are handed to the browser.
   const publicCandidates=candidates.slice(0,50).map(row=>({
     id:String(row.id??'').slice(0,80),label:String(row.label??'').slice(0,100),
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
   if(!provider||typeof driver?.importCandidate!=='function'){
     const e=new Error('渠道未提供安全的账号导入驱动');e.status=501;throw e;
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
     enabled:false,autoCheckin:false,weight:1};
   configStore.replace({...cfg,accounts:[...cfg.accounts,newAccount]});
   adapter?.invalidateCatalog?.();
   // Preserve the remaining independently approved discovery candidates:
   // importing one account must not force rescanning the entire channel pool.
   cache.ids.delete(candidateId);
   if(cache.ids.size===0)discoverCache.delete(providerId);
   return {id:newAccount.id,providerId,enabled:false,message:'已导入已授权账号引用，默认停用；启用前请先验证登录态'};
 }
 async function refreshAll(){
   const ids=list().accounts.filter(a=>a.enabled&&a.refreshAvailable).map(a=>a.id);
   const results=[];
   // Serial by default: high-concurrency account probing risks rate limits.
   for(const id of ids){try{results.push(await verify(id))}catch(e){results.push({id,state:'error',message:concise(e.message)})}}
   return {attempted:ids.length,results};
 }
 return {list,verify,setEnabled,logout,discover,importCandidate,refreshAll,drivers,driverFor,find};
}
