// First-party self-owned Doubao Work adapter. No original plugin runtime dependency.
// Request dialect / browser login derived from hulibuld/dsh-get-it-for-free (MIT).
import {createHash,randomUUID} from 'node:crypto';
import {UpstreamError} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {visibleTools} from '../host-tools.mjs';
import {publicAccountName} from '../account-facts.mjs';
import {chat,fetchAccountInfo,fetchModels,fetchQuota,fetchLaunch,fetchCampaignDetail,
 findDailyCheckin,claimCheckin,completedDoubaoRewards,claimCompletedDoubaoReward,
 DoubaoError,hasSession,uidFromCookie} from './doubao-upstream.mjs';
import {createLoginFlow} from './doubao-login.mjs';

const ID='own_doubao',REF=/^driver:own_doubao:(db_[a-f0-9]{28})$/;
const keyFor=id=>'NATIVE_ROUTER_DOUBAO_'+id.slice(3).toUpperCase();
const errorCode=e=>String(e?.code??'');
function cookieHeader(value){
 if(typeof value!=='string'||!value||value.length>32768||/[\r\n\u0000]/.test(value))
  throw new Error('豆包 Cookie 格式无效');
 const parts=new Map();
 for(const piece of value.split(';')){
  const at=piece.indexOf('=');
  if(at<=0)continue;
  const name=piece.slice(0,at).trim(),val=piece.slice(at+1).trim();
  if(!/^[a-zA-Z0-9_.$-]{1,80}$/.test(name)||!val||val.length>4096||/[\s\r\n]/.test(val))continue;
  parts.set(name,val);
 }
 const joined=[...parts].map(([name,val])=>name+'='+val).join('; ');
 if(!hasSession(joined))throw new Error('豆包 Cookie 不包含有效会话标识');
 return joined;
}
function legacyHashId(cookie){
 const stable=/(?:^|;\s*)uid_tt=([^;]+)/.exec(cookie)?.[1]??'';
 let uid='';try{uid=uidFromCookie(cookie)}catch{}
 return 'db_'+createHash('sha256').update('dsh-native-router-doubao\0'+
  (stable||uid||cookie)).digest('hex').slice(0,28);
}
// A browser profile/device cookie can rotate at every scan. The member's
// server-verified UID is the durable identity; keep legacy IDs readable.
const memberId=uid=>'db_'+createHash('sha256')
 .update('dsh-native-router-doubao-member\0'+uid).digest('hex').slice(0,28);

