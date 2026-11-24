import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS,SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {todayKey,clockAt} from './checkins.mjs';
import {channelAutoEnabled} from './config.mjs';
import {publicAccountName,publicBalance,checkinDisplayState,expiredCheckinConfirmation} from './account-facts.mjs';
import {verificationWithinPeriod} from './account-verification-store.mjs';
import {publicCheckinMessage,publicAccountFailureMessage,safeCheckinDiagnostic} from './public-diagnostics.mjs';
import {LOOMY_FREE_TASKS} from './channels/loomy-rewards.mjs';

const supported=new Set(SOURCE_DAILY_SIGNIN_PROVIDERS);const RETRY_DELAY_MS=60*60*1000;
const MAX_AUTO_ATTEMPTS=3,RACCOON_MAX_AUTO_ATTEMPTS=14;
// An empty ZCode banner is a time-limited observation, not a day-long
// refusal. The official marketing feed can deliver a second card at 19:30.
const ZCODE_CARD_RECHECK_MS=30*60*1000;
// ZCode promotional Start Plan GLOBAL/WEEKEND cards drop at 19:00 Beijing.
// The other channel daily activities may already run from 10:05.
const ZCODE_PROMO_START='19:00';
/**
 * Source-channel check-in is account-scoped, runs only inside DSH, and
 * shares the native router history. No external RPC server or timer.
 * The native pack's credits.status/credits.claimAll implementations are reused.
 */
