import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS,SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {todayKey,clockAt} from './checkins.mjs';

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
  return {
   enabled:row.enabled&&(!imported||imported.enabled===true),
   autoCheckin:cfg.checkin.autoSourceAccounts===true&&(!imported||imported.autoCheckin===true),
   providerEnabled:!imported||cfg.providers.find(p=>p.id===imported.providerId)?.enabled===true,
  };
 }
 async function refresh(){
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
      const label=typeof item.nickname==='string'&&item.nickname?
        item.nickname:statusCache.get(id)?.nickname||'';
      next.set(id,{id,sourceAccountId:item.id,providerId:item.providerId,
        nickname:label.slice(0,80),enabled:item.enabled===true});
    }
    roster.clear();
    for(const [id,row] of next)roster.set(id,row);
    for(const key of [...statusCache.keys()])if(!roster.has(key))statusCache.delete(key);
     const providers=[...new Set([...roster.values()].filter(row=>row.enabled===true&&SOURCE_PACK_PROVIDERS.includes(row.providerId))
       .map(row=>row.providerId))].slice(0,13);    for(const key of [...statusAttempts.keys()]){
      if(!providers.includes(key))statusAttempts.delete(key);
    }
    if(typeof sourcePack.readSourceStatuses==='function'){
      await Promise.all(providers.map(async providerId=>{
        const members=[...roster.values()].filter(row=>row.providerId===providerId);
        const last=statusAttempts.get(providerId);
        if(last&&now()-last.at<(last.ok?STATUS_TTL_MS:60000))return;
        if(members.every(row=>{
          const cached=statusCache.get(row.id);
          return cached&&cached.day===today()&&now()-cached.checkedAt<STATUS_TTL_MS;
        }))return;
        statusAttempts.set(providerId,{at:now(),ok:false});
        const result=await sourcePack.readSourceStatuses(providerId)
          .catch(()=>({state:'unavailable'}));
        if(stopped||result?.state!=='ready'||!Array.isArray(result.accounts))return;
        statusAttempts.set(providerId,{at:now(),ok:true});
        for(const entry of result.accounts){
          const matches=members.filter(row=>row.sourceAccountId===entry.accountId);
          if(matches.length!==1)continue;
          const row=matches[0];
           const nickname=(entry.nickname||row.nickname||'').slice(0,80);
           statusCache.set(row.id,{day:today(),checkedAt:now(),nickname,
             todayCheckedIn:entry.todayCheckedIn===true?true:
               entry.todayCheckedIn===false?false:null,
             active:entry.active===true?true:entry.active===false?false:null,
             authVerified:entry.authVerified===true,
             balanceState:entry.balanceState==='available'?'available':'not_available',
             maskedPhone:typeof entry.maskedPhone==='string'?entry.maskedPhone.slice(0,32):null,
             ...(Number.isFinite(entry.balance)&&entry.balance>=0?{balance:entry.balance,
               balanceUnit:typeof entry.balanceUnit==='string'?entry.balanceUnit.slice(0,12):'余额'}:{})});
           if(nickname)row.nickname=nickname;
         }      }));
    }
    return snapshot();
  })().finally(()=>{refreshing=null});
  return refreshing;
 }
 function has(id){return roster.has(id)}
 function snapshot(){
  return [...roster.values()].map(row=>{
   const state=configFor(row),recent=latest(row.id),implemented=supported.has(row.providerId);
   const verified=statusCache.get(row.id);
   const fresh=verified?.day===today()&&now()-verified.checkedAt<STATUS_TTL_MS*3;
   const report=fresh?verified:null;
   const accountState=pending.has(row.id)?'running':
     !implemented?'unsupported':report?.todayCheckedIn===true?'success':
     recent?.state==='success'?'success':report?.active===false?'no_task':
     report?.todayCheckedIn===false?'not_run':recent?.state??'not_run';
   return {id:row.id,providerId:row.providerId,providerName:row.providerId,
    nickname:row.nickname,enabled:state.enabled&&state.providerEnabled,
    configuredEnabled:row.enabled,credentialKind:'driver',
     connectionState:!row.enabled?'disabled':report?.authVerified===true?'online':'not_checked',
     sourceAccount:true,autoCheckin:state.autoCheckin,    checkinSupported:implemented,checkinAvailable:implemented,
    checkinState:accountState,checkinAt:report?.checkedAt??recent?.at??null,
     ...(Number.isFinite(report?.balance)?{balance:report.balance,
       balanceUnit:report.balanceUnit,balanceCheckedAt:report.checkedAt}:{}),
     ...(report?.maskedPhone?{maskedPhone:report.maskedPhone}:{}),
     balanceState:report?.balanceState??'not_checked',    checkinMessage:report?.todayCheckedIn===true?'来源服务确认今日已签到':
      report?.active===false?'来源服务确认今日无签到活动':
      report?.todayCheckedIn===false?'来源服务确认今日尚未签到':
      recent?.message??(implemented?'今日签到状态暂未核实':
        row.providerId==='raccoon'?'该平台每日积分由服务端自动发放':'该渠道不提供每日签到操作')};
  }); }
 async function run(id,{source='manual'}={}){
  if(stopped){const e=Error('插件已经停止');e.status=503;throw e}
  if(store.blocked){const e=Error(store.error??'签到历史不可用');e.status=503;throw e}
  const row=roster.get(id);
  if(!row){const e=Error('来源账号不存在或未同步');e.status=404;throw e}
  const cfg=configFor(row);
  if(!cfg.enabled||!cfg.providerEnabled){const e=Error('账号已停用');e.status=409;throw e}
  if(!supported.has(row.providerId)){const e=Error('此渠道没有每日签到');e.status=501;throw e}
  if(pending.has(id)){const e=Error('该账号的签到正在执行');e.status=409;throw e}
  const previous=latest(id);
  if(previous?.state==='success')return {alreadyConfirmed:true,record:previous};
  pending.add(id);
  let reply,state='failed',message='未确认';
  try{
    try{reply=await sourcePack.checkinAccount({providerId:row.providerId,sourceAccountId:row.sourceAccountId})}
    catch{reply={state:'failed',message:'来源签到请求异常，等待下次自动重试'}}
    if(reply?.state==='unavailable'){const e=Error('来源服务尚未就绪');e.status=503;throw e}
    if(stopped){const e=Error('插件已卸载，禁止写回签到历史');e.status=503;throw e}
    if(reply?.confirmed===true){state='success';message=safeText(reply.message??'今日签到已确认')}
   else if(reply?.state==='no_task'){state='no_task';message=safeText(reply.message??'今日无签到活动')}
   else if(reply?.state==='pending_confirmation'||reply?.accepted===true){
    state='pending_confirmation';message=safeText(reply.message??'签到回查待确认');
   }else{message=safeText(reply?.message??'签到未确认')}
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
   if(['success','no_task','client_required'].includes(recent?.state))continue;
   if(records.filter(x=>x.source==='auto').length>=MAX_AUTO_ATTEMPTS)continue;
   if(recent&&now()-recent.at<RETRY_DELAY_MS)continue;
   try{results.push(await run(row.id,{source:'auto'}));attempted++}
   catch(error){logger?.warn?.('source sign-in skipped '+row.providerId+': '+safeText(error?.message))}
  }
  return {attempted,results};
 }
  function stop(){stopped=true;roster.clear();statusCache.clear();statusAttempts.clear();pending.clear()}
  return {refresh,snapshot,run,tick,has,stop};}