function beijingDate(now){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function isTaskModel(row){return row.isTaskMode===true}
const MAX_SESSIONS=128;
function promptFor(options){
 const messages=toChatMessages(options);
 const text=messages.map(m=>{
  const body=typeof m.content==='string'?m.content:JSON.stringify(m.content??'');
  return '['+m.role+'] '+body;
 }).join('\n\n');
 return text.slice(-80000);
}
export function createDoubaoDriver({vault,fetchImpl=fetch,now=()=>Date.now(),
 sleepMs=ms=>new Promise(resolve=>setTimeout(resolve,ms)),getAccounts=()=>[],logger}={}){
 const publicStatus=new Map(),cache=new Map(),conversations=new Map(),writes=new Set();
 const pendingRollbacks=new Map();
 async function secret(account){
  const match=REF.exec(String(account?.credentialRef??''));
  if(!match||account?.providerId!==ID||account.id!==match[1])
   throw new UpstreamError('Invalid self-owned Doubao binding',{code:'CREDENTIAL'});
  if(typeof vault?.resolve!=='function')throw new UpstreamError('DSH Credentials unavailable',{code:'CREDENTIAL'});
  let found;try{found=await vault.resolve(keyFor(match[1]))}catch{}
  const value=typeof found==='string'?found:found?.value;
  if(typeof value!=='string')throw new UpstreamError('Independent Doubao login missing',{code:'CREDENTIAL'});
  try{
   const parsed=JSON.parse(value);
   return cookieHeader(parsed.cookie);
  }catch{throw new UpstreamError('Independent Doubao cookie invalid',{code:'CREDENTIAL'})}
 }
 async function verifyMemberCookie(cookie){
  try{
   const info=await fetchAccountInfo(cookie,withFetch({timeoutMs:12000}));
   if(typeof info?.uid!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(info.uid))
    throw Error('Account identity missing');
   return info;
  }catch{
   throw new UpstreamError('Doubao membership identity not verified by remote server',
    {code:'CREDENTIAL'});
  }
 }
 async function addCookie({cookie,name,stageRollback=false}={}){
  const parsed=cookieHeader(cookie);
  if(typeof vault?.set!=='function'||typeof vault?.resolve!=='function')
   throw new UpstreamError('DSH Credentials cannot store Doubao',{code:'CREDENTIAL'});
  const remote=await verifyMemberCookie(parsed);
  // One in-process serialization scope per verified account. No background
  // app, old plugin, shared gateway, or local browser process is involved.
  const lock=memberId(remote.uid);
  if(writes.has(lock))throw new UpstreamError('Doubao member import already running',{code:'CREDENTIAL'});
  writes.add(lock);
  try{
   const configured=typeof getAccounts==='function'?getAccounts():[];
   const candidates=(Array.isArray(configured)?configured:[])
    .filter(x=>x?.providerId===ID&&typeof x.id==='string'
      &&x.credentialRef==='driver:'+ID+':'+x.id&&/^db_[a-f0-9]{28}$/.test(x.id)).slice(0,200);
   const matches=[];
   for(const account of candidates){
    let value;
    try{value=await vault.resolve(keyFor(account.id))}catch{}
    const raw=typeof value==='string'?value:value?.value;
    let saved;
    try{saved=raw?JSON.parse(raw):null}catch{}
    if(!saved||typeof saved.cookie!=='string')continue;
    let oldUid=typeof saved.uid==='string'?saved.uid:'';
    // RC.28/29 legacy records predate the member UID field. Verify their
    // still-live session only when the same old device identity is supplied.
    if(!oldUid&&legacyHashId(saved.cookie)===legacyHashId(parsed))
     try{oldUid=(await verifyMemberCookie(saved.cookie)).uid}catch{}
    if(oldUid===remote.uid)matches.push(account.id);
   }
   if(matches.length>1)
    throw new UpstreamError('Multiple owned Doubao records for the same member need reconciliation',{code:'CREDENTIAL'});
   const id=matches[0]??memberId(remote.uid),key=keyFor(id);
   let previous;
   try{previous=await vault.resolve(key)}catch{}
   const existingValue=typeof previous==='string'?previous:previous?.value;
   let existing;
   try{if(existingValue)existing=JSON.parse(existingValue)}catch{}
   const oldCookie=typeof existing?.cookie==='string'?existing.cookie:'';
   if(previous&&oldCookie!==parsed){
    let oldUid=typeof existing?.uid==='string'?existing.uid:'';
    if(!oldUid&&oldCookie)
     try{oldUid=(await verifyMemberCookie(oldCookie)).uid}catch{}
    if(oldUid!==remote.uid)
     throw new UpstreamError('Doubao reauthorization identity mismatch',{code:'CREDENTIAL'});
   }
   let rollbackToken;
   if(!previous||oldCookie!==parsed){
    const replacement=JSON.stringify({cookie:parsed,uid:remote.uid});
    await vault.set(key,replacement);
    if(stageRollback){
     rollbackToken=randomUUID();
     pendingRollbacks.set(rollbackToken,{id,
      previous:typeof existingValue==='string'?existingValue:null,replacement});
     // In-memory rollback receipts never enter config or public HTTP responses.
     if(pendingRollbacks.size>32)pendingRollbacks.delete(pendingRollbacks.keys().next().value);
    }
    cache.delete(id);
    for(const sessionKey of conversations.keys())
     if(sessionKey.startsWith(id+':'))conversations.delete(sessionKey);
   }
   const nickname=publicAccountName({nickname:remote.name},{nickname:name});
   publicStatus.set(id,{...(nickname?{nickname}:{}),
    uidConfirmed:true,verifiedAt:now(),balanceState:'not_checked'});
   return {id,providerId:ID,credentialRef:'driver:'+ID+':'+id,
    ...(previous?{alreadyOwned:true}:{}),...(rollbackToken?{rollbackToken}:{})};
  }finally{writes.delete(lock)}
 }
 function withFetch(extra={}){return {...extra,fetchImpl}}
  async function probe(account,signal){
   const cookie=await secret(account);
   try{
    const info=await fetchAccountInfo(cookie,withFetch({timeoutMs:12000,signal}));
    if(!info?.uid)throw new UpstreamError('Doubao official UID missing',{code:'UPSTREAM'});
    let raw;try{raw=await vault.resolve(keyFor(account.id))}catch{}
    const saved=typeof raw==='string'?raw:raw?.value;
    let stored;try{stored=JSON.parse(saved)}catch{}
    if(typeof stored?.uid==='string'&&stored.uid&&stored.uid!==info.uid)
     throw new UpstreamError('Doubao owned identity changed',{code:'CREDENTIAL'});
    if(!stored?.uid&&memberId(info.uid)!==account.id&&
       legacyHashId(cookie)!==account.id)
     throw new UpstreamError('Doubao account does not match member UID',{code:'CREDENTIAL'});
    const current=publicStatus.get(account.id)??{};
    const nickname=publicAccountName({nickname:info.name},current);
    publicStatus.set(account.id,{...current,...(nickname?{nickname}:{}),
      uidConfirmed:true,verifiedAt:now()});
    return info;
   }catch(error){
    // This catch is *after* a successfully opened local vault credential.
    // A server 401 or a verified member UID change is an official auth
    // rejection; by contrast a failing DSH Credentials read never got here.
    if(error?.code==='CREDENTIAL'||error?.status===401||errorCode(error)==='710012001')
     throw new UpstreamError('Doubao session identity invalid',{code:'AUTH',status:401});
    if(error?.status===429||errorCode(error)==='710022004')
     throw new UpstreamError('Doubao risk control requires official confirmation',{code:'RATE_LIMIT',status:429});
    throw new UpstreamError('Doubao official account probe failed',{code:'UPSTREAM'});
   }
   }
   async function listModels({account}={}){
  const cookie=await secret(account);
  const models=await fetchModels(cookie,withFetch({timeoutMs:15000}));
  if(!Array.isArray(models))throw new UpstreamError('Doubao catalog invalid',{code:'MODEL'});
  // Local-task models require Doubao's desktop task executor. Do not claim this
  // DSH adapter can execute them until a real tool-runtime handshake is supplied.
  const usable=models.filter(row=>!isTaskModel(row))
   .map(row=>({id:row.id,name:row.name+(row.ratio?' · '+row.ratio:'')}));
  cache.set(account.id,{at:now(),models:usable,allCount:models.length,
    unavailableTaskCount:models.length-usable.length});
  return usable;
 }
 async function generate({account,model,options={},signal}={}){
  if(signal?.aborted)throw new UpstreamError('Doubao request cancelled',{code:'CANCELLED'});
  if(visibleTools(options.tools).length)
   throw new UpstreamError('Doubao tool calls are not enabled until real host execution is verified',{code:'TOOL_PROTOCOL'});
  const cookie=await secret(account);
  const known=cache.get(account.id)?.models;
  if(!known){await listModels({account})}
  if(!cache.get(account.id)?.models.some(x=>x.id===model))
   throw new UpstreamError('Doubao model not in current independently authorized chat catalog',{code:'MODEL'});
  const sessionKey=account.id+':'+String(options.sessionId??options.agentId??'');
  const previous=conversations.get(sessionKey);
  const userMessages=toChatMessages(options).filter(x=>x.role==='user');
  const prompt=previous&&userMessages.length?String(userMessages.at(-1).content??''):promptFor(options);
  if(!prompt.trim())throw new UpstreamError('Doubao message cannot be empty',{code:'EMPTY'});
  try{
   const result=await chat(cookie,{prompt,modelId:model,
      conversationId:previous?.conversationId??'',timeoutMs:Math.min(180000,Number(options.timeoutMs)||120000),
      signal,fetchImpl});
   if(result?.conversationId){
    conversations.delete(sessionKey);
    conversations.set(sessionKey,{conversationId:result.conversationId,at:now()});
    if(conversations.size>MAX_SESSIONS)conversations.delete(conversations.keys().next().value);
   }
   if(!result?.text?.trim())throw new UpstreamError('Doubao stream returned no completed text',{code:'EMPTY'});
   return {text:result.text,reasoning:'',toolCalls:[],finishReason:'stop',usage:null};
  }catch(error){
   if(error instanceof DoubaoError){
    if(errorCode(error)==='710022004')throw new UpstreamError('Doubao risk-control challenge; automatic retry disabled',{code:'RATE_LIMIT',status:429});
    if(errorCode(error)==='710012001'||error.status===401||error.status===403)
     throw new UpstreamError('Doubao session expired; sign in again',{code:'CREDENTIAL',status:401});
    if(errorCode(error)==='710010702')
     throw new UpstreamError('Doubao desktop task runtime unavailable; try a normal chat model',{code:'CLIENT_REQUIRED'});
    throw new UpstreamError('Doubao upstream rejected model request',{code:'UPSTREAM',status:error.status||0});
   }
   throw error;
  }
 }
  async function refreshAccountStatus({account,signal}={}){
   try{
    await probe(account,signal);
    const cookie=await secret(account);
    try{
      const q=await fetchQuota(cookie,withFetch({timeoutMs:12000}));
      const windows=(Array.isArray(q.windows)?q.windows:[]).filter(w=>
       w&&typeof w.label==='string'&&Number.isFinite(w.total)&&w.total>=0
       &&Number.isFinite(w.used)&&w.used>=0&&Number.isFinite(w.left)&&w.left>=0)
       .slice(0,12).map(w=>({kind:['5h','week','grant','package'].includes(w.kind)?w.kind:'other',
         label:w.label.slice(0,50),total:w.total,used:w.used,left:w.left,
         ...(Number.isFinite(w.endAt)&&w.endAt>0?{endAt:w.endAt}:{})}));
      // These independent quota windows MUST NOT be summed: five-hour, weekly
      // and purchased package limits are overlapping periods, not a wallet.
      const primary=windows.find(w=>w.kind==='package')??
        windows.find(w=>w.kind==='grant')??windows.find(w=>w.kind==='week')??windows[0];
      const old=publicStatus.get(account.id)??{};
       publicStatus.set(account.id,{...old,
         planName:typeof q.planName==='string'?q.planName.slice(0,72):'',
         quotaWindows:windows,quotaCheckedAt:now(),
         quotaRefreshState:primary?'available':'not_returned',
         ...(primary?{balance:primary.left,balanceUnit:primary.label||'平台额度',
          balanceCheckedAt:now(),balanceState:'available'}:
          {balanceState:Number.isFinite(old.balance)?'cached':'not_returned'})});
     }catch{
      const old=publicStatus.get(account.id)??{};
      // Keep previously verified numeric quota with its historical timestamp,
      // but never pretend a failed refresh is the latest official value.
      publicStatus.set(account.id,{...old,
        balanceState:Number.isFinite(old.balance)?'cached':'unavailable',
       quotaRefreshState:'unavailable'});
     }
    // Metadata refresh only discovers official tasks; never submits awards.
    try{
      const launch=await fetchLaunch(cookie,withFetch({timeoutMs:12000}));
      const group=launch.campaignGroup||launch.campaign;
      if(group){
        const detail=await fetchCampaignDetail(cookie,group,withFetch({timeoutMs:12000}));
        const daily=findDailyCheckin(detail.tasks||[]);
        // Non-daily campaign tasks have independent conditions and are not
        // fulfilled by the simple daily check-in claim endpoint.
        const extra=completedDoubaoRewards(detail);
        const additionalTasks=(detail.tasks||[]).filter(task=>task!==daily);
        const prior=publicStatus.get(account.id)??{};
        const date=beijingDate(now());
        const verified=daily?.checkedInToday===true,claimable=daily?.checkedInToday===false;
        publicStatus.set(account.id,{...prior,
          activityState:verified?'claimed':claimable?'claimable':'not_confirmed',
          activityCheckedAt:now(),
          activityTaskCount:Math.min(additionalTasks.length,99),
          activityTaskExecutionState:extra.some(x=>!x.claimed)?
            'official_completed_reward_only':additionalTasks.length?
              'requires_verified_executor':'none',
          benefits:extra.map(rewardOffer).slice(0,40),benefitsCheckedAt:now(),
          ...(verified||claimable?{checkinDate:date,
            checkinOutcome:verified?'already':'claimable'}:{})});
      }else{
        const prior=publicStatus.get(account.id)??{};
        publicStatus.set(account.id,{...prior,activityState:'not_offered',activityCheckedAt:now()});
      }
    }catch{
      const prior=publicStatus.get(account.id)??{};
      publicStatus.set(account.id,{...prior,activityState:'unavailable'});
    }
     return {state:'online',authVerified:true,checkedAt:now(),
       message:'豆包官方身份、会员额度及活动状态已执行独立只读刷新'};
   }catch(error){
    // Do not persist 'expired' merely because Host could not read its own
    // credential record. Only an authenticated official rejection from probe
    // is definitive. Preserve the exact earlier proof for later rechecking.
    return {state:error?.code==='AUTH'?'expired':
       error?.status===429?'limited':'unavailable',authVerified:false,
       message:'豆包账号资料暂不可核验；本地凭据暂不可读取不等于官方授权过期'};
   }
  }
  async function refresh({account,signal}={}){
    const facts=await refreshAccountStatus({account,signal});
    if(facts.state!=='online')return facts;
    try{
      const models=await listModels({account,signal});
      return {state:'online',message:models.length?
        '豆包独立账号、权益及模型目录已确认（真实推理待验收）':
        '豆包身份与权益已确认，官方暂未列出可用对话模型'};
    }catch{return {state:'online',message:'豆包身份与权益已确认，但模型目录暂不可用'};}
  }
 // Authenticated, already-finished campaign rewards only; never perform
 // creative tasks, buy packages, call paid models or forge completion.
 // Source: MIT Muverix/Auto-Signin-Hub signin/doubao.py.
 const doubaoKind=(group,code)=>'doubao_task_'+createHash('sha256')
   .update(group+'\\0'+code).digest('hex').slice(0,24);
 const rewardOffer=x=>({kind:doubaoKind(x.group,x.code),
   name:x.name,active:true,claimed:x.claimed===true,credit:x.credit});
 async function discoverExtra(cookie){
   const launch=await fetchLaunch(cookie,withFetch({timeoutMs:12000}));
   const group=launch.campaignGroup||launch.campaign;
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(group))return {group:null,offers:[]};
   const detail=await fetchCampaignDetail(cookie,group,withFetch({timeoutMs:12000}));
   return {group,offers:completedDoubaoRewards(detail)};
 }
 async function grantWallet(cookie){
   try{
     const quota=await fetchQuota(cookie,withFetch({timeoutMs:12000}));
     const items=(quota?.windows||[]).filter(row=>row.kind==='grant'
       &&Number.isFinite(row.left)&&row.left>=0);
     return items.length===1?items[0].left:null;
   }catch{return null}
 }
 async function claimActivities({account,beforeClaim,onOutcome,onObserved,previousReceipt}={}){
   let cookie;try{cookie=await secret(account);await probe(account)}
   catch{return {state:'unavailable',confirmed:0,pending:0,eligible:0}}
   let discovered;try{discovered=await discoverExtra(cookie)}
   catch{return {state:'unavailable',confirmed:0,pending:0,eligible:0}}
   let confirmed=0,pending=0,skipped=0;
   const eligible=discovered.offers.filter(x=>!x.claimed);
   // Uncertain old POSTs are never reissued. Status + wallet proofs can
   // reconcile those receipts later with no further write to the campaign.
   for(const item of discovered.offers.filter(x=>x.claimed)){
     const offer=rewardOffer(item);
     let receipt=null;try{receipt=await previousReceipt?.(offer)}catch{}
     if(!receipt||receipt.state==='confirmed'
       ||!Number.isFinite(receipt.baselineBalance))continue;
     const wallet=await grantWallet(cookie);
     if(!Number.isFinite(wallet)||Math.abs(wallet-receipt.baselineBalance-item.credit)>0.000001)
       continue;
     try{await onObserved?.(offer,'confirmed',{
       credit:item.credit,proof:'official_wallet_delta',verifiedAt:now()})}catch{}
   }
   for(const item of eligible){
     const offer=rewardOffer(item);
     let receipt=null;try{receipt=await previousReceipt?.(offer)}catch{}
     if(receipt){skipped++;continue}
     const before=await grantWallet(cookie);
     if(!Number.isFinite(before)){skipped++;continue}
     let approved=false;
     try{approved=await beforeClaim?.(offer,{baselineBalance:before})===true}catch{}
     if(!approved){skipped++;continue}
     let state='pending_confirmation',meta={};
     try{
       await claimCompletedDoubaoReward(cookie,discovered.group,item.code,
         withFetch({timeoutMs:12000}));
       const latest=await discoverExtra(cookie);
       const after=await grantWallet(cookie);
       const verified=latest.offers.some(row=>row.code===item.code
         &&row.group===item.group&&row.claimed&&row.credit===item.credit);
       if(verified&&Number.isFinite(after)
         &&Math.abs(after-before-item.credit)<0.000001){
         state='confirmed';confirmed++;
         meta={credit:item.credit,proof:'official_wallet_delta',verifiedAt:now()};
       }else pending++;
     }catch{pending++}
     try{await onOutcome?.(offer,state,meta)}catch{}
     if(state!=='confirmed')break;
   }
   // Only sanitized public data enters account snapshot; private task IDs
   // never leave this driver or persist to activity receipt journal.
   try{const latest=await discoverExtra(cookie),old=publicStatus.get(account.id)??{};
     publicStatus.set(account.id,{...old,
       benefits:latest.offers.map(rewardOffer).slice(0,40),benefitsCheckedAt:now(),
       activityTaskCount:latest.offers.filter(x=>!x.claimed).length,
       activityTaskExecutionState:'official_completed_reward_only'})}catch{}
   return {state:pending?'pending_confirmation':confirmed?'confirmed':
     eligible.length?'skipped':'no_task',
     confirmed,pending,skipped,eligible:eligible.length};
 }
 async function checkIn({account,date}={}){
  const cookie=await secret(account);
  try{
   const launch=await fetchLaunch(cookie,withFetch({timeoutMs:12000}));
   const group=launch.campaignGroup||launch.campaign;
   if(!group)return {state:'no_task',message:'官方活动入口没有返回当前签到组'};
   const detail=await fetchCampaignDetail(cookie,group,withFetch({timeoutMs:12000}));
   const task=findDailyCheckin(detail.tasks||[]);
   if(!task)return {state:'no_task',message:'官方活动未列出今日签到任务'};
   if(task.checkedInToday===true)return {confirmed:true,date,
     message:'官方任务列表已确认今日签到'};
    if(task.checkedInToday!==false)
      return {state:'pending_confirmation',message:'官方没有明确报告今日未领取，禁止重复发送签到'};
    // A submitted request may consume one activity chance even on rejection.
    try{await claimCheckin(cookie,group,withFetch({timeoutMs:12000}))}
    catch(error){
      if(errorCode(error)==='710010702'||errorCode(error)==='710022004')
        return {state:'client_required',message:'官方要求在网页完成活动确认，不自动重发或跳过验证'};
      return {state:'pending_confirmation',message:'豆包网页版领取请求未确认，停止自动重复领取'};
    }
   for(const delayMs of [0,2000,4000]){
    if(delayMs)await sleepMs(delayMs);
    try{
     const latest=await fetchCampaignDetail(cookie,group,withFetch({timeoutMs:12000}));
     if(findDailyCheckin(latest.tasks||[])?.checkedInToday===true)
      return {confirmed:true,date,message:'豆包网页版活动已回查确认今日签到'};
    }catch{/* An inaccessible status endpoint cannot prove a reward. */}
   }
   return {state:'pending_confirmation',message:'豆包网页版已提交领取，官方活动详情尚未确认'};
  }catch{return {state:'pending_confirmation',message:'豆包签到状态无法核验，不视为签到成功'}}
 }
 async function rollbackCandidate({account}={}){
  const match=REF.exec(String(account?.credentialRef??''));
  if(!match||match[1]!==account?.id||account?.providerId!==ID)return;
  const pending=pendingRollbacks.get(account?.rollbackToken);
  if(pending){
   if(pending.id!==account.id)return;
   let current;
   try{current=await vault.resolve(keyFor(account.id))}catch{}
   const stored=typeof current==='string'?current:current?.value;
   if(stored===pending.replacement){
    if(pending.previous===null)await vault.unset(keyFor(account.id));
    else await vault.set(keyFor(account.id),pending.previous);
   }
   pendingRollbacks.delete(account.rollbackToken);
   publicStatus.delete(account.id);cache.delete(account.id);
   return;
  }
   // Without a matching in-flight receipt, deletion is NEVER authorized.
   // Direct Cookie imports and browser logins stage an exact rollback token.
   return;
  }
 function completeCandidate({account}={}){
  const pending=pendingRollbacks.get(account?.rollbackToken);
  if(pending?.id===account?.id)pendingRollbacks.delete(account.rollbackToken);
 }
 async function logout({account}={}){
  const match=REF.exec(String(account?.credentialRef??''));
  if(match&&match[1]===account?.id)await vault?.unset?.(keyFor(match[1]));
  cache.delete(account?.id);publicStatus.delete(account?.id);
  for(const key of conversations.keys())if(key.startsWith(account.id+':'))conversations.delete(key);
  return {revokedUpstream:false,message:'豆包凭据已从本插件删除；官方账号登录不受影响'};
 }
 const browser=createLoginFlow({logger,
  addAccount:async({cookie,name})=>({account:await addCookie({cookie,name,stageRollback:true})}),
  validateCookie:async cookie=>{
   try{await verifyMemberCookie(cookie);return true}catch{return false}
  },
  rollbackAccount:account=>rollbackCandidate({account}),
 });
 function loginStatus(){
  const status=browser.status();
  return {...status,account:status.account?{
   id:status.account.id,providerId:ID,credentialRef:status.account.credentialRef,
   alreadyOwned:status.account.alreadyOwned===true,
   ...(status.account.rollbackToken?{rollbackToken:status.account.rollbackToken}:{})}:null};
 }
  function accountSnapshot(account){return publicStatus.get(account?.id)??{}}
   async function cancelLogin(){
    const state=browser.status();
    if(state.status==='done'){
     if(state.account?.rollbackToken)
      await rollbackCandidate({account:state.account});
     return browser.dismissCompleted?.()??{status:'canceled',at:now()};
    }
    return browser.cancel();
   }
  return {authMethod:'独立浏览器扫码登录 / Cookie',
    get runtimeReady(){return typeof vault?.resolve==='function'&&typeof vault?.set==='function'},
   addCookie,rollbackCandidate,completeCandidate,loginStatus,startLogin:()=>browser.start(),cancelLogin,
    listModels,generate,refresh,refreshAccountStatus,login:refresh,logout,
    checkIn,claimActivities,accountSnapshot};
 }