export function createSourceCheckinCenter({sourcePack,configStore,store,now=()=>Date.now(),logger,
 verificationStore,activityStore}={}){
 const roster=new Map(),pending=new Set(),statusCache=new Map(),statusAttempts=new Map();
 const activityPending=new Set(),activityLastProbe=new Map();
 let refreshing=null,stopped=false;
 // Status is valid for 15 minutes across runtime restarts. Explicit owner
 // refresh bypasses this cache. Successful sign-ins still use their durable
 // per-day confirmation history rather than an auth status alone.
 const STATUS_TTL_MS=15*60*1000;
 const today=()=>todayKey(now(),'Asia/Shanghai');
 const history=id=>store.all().filter(x=>x.accountId===id&&x.date===today());
 const latest=id=>history(id).at(-1);
 function configFor(row){
  const cfg=configStore.get();
  const imported=cfg.accounts.find(x=>x.id===row.id
    &&(x.providerId===row.providerId||x.providerId==='own_'+row.providerId));
  // A detached account can remain in the source pack's stored session.
  // Ignore its old login for BOTH display and sign-in until the owner
  // explicitly imports the same account again. Do not silently resurrect it.
  const hidden=(cfg.sessionReuse?.ignoredIds??[]).includes(row.id)&&!imported;
  // An automatically discovered account still belongs to its own native
  // channel. A disabled own_* Provider must block check-in before an account
  // has been imported into the plugin's static account list.
  const provider=cfg.providers.find(p=>p.id===(imported?.providerId??'own_'+row.providerId));
  const providerEnabled=provider?.enabled!==false;
  const enabled=!hidden&&row.enabled&&(!imported||imported.enabled===true);
  return {
   hidden,enabled,providerEnabled,
    autoCheckin:enabled&&providerEnabled&&cfg.checkin.autoSourceAccounts===true
      &&channelAutoEnabled(cfg,row.providerId)
      &&(!imported||imported.autoCheckin===true),
  };
 }
  // Reconcile with the latest precise, persisted account authentication
  // before answering model-eligibility or deciding whether credits/status
  // needs a remote call. A newer explicit credential expiration must revoke
  // a previously hydrated online badge immediately, without extra requests.
  function boundAccount(row){
    const cfg=configStore.get();
    return cfg.accounts.find(a=>a.id===row.id
      &&(a.providerId===row.providerId||a.providerId==='own_'+row.providerId));
  }
  const bindingFor=row=>boundAccount(row)?.credentialRef??null;
  const raccoonOffer=Object.freeze({kind:'raccoon_login'});
  const raccoonAccount=row=>({providerId:'own_raccoon',id:row.id,
    credentialRef:bindingFor(row)??'source:'+row.providerId+':'+row.id});
  const raccoonReceipt=row=>activityStore?.receipt?.(raccoonAccount(row),raccoonOffer)??null;
  const loomyAccount=row=>({providerId:'own_loomy',id:row.id,
    credentialRef:bindingFor(row)??'source:'+row.providerId+':'+row.id});
  const loomyBenefits=entry=>Array.isArray(entry?.benefits)?entry.benefits
    .filter(x=>x&&typeof x.kind==='string'&&x.kind.startsWith('loomy_')
      &&Object.hasOwn(LOOMY_FREE_TASKS,x.kind.slice(6))
      &&typeof x.claimed==='boolean')
    .slice(0,8).map(x=>({kind:x.kind,
      name:LOOMY_FREE_TASKS[x.kind.slice(6)].name,
      credit:LOOMY_FREE_TASKS[x.kind.slice(6)].points,
      active:true,claimed:x.claimed})):[];
  function currentStatus(row){
    let cached=statusCache.get(row.id);
    const account=boundAccount(row),bindingRef=account?.credentialRef??null;
    // A new account binding is a new authorization identity even if the
    // visible source ID did not change. Never reuse the old source cache.
    if(cached&&cached.bindingRef!==bindingRef){
      statusCache.delete(row.id);cached=null;
    }
    const saved=account?verificationStore?.get?.(account):null;
    if(saved&&(!cached||saved.checkedAt>cached.checkedAt)){
      // An intermittent request error does not revoke a still-fresh verified
      // source session. An explicit credential expiration does revoke it.
      if(cached?.authVerified===true&&['error','pending'].includes(saved.state)
        &&verificationWithinPeriod(cached,now(),STATUS_TTL_MS))return cached;
      cached={day:today(),checkedAt:saved.checkedAt,state:saved.state,
        bindingRef,authVerified:saved.state==='online',
        todayCheckedIn:cached?.day===today()?cached.todayCheckedIn:null,
        nickname:cached?.nickname??row.nickname,active:null};
      statusCache.set(row.id,cached);
    }
    return cached;
  }
   async function refresh({force=false,onlyProviderId=null,skipVerified=false}={}){
  if(stopped||!sourcePack?.listAccounts)return [];
  if(refreshing){
    if(!force&&!skipVerified)return refreshing;
    await refreshing;
    return stopped?[]:refresh({force,onlyProviderId,skipVerified});
  }
  refreshing=(async()=>{
   const reply=await sourcePack.listAccounts();
   if(stopped||reply?.state!=='ready'||!Array.isArray(reply.accounts))return snapshot();
    const seen=new Set(),next=new Map();
    for(const item of reply.accounts){
      if(typeof item?.id!=='string'||!item.id||typeof item.providerId!=='string')continue;
      const id=sourceAccountOpaqueId(item.providerId,item.id);
      if(seen.has(id))continue;
      seen.add(id);
       const label=publicAccountName(item,statusCache.get(id));
      next.set(id,{id,sourceAccountId:item.id,providerId:item.providerId,
        nickname:label.slice(0,80),enabled:item.enabled===true});
    }
    roster.clear();
    for(const [id,row] of next)roster.set(id,row);
    // This also hydrates the first state after a DSH restart. A newer
    // persisted failure/explicit expiration wins over an older source badge.
    for(const row of roster.values())currentStatus(row);
    const active=row=>{
      if(!row?.enabled)return false;
      const state=configFor(row);
      return state.enabled&&state.providerEnabled;
    };
    for(const key of [...statusCache.keys()])if(!roster.has(key)||!active(roster.get(key)))
      statusCache.delete(key);
    // A disabled or detached native channel must not continue polling its
    // old official account endpoint simply because the bundled pack still
    // holds the session. Only independently enabled accounts may trigger I/O.
     const providers=[...new Set([...roster.values()].filter(row=>active(row)
       &&SOURCE_PACK_PROVIDERS.includes(row.providerId))
       .map(row=>row.providerId))].slice(0,13);    for(const key of [...statusAttempts.keys()]){
      if(!providers.includes(key))statusAttempts.delete(key);
    }
    if(typeof sourcePack.readSourceStatuses==='function'){
      // Post-claim verification must query only the claimed Provider, not
      // force-refresh the entire set of other authenticated channels.
      const statusProviders=onlyProviderId?providers.filter(id=>id===onlyProviderId):providers;
      await Promise.all(statusProviders.map(async providerId=>{
         const members=[...roster.values()].filter(row=>{
           if(row.providerId!==providerId||!active(row))return false;
           if(!skipVerified)return true;
           const cached=currentStatus(row);
           return !(cached?.authVerified===true&&verificationWithinPeriod({state:'online',checkedAt:cached.checkedAt},now(),STATUS_TTL_MS));
         });
         if(!members.length)return;
        const bindings=new Map(members.map(row=>[row.id,bindingFor(row)]));
        const last=statusAttempts.get(providerId);
         if(!force&&!skipVerified){          // A provider-level successful probe is not a proof for every
          // account on that provider. Newly enabled/imported members without
          // their own fresh result must be checked immediately, rather than
          // being blocked by the first account's five-minute success cache.
          if(members.every(row=>{
            const cached=currentStatus(row);
            return cached&&cached.day===today()
              &&verificationWithinPeriod({state:cached.state??(cached.authVerified?'online':'pending'),
                checkedAt:cached.checkedAt},now(),STATUS_TTL_MS);
          }))return;
          // Preserve bounded retries after failed provider requests.
          if(last&&!last.ok&&now()-last.at<60000)return;
        }
        statusAttempts.set(providerId,{at:now(),ok:false});
         let result;
         if(skipVerified){
            const checked=[];let read=0;
            for(const member of members){
              if(stopped||!active(member))break;
              const item=await sourcePack.readSourceStatuses(providerId,member.sourceAccountId).catch(()=>null);
              if(item?.state==='ready'&&Array.isArray(item.accounts)){read++;checked.push(...item.accounts.filter(x=>x.accountId===member.sourceAccountId));}
            }
            result={state:read?'ready':'unavailable',accounts:checked};         }else result=await sourcePack.readSourceStatuses(providerId).catch(()=>({state:'unavailable'}));
        if(stopped||result?.state!=='ready'||!Array.isArray(result.accounts))return;
        // A logout or channel disable may occur while the remote request is
        // pending. Never commit its old successful auth proof to a disabled
        // source: that cached proof would incorrectly authorize a subsequent
        // re-adoption/re-enable without checking the new binding.
        if(!members.some(active)){
          // The request was cancelled by an owner/config change rather than
          // a source outage. Do not impose the one-minute network-error
          // backoff on a later explicit re-adoption.
          statusAttempts.delete(providerId);
          return;
        }
        statusAttempts.set(providerId,{at:now(),ok:true});
        const confirmedMembers=new Set();
        for(const entry of result.accounts){
          const matches=members.filter(row=>row.sourceAccountId===entry.accountId);
          if(matches.length!==1)continue;
          const row=matches[0];
          if(!active(row)||bindings.get(row.id)!==bindingFor(row)){
            statusCache.delete(row.id);
            continue;
          }
          confirmedMembers.add(row.id);
           const prior=statusCache.get(row.id);
           const nickname=publicAccountName(entry,prior,row);
           // A same-day authenticated claimed result remains final even if a
           // later partial response omits the task field.
           const confirmed=entry.todayCheckedIn===true||
             prior?.day===today()&&prior.todayCheckedIn===true;
           const official=publicBalance(entry);
           const previous=publicBalance(prior);
           const keepPrevious=!Number.isFinite(official.balance)&&
             Number.isFinite(previous.balance)&&prior?.bindingRef===bindingFor(row);
           const facts=keepPrevious?{...previous,balanceState:'cached'}:official;
           statusCache.set(row.id,{day:today(),checkedAt:now(),nickname,
             bindingRef:bindingFor(row),
             state:entry.authVerified===true?'online':'pending',todayCheckedIn:confirmed?true:entry.todayCheckedIn===false?false:null,
             active:entry.active===true?true:entry.active===false?false:null,
              authVerified:entry.authVerified===true,
              ...(typeof entry.claimable==='boolean'?{claimable:entry.claimable}:{}),
              ...(entry.noClaimablePlans===true?{noClaimablePlans:true}:{}),
              ...(row.providerId==='loomy'&&Array.isArray(entry.benefits)?{
                benefits:loomyBenefits(entry)}:{}),
               ...(row.providerId==='raccoon'&&typeof entry.loginRewardPending==='boolean'
                 ?{loginRewardPending:entry.loginRewardPending}:{}),
              ...(Number.isFinite(entry.activityRewardAmount)&&entry.activityRewardAmount>=0
                &&typeof entry.activityRewardUnit==='string'?{
                  activityRewardAmount:entry.activityRewardAmount,
                  activityRewardUnit:entry.activityRewardUnit}:{}),
              ...(row.providerId==='raccoon'&&entry.authVerified===true
                &&entry.activityRewardProof==='official_daily_grant_bill'
                &&Number.isSafeInteger(entry.activityRewardVerifiedAt)?{
                  activityRewardProof:'official_daily_grant_bill',
                  activityRewardVerifiedAt:entry.activityRewardVerifiedAt}:{}),
              ...(Number.isFinite(entry.activityExpiresAt)&&entry.activityExpiresAt>0
                ?{activityExpiresAt:entry.activityExpiresAt}:{}),
              ...facts,
              ...(Number.isFinite(entry.expiringPoints)&&entry.expiringPoints>0
                &&entry.balanceUnit==='积分'?{expiringPoints:entry.expiringPoints,
                ...(Number.isFinite(entry.expiringAt)?{expiringAt:entry.expiringAt}:{})}:{}),
              maskedPhone:typeof entry.maskedPhone==='string'?entry.maskedPhone.slice(0,32):null});
           // Reconcile an earlier ambiguous one-time POST from authenticated
           // official task status. Do not retry that POST after a restart.
           if(row.providerId==='raccoon'&&entry.authVerified===true
             &&entry.loginRewardTaskVerified===true&&entry.loginRewardPending===false
             &&raccoonReceipt(row)
             &&raccoonReceipt(row).state!=='confirmed')
             try{activityStore.finish(raccoonAccount(row),raccoonOffer,'confirmed')}catch{}
           if(nickname)row.nickname=nickname;
           // Close an existing daily pending record using fresh official
           // confirmation, never create a claim or conflate Raccoon login gifts.
           if(entry.authVerified===true&&entry.todayCheckedIn===true&&supported.has(row.providerId)
             &&row.providerId!=='raccoon'&&!pending.has(row.id)&&!store.blocked
             &&latest(row.id)?.state==='pending_confirmation'
             &&!history(row.id).some(x=>x.state==='success')){
             try{store.append({date:today(),accountId:row.id,providerId:row.providerId,
               state:'success',message:'官方只读任务状态确认今日已签到',at:now(),source:'status'})}catch{}
           }
         }
        // A successful provider response is not a successful authentication
        // for an account missing from its returned roster. Discard stale
        // per-account proof immediately; otherwise it remains 'online' for
        // 15 minutes after the provider stopped returning that identity.
        for(const row of members)if(!confirmedMembers.has(row.id)){
          const old=statusCache.get(row.id);
          if(!old||old.bindingRef!==bindingFor(row)){
            statusCache.delete(row.id);continue;
          }
          // An absent account is NOT authenticated, but its last public
          // name/balance must not blink out. Retain only presentation facts,
          // never a prior online badge or daily claim eligibility.
          const stale={...old,checkedAt:now(),state:'pending',
            authVerified:false,claimable:false,todayCheckedIn:null,
            benefits:[],balanceState:Number.isFinite(old.balance)?'cached':
              'not_checked'};
          delete stale.activityRewardProof;
          delete stale.activityRewardVerifiedAt;
          statusCache.set(row.id,stale);
        }
      }));
    }
    return snapshot();
  })().finally(()=>{refreshing=null});
  return refreshing;
 }
 function has(id){const row=roster.get(id);return !!row&&!configFor(row).hidden}
 function snapshot(){
  return [...roster.values()].filter(row=>!configFor(row).hidden).map(row=>{
   const state=configFor(row),recent=latest(row.id),implemented=supported.has(row.providerId);
    const receipt=row.providerId==='raccoon'?raccoonReceipt(row):null;
   const verified=currentStatus(row);
   const fresh=verified?.day===today()
     &&verificationWithinPeriod({state:verified.state??(verified.authVerified?'online':'pending'),
       checkedAt:verified.checkedAt},now(),STATUS_TTL_MS);
   const report=fresh?verified:null;
   // Authentication freshness and public display continuity are separate:
   // an expired 15-min probe must not erase the last observed account facts.
   const displayFacts=verified?.bindingRef===bindingFor(row)?verified:null;
   const displayBalance=publicBalance(report,displayFacts);
   const isCached=Number.isFinite(displayBalance.balance)&&
     (!report||displayBalance.balanceState==='cached');
   const loomy=row.providerId==='loomy'&&Array.isArray(report?.benefits)?
     report.benefits.map(offer=>{
       const receipt=activityStore?.receipt?.(loomyAccount(row),offer);
       const proven=offer.claimed===true&&receipt?.state==='confirmed'
         &&receipt.proof==='official_wallet_delta'
         &&receipt.credit===offer.credit&&Number.isSafeInteger(receipt.verifiedAt);
       return {...offer,
         ...(receipt?.state?{receiptState:receipt.state}:{}),
         ...(proven?{rewardVerified:true,rewardProof:'official_wallet_delta',
           rewardVerifiedAt:receipt.verifiedAt}:{})};
     }):null;
   const loomySummary=row.providerId==='loomy'&&activityStore?
     activityStore.summary(loomyAccount(row)):null;
      const confirmedFromHistory=history(row.id).some(x=>x.state==='success');
      const confirmedUpstream=verified?.day===today()&&verified.todayCheckedIn===true;
      const confirmed=confirmedFromHistory||confirmedUpstream;
      const oldPending=expiredCheckinConfirmation(recent,now());
      // "active" in provider credits.status often means a credit plan, not
      // whether a daily sign-in task exists.
       const accountState=checkinDisplayState({recent,now:now(),pending:pending.has(row.id),
         implemented,confirmed,
         noTask:row.providerId==='zcode'&&report?.noClaimablePlans===true,
         claimable:report?.claimable===true||
           (report?.claimable===undefined&&report?.todayCheckedIn===false
             &&report?.noClaimablePlans!==true)});    return {id:row.id,providerId:row.providerId,providerName:row.providerId,
      nickname:row.nickname,enabled:state.enabled&&state.providerEnabled,
      configuredEnabled:row.enabled,credentialKind:'driver',
      connectionState:!state.enabled||!state.providerEnabled?'disabled':
        report?.authVerified===true?'online':
        ['expired','limited'].includes(report?.state)?report.state:
        displayFacts?.authVerified===true?'recently_verified':'not_checked',
      sourceAccount:true,autoCheckin:state.autoCheckin,
       autoCheckinEffective:state.autoCheckin&&state.enabled&&state.providerEnabled,
      checkinSupported:implemented,checkinAvailable:implemented,
      // Only the authenticated, fresh official source status is enough to
      // show a currently claimable free daily activity. A local balance or
      // old checked-in flag is NOT official live eligibility.
      activityClaimable:state.enabled&&state.providerEnabled
        &&report?.authVerified===true&&report?.claimable===true,
      activitiesSupported:row.providerId==='loomy'
        &&typeof sourcePack?.claimLoomyActivities==='function',
      ...(loomy?{benefits:loomy,
        activityClaims:loomySummary}:{}),
      ...(row.providerId==='raccoon'?{
        activityClaims:{confirmed:receipt?.state==='confirmed'?1:0,
          unconfirmed:receipt&&receipt.state!=='confirmed'?1:0,
          lastAt:receipt?.at??null},
        ...(report?.loginRewardPending===true||receipt?.state==='confirmed'?{
          benefits:[{kind:'raccoon_login',active:true,
            claimed:receipt?.state==='confirmed',
            ...(Number.isFinite(receipt?.credit)?{credit:receipt.credit}:{})}]}:{})
      }:{}),
      ...(report?.active===false?{activityActive:false}:
        report?.active===true?{activityActive:true}:{}),
      checkinState:accountState,checkinAt:report?.checkedAt??recent?.at??null,
      ...(Number.isFinite(report?.activityRewardAmount)&&report.activityRewardAmount>=0
        &&typeof report.activityRewardUnit==='string'?{
          activityRewardAmount:report.activityRewardAmount,
          activityRewardUnit:report.activityRewardUnit}:{}),
      ...(report?.authVerified===true
        &&report.activityRewardProof==='official_daily_grant_bill'
        &&Number.isSafeInteger(report.activityRewardVerifiedAt)?{
          activityRewardProof:'official_daily_grant_bill',
          activityRewardVerifiedAt:report.activityRewardVerifiedAt}:{}),
      ...(Number.isFinite(report?.activityExpiresAt)&&report.activityExpiresAt>0
        ?{activityExpiresAt:report.activityExpiresAt}:{}),
      ...displayBalance,
      ...(isCached?{balanceState:'cached',balanceStale:true}:{}),
      ...(Number.isFinite(displayFacts?.expiringPoints)&&displayFacts.expiringPoints>0
        &&displayBalance.balanceUnit==='积分'
        &&Number.isFinite(displayFacts.expiringAt)&&displayFacts.expiringAt>now()?
        {expiringPoints:displayFacts.expiringPoints,expiringAt:displayFacts.expiringAt}:{}),
      ...(displayFacts?.maskedPhone?{maskedPhone:displayFacts.maskedPhone}:{}),
      checkinMessage:confirmedUpstream?'来源服务已核实今日签到完成':
        confirmedFromHistory?'本账号今日已有确认成功记录；来源状态尚未同步':
        oldPending?'上次请求已超过20分钟，尚无服务端签到确认；后续将限次复核':
         row.providerId==='zcode'&&report?.noClaimablePlans===true
           ?'官方查询当前没有可领取的 Start Plan；未证明今日已领取，后续继续检查':
         report?.claimable===true?'官方确认当前存在可领取的计划':
         report?.todayCheckedIn===false?'来源服务确认今日尚未签到':         recent?publicCheckinMessage(recent.state,recent.diagnosticCode):(implemented?'今日签到状态暂未核实':
           row.providerId==='raccoon'?'每日积分需官方网页活动触发并核验账单':'该渠道不提供每日签到操作'),
    };
  }); }
 async function run(id,{source='manual'}={}){
  if(stopped){const e=Error('插件已经停止');e.status=503;throw e}
  if(store.blocked){const e=Error(store.error??'签到历史不可用');e.status=503;throw e}
  const row=roster.get(id);
  if(!row||configFor(row).hidden){const e=Error('来源账号不存在或已移除');e.status=404;throw e}
  const cfg=configFor(row);
  if(!cfg.enabled||!cfg.providerEnabled){const e=Error('账号已停用');e.status=409;throw e}
  if(!supported.has(row.providerId)){const e=Error('此渠道没有每日签到');e.status=501;throw e}
  if(pending.has(id)){const e=Error('该账号的签到正在执行');e.status=409;throw e}
    const previous=latest(id);
    const successfulHistory=history(id).find(x=>x.state==='success');
    const pendingRaccoonLogin=row.providerId==='raccoon'
      &&statusCache.get(id)?.loginRewardPending===true&&!raccoonReceipt(row);
    if(!pendingRaccoonLogin&&(successfulHistory||statusCache.get(id)?.day===today()&&
      statusCache.get(id)?.todayCheckedIn===true))
     return {alreadyConfirmed:true,record:successfulHistory??{
       date:today(),accountId:id,providerId:row.providerId,state:'success',
       message:'来源服务已确认今日签到',at:now(),source:'status'},
       ...(row.providerId==='loomy'?{
         activities:await runFreeActivities(id,{source})}:{})};
  // A sign-in can outlive its original owner authorization. Capture the
  // exact source identity and credential binding before calling upstream;
  // late completion cannot authenticate a disabled/replaced account.
  const originalBinding=bindingFor(row);
  const stillAuthorized=()=>{
    const live=roster.get(id),status=configFor(row);
    return !stopped&&!!live&&live.providerId===row.providerId
      &&live.sourceAccountId===row.sourceAccountId&&status.enabled
      &&status.providerEnabled&&bindingFor(row)===originalBinding;
  };
  const assertAuthorized=()=>{
    if(!stillAuthorized()){
      const error=Error('来源账号授权在签到请求期间已改变，旧结果不得写入新账号');
      error.status=409;error.code='ERR_ACCOUNT_CHANGED';throw error;
    }
  };
  pending.add(id);
  let reply,state='failed',message='未确认';
  try{
    try{reply=await sourcePack.checkinAccount({providerId:row.providerId,
      sourceAccountId:row.sourceAccountId,
      ...(row.providerId==='raccoon'?{
        beforeOneTimeClaim:offer=>stillAuthorized()&&activityStore?.blocked!==true
          &&activityStore?.begin?.(raccoonAccount(row),offer)===true,
        onOneTimeOutcome:(kind,state,meta)=>{
          if(kind!=='raccoon_login'||!stillAuthorized())return;
          activityStore?.finish?.(raccoonAccount(row),raccoonOffer,state,meta);
        }
      }:{})})}
    catch{reply={state:'failed',message:'来源签到请求异常，等待下次自动重试'}}
    if(reply?.state==='unavailable'){const e=Error('来源服务尚未就绪');e.status=503;throw e}
    if(stopped){const e=Error('插件已卸载，禁止写回签到历史');e.status=503;throw e}
    assertAuthorized();
     if(reply?.confirmed===true){state='success';message=publicCheckinMessage('success')}
     else if(reply?.state==='no_task'){state='no_task';message=publicCheckinMessage('no_task')}
     else if(reply?.state==='client_required'){
       // A vendor CAPTCHA is NOT a successful/accepted claim; stop auto POST
       // until the owner completes the vendor's own verification flow.
       state='client_required';message=publicCheckinMessage('client_required');
     }
     else if(reply?.state==='pending_confirmation'
       &&(reply?.accepted===true||row.providerId==='raccoon'
         &&reply.loginRewardState==='pending_confirmation')){
       // Read-only confirmation must follow a confirmed acceptance response.
       await refresh({force:true,onlyProviderId:row.providerId});
       if(statusCache.get(id)?.day===today()&&statusCache.get(id)?.todayCheckedIn===true){
         state='success';message='上游签到状态已回查确认';
       }else{state='pending_confirmation';message=publicCheckinMessage(state,reply?.diagnosticCode);}
      }else{message=publicCheckinMessage('failed',reply?.diagnosticCode)}
   assertAuthorized();
   const record=store.append({date:today(),accountId:id,providerId:row.providerId,
     state,message,at:now(),source,
     ...(state!=='success'&&safeCheckinDiagnostic(reply?.diagnosticCode)?{diagnosticCode:safeCheckinDiagnostic(reply.diagnosticCode)}:{}),
    // Persist explicit read-only provenance across restarts. Older no_task
    // records and any claim POST result must still consume the attempt budget.
    ...(row.providerId==='zcode'&&state==='no_task'&&reply?.claimPosted===false
      ?{readOnlyNoTask:true}:{})});
   logger?.info?.('native-router source sign-in '+row.providerId+'/'+id+': '+state);
   return {alreadyConfirmed:false,record,
     ...(row.providerId==='loomy'?{
       activities:await runFreeActivities(id,{source})}:{})};
  }finally{pending.delete(id)}
 }
 async function runFreeActivities(id,{source='manual'}={}){
   if(stopped||store.blocked||activityStore?.blocked)return {state:'blocked'};
   const row=roster.get(id);
   if(!row||row.providerId!=='loomy'
      ||typeof sourcePack?.claimLoomyActivities!=='function'||!activityStore)
     return {state:'unsupported'};
   const cfg=configFor(row);
   if(!cfg.enabled||!cfg.providerEnabled)return {state:'disabled'};
    if(source==='auto'&&!cfg.autoCheckin)
      return {state:'disabled'};
   if(activityPending.has(id))return {state:'busy'};
   const key=id+'\\0'+(bindingFor(row)??'');
   if(source==='auto'&&activityLastProbe.has(key)
     &&now()-activityLastProbe.get(key)<30*60*1000)return {state:'cached'};
   activityLastProbe.set(key,now());
   const account=loomyAccount(row),credentialRef=bindingFor(row);
   const authorized=()=>{
     const live=roster.get(id);
     const config=configFor(row);
     return !stopped&&!!live&&live.sourceAccountId===row.sourceAccountId
       &&live.providerId==='loomy'&&config.enabled&&config.providerEnabled
       &&bindingFor(row)===credentialRef;
   };
   activityPending.add(id);
   try{
     const result=await sourcePack.claimLoomyActivities({
       sourceAccountId:row.sourceAccountId,
       beforeClaim:(offer,meta)=>authorized()&&activityStore.begin(account,offer,meta),
       onOutcome:(offer,state,meta)=>authorized()&&activityStore.finish(account,offer,
         state==='confirmed'?'confirmed':'pending_confirmation',meta),
       onObserved:(offer,state,meta)=>authorized()&&activityStore.finish(account,offer,
         state==='confirmed'?'confirmed':'pending_confirmation',meta),
       previousReceipt:offer=>authorized()?activityStore.receipt(account,offer):null
     });
     if(!authorized())return {state:'account_changed'};
     if(result?.confirmed>0||result?.pending>0)
       await refresh({force:true,onlyProviderId:'loomy'}).catch(()=>{});
     return {accountId:id,providerId:'loomy',
       state:result?.state??'unavailable',
       confirmed:result?.confirmed??0,pending:result?.pending??0,
       eligible:result?.eligible??0};
   }catch(error){
     logger?.warn?.('Loomy free activity unavailable: '+publicAccountFailureMessage(error));
     return {state:'unavailable'};
   }finally{activityPending.delete(id)}
 }
 async function tick(){
   if(stopped||store.blocked)return {attempted:0,results:[]};
   if(typeof sourcePack?.status==='function'&&sourcePack.status().state!=='mounted')
    return {attempted:0,results:[]};
   // Qoder and other source activities may open after 10:00 Beijing time.
   // Do not record a terminal 'no_task' before that daily eligibility window.
   if(clockAt(now(),'Asia/Shanghai')<'10:05')return {attempted:0,results:[]};
   await refresh();
  let attempted=0;
  const results=[];
  for(const row of roster.values()){
   if(stopped)break;
    const cfg=configFor(row);
    if(!cfg.enabled||!cfg.providerEnabled||!cfg.autoCheckin||!supported.has(row.providerId))continue;
    if(row.providerId==='zcode'&&clockAt(now(),'Asia/Shanghai')<ZCODE_PROMO_START)
      continue; // preserve all claim retries until promotional cards arrive
    const records=history(row.id),recent=records.at(-1);
    const zcodeEmpty=row.providerId==='zcode'&&recent?.state==='no_task';
    const zcodeEmptyRecheck=zcodeEmpty&&(
      // Legacy morning no_task may precede the evening window, but still
      // counts as a potential POST unless read-only provenance is proven.
      clockAt(recent.at,'Asia/Shanghai')<ZCODE_PROMO_START
      ||(recent?.readOnlyNoTask===true
        &&now()-recent.at>=ZCODE_CARD_RECHECK_MS));
    // A fresh official ZCode no-plans response prevents unnecessary captcha
    // and claim POST; it may become available later and is rechecked after TTL.
    const noPlan=statusCache.get(row.id);
    if(row.providerId==='zcode'&&noPlan?.day===today()&&noPlan.noClaimablePlans===true
      &&verificationWithinPeriod({state:noPlan.state,checkedAt:noPlan.checkedAt},
        now(),STATUS_TTL_MS))continue;
    const pendingRaccoonLogin=row.providerId==='raccoon'
      &&statusCache.get(row.id)?.loginRewardPending===true&&!raccoonReceipt(row);
    if((records.some(x=>x.state==='success')&&!pendingRaccoonLogin)
      ||recent?.state==='client_required')continue;
    // A morning manual no-task is not evidence that no evening card will drop.
    // A ZCode receipt accepted earlier tonight must not trigger more captchas.
    if(row.providerId==='zcode'&&recent?.state==='pending_confirmation')continue;
    if(recent?.state==='no_task'&&!zcodeEmptyRecheck
      &&row.providerId!=='raccoon')continue;
    if(statusCache.get(row.id)?.day===today()&&statusCache.get(row.id)?.todayCheckedIn===true
      &&!pendingRaccoonLogin)continue;   // Only proven read-only ZCode empty cards do not count as claim POSTs.
    // Unknown/older no_task outcomes still consume the three-attempt budget.
    if(records.filter(x=>x.source==='auto'
      &&!(row.providerId==='zcode'&&x.state==='no_task'
        &&x.readOnlyNoTask===true)).length>=
      (row.providerId==='raccoon'?RACCOON_MAX_AUTO_ATTEMPTS:MAX_AUTO_ATTEMPTS))continue;
   if(recent&&now()-recent.at<RETRY_DELAY_MS&&!zcodeEmptyRecheck)continue;
   try{results.push(await run(row.id,{source:'auto'}));attempted++}
   catch(error){logger?.warn?.('source sign-in skipped '+row.providerId+': '+publicAccountFailureMessage(error))}
  }
  const rewards=[];
  for(const row of roster.values()){
    if(stopped||row.providerId!=='loomy')continue;
    const cfg=configFor(row);
    if(!cfg.enabled||!cfg.providerEnabled||!cfg.autoCheckin)continue;
    const outcome=await runFreeActivities(row.id,{source:'auto'});
    if(outcome?.confirmed||outcome?.pending)rewards.push(outcome);
  }
  return {attempted,results,rewards};
 }
  function stop(){stopped=true;roster.clear();statusCache.clear();statusAttempts.clear();pending.clear();
    activityPending.clear();activityLastProbe.clear()}
  return {refresh,snapshot,run,runFreeActivities,tick,has,stop};}
