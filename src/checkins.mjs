import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {defaultConfigPath} from './config.mjs';
import {createSourceCheckinCenter} from './source-checkins.mjs';

const MAX_HISTORY=500;
const STATES=new Set(['success','failed','pending_confirmation','no_task','client_required','unsupported']);
const short=text=>String(text??'').replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._~-]{12,}/gi,'[REDACTED]').slice(0,180);
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
      try{renameSync(target,path)}catch(error){try{unlinkSync(target)}catch{};throw error}
      records=next;
      return structuredClone(entry);
    },
  };
}
export function createCheckinCenter({configStore,accountCenter,store=createCheckinStore(),
   now=()=>Date.now(),logger,intervalMs=60000,sourcePack}={}){
   if(!configStore?.get||!accountCenter?.find)throw Error('Config and account center are required');
   const pending=new Set();
   let timer=null,running=null;
   const sourceCenter=sourcePack?createSourceCheckinCenter({sourcePack,configStore,store,now,logger}):null;
  const currentDate=()=>todayKey(now(),configStore.get().checkin.timeZone);
  function latestFor(accountId,date=currentDate()){
    return store.all().filter(x=>x.accountId===accountId&&x.date===date).at(-1)??null;
  }
  function snapshot(){
    const cfg=configStore.get(),today=currentDate(),roster=accountCenter.list();
    const accounts=roster.accounts.map(a=>{
      const recent=latestFor(a.id,today);
      const entry=accountCenter.find(a.id),driver=accountCenter.driverFor(a.providerId);
      const implemented=typeof driver?.checkIn==='function';
      const state=pending.has(a.id)?'running':
        !implemented?'unsupported':recent?.state??'not_run';
      return {...a,autoCheckin:entry.account.autoCheckin===true,
        checkinState:state,checkinAt:recent?.at??null,
        checkinMessage:recent?.message??(implemented?'今日尚未执行签到':'未接入本渠道签到执行器'),
        checkinSupported:implemented,
      };
    });
     for(const sourceRow of sourceCenter?.snapshot()??[]){
       const existing=accounts.find(item=>item.id===sourceRow.id);
        if(existing)Object.assign(existing,{checkinSupported:sourceRow.checkinSupported,
          checkinAvailable:sourceRow.checkinAvailable,checkinState:sourceRow.checkinState,
          checkinAt:sourceRow.checkinAt,checkinMessage:sourceRow.checkinMessage,
          autoCheckin:sourceRow.autoCheckin,sourceAccount:true,
          ...(sourceRow.connectionState==='online'?{connectionState:'online'}:{}),
          ...(sourceRow.nickname?{nickname:sourceRow.nickname}:{}),
          ...(Number.isFinite(sourceRow.balance)?{balance:sourceRow.balance,
            balanceUnit:sourceRow.balanceUnit,balanceCheckedAt:sourceRow.balanceCheckedAt}:{}),
          balanceState:sourceRow.balanceState,
          ...(sourceRow.maskedPhone?{maskedPhone:sourceRow.maskedPhone}:{})});
       else accounts.push(sourceRow);
     }
     const groups=roster.channels.map(c=>{
      const members=accounts.filter(a=>a.providerId===c.id);
      return {...c,accountCount:members.length,
        success:members.filter(a=>a.checkinState==='success').length,
        failed:members.filter(a=>a.checkinState==='failed').length,
        pending:members.filter(a=>a.checkinState==='pending_confirmation').length,
        unsupported:members.filter(a=>a.checkinState==='unsupported').length,
        notRun:members.filter(a=>a.checkinState==='not_run').length};
    });
     const known=new Set(groups.map(c=>c.id));
     for(const providerId of new Set(accounts.map(a=>a.providerId))){
       if(known.has(providerId))continue;
       const members=accounts.filter(a=>a.providerId===providerId);
       groups.push({id:providerId,name:providerId,accountCount:members.length,
         success:members.filter(a=>a.checkinState==='success').length,
         failed:members.filter(a=>a.checkinState==='failed').length,
         pending:members.filter(a=>a.checkinState==='pending_confirmation').length,
         unsupported:members.filter(a=>a.checkinState==='unsupported').length,
         notRun:members.filter(a=>a.checkinState==='not_run').length});
     }
     return {today,timeZone:cfg.checkin.timeZone,autoEnabled:cfg.checkin.autoEnabled,
       autoSourceAccounts:cfg.checkin.autoSourceAccounts,
      historyBlocked:store.blocked===true,historyError:store.error??null,
      runAt:cfg.checkin.runAt,groups,accounts,
      history:store.all().slice(-80).reverse()};
  }
   async function run(accountId,{source='manual'}={}){
     if(sourceCenter&&!sourceCenter.has(accountId))await sourceCenter.refresh();
     if(sourceCenter?.has(accountId))return sourceCenter.run(accountId,{source});
    if(store.blocked){const e=new Error(store.error??'签到存储不可用');e.status=503;throw e}
    if(pending.has(accountId)){const e=new Error('本账号签到正在执行');e.status=409;throw e}
    const {account,provider,driver}=accountCenter.find(accountId);
    if(!account.enabled||!provider.enabled){const e=new Error('账号已停用，不能签到');e.status=409;throw e}
    if(typeof driver?.checkIn!=='function'){const e=new Error('该渠道尚未实现真实签到及结果验证');e.status=501;throw e}
    const date=currentDate(),previous=latestFor(accountId,date);
    if(previous?.state==='success')return {alreadyConfirmed:true,record:previous};
    pending.add(accountId);
    let state='failed',message='签到未确认';
    try{
      const reply=await driver.checkIn({account,provider,date,source});
      if(reply?.confirmed===true&&reply?.date===date){
        state='success';message=short(reply.message??'服务器已确认今日签到');
      }else if(reply?.state==='no_task'){
        state='no_task';message=short(reply.message??'该账号今日无签到任务');
      }else if(reply?.state==='client_required'){
        state='client_required';message=short(reply.message??'需在官方客户端完成');
      }else if(reply?.state==='pending_confirmation'||reply?.accepted===true){
        state='pending_confirmation';message=short(reply.message??'上游已受理，尚未确认到账');
      }else{
        message=short(reply?.message??'签到未完成且没有确认依据');
      }
    }catch(error){
      state='failed';message=short(error?.message??'渠道签到失败');
    }finally{pending.delete(accountId)}
    const record=store.append({date,accountId,providerId:provider.id,state,message,
      at:now(),source});
    logger?.info?.('native-router checkin '+provider.id+'/'+accountId+': '+state);
    return {alreadyConfirmed:false,record};
  }
  async function tick(){
    if(store.blocked)return {skipped:'history_blocked'};
    const cfg=configStore.get();
    if(!cfg.checkin.autoEnabled)return {skipped:'disabled'};
    if(clockAt(now(),cfg.checkin.timeZone)<cfg.checkin.runAt)return {skipped:'not_due'};
    if(running)return running;
    running=(async()=>{
      const results=[];
      for(const account of cfg.accounts){
        if(!account.autoCheckin||!account.enabled)continue;
        const provider=cfg.providers.find(p=>p.id===account.providerId);
        if(!provider?.enabled||typeof accountCenter.driverFor(account.providerId)?.checkIn!=='function')continue;
        if(latestFor(account.id))continue; // One automatic attempt per local day. Manual retry remains possible.
        try{results.push(await run(account.id,{source:'auto'}))}catch(error){
          logger?.warn?.('native-router checkin skip '+account.id+': '+short(error?.message));
        }
      }
       if(sourceCenter){
         const sourceResult=await sourceCenter.tick();
         results.push(...sourceResult.results??[]);
       }
       return {attempted:results.length,results};
    })().finally(()=>{running=null});
    return running;
  }
  function start(){
    if(timer)return stop;
    // Timer belongs to the plugin runtime, not Windows Task Scheduler.
    const refreshReadOnly=()=>void sourceCenter?.refresh().catch(()=>
      logger?.warn?.('source sign-in status synchronization unavailable'));
    timer=setInterval(()=>{
      refreshReadOnly();
      void tick().catch(()=>logger?.warn?.('checkin task unavailable'));
    },intervalMs);
    timer.unref?.();
    refreshReadOnly(); // Only a read-only status probe, independent of the auto-sign-in switch.
    void tick().catch(()=>logger?.warn?.('checkin startup check unavailable'));    return stop;
  }
   function stop(){if(timer){clearInterval(timer);timer=null}sourceCenter?.stop()}
    return {snapshot,sourceSnapshot:()=>sourceCenter?.snapshot()??[],run,tick,start,stop,store,refreshSources:()=>sourceCenter?.refresh()??Promise.resolve([])};
}
