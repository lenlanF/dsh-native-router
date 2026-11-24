// Owner-authenticated, in-process acceptance jobs. No external service,
// foreground window, persisted config edits, or raw account data in reports.
const modes=new Set(['inventory','catalog','free-models','channel-activity','all-channel-activity']);
const channelKey=id=>String(id||'').replace(/^own_/,'');
const channelPattern=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const requestPattern=/^[a-f0-9]{32}$/;
const stateSet=new Set(['online','expired','limited','error','pending','client_required','verified','skipped','failed','unavailable','ready']);
const stateOf=value=>stateSet.has(value)?value:'unavailable';
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(value)?value:undefined;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=10000?v:0;
function reject(message,status=400){throw Object.assign(Error(message),{status})}
export function createOwnerAcceptance({configStore,accountCenter,checkinCenter,ownedDirectory,now=()=>Date.now()}={}){
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
    if(report.mode==='catalog'){
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
       const data=publicRow(account);
       row.hasProfile=Boolean(data?.nickname||data?.maskedPhone);
       row.hasBalance=Number.isFinite(data?.balance)&&data.balance>=0;
       row.hasBalanceUnit=Boolean(data?.balanceUnit);
       row.balanceState=['available','cached','unavailable','not_returned','not_supported','not_checked'].includes(data?.balanceState)?data.balanceState:'unknown';
       row.quotaWindowCount=count(data?.quotaWindows?.length);
       row.hasRollingQuota=data?.usageState==='available'&&Number.isFinite(data.usagePercentRemaining);
       row.hasMembershipQuota=data?.membershipState==='active'&&Number.isFinite(data.membershipPercentRemaining);
       row.quotaObserved=row.quotaWindowCount>0||row.hasRollingQuota||row.hasMembershipQuota;
       const catalog=await accountCenter.listTestModels(account.id,{officialOnly:true,signal:job.controller.signal});
       row.freeCandidates=count(catalog?.freeCount);
       row.advertisedCount=count(catalog?.models?.length);
       row.state='observed';
      }
     }else{
      // Stop between accounts, not halfway through a provider's response.
       const result=await accountCenter.verifyModel(account.id,{officialOnly:true});
      row.modelState=stateOf(result?.state);row.code=safeCode(result?.code);
      // Never copy model response or arbitrary upstream strings.
      row.state=row.modelState;
     }
    }catch(error){row.state='unavailable';row.code=error?.status===409?'BUSY_OR_CHANGED':'OPERATION_UNAVAILABLE'}
    if(!eligible(account)){report.accounts.push({slot:row.slot,providerId:row.providerId,state:'skipped',code:'ACCOUNT_CHANGED'})}
    else report.accounts.push({...row,state:row.state??'skipped',...(!row.state?{code:'CANCELLED'}:{})});
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
    ||mode==='channel-activity'&&channel===undefined||mode==='all-channel-activity'&&channel!==undefined)reject('Invalid explicit acceptance request');
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
  const activityMode=mode==='channel-activity'||mode==='all-channel-activity';
   if(!activityMode&&mode!=='catalog'&&targets.length>16)reject('Select a narrower channel (maximum 16 accounts)',400);
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
