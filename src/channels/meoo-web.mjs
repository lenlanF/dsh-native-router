// Native Router independently owned Meoo Web member-session driver.
// Adapted from hulibuld/dsh-get-it-for-free v3.5.4 (MIT):
// src/meoo-web/{login,session,provider,sse}.js. No original plugin, API key,
// external gateway, browser profile persistence or unverified model catalog.
import {createHash,randomUUID} from 'node:crypto';
import {UpstreamError} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {visibleTools} from '../host-tools.mjs';
import {publicAccountName} from '../account-facts.mjs';
import {createBrowserLoginFlow} from './browser-login.mjs';
import {MeooSseTranslator,sseEvents} from './meoo-sse.mjs';

export const MEOO_WEB_ID='own_meoo_web';
export const MEOO_WEB_ORIGIN='https://meoo.com';
const REF=/^driver:own_meoo_web:(mw_[a-f0-9]{28})$/;
const KEY=id=>'NATIVE_ROUTER_MEOO_WEB_'+id.slice(3).toUpperCase();
const ORIGIN=new URL(MEOO_WEB_ORIGIN);
const ACCEPTED=/^[a-zA-Z0-9_.$-]{1,80}$/;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const UID_KEYS=['id','userId','user_id','uid'];
const MODEL_KEYS=['id','model','modelId','model_id','key','name'];
const NAME_KEYS=['name','displayName','display_name','label','title'];
const REQUIRED=['oneday_sid','login_oneday_ticket'];
const LOGIN_URL='https://meoo.com/';
const fail=(code='UPSTREAM',status=0)=>new UpstreamError(
 'Meoo Web independent membership session unavailable',{code,status});

const uidOf=user=>{
 if(!user||typeof user!=='object')return '';
 for(const key of UID_KEYS){
  const v=user[key];
  const id=typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):
   typeof v==='string'?v.trim():'';
  if(ID.test(id))return id;
 }
 return '';
};
const hashId=uid=>'mw_'+createHash('sha256')
  .update('dsh-native-router:meoo-web:member\0'+uid).digest('hex').slice(0,28);
