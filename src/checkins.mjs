import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {defaultConfigPath,channelAutoEnabled} from './config.mjs';
import {createSourceCheckinCenter} from './source-checkins.mjs';
import {createActivityClaimStore} from './activity-claims.mjs';
import {checkinDisplayState,expiredCheckinConfirmation} from './account-facts.mjs';
import {checkinGroups,latestConfirmedDate} from './checkin-summary.mjs';
import {publicCheckinMessage,publicAccountFailureMessage} from './public-diagnostics.mjs';

import {retryAtomicRename} from './retry-atomic-rename.mjs';
const MAX_HISTORY=500;
const STATES=new Set(['success','failed','pending_confirmation','no_task','client_required','unsupported']);
export function todayKey(now=Date.now(),timeZone='Asia/Shanghai'){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const val=name=>parts.find(x=>x.type===name).value;
  return val('year')+'-'+val('month')+'-'+val('day');
}
export function clockAt(now,timeZone){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const val=name=>parts.find(x=>x.type===name).value;
  return val('hour')+':'+val('minute');
}
export function createCheckinStore({path=join(dirname(defaultConfigPath()),'checkins.json')}={}){
  let records=[],blockedReason=null;
  if(existsSync(path)){
    try{
      const payload=JSON.parse(readFileSync(path,'utf8'));
      if(payload?.version!==1||!Array.isArray(payload.history)||payload.history.length>MAX_HISTORY*10)
        throw new Error('invalid schema');
      records=payload.history.filter(x=>x&&typeof x==='object'&&
        typeof x.accountId==='string'&&typeof x.date==='string'&&STATES.has(x.state)).slice(-MAX_HISTORY);
    }catch{
      // Block all sign-in writes, but keep the DSH model provider running.
      blockedReason='签到历史无法读取或校验，已禁止签到执行与覆盖；请备份原文件后修复';
    }
  }
  return {
    path,
    get blocked(){return blockedReason!==null},
    get error(){return blockedReason},
    all:()=>structuredClone(records),
    append(entry){
      if(blockedReason)throw new Error(blockedReason);
      if(!entry||!STATES.has(entry.state)||typeof entry.accountId!=='string')throw new Error('Invalid check-in record');
      const next=[...records,entry].slice(-MAX_HISTORY);
      const target=path+'.tmp-'+process.pid;
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(target,JSON.stringify({version:1,history:next},null,2)+'\n',{flag:'wx',mode:0o600});
      try{retryAtomicRename(target,path)}catch(error){try{unlinkSync(target)}catch{};throw error}
      records=next;
      return structuredClone(entry);
    },
  };
}
export function createCheckinCenter({configStore,accountCenter,store=createCheckinStore(),
   now=()=>Date.now(),logger,intervalMs=60000,sourcePack,verificationStore,
   activityStore=createActivityClaimStore()}={}){
   if(!configStore?.get||!accountCenter?.find)throw Error('Config and account center are required');
   const pending=new Set(),activityLastProbe=new Map();
   let timer=null,running=null;
   const sourceCenter=sourcePack?createSourceCheckinCenter({sourcePack,configStore,store,now,logger,
     verificationStore,activityStore}):null;
  const currentDate=()=>todayKey(now(),configStore.get().checkin.timeZone);
  function latestFor(accountId,date=currentDate()){
    return store.all().filter(x=>x.accountId===accountId&&x.date===date).at(-1)??null;
  }
   const channelEnabled=channelAutoEnabled;
  const activityPending=new Set();
  const activityFor=accountId=>{
    try{return activityStore.summary(accountCenter.find(accountId).account)}
    catch{return {confirmed:0,unconfirmed:0,lastAt:null}}
  };
  // This workflow is independent of the one-time daily sign-in result:
  // new eligible gifts can appear AFTER an already-successful daily sign-in.
  async function runActivities(accountId,{source='manual'}={}){
    if(store.blocked||activityStore.blocked)return {state:'blocked'};
    const {account,provider,driver}=accountCenter.find(accountId);
    const cfg=configStore.get();
    if(!account.enabled||!provider.enabled||typeof driver?.claimActivities!=='function')
      return {state:'unsupported'};
     if(source==='auto'&&(!account.autoCheckin||!channelEnabled(cfg,provider.id)))
       return {state:'disabled'};
    if(activityPending.has(accountId))return {state:'busy'};
    const probeKey=account.id+'\\0'+account.credentialRef;
    if(source==='auto'&&activityLastProbe.has(probeKey)
      &&now()-activityLastProbe.get(probeKey)<30*60*1000)
      return {state:'cached'};
    activityLastProbe.set(probeKey,now());
    const authorized=()=>{
      const current=configStore.get();
      return current.accounts.some(a=>a.id===account.id&&a.providerId===provider.id
        &&a.credentialRef===account.credentialRef&&a.enabled===true)
        &&current.providers.some(p=>p.id===provider.id&&p.enabled===true);
    };
    activityPending.add(accountId);
    try{
      const result=await driver.claimActivities({
        account,date:currentDate(),
        beforeClaim:(offer,meta)=>authorized()&&activityStore.begin(account,offer,meta),
        onOutcome:(offer,state,meta)=>activityStore.finish(account,offer,
          state==='confirmed'&&authorized()?'confirmed':'pending_confirmation',meta),
        onObserved:(offer,state,meta)=>authorized()&&activityStore.finish(account,offer,
          state==='confirmed'?'confirmed':'pending_confirmation',meta),
        previousReceipt:offer=>authorized()?activityStore.receipt(account,offer):null,
      });
      return authorized()?{state:result?.state??'unavailable',
        confirmed:result?.confirmed??0,pending:result?.pending??0,
        eligible:result?.eligible??0}:{state:'account_changed'};
    }catch(error){
      logger?.warn?.('native-router activity claim unavailable: '+
        publicAccountFailureMessage(error));
      return {state:'unavailable'};
    }finally{activityPending.delete(accountId)}
  }
  function snapshot(){
    const cfg=configStore.get(),today=currentDate(),roster=accountCenter.list();
    const accounts=roster.accounts.map(a=>{
       const recent=latestFor(a.id,today);
       const entry=accountCenter.find(a.id),driver=accountCenter.driverFor(a.providerId);
       const implemented=typeof driver?.checkIn==='function';
        const upstreamToday=a.upstreamCheckinDate===today;
        const historyConfirmed=latestConfirmedDate(store.all(),a.id,today)===today;
        const verified=historyConfirmed||upstreamToday&&
          ['claimed','already'].includes(a.upstreamCheckinOutcome);
        const claimable=upstreamToday&&a.upstreamCheckinOutcome==='claimable';
        const state=checkinDisplayState({recent,now:now(),pending:pending.has(a.id),
          implemented,confirmed:verified,claimable});
       const sourceName=a.upstreamCheckinSource==='live-readonly'?
         '灵犀上游任务中心':'原灵犀插件同账号签到记录';
       // A remote claimed flag is NOT official credited-points evidence.
       // Only the durable account-bound before/after wallet proof may turn
       // a particular gift or compensation activity into a visible row.
       const verifiedBenefits=Array.isArray(a.benefits)?a.benefits.map(offer=>{
         const receipt=activityStore.receipt(entry.account,offer);
         const verified=offer.claimed===true&&receipt?.state==='confirmed'
           &&receipt.proof==='official_wallet_delta'
           &&Number.isSafeInteger(receipt.verifiedAt)
           &&receipt.credit===offer.credit;
         return {...offer,...(verified?{
           rewardVerified:true,rewardProof:'official_wallet_delta',
           rewardVerifiedAt:receipt.verifiedAt}:{})};
       }):null;
       return {...a,...(verifiedBenefits?{benefits:verifiedBenefits}:{}),
         autoCheckin:entry.account.autoCheckin===true,
          autoCheckinEffective:entry.account.autoCheckin===true
            &&channelEnabled(cfg,entry.account.providerId),
         checkinState:state,checkinAt:recent?.at??a.balanceCheckedAt??null,
           checkinMessage:verified?(historyConfirmed?
             '本账号今日已有已确认签到记录':sourceName+'确认今日已签到'):
             expiredCheckinConfirmation(recent,now())?'上次请求已超过20分钟，服务端仍未确认；等待限次复核':
             claimable?'上游今日任务仍可领取，尚未确认签到':
              recent?publicCheckinMessage(recent.state):
                (implemented?'今日签到状态尚未核实':'未接入本渠道签到执行器'),
         checkinSupported:implemented,
         activitiesSupported:typeof driver?.claimActivities==='function',
         activityClaims:activityFor(a.id),
       };
    });
     for(const sourceRow of sourceCenter?.snapshot()??[]){
       const existing=accounts.find(item=>item.id===sourceRow.id);
        if(existing)Object.assign(existing,{
          checkinSupported:sourceRow.checkinSupported,
          activitiesSupported:sourceRow.activitiesSupported===true,
          checkinAvailable:sourceRow.checkinAvailable,checkinState:sourceRow.checkinState,
          activityClaimable:sourceRow.activityClaimable===true,
          checkinAt:sourceRow.checkinAt,checkinMessage:sourceRow.checkinMessage,
          ...(Number.isFinite(sourceRow.activityRewardAmount)&&sourceRow.activityRewardAmount>=0
            &&typeof sourceRow.activityRewardUnit==='string'?{
              activityRewardAmount:sourceRow.activityRewardAmount,
              activityRewardUnit:sourceRow.activityRewardUnit}:{}),
          ...(sourceRow.activityRewardProof==='official_daily_grant_bill'
            &&Number.isSafeInteger(sourceRow.activityRewardVerifiedAt)?{
              activityRewardProof:sourceRow.activityRewardProof,
              activityRewardVerifiedAt:sourceRow.activityRewardVerifiedAt}:{}),
          ...(Number.isFinite(sourceRow.activityExpiresAt)&&sourceRow.activityExpiresAt>0
            ?{activityExpiresAt:sourceRow.activityExpiresAt}:{}),
          autoCheckin:sourceRow.autoCheckin,
          autoCheckinEffective:sourceRow.autoCheckinEffective===true,sourceAccount:true,
          ...(typeof sourceRow.activityActive==='boolean'?{
            activityActive:sourceRow.activityActive}:{}),
          ...(Array.isArray(sourceRow.benefits)?{benefits:sourceRow.benefits}:{}),
          ...(sourceRow.activityClaims?{activityClaims:sourceRow.activityClaims}:{}),
          // The standalone source pool owns the actual login state. The
          // imported static card must not show online/enabled when its real
          // source member was disabled, expired or became rate limited.
          ...(sourceRow.enabled===false?{enabled:false,connectionState:'disabled'}:
            ['online','expired','limited'].includes(sourceRow.connectionState)
              ?{connectionState:sourceRow.connectionState}:{}),
          ...(sourceRow.nickname?{nickname:sourceRow.nickname}:{}),
          ...(Number.isFinite(sourceRow.balance)?{balance:sourceRow.balance,
            ...(sourceRow.balanceUnit?{balanceUnit:sourceRow.balanceUnit}:{}),
            balanceCheckedAt:sourceRow.balanceCheckedAt}:{}),
          balanceState:sourceRow.balanceState,
          ...(Number.isFinite(sourceRow.expiringPoints)&&sourceRow.expiringPoints>0
            &&sourceRow.balanceUnit==='积分'?{expiringPoints:sourceRow.expiringPoints,
            ...(Number.isFinite(sourceRow.expiringAt)?{expiringAt:sourceRow.expiringAt}:{})}:{}),
          ...(sourceRow.maskedPhone?{maskedPhone:sourceRow.maskedPhone}:{}),
        });
       else accounts.push(sourceRow);
     }
      const history=store.all();
      for(const account of accounts){
        const confirmedInHistory=latestConfirmedDate(history,account.id,today);
        const confirmedUpstream=account.checkinState==='success'
          &&(account.upstreamCheckinDate===today||account.sourceAccount===true)
          ?today:null;
        const lastConfirmedDate=confirmedUpstream??confirmedInHistory;
        if(lastConfirmedDate)account.lastConfirmedDate=lastConfirmedDate;
        if(account.checkinState!=='success'&&lastConfirmedDate&&lastConfirmedDate<today)
          account.checkinMessage=(account.checkinMessage||'今日状态待核实')+
            '；历史最近确认：'+lastConfirmedDate;
      }
      // A channel with no genuine daily sign-in executor is never presented
      // as sign-in capable, even if it exposes natural-refresh quota.
      const groups=checkinGroups(accounts,roster.channels)
        .filter(group=>group.supported>0).map(group=>({...group,
          autoEnabled:channelEnabled(cfg,group.id)}));
     return {today,timeZone:cfg.checkin.timeZone,autoEnabled:cfg.checkin.autoEnabled,
       autoSourceAccounts:cfg.checkin.autoSourceAccounts,
       rewardHistoryBlocked:activityStore.blocked,
      historyBlocked:store.blocked===true,historyError:store.error??null,
      runAt:cfg.checkin.runAt,groups,accounts,
        history:history.slice(-80).reverse().map(item=>({...item,
          message:publicCheckinMessage(item.state)}))};  }
   async function run(accountId,{source='manual'}={}){
     if(sourceCenter&&!sourceCenter.has(accountId))await sourceCenter.refresh();
     if(sourceCenter?.has(accountId))return sourceCenter.run(accountId,{source});
    if(store.blocked){const e=new Error(store.error??'签到存储不可用');e.status=503;throw e}
    if(pending.has(accountId)){const e=new Error('本账号签到正在执行');e.status=409;throw e}
    const {account,provider,driver}=accountCenter.find(accountId);
    if(!account.enabled||!provider.enabled){const e=new Error('账号已停用，不能签到');e.status=409;throw e}
    if(typeof driver?.checkIn!=='function'){
      if(typeof driver?.claimActivities==='function')
        return {activities:await runActivities(accountId,{source})};
      const e=new Error('该渠道未提供可验证的积分任务执行器');e.status=501;throw e;
    }
     const date=currentDate(),previous=latestFor(accountId,date);
     const earlierSuccess=store.all().find(x=>x.accountId===accountId&&x.date===date&&x.state==='success');
     if(earlierSuccess)return {alreadyConfirmed:true,record:earlierSuccess,
       activities:await runActivities(accountId,{source})};
     // An official POST can have been accepted despite a closed connection.
     // Manually pressing again must not double-claim a one-attempt daily grant.
     if(previous?.state==='pending_confirmation'&&
       (/^own_workbuddy-/.test(account.providerId)||account.providerId==='own_doubao'))
       return {alreadyPending:true,record:previous,
         activities:await runActivities(accountId,{source})};
     const publicAccount=accountCenter.list().accounts.find(a=>a.id===accountId);
     if(publicAccount?.upstreamCheckinDate===date&&
       ['claimed','already'].includes(publicAccount?.upstreamCheckinOutcome)){
       const record=store.append({date,accountId,providerId:provider.id,
         state:'success',message:'上游/原插件确认今日已签到',at:now(),source:'status'});
       return {alreadyConfirmed:true,record,
         activities:await runActivities(accountId,{source})};
     }
     pending.add(accountId);
    let state='failed',message='签到未确认';
    try{
      const reply=await driver.checkIn({account,provider,date,source,
        includeActivities:false});
      if(reply?.confirmed===true&&reply?.date===date){
         state='success';message=publicCheckinMessage('success');
      }else if(reply?.state==='no_task'){
         state='no_task';message=publicCheckinMessage('no_task');
      }else if(reply?.state==='client_required'){
         state='client_required';message=publicCheckinMessage('client_required');
      }else if(reply?.state==='pending_confirmation'||reply?.accepted===true){
         state='pending_confirmation';message=publicCheckinMessage('pending_confirmation');
      }else{
         message=publicCheckinMessage('failed');
      }
    }catch(error){
       state='failed';message=publicCheckinMessage('failed')+'；'+publicAccountFailureMessage(error);
    }finally{pending.delete(accountId)}
    // A claim may have completed upstream while its owner disabled the
    // Provider, replaced the login or removed the account. Never attach that
    // old response to a new identity or publish it as a successful sign-in.
    const current=configStore.get();
    const live=current.accounts.find(row=>row.id===accountId
      &&row.providerId===account.providerId&&row.credentialRef===account.credentialRef
      &&row.enabled===true);
    if(!live||!current.providers.some(row=>row.id===provider.id&&row.enabled===true)){
      const error=new Error('账号授权在签到执行期间已改变，旧签到结果不予写入');
      error.status=409;error.code='ERR_ACCOUNT_CHANGED';throw error;
    }
    const record=store.append({date,accountId,providerId:provider.id,state,message,
      at:now(),source});
    logger?.info?.('native-router checkin '+provider.id+'/'+accountId+': '+state);
    return {alreadyConfirmed:false,record,
      activities:await runActivities(accountId,{source})};
  }
  // Owner-initiated batch: never invokes channels which only have a quota
  // reader or an unverified activity endpoint. Global auto switch does not
  // prevent safe manual requests. Existing per-account anti-duplicate rules
  // remain in run() for every request.
  // Pure-API, no-purchase free activity attempt across one channel.
  // It does NOT turn rejected or pending receipts into visible rewards.
  async function runActivityChannel(providerId,{source='manual'}={}){
    const selected=String(providerId||'').replace(/^own_/,'');
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(selected))
      throw Error('Invalid activity channel');
    const accounts=snapshot().accounts.filter(row=>
      row.providerId?.replace(/^own_/,'')===selected&&row.enabled!==false
      &&(row.activitiesSupported===true||row.checkinSupported===true)).slice(0,32);
    const results=[];
    for(const row of accounts){
      try{
        // The source pack's ten DAILY free-claim providers are genuine
        // activity executors too. In rc93 this path accidentally only
        // called Loomy/WorkBuddy extra tasks, silently skipping them.
        // run() already preserves per-account official eligibility, receipts
        // and repeat-claim protection. It also runs Loomy bonus tasks.
        const outcome=row.checkinSupported===true?
          await run(row.id,{source}):
          sourceCenter?.has(row.id)?await sourceCenter.runFreeActivities(row.id,{source}):
            await runActivities(row.id,{source});
        results.push({accountId:row.id,...outcome});
      }catch(error){results.push({accountId:row.id,state:'unavailable',
        message:publicAccountFailureMessage(error)})}
    }
    return {providerId:selected,attempted:results.length,results};
  }
  async function runChannel(providerId,{source='manual'}={}){
    const selected=String(providerId||'').replace(/^own_/,'');
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(selected))
      throw Error('Invalid check-in channel');
    const eligible=snapshot().accounts.filter(row=>
      row.providerId?.replace(/^own_/,'')===selected
      &&row.enabled!==false&&row.checkinSupported===true).slice(0,32);
    const results=[];
    for(const row of eligible){
      try{results.push({accountId:row.id,...await run(row.id,{source})})}
      catch(error){results.push({accountId:row.id,state:'unavailable',
        message:publicAccountFailureMessage(error)})}
    }
    return {providerId:selected,attempted:results.length,results};
  }
  async function tick(){
    if(store.blocked)return {skipped:'history_blocked'};
    const cfg=configStore.get();
     if(!cfg.checkin.autoEnabled&&
       !Object.keys(cfg.checkin.channels??{}).some(id=>channelEnabled(cfg,id)))
       return {skipped:'disabled'};
     if(clockAt(now(),cfg.checkin.timeZone)<cfg.checkin.runAt)return {skipped:'not_due'};
     if(running)return running;
     running=(async()=>{
       const results=[];
       await accountCenter.refreshReadOnly?.().catch(()=>{});
       const today=currentDate(),known=accountCenter.list().accounts;
       for(const account of cfg.accounts){
         if(!account.autoCheckin||!account.enabled
           ||!channelEnabled(cfg,account.providerId))continue;
         const provider=cfg.providers.find(p=>p.id===account.providerId);
         if(!provider?.enabled||typeof accountCenter.driverFor(account.providerId)?.checkIn!=='function')continue;
         const publicAccount=known.find(row=>row.id===account.id);
         if(publicAccount?.upstreamCheckinDate===today&&
           ['claimed','already'].includes(publicAccount.upstreamCheckinOutcome))continue;
         const records=store.all().filter(r=>r.accountId===account.id&&r.date===today);
         const recent=records.at(-1);
           if(records.some(x=>x.state==='success')||recent?.state==='client_required')continue;
           // An unconfirmed official grant may already have consumed today's
           // only attempt; don't blindly re-submit after an hour or restart.
           if(recent?.state==='pending_confirmation'&&
             (/^own_workbuddy-/.test(account.providerId)||account.providerId==='own_doubao'))continue;
         // Historic no_task was incorrectly returned for an already-claimed
         // Lingxi task; permit a bounded retry if source still reports unclaimed.
         if(recent?.state==='no_task'&&account.providerId!=='own_lingxi')continue;
         if(records.filter(x=>x.source==='auto').length>=3)continue;
         if(recent&&now()-recent.at<60*60*1000)continue;
        try{results.push(await run(account.id,{source:'auto'}))}catch(error){
           logger?.warn?.('native-router checkin skipped: '+publicAccountFailureMessage(error));
        }
      }
       let sourceRewards=[];
       if(sourceCenter){
         const sourceResult=await sourceCenter.tick();
         results.push(...sourceResult.results??[]);
         sourceRewards=sourceResult.rewards??[];
       }
       // A successful sign-in must NOT terminate later eligible activity
       // discovery; WorkBuddy compensation/gift campaigns can appear any time.
       const rewards=[...sourceRewards];
       for(const account of cfg.accounts){
         if(!account.enabled||account.autoCheckin!==true
           ||!channelEnabled(cfg,account.providerId))continue;
         if(typeof accountCenter.driverFor(account.providerId)?.claimActivities!=='function')continue;
         const outcome=await runActivities(account.id,{source:'auto'});
         if(outcome.confirmed||outcome.pending)rewards.push({accountId:account.id,...outcome});
       }
       return {attempted:results.length,results,rewards};
    })().finally(()=>{running=null});
    return running;
  }
  function start(){
    if(timer)return stop;
    // Timer belongs to the plugin runtime, not Windows Task Scheduler.
     const refreshReadOnly=()=>void Promise.all([
       sourceCenter?.refresh().catch(()=>null),
       accountCenter.refreshReadOnly?.().catch(()=>null),
     ]).catch(()=>logger?.warn?.('source check-in metadata refresh unavailable'));
    timer=setInterval(()=>{
      refreshReadOnly();
      void tick().catch(()=>logger?.warn?.('checkin task unavailable'));
    },intervalMs);
    timer.unref?.();
    refreshReadOnly(); // Only a read-only status probe, independent of the auto-sign-in switch.
    void tick().catch(()=>logger?.warn?.('checkin startup check unavailable'));    return stop;
  }
   function stop(){if(timer){clearInterval(timer);timer=null}sourceCenter?.stop()}
    return {snapshot,sourceSnapshot:()=>sourceCenter?.snapshot()??[],run,runChannel,
      runActivityChannel,runActivities,tick,start,stop,
      store,activityStore,refreshSources:options=>sourceCenter?.refresh(options)??Promise.resolve([])};
}
