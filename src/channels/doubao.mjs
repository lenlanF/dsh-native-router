// First-party self-owned Doubao Work adapter. No original plugin runtime dependency.
// Request dialect / browser login derived from hulibuld/dsh-get-it-for-free (MIT).
import {createHash} from 'node:crypto';
import {UpstreamError} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {visibleTools} from '../host-tools.mjs';
import {chat,fetchAccountInfo,fetchModels,fetchQuota,fetchLaunch,fetchCampaignDetail,
 findDailyCheckin,claimCheckin,DoubaoError,hasSession,uidFromCookie} from './doubao-upstream.mjs';
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
function hashId(cookie){
 const stable=/(?:^|;\s*)uid_tt=([^;]+)/.exec(cookie)?.[1]??'';
 let uid='';try{uid=uidFromCookie(cookie)}catch{}
 return 'db_'+createHash('sha256').update('dsh-native-router-doubao\0'+
  (stable||uid||cookie)).digest('hex').slice(0,28);
}

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
export function createDoubaoDriver({vault,fetchImpl=fetch,now=()=>Date.now(),logger}={}){
 const publicStatus=new Map(),cache=new Map(),conversations=new Map(),writes=new Set();
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
 async function addCookie({cookie,name}={}){
  const parsed=cookieHeader(cookie);
  if(typeof vault?.set!=='function'||typeof vault?.resolve!=='function')
   throw new UpstreamError('DSH Credentials cannot store Doubao',{code:'CREDENTIAL'});
  const id=hashId(parsed),key=keyFor(id);
  if(writes.has(key))throw new UpstreamError('Doubao credential import already running',{code:'CREDENTIAL'});
  writes.add(key);
  try{
   let previous;
   try{previous=await vault.resolve(key)}catch{}
   if(!previous)await vault.set(key,JSON.stringify({cookie:parsed}));
   if(typeof name==='string'&&name.length&&name.length<100)
    publicStatus.set(id,{nickname:name,balanceState:'not_checked'});
   return {id,providerId:ID,credentialRef:'driver:'+ID+':'+id,
    ...(previous?{alreadyOwned:true}:{})};
  }finally{writes.delete(key)}
 }
 function withFetch(extra={}){return {...extra,fetchImpl}}
 async function probe(account){
  const cookie=await secret(account);
  try{
   const info=await fetchAccountInfo(cookie,withFetch({timeoutMs:12000}));
   if(!info?.uid&&!info?.name)throw new UpstreamError('Doubao did not confirm account identity',{code:'UPSTREAM'});
   const current=publicStatus.get(account.id)??{};
   publicStatus.set(account.id,{...current,nickname:info.name||current.nickname,
     uidConfirmed:Boolean(info.uid||info.name),verifiedAt:now()});
   return info;
  }catch(error){
   if(error?.status===401||errorCode(error)==='710012001')
    throw new UpstreamError('Doubao session expired',{code:'CREDENTIAL',status:401});
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
 async function refresh({account}={}){
  try{
   await probe(account);
   const models=await listModels({account});
   const cookie=await secret(account);
   try{
    const q=await fetchQuota(cookie,withFetch({timeoutMs:12000}));
    const remaining=(q.windows??[]).filter(w=>Number.isFinite(w.left)).reduce((s,w)=>s+w.left,0);
    const status=publicStatus.get(account.id)??{};
    publicStatus.set(account.id,{...status,
      ...q.windows?.length?{balance:remaining,balanceUnit:'额度',balanceCheckedAt:now()}:{}});
   }catch{}
   return {state:models.length?'online':'pending',
     message:models.length?'豆包工作账号及普通对话模型目录鉴权通过（真实推理待验收）':'账号已鉴权但无可用对话模型'};
  }catch(error){
   return {state:error?.status===401?'expired':error?.status===429?'limited':'error',
     message:'豆包工作鉴权或目录暂不可用'};
  }
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
   // Upstream observed web sessions cannot claim the desktop-only 710010702
   // daily reward. No speculative claim; never report an unverified success.
   return {state:'client_required',message:'豆包每日签到需官方桌面端执行，Web 会话不能确认领取成功'};
  }catch{return {state:'pending_confirmation',message:'豆包签到状态无法核验，不视为签到成功'}}
 }
 async function rollbackCandidate({account}={}){
  const match=REF.exec(String(account?.credentialRef??''));
  if(!match||match[1]!==account?.id||account?.providerId!==ID)return;
  try{await vault?.unset?.(keyFor(match[1]))}catch{}
  publicStatus.delete(match[1]);cache.delete(match[1]);
 }
 async function logout({account}={}){
  const match=REF.exec(String(account?.credentialRef??''));
  if(match&&match[1]===account?.id)await vault?.unset?.(keyFor(match[1]));
  cache.delete(account?.id);publicStatus.delete(account?.id);
  for(const key of conversations.keys())if(key.startsWith(account.id+':'))conversations.delete(key);
  return {revokedUpstream:false,message:'豆包凭据已从本插件删除；官方账号登录不受影响'};
 }
 const browser=createLoginFlow({logger,
  addAccount:async({cookie,name})=>({account:await addCookie({cookie,name})})});
 function loginStatus(){
  const status=browser.status();
  return {...status,account:status.account?{
   id:status.account.id,providerId:ID,credentialRef:status.account.credentialRef,
   alreadyOwned:status.account.alreadyOwned===true}:null};
 }
 function accountSnapshot(account){return publicStatus.get(account?.id)??{}}
 return {authMethod:'独立浏览器扫码登录 / Cookie',
   addCookie,rollbackCandidate,loginStatus,startLogin:()=>browser.start(),cancelLogin:()=>browser.cancel(),
   listModels,generate,refresh,login:refresh,logout,checkIn,accountSnapshot};
}
