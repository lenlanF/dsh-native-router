import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS} from './embedded-pack.mjs';
import {todayKey,clockAt} from './checkins.mjs';

const supported=new Set(SOURCE_DAILY_SIGNIN_PROVIDERS);
const RETRY_DELAY_MS=60*60*1000;
const MAX_AUTO_ATTEMPTS=3;
const safeText=x=>String(x??'').replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._~-]{12,}/gi,'[REDACTED]').slice(0,160);

/**
 * Source-channel check-in is account-scoped, runs only inside DSH, and
 * shares the native router history. No external RPC server or timer.
 * The native pack's credits.status/credits.claimAll implementations are reused.
 */
export function createSourceCheckinCenter({sourcePack,configStore,store,now=()=>Date.now(),logger}={}){
 const roster=new Map(),pending=new Set();
 let refreshing=null,stopped=false;
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
    next.set(id,{id,sourceAccountId:item.id,providerId:item.providerId,
      nickname:typeof item.nickname==='string'?item.nickname.slice(0,80):'',
      enabled:item.enabled===true});
   }
   roster.clear();
   for(const [id,row] of next)roster.set(id,row);
   return snapshot();
  })().finally(()=>{refreshing=null});
  return refreshing;
 }
 function has(id){return roster.has(id)}
 function snapshot(){
  return [...roster.values()].map(row=>{
   const state=configFor(row),recent=latest(row.id),implemented=supported.has(row.providerId);
   const accountState=pending.has(row.id)?'running':
     !implemented?'unsupported':recent?.state??'not_run';
   return {id:row.id,providerId:row.providerId,providerName:row.providerId,
    nickname:row.nickname,enabled:state.enabled&&state.providerEnabled,
    configuredEnabled:row.enabled,credentialKind:'driver',
    connectionState:row.enabled?'not_checked':'disabled',
    sourceAccount:true,autoCheckin:state.autoCheckin,
    checkinSupported:implemented,checkinAvailable:implemented,
    checkinState:accountState,checkinAt:recent?.at??null,
     checkinMessage:recent?.message??(implemented?'来源渠道今日尚未签到':
       row.providerId==='raccoon'?'该平台每日积分由服务端自动发放，无需执行签到':'该渠道不提供每日签到操作')};
  });
 }
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
 function stop(){stopped=true;roster.clear();pending.clear()}
 return {refresh,snapshot,run,tick,has,stop};
}