function cookieParts(raw){
 if(typeof raw!=='string'||raw.length>32768||/[\r\n\0-\x1f]/.test(raw))
  throw fail('CREDENTIAL');
 const out=new Map();
 for(const item of raw.split(';')){
  const at=item.indexOf('=');
  if(at<=0)continue;
  const name=item.slice(0,at).trim(),value=item.slice(at+1).trim();
  if(!ACCEPTED.test(name)||!value||value.length>4096
     ||/[;\s\r\n]/.test(value))continue;
  out.set(name,value);
 }
 if(!REQUIRED.every(k=>out.has(k)))throw fail('CREDENTIAL');
 return [...out].map(([key,value])=>key+'='+value).join('; ');
}
export function meooCookieFromCdp(rows){
 if(!Array.isArray(rows))return '';
 const clean=[];
 for(const row of rows){
  const domain=String(row?.domain??'').toLowerCase().replace(/^\./,'');
  if(domain!=='meoo.com'&&!domain.endsWith('.meoo.com'))continue;
  if(!ACCEPTED.test(String(row?.name??''))||
    typeof row.value!=='string'||!row.value||row.value.length>4096||
     /[;\s\r\n]/.test(row.value))continue;
  clean.push(row.name+'='+row.value);
 }
 try{return cookieParts(clean.join('; '))}catch{return ''}
}
const safeModel=v=>typeof v==='string'&&/^[^\s\r\n\x00-\x1f]{1,128}$/.test(v);
const pick=(row,keys)=>{
 for(const key of keys)if(typeof row?.[key]==='string'&&row[key].trim())
  return row[key].trim();
 return '';
};
function findModelArray(value,depth=0){
 if(depth>4||!value||typeof value!=='object')return null;
 if(Array.isArray(value)){
  return value.length===0||value.some(x=>x&&typeof x==='object'&&pick(x,MODEL_KEYS))
   ?value:null;
 }
 for(const k of ['models','data','result','list','items','rows']){
  if(value[k]!==undefined){
   const rows=findModelArray(value[k],depth+1);
   if(rows)return rows;
  }
 }
 return null;
}
export function meooModels(payload){
 const rows=findModelArray(payload),out=[],seen=new Set();
 for(const row of rows??[]){
  if(out.length>=100)break;
  const id=pick(row,MODEL_KEYS);
  if(!safeModel(id)||seen.has(id))continue;
  seen.add(id);const title=pick(row,NAME_KEYS);
  out.push({id,name:title.slice(0,120)||id});
 }
 return out;
}
function projectIdOf(body){
 const seen=new Set(),queue=[{value:body,depth:0}];
 while(queue.length){
  const {value,depth}=queue.shift();
  if(depth>4||!value||typeof value!=='object'||seen.has(value))continue;
  seen.add(value);
  if(Array.isArray(value)){
   for(const item of value)queue.push({value:item,depth:depth+1});
   continue;
  }
  const raw=value.url_id??value.urlId??value.urlID;
  if(typeof raw==='string'&&ID.test(raw))return raw;
  for(const key of ['data','result','project','projects','list'])
   if(value[key]!==undefined)queue.push({value:value[key],depth:depth+1});
 }
 return '';
}
function ownedProject(body){
 const rows=Array.isArray(body?.data)?body.data:
  Array.isArray(body?.data?.list)?body.data.list:
  Array.isArray(body?.data?.projects)?body.data.projects:
  Array.isArray(body?.list)?body.list:[];
 for(const row of rows){
  if(row?.name==='DSH Native Router'){
   const id=projectIdOf(row);if(id)return id;
  }
 }
 return '';
}
export function meooQuota(body){
 const data=body?.data;
 if(!data||typeof data!=='object')return null;
 const point=data.userPointInfo?.account;
 const credit=Array.isArray(data.benefits)
  ?data.benefits.find(x=>x?.typeCode==='model_credits'):null;
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const remaining=num(point?.availableBalance)??(
  num(credit?.quota)!==null?
    Math.max(0,num(credit.quota)- (num(credit?.used)??0)):null);
 return remaining===null?null:{
  balance:remaining,balanceUnit:'积分',balanceCheckedAt:Date.now(),
  balanceState:'verified',
 };
}
async function boundedJson(response,limit=1048576){
 if(!response?.body)return null;
 let bytes=0,raw='';
 const decoder=new TextDecoder();
 for await(const part of response.body){
  bytes+=part.byteLength;
  if(bytes>limit)throw fail('RESPONSE_SIZE');
  raw+=decoder.decode(part,{stream:true});
 }
 raw+=decoder.decode();
 if(raw.trim().startsWith('<'))throw fail('CREDENTIAL',401);
 try{return JSON.parse(raw)}catch{throw fail('UPSTREAM')}
}
function authError(response){
 return response.status===401?fail('CREDENTIAL',401):
   fail('UPSTREAM',response.status);
}

