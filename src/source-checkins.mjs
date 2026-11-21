import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS,SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {todayKey,clockAt} from './checkins.mjs';
import {publicAccountName,publicBalance,checkinDisplayState,expiredCheckinConfirmation} from './account-facts.mjs';

const supported=new Set(SOURCE_DAILY_SIGNIN_PROVIDERS);const RETRY_DELAY_MS=60*60*1000;
const MAX_AUTO_ATTEMPTS=3;
const safeText=x=>String(x??'').replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._~-]{12,}/gi,'[REDACTED]').slice(0,160);

/**
 * Source-channel check-in is account-scoped, runs only inside DSH, and
 * shares the native router history. No external RPC server or timer.
 * The native pack's credits.status/credits.claimAll implementations are reused.
 */
export function createSourceCheckinCenter({sourcePack,configStore,store,now=()=>Date.now(),logger}={}){
 const roster=new Map(),pending=new Set(),statusCache=new Map(),statusAttempts=new Map();
 let refreshing=null,stopped=false;
 const STATUS_TTL_MS=5*60*1000;
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
     &&(!imported||imported.autoCheckin===true),
  };
 }
  async function refresh({force=false}={}){
  if(stopped||!sourcePack?.listAccounts)return [];
  if(refreshing)return refreshing;
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
      await Promise.all(providers.map(async providerId=>{
        const members=[...roster.values()].filter(row=>row.providerId===providerId&&active(row));
        const last=statusAttempts.get(providerId);
        if(!force){
          // A provider-level successful probe is not a proof for every
          // account on that provider. Newly enabled/imported members without
          // their own fresh result must be checked immediately, rather than
          // being blocked by the first account's five-minute success cache.
          if(members.every(row=>{
            const cached=statusCache.get(row.id);
            return cached&&cached.day===today()&&now()-cached.checkedAt<STATUS_TTL_MS;
          }))return;
          // Preserve bounded retries after failed provider requests.
          if(last&&!last.ok&&now()-last.at<60000)return;
        }
        statusAttempts.set(providerId,{at:now(),ok:false});
        const result=await sourcePack.readSourceStatuses(providerId)
          .catch(()=>({state:'unavailable'}));
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
          if(!active(row)){
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
           const facts=publicBalance(entry);
           statusCache.set(row.id,{day:today(),checkedAt:now(),nickname,
             todayCheckedIn:confirmed?true:entry.todayCheckedIn===false?false:null,
             active:entry.active===true?true:entry.active===false?false:null,
             authVerified:entry.authVerified===true,
             ...facts,
             maskedPhone:typeof entry.maskedPhone==='string'?entry.maskedPhone.slice(0,32):null});
           if(nickname)row.nickname=nickname;
         }
        // A successful provider response is not a successful authentication
        // for an account missing from its returned roster. Discard stale
        // per-account proof immediately; otherwise it remains 'online' for
        // 15 minutes after the provider stopped returning that identity.
        for(const row of members)if(!confirmedMembers.has(row.id))
          statusCache.delete(row.id);
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
   const verified=statusCache.get(row.id);
   const fresh=verified?.day===today()&&now()-verified.checkedAt<STATUS_TTL_MS*3;
   const report=fresh?verified:null;
      const confirmedFromHistory=history(row.id).some(x=>x.state==='success');
      const confirmedUpstream=verified?.day===today()&&verified.todayCheckedIn===true;
      const confirmed=confirmedFromHistory||confirmedUpstream;
      const oldPending=expiredCheckinConfirmation(recent,now());
      // "active" in provider credits.status often means a credit plan, not
      // whether a daily sign-in task exists.
      const accountState=checkinDisplayState({recent,now:now(),pending:pending.has(row.id),
        implemented,confirmed,claimable:report?.todayCheckedIn===false});
    return {id:row.id,providerId:row.providerId,providerName:row.providerId,
      nickname:row.nickname,enabled:state.enabled&&state.providerEnabled,
      configuredEnabled:row.enabled,credentialKind:'driver',
      connectionState:!state.enabled||!state.providerEnabled?'disabled':
        report?.authVerified===true?'online':'not_checked',
      sourceAccount:true,autoCheckin:state.autoCheckin,
      autoCheckinEffective:state.autoCheckin&&state.enabled&&state.providerEnabled
        &&configStore.get().checkin.autoEnabled===true,
      checkinSupported:implemented,checkinAvailable:implemented,
      checkinState:accountState,checkinAt:report?.checkedAt??recent?.at??null,
      ...publicBalance(report),
      ...(report?.maskedPhone?{maskedPhone:report.maskedPhone}:{}),
      checkinMessage:confirmedUpstream?'来源服务已核实今日签到完成':
        confirmedFromHistory?'本账号今日已有确认成功记录；来源状态尚未同步':
        oldPending?'上次请求已超过20分钟，尚无服务端签到确认；后续将限次复核':
        report?.todayCheckedIn===false?'来源服务确认今日尚未签到':
        recent?.message??(implemented?'今日签到状态暂未核实':
          row.providerId==='raccoon'?'该平台每日积分由服务端自动发放':'该渠道不提供每日签到操作'),
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
    if(successfulHistory||statusCache.get(id)?.day===today()&&
      statusCache.get(id)?.todayCheckedIn===true)
     return {alreadyConfirmed:true,record:successfulHistory??{
       date:today(),accountId:id,providerId:row.providerId,state:'success',
       message:'来源服务已确认今日签到',at:now(),source:'status'}};
  pending.add(id);
  let reply,state='failed',message='未确认';
  try{
    try{reply=await sourcePack.checkinAccount({providerId:row.providerId,sourceAccountId:row.sourceAccountId})}
    catch{reply={state:'failed',message:'来源签到请求异常，等待下次自动重试'}}
    if(reply?.state==='unavailable'){const e=Error('来源服务尚未就绪');e.status=503;throw e}
    if(stopped){const e=Error('插件已卸载，禁止写回签到历史');e.status=503;throw e}
     if(reply?.confirmed===true){state='success';message=safeText(reply.message??'今日签到已确认')}
     else if(reply?.state==='no_task'){state='no_task';message=safeText(reply.message??'今日无签到活动')}
     else if(reply?.state==='pending_confirmation'&&reply?.accepted===true){
       // Read-only confirmation must follow a confirmed acceptance response.
       await refresh({force:true});
       if(statusCache.get(id)?.day===today()&&statusCache.get(id)?.todayCheckedIn===true){
         state='success';message='上游签到状态已回查确认';
       }else{state='pending_confirmation';message='请求已受理，服务端仍未确认；自动回查和限次重试';}
     }else{message=safeText(reply?.message??'签到未确认或未发送')}
   const record=store.append({date:today(),accountId:id,providerId:row.providerId,
    state,message,at:now(),source});
   logger?.info?.('native-router source sign-in '+row.providerId+'/'+id+': '+state);
   return {alreadyConfirmed:false,record};
  }finally{pending.delete(id)}
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
   const records=history(row.id),recent=records.at(-1);
    if(records.some(x=>x.state==='success')||['no_task','client_required'].includes(recent?.state))continue;
    if(statusCache.get(row.id)?.day===today()&&statusCache.get(row.id)?.todayCheckedIn===true)continue;
   if(records.filter(x=>x.source==='auto').length>=MAX_AUTO_ATTEMPTS)continue;
   if(recent&&now()-recent.at<RETRY_DELAY_MS)continue;
   try{results.push(await run(row.id,{source:'auto'}));attempted++}
   catch(error){logger?.warn?.('source sign-in skipped '+row.providerId+': '+safeText(error?.message))}
  }
  return {attempted,results};
 }
  function stop(){stopped=true;roster.clear();statusCache.clear();statusAttempts.clear();pending.clear()}
  return {refresh,snapshot,run,tick,has,stop};}
