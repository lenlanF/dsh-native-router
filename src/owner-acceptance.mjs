// Owner-authenticated, in-process acceptance jobs. No external service,
// foreground window, persisted config edits, or raw account data in reports.
import {hostRouteProof,ownedFreeRouteProof} from './owner-live-smoke.mjs';
const modes=new Set(['inventory','catalog','free-models','channel-activity','all-channel-activity','autofree-audit','owned-autofree-audit','owned-autofree-route','host-route']);
const channelKey=id=>String(id||'').replace(/^own_/,'');
const channelPattern=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const requestPattern=/^[a-f0-9]{32}$/;
const stateSet=new Set(['online','expired','limited','error','pending','client_required','verified','skipped','failed','unavailable','ready']);
const stateOf=value=>stateSet.has(value)?value:'unavailable';
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(value)?value:undefined;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=10000?v:0;
function reject(message,status=400){throw Object.assign(Error(message),{status})}
export function createOwnerAcceptance({configStore,accountCenter,checkinCenter,ownedDirectory,adapter,llm,now=()=>Date.now()}={}){
 let active=null,latest=null,disposed=false;
 const jobs=new Map();
 const output=job=>job?structuredClone(job.report):{state:'idle'};
 function snapshot(requestId){return output(requestId===undefined?latest:jobs.get(requestId))}
 function currentBinding(account){
  const cfg=configStore.get();
  return cfg.accounts.some(x=>x.id===account.id&&x.providerId===account.providerId
    &&x.credentialRef===account.credentialRef&&x.enabled===true)
    &&cfg.providers.some(x=>x.id===account.providerId&&x.protocol==='native-channel'&&x.enabled===true);
 }
 const publicRow=account=>accountCenter.list().accounts.find(x=>x.id===account.id&&x.providerId===account.providerId);
 function eligible(account){
  const row=publicRow(account);
  return currentBinding(account)&&row?.runtimeMode==='owned';
 }
 async function run(job,targets){
  const report=job.report,stopped=()=>disposed||job.controller.signal.aborted;
  try{
     if(['autofree-audit','owned-autofree-audit'].includes(report.mode)){
      const result=await adapter?.auditAutoFree?.({ownedOnly:report.mode==='owned-autofree-audit'});
      if(!result||result.state!=='ready')throw Error('AutoFree audit unavailable');
      report.autoFree={state:'ready',catalogCount:count(result.catalogCount),routeCount:count(result.routeCount),
       manualCount:count(result.manualCount),errors:count(result.errors),
       providers:(Array.isArray(result.providers)?result.providers:[]).filter(x=>channelPattern.test(x?.providerId??'')).slice(0,128)
         .map(x=>({providerId:x.providerId,routeCount:count(x.routeCount),accountCount:count(x.accountCount)})),
        ...(Array.isArray(result.issues)&&result.issues.length?{issues:result.issues.filter(x=>channelPattern.test(x?.providerId??'')&&['HOST_CATALOG_UNAVAILABLE','ACCOUNT_CATALOG_UNAVAILABLE','SOURCE_ACCOUNT_SCOPE_UNVERIFIED','SOURCE_CATALOG_UNAVAILABLE','SOURCE_ROSTER_UNAVAILABLE','SCAN_UNAVAILABLE'].includes(x.code)).slice(0,128).map(x=>({providerId:x.providerId,code:x.code,count:count(x.count)}))}: {})};
     }else if(report.mode==='owned-autofree-route'){
      const result=await ownedFreeRouteProof({llm,adapter,requestId:report.requestId,signal:job.controller.signal,now});
      report.ownedRoute={state:stateOf(result.state),code:safeCode(result.code),failedAttempts:count(result.failedAttempts),failedProviderCount:count(result.failedProviderCount),crossChannelSwitch:result.crossChannelSwitch===true,
       ...(channelPattern.test(result.completedProvider??'')?{completedProvider:result.completedProvider}:{})};
     }else if(report.mode==='host-route'){
      // One explicit provider at a time; never run every account or choose paid.
      const account=targets[0],row={slot:1,providerId:account.providerId,scope:'provider'};
      try{
       const catalog=await accountCenter.listTestModels(account.id,{signal:job.controller.signal,officialOnly:true});
       const candidates=catalog?.state==='ready'?catalog.models?.filter(m=>m.free===true)??[]:[];
       const preferred=account.providerId==='own_workbuddy-cn'?'hy4flash-free':account.providerId==='own_workbuddy-global'?'deepseek-v4.1-flash':account.providerId==='own_loomy'?'spark-x2.6':null;
       const model=candidates.find(m=>m.id===preferred)??candidates[0];
       const result=stopped()?{state:'skipped',code:'CANCELLED'}:
         !eligible(account)?{state:'skipped',code:'ACCOUNT_CHANGED'}:
         !model?{state:'skipped',code:'NO_CONFIRMED_FREE_MODEL'}:
         await hostRouteProof({llm,adapter,configStore,accountCenter,providerId:account.providerId,modelId:model.id,signal:job.controller.signal,now});
       row.state=stateOf(result.state);row.code=safeCode(result.code);
       if(['MISSING_FINISH','MAX_TOKENS','TOOL_CALLS','NO_TEXT','UNEXPECTED_FINISH'].includes(result.hostPhase))row.hostPhase=result.hostPhase;
      }catch{row.state='failed';row.code='DSH_HOST_ROUTE_FAILED'}
      report.accounts.push(row);
     }else if(report.mode==='catalog'){
     report.catalog=[];
     for(const providerId of job.channels){
      if(stopped())break;
      try{
       const result=await ownedDirectory.listModels(providerId);
       const models=Array.isArray(result?.models)?result.models:[];
       report.catalog.push({providerId,state:result?.state==='ready'&&models.length?'ready':'unavailable',modelCount:count(models.length),
        freeCount:count(models.filter(x=>x.isFree===true||x.free===true).length)});
      }catch{report.catalog.push({providerId,state:'unavailable',modelCount:0,freeCount:0})}
     }
    }else if(report.mode==='channel-activity'||report.mode==='all-channel-activity'){
     const keys=['attempted','confirmedSignins','newlyCreditedRewards','pendingAccounts','failedAccounts','noTaskAccounts','clientRequiredAccounts'];
     const selected=report.mode==='channel-activity'?[report.channel]:job.channels;
     if(report.mode==='all-channel-activity'){
       report.activityChannels=[];
       report.activity=Object.fromEntries(keys.map(k=>[k,0]));
     }
     for(const channel of selected){
       if(stopped())break;
       try{
         // Refresh only the selected source roster. Each channel driver
         // independently enforces official eligibility and duplicate receipts.
         await checkinCenter.refreshSources?.({onlyProviderId:channel});
         if(stopped())break;
         const result=await checkinCenter.runActivityChannel(channel,{signal:job.controller.signal});
         const summary=Object.fromEntries(keys.map(k=>[k,count(result?.summary?.[k])]));
         if(report.mode==='channel-activity')report.activity=summary;
         else{
           report.activityChannels.push({providerId:channel,state:'complete',...summary});
           for(const key of keys)report.activity[key]+=summary[key];
         }
       }catch(error){
         if(report.mode==='channel-activity')throw error;
         report.activityChannels.push({providerId:channel,state:'unavailable',code:'OPERATION_UNAVAILABLE'});
       }
     }
   }else for(const account of targets){
    if(stopped())break;
    const row={slot:report.accounts.length+1,providerId:account.providerId};
    if(!eligible(account)){row.state='skipped';row.code='ACCOUNT_CHANGED';report.accounts.push(row);continue}
    try{
     if(report.mode==='inventory'){
       // Use a dedicated official reader when available; do not fetch
       // the model catalogue twice during a single acceptance run.
       const hasReader=typeof accountCenter.driverFor?.(account.providerId)?.refreshAccountStatus==='function'
         &&typeof accountCenter.refreshReadOnly==='function';
       const probe=hasReader?(await accountCenter.refreshReadOnly({force:true,accountId:account.id}))[0]
         :await accountCenter.verify(account.id);
       row.connection=hasReader&&probe?.authVerified===true&&['ready','online'].includes(probe.state)
         ?'online':probe?.state==='ready'?'pending':stateOf(probe?.state);
      if(!stopped()&&eligible(account)){
        // Only current official evidence; never serialize balances or identities.
        if(hasReader&&probe?.authVerified===true&&['ready','online'].includes(probe.state)){
         for(const k of ['zcodeStatusObserved','zcodeBalanceObserved'])if(typeof probe[k]==='boolean')row[k]=probe[k];
         for(const k of ['zcodePlanBuckets','zcodeFlashBuckets','zcodePreviewStartPlans'])if(Number.isSafeInteger(probe[k])&&probe[k]>=0)row[k]=count(probe[k]);
         if(account.providerId==='own_zcode'||typeof probe.zcodeBalanceObserved==='boolean')
           row.zcodeGiftConfirmed=probe.balanceState==='available'&&Number.isFinite(probe.giftedBalance)&&probe.giftedBalance>=1024;
          if(account.providerId==='own_zcode')row.zcodeGiftRoutable=false;
         if(account.providerId==='own_loomy'||Number.isFinite(probe.loomyDailyGift)||probe.dailyQuotaEvidence){
          row.loomyGiftConfirmed=probe.balanceState==='available'&&Number.isFinite(probe.loomyDailyGift)&&probe.loomyDailyGift>=2000;
          const q=probe.dailyQuotaEvidence;
          row.dailyQuotaObserved=Boolean(q&&['quota','balance','consumed'].every(k=>Number.isFinite(q[k])&&q[k]>=0)&&q.quota>0&&Math.abs(q.quota-q.balance-q.consumed)<1e-6);
         }
        }
        const data=publicRow(account);
       row.hasProfile=Boolean(data?.nickname||data?.maskedPhone);
       row.profileState=['verified','cached','not_returned'].includes(data?.profileState)?data.profileState:'unknown';
       row.hasBalance=Number.isFinite(data?.balance)&&data.balance>=0;
       row.hasBalanceUnit=Boolean(data?.balanceUnit);
       row.balanceState=['available','cached','unavailable','not_returned','not_supported','not_checked'].includes(data?.balanceState)?data.balanceState:'unknown';
       row.membershipState=['active','not_subscribed','unavailable','not_supported','not_checked'].includes(data?.membershipState)?data.membershipState:'unknown';
       row.usageState=['available','no_cycle','unavailable','not_supported','not_checked'].includes(data?.usageState)?data.usageState:'unknown';
       if(['own_lingxi','own_loomy','own_workbuddy-cn','own_workbuddy-global','codearts','own_codearts'].includes(account.providerId)){
         row.giftWalletVerified=probe?.authVerified===true&&data?.giftCreditState==='verified';
         row.giftCreditAvailable=row.giftWalletVerified&&data.giftedBalance>0;
         row.ordinaryCreditObserved=row.giftWalletVerified&&Number.isFinite(data.ordinaryBalance);
         row.giftRoutingReady=row.giftCreditAvailable&&data?.giftRouteState==='existing_daily_policy'&&probe?.loomyDailyGift>=2000;
       }
       row.quotaWindowCount=count(data?.quotaWindows?.length);
       row.hasRollingQuota=data?.usageState==='available'&&Number.isFinite(data.usagePercentRemaining);
       row.hasMembershipQuota=data?.membershipState==='active'&&Number.isFinite(data.membershipPercentRemaining);
       row.quotaObserved=row.quotaWindowCount>0||row.hasRollingQuota||row.hasMembershipQuota;
       try{
        const catalog=await accountCenter.listTestModels(account.id,{officialOnly:true,signal:job.controller.signal});
        row.freeCandidates=count(catalog?.freeCount);
        row.advertisedCount=count(catalog?.models?.length);
        const rates=(Array.isArray(catalog?.models)?catalog.models:[]).map(m=>m.costMultiplier).filter(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100);
        row.knownRateCount=count(rates.length);row.zeroRateCount=count(rates.filter(x=>x===0).length);
        if(rates.length)row.lowestMultiplier=Math.min(...rates);
        row.catalogState=catalog?.state==='ready'?(row.advertisedCount?'ready':'empty'):'unavailable';
       }catch{row.catalogState='unavailable';row.code='CATALOG_UNAVAILABLE'}
       row.state='observed';

      }
     }else{
      // Stop between accounts, not halfway through a provider's response.
       const result=await accountCenter.verifyModel(account.id,{officialOnly:true});
      row.modelState=stateOf(result?.state);row.code=safeCode(result?.code);
      if(['CATALOG','DRIVER_PRECHECK','ENTITLEMENT_READ','STREAM_OPEN','STREAM_READ','STREAM_FIRST_EVENT','STREAM_REASONING','STREAM_TEXT','STREAM_FINISH'].includes(result?.phase))row.phase=result.phase;
      // Never copy model response or arbitrary upstream strings.
      row.state=row.modelState;
     }
    }catch(error){row.state='unavailable';row.code=error?.status===409?'BUSY_OR_CHANGED':'OPERATION_UNAVAILABLE'}
    if(!eligible(account)){report.accounts.push({slot:row.slot,providerId:row.providerId,state:'skipped',code:'ACCOUNT_CHANGED'})}
    else report.accounts.push({...row,state:row.state??'skipped',...(!row.state?{code:'CANCELLED'}:{})});
   }
   if(report.mode==='inventory'){
    const summaries=['own_workbuddy-cn','own_workbuddy-global'].filter(id=>targets.some(a=>a.providerId===id)).map(providerId=>{
     const item=accountCenter.workbuddyIdentitySummary?.(providerId);
     return item?{providerId,configuredRecords:count(item.configuredRecords),enabledRecords:count(item.enabledRecords),confirmedRecords:count(item.confirmedRecords),distinctConfirmedSubjects:count(item.distinctConfirmedSubjects),unconfirmedRecords:count(item.unconfirmedRecords)}:null;
    }).filter(Boolean);
    if(summaries.length)report.workbuddyIdentity=summaries;
   }
   report.state=stopped()?'cancelled':'complete';
  }catch{report.state=stopped()?'cancelled':'failed';report.code='OPERATION_UNAVAILABLE'}
  finally{report.completedAt=now();if(active===job)active=null}
 }
 function start(input={}){
  const {requestId,mode,channel,consent}=input??{};
  if(disposed)reject('Acceptance service stopped',503);
  if(typeof requestId!=='string'||!requestPattern.test(requestId)||!modes.has(mode)||consent!==true
    ||channel!==undefined&&(typeof channel!=='string'||!channelPattern.test(channel))
    ||['channel-activity','host-route'].includes(mode)&&channel===undefined||['all-channel-activity','autofree-audit','owned-autofree-audit','owned-autofree-route'].includes(mode)&&channel!==undefined)reject('Invalid explicit acceptance request');
  const selected=channel===undefined?undefined:channelKey(channel);
  const signature=JSON.stringify([mode,selected]);
  const old=jobs.get(requestId);
  if(old){
   if(old.signature!==signature)reject('Request ID already used',409);
   return output(old);
  }
  if(active)reject('Acceptance already running',409);
  // Keep all request IDs for this lifetime. A full ledger fails closed rather
  // than silently permitting a replay. No automatic job starts at boot.
  if(jobs.size>=128)reject('Acceptance request ledger full',429);
  const cfg=configStore.get();
  const targets=cfg.accounts.filter(a=>(!selected||channelKey(a.providerId)===selected)&&eligible(a));
  if(mode==='host-route'&&(!targets.length||new Set(targets.map(a=>a.providerId)).size!==1))reject('Select exactly one enabled owned provider',409);
  const activityMode=mode==='channel-activity'||mode==='all-channel-activity';
   if(!activityMode&&!['catalog','autofree-audit','owned-autofree-audit','owned-autofree-route'].includes(mode)&&targets.length>16)reject('Select a narrower channel (maximum 16 accounts)',400);
  const activityRows=activityMode?(checkinCenter.snapshot?.().accounts??[]).filter(a=>
    a.enabled===true&&(a.checkinSupported===true||a.activitiesSupported===true)
    &&channelPattern.test(channelKey(a.providerId))&&(!selected||channelKey(a.providerId)===selected)):[];
   const channels=mode==='catalog'?(ownedDirectory?.providers()??[]).filter(p=>p.family==='native-router-owned'&&p.loginVerified===true&&channelPattern.test(p.providerId)&&(!selected||channelKey(p.providerId)===selected)).map(p=>p.providerId):[...new Set(activityRows.map(a=>channelKey(a.providerId)))].sort();
  if(activityMode&&!channels.length)reject('No enabled activity executor for selected channel',409);
  if(channels.length>32||activityRows.length>128||channels.some(id=>activityRows.filter(a=>channelKey(a.providerId)===id).length>32))
    reject('Activity scope exceeds safe job bound; select a narrower channel',400);
  const report={requestId,mode,...(selected?{channel:selected}:{}),state:'running',startedAt:now(),
    completedAt:null,accountCount:activityMode?activityRows.length:targets.length,accounts:[],
    ...(mode==='all-channel-activity'?{channelCount:channels.length,activityChannels:[]}:{})};
  const job={signature,report,channels,controller:new AbortController()};
  jobs.set(requestId,job);active=latest=job;
  void Promise.resolve().then(()=>run(job,targets));
  return output(job);
 }
 function cancel(requestId){
  if(!active||active.report.requestId!==requestId)reject('Acceptance job not running',409);
  active.controller.abort();return output(active);
 }
 function dispose(){disposed=true;active?.controller.abort()}
 return {start,snapshot,cancel,dispose};
}