export function createMeooWebDriver({vault,fetchImpl=fetch,now=()=>Date.now(),
 loginFactory=createBrowserLoginFlow,getAccounts=()=>[],logger,
}={}){
 const snapshots=new Map(),modelCache=new Map(),projects=new Map(),
  inFlight=new Set(),pendingRollbacks=new Map(),modelProof=new Map();
 const runtimeReady=()=>typeof vault?.resolve==='function'&&
   typeof vault?.set==='function'&&typeof vault?.unset==='function';
 async function ownCookie(account){
  const id=String(account?.id??''),match=REF.exec(String(account?.credentialRef??''));
  if(account?.providerId!==MEOO_WEB_ID||!match||match[1]!==id||!runtimeReady())
   throw fail('CREDENTIAL');
  let raw;try{raw=await vault.resolve(KEY(id))}catch{throw fail('CREDENTIAL')}
  const text=typeof raw==='string'?raw:raw?.value;
  let data;try{data=JSON.parse(text)}catch{throw fail('CREDENTIAL')}
  if(!data||data.uid!==undefined&&!ID.test(data.uid)||
    hashId(data.uid??'')!==id)throw fail('CREDENTIAL');
  return cookieParts(data.cookie);
 }
 async function request(cookie,path,{method='GET',body,signal,accept='application/json',
  timeoutMs=15000}={}){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//'))
   throw fail('UPSTREAM');
  const abort=new AbortController(),cancel=()=>abort.abort();
  const timer=setTimeout(cancel,timeoutMs);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  try{
   const result=await fetchImpl(ORIGIN.origin+path,{
    method,headers:{cookie,'user-agent':'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36',
     accept,'accept-language':'zh-CN,zh;q=0.9',origin:ORIGIN.origin,
     referer:ORIGIN.origin+'/',...(body!==undefined?{'content-type':'application/json'}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    redirect:'manual',signal:abort.signal});
   if(!result||result.status===401)throw fail('CREDENTIAL',401);
   if(result.status>=300&&result.status<400)throw fail('CREDENTIAL',result.status);
   if(!result.ok)throw authError(result);
   return result;
  }catch(error){
   if(signal?.aborted)throw fail('CANCELLED');
   if(abort.signal.aborted)throw fail('TIMEOUT');
   if(error instanceof UpstreamError)throw error;
   throw fail('UPSTREAM');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 }
 async function json(cookie,path,opts={}){
  return boundedJson(await request(cookie,path,opts));
 }
 async function remoteMember(cookie,signal){
  const body=await json(cookie,'/api/v1/user/me',{signal});
  const user=body?.data,uid=uidOf(user);
  if(!uid)throw fail('CREDENTIAL',401);
  return {uid,name:publicAccountName({nickname:user?.nickname,displayName:user?.username},user)??''};
 }
 async function addCookie({cookie,stageRollback=false}={}){
  if(!runtimeReady())throw fail('CREDENTIAL');
  const accepted=cookieParts(cookie);
  const remote=await remoteMember(accepted);
  const id=hashId(remote.uid),key=KEY(id);
  if(inFlight.has(id))throw fail('BUSY');
  inFlight.add(id);
  try{
   const configured=getAccounts();
   if(Array.isArray(configured)&&configured.some(x=>x.id===id&&
     (x.providerId!==MEOO_WEB_ID||x.credentialRef!=='driver:'+MEOO_WEB_ID+':'+id)))
    throw fail('CREDENTIAL');
   let raw;try{raw=await vault.resolve(key)}catch{}
   const value=typeof raw==='string'?raw:raw?.value;
   let previous;try{if(value)previous=JSON.parse(value)}catch{}
   if(value&&previous?.uid!==remote.uid)throw fail('CREDENTIAL');
   const updated=JSON.stringify({cookie:accepted,uid:remote.uid});
   const modified=updated!==value;
   let rollbackToken;
   if(modified){
    await vault.set(key,updated);
    if(stageRollback){
     rollbackToken=randomUUID();
     pendingRollbacks.set(rollbackToken,{id,previous:value??null,replacement:updated});
     if(pendingRollbacks.size>32)pendingRollbacks.delete(pendingRollbacks.keys().next().value);
    }
    modelCache.delete(id);projects.delete(id);modelProof.delete(id);
   }
   snapshots.set(id,{...(remote.name?{nickname:remote.name}:{}),
    uidConfirmed:true,verifiedAt:now(),balanceState:'not_checked'});
   return {id,providerId:MEOO_WEB_ID,
    credentialRef:'driver:'+MEOO_WEB_ID+':'+id,
    ...(value?{alreadyOwned:true}:{}),
    ...(rollbackToken?{rollbackToken}:{})};
  }finally{inFlight.delete(id)}
 }
 async function rollbackCandidate({account}={}){
  const id=String(account?.id??''),match=REF.exec(String(account?.credentialRef??''));
  if(account?.providerId!==MEOO_WEB_ID||!match||match[1]!==id)return;
  const journal=pendingRollbacks.get(account?.rollbackToken);
  if(journal?.id===id){
   let raw;try{raw=await vault.resolve(KEY(id))}catch{}
   const current=typeof raw==='string'?raw:raw?.value;
   if(current===journal.replacement){
    if(journal.previous===null)await vault.unset(KEY(id));
    else await vault.set(KEY(id),journal.previous);
   }
   pendingRollbacks.delete(account.rollbackToken);
   snapshots.delete(id);modelCache.delete(id);projects.delete(id);
   return;
  }
   // Only a matching, still-pending rollback journal may revoke a credential.
   // A late cancel without a journal must never erase a newly committed owner.
   return;
 }
 function completeCandidate({account}={}){
  const journal=pendingRollbacks.get(account?.rollbackToken);
  if(journal?.id===account?.id)pendingRollbacks.delete(account.rollbackToken);
 }
 async function refresh({account,signal}={}){
  try{
   const cookie=await ownCookie(account);
   const remote=await remoteMember(cookie,signal);
   if(hashId(remote.uid)!==account.id)throw fail('CREDENTIAL');
   const state=snapshots.get(account.id)??{};
   snapshots.set(account.id,{...state,uidConfirmed:true,verifiedAt:now(),
    ...(remote.name?{nickname:remote.name}:{})});
   // Quota is real member credits; a public model list never authenticates.
   try{
    const quota=meooQuota(await json(cookie,'/api/mc/entitlement/get',{signal}));
    if(quota)snapshots.set(account.id,{...snapshots.get(account.id),...quota});
   }catch{}
   return {state:'online',message:'秒悟网页自有账号已通过官方身份接口核验；完整推理需单独验收'};
  }catch(e){
   return {state:e?.code==='CREDENTIAL'?'expired':'error',
    message:'秒悟网页身份接口未确认登录有效，不展示假在线'};
  }
 }
 async function listModels({account,signal}={}){
  const cookie=await ownCookie(account);
  const member=await remoteMember(cookie,signal);
  if(hashId(member.uid)!==account.id)throw fail('CREDENTIAL');
  const models=meooModels(await json(cookie,'/api/v1/agent/models',{signal}));
  modelCache.set(account.id,models);
  return models;
 }
 function promptFor(options){
  const messages=toChatMessages(options),prompt=messages
   .map(m=>'['+m.role+'] '+(typeof m.content==='string'?m.content:
     JSON.stringify(m.content??''))).join('\n\n');
  if(!prompt.trim())throw fail('EMPTY');
  return prompt.slice(-80000);
 }
 async function projectFor(account,cookie,signal){
  const cached=projects.get(account.id);
  if(cached)return cached;
  let owned='';
  try{owned=ownedProject(await json(cookie,'/api/v1/project/list',{signal}))}catch(e){
   if(e?.code==='CREDENTIAL')throw e;
  }
  if(!owned){
   const created=await json(cookie,'/api/v1/project',{
    method:'POST',body:{name:'DSH Native Router'},signal});
   owned=projectIdOf(created);
  }
  if(!owned)throw fail('UPSTREAM');
  projects.set(account.id,owned);
  return owned;
 }
 async function generate({account,model,options={},signal}={}){
  if(signal?.aborted)throw fail('CANCELLED');
  if(visibleTools(options.tools).length)throw fail('TOOL_PROTOCOL');
  const cookie=await ownCookie(account);
  const current=await listModels({account,signal});
  if(!safeModel(model)||!current.some(x=>x.id===model))throw fail('MODEL');
  const message=promptFor(options),projectId=await projectFor(account,cookie,signal);
  const abort=new AbortController(),relay=()=>abort.abort(signal?.reason);
  if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
  const timer=setTimeout(()=>abort.abort('timeout'),125000);
  const queryPath='/api/agent/query?projectId='+encodeURIComponent(projectId);
  const queryTask=request(cookie,queryPath,{signal:abort.signal,accept:'text/event-stream',
    timeoutMs:120000}).then(res=>res,()=>null);
  let started=false;
  try{
   await json(cookie,'/api/agent/start',{method:'POST',
    body:{projectId,model,message,mode:'chat',extraParams:{llmMode:model}},
    signal:abort.signal,timeoutMs:30000});
   started=true;
   const stream=await queryTask;
   if(!stream||!String(stream.headers?.get?.('content-type')??'').includes('text/event-stream'))
    throw fail('UPSTREAM');
   const translator=new MeooSseTranslator();
   let finished=false,frames=0;
   for await(const event of sseEvents(stream.body,abort.signal)){
    if(++frames>4000)throw fail('RESPONSE_SIZE');
    if(event?.type==='error'||event?.type==='server_error')throw fail('UPSTREAM');
    translator.handle(event);
    if(translator.text.length>1048576)throw fail('RESPONSE_SIZE');
    if(event?.type==='task_complete'){
     const terminal=String(event?.status??event?.data?.status??'').toLowerCase();
     if(event?.success===false||event?.data?.success===false||
        ['failed','error','cancelled','canceled'].includes(terminal))throw fail('UPSTREAM');
     finished=true;break;
    }
   }
   if(!finished||!translator.text.trim())throw fail('INCOMPLETE_STREAM');
   modelProof.set(account.id,{at:now(),model});
   return {text:translator.text,reasoning:'',toolCalls:[],finishReason:'stop',usage:null};
  }catch(e){
   if(abort.signal.aborted)throw fail(signal?.aborted?'CANCELLED':'TIMEOUT');
   throw e instanceof UpstreamError?e:fail('UPSTREAM');
  }finally{
   abort.abort();
   if(started&&signal?.aborted)void request(cookie,'/api/agent/stop',{
    method:'POST',body:{projectId},timeoutMs:8000}).catch(()=>{});
   clearTimeout(timer);signal?.removeEventListener('abort',relay);
  }
 }
 async function logout({account}={}){
  await ownCookie(account); // exact provider/id/ref binding only
  await vault.unset(KEY(account.id));
  snapshots.delete(account.id);modelCache.delete(account.id);projects.delete(account.id);
  modelProof.delete(account.id);
  return {revokedUpstream:false,
   message:'仅删除聚合路由自有秒悟授权，不修改原浏览器或其他 DSH 渠道账号'};
 }
 const browser=loginFactory({loginUrl:LOGIN_URL,logger,
  extractCookie:meooCookieFromCdp,
  validateCookie:async cookie=>{try{await remoteMember(cookie);return true}catch{return false}},
  addAccount:async({cookie})=>({account:await addCookie({cookie,stageRollback:true})}),
  rollbackAccount:account=>rollbackCandidate({account}),
 });
 const loginStatus=()=>{
  const state=browser.status();
  return {status:state.status,at:state.at,
   ...(state.account?.id?{account:{
    id:state.account.id,providerId:MEOO_WEB_ID,
    credentialRef:state.account.credentialRef,
    alreadyOwned:state.account.alreadyOwned===true,
    ...(state.account.rollbackToken?{rollbackToken:state.account.rollbackToken}:{})}}:{})};
 };
 return {
  independentProvider:MEOO_WEB_ID,
  providerName:'秒悟网页版 · 聚合路由自有',
  authMethod:'秒悟会员独立浏览器登录或显式 Cookie 接管',
  get runtimeReady(){return runtimeReady()},
  accountSnapshot:account=>({...snapshots.get(account?.id),
   modelInferenceVerifiedAt:modelProof.get(account?.id)?.at??null}),
  addCookie,rollbackCandidate,completeCandidate,
   startLogin:()=>browser.start(),loginStatus,
   cancelLogin:async()=>{
    const state=browser.status();
    if(state.status==='done'){
     if(state.account?.rollbackToken)await rollbackCandidate({account:state.account});
     return browser.dismissCompleted?.()??{status:'canceled',at:now()};
    }
    return browser.cancel();
   },
  refresh,login:refresh,listModels,generate,logout,
 };
}
