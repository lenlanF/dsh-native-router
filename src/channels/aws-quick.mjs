// Independent Amazon Quick owned-member driver for DSH, not a Magpie runtime.
// MIT protocol engine: httpdone/magpie-aws-quick pinned at adf163c11bdffc74.
// The unofficial Quick bidi WebSocket may change or risk member account limits.
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {mkdirSync,existsSync} from 'node:fs';
import {UpstreamError} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {publicAccountName} from '../account-facts.mjs';
import {visibleTools} from '../host-tools.mjs';
import {startOAuthLogin,takeDiscovery,createDirectBackend} from './aws-quick-vendor/lib/oauth.mjs';
import {loadCredManSession} from './aws-quick-vendor/lib/credman.mjs';
import {handleChatCompletions,disposeQuickBackend} from './aws-quick-vendor/lib/handler.mjs';
import {createSessionStore} from './aws-quick-vendor/lib/sessions.mjs';
import {quickUsage} from './aws-quick-vendor/lib/usage.mjs';

export const AWS_QUICK_ID='own_aws_quick';
const REF=/^driver:own_aws_quick:(aq_[a-f0-9]{28})$/;
const MODES=Object.freeze(['fast','balanced','smart','advanced']);
const ID_KEY=id=>'NATIVE_ROUTER_AWS_QUICK_'+id.slice(3).toUpperCase();
const SAFE_ID=/^[^\u0000-\u001f]{4,320}$/;
const fail=(code='UPSTREAM',status=0)=>new UpstreamError(
 'Amazon Quick 自有账号授权或模型协议暂不可用',{code,status});
function goodIdentity(s){
 const v=typeof s==='string'?s.trim():'';
 return SAFE_ID.test(v)?v:'';
}
function localName(source){
 return publicAccountName({
  displayName:source?.display_name,username:source?.user_name,
  nickname:source?.account_name,email:source?.email},source)??'';
}
function identityKey(session){
 const user=session?.user_info??{};
 const actor=goodIdentity(user.user_arn??session?.actor_arn);
 const email=goodIdentity(user.email??session?.email).toLowerCase();
 const tenant=goodIdentity(session?.aws_account_id??user.aws_account_id);
 const who=actor||email;
 if(!who)return '';
 return tenant+'|'+who;
}
function accountId(session){
 const identity=identityKey(session);
 if(!identity)return '';
 return 'aq_'+createHash('sha256')
  .update('dsh-native-router:amazon-quick:owner-v1\0'+identity)
  .digest('hex').slice(0,28);
}
function endpointFor(session,{allowLoopback=false}={}){
 let url;
 try{url=new URL(String(session?.tenant_url??''))}catch{throw fail('CREDENTIAL')}
 const loopback=allowLoopback&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!loopback&&url.protocol!=='https:')throw fail('CREDENTIAL');
 if(loopback&&url.protocol!=='http:')throw fail('CREDENTIAL');
 if(!loopback&&!url.hostname.endsWith('.plato.ai.aws.dev'))throw fail('CREDENTIAL');
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw fail('CREDENTIAL');
 const ws=String(session?.ws_host??'').trim();
 const expected=loopback?'ws://'+url.host:url.host;
 if(ws!==expected)throw fail('CREDENTIAL');
 return url.origin;
}
function sanitized(session,opts){
 if(!session||typeof session!=='object'||Array.isArray(session))throw fail('CREDENTIAL');
 const s=structuredClone(session);
 delete s._raw;delete s._credTarget;delete s.password;
 delete s.credentials;delete s.cookies;
 const info=s.user_info??{};
 s.email=String(info.email??s.email??'').slice(0,254);
 s.actor_arn=String(info.user_arn??s.actor_arn??'').slice(0,320);
 s.display_name=localName(info).slice(0,120);
 s.aws_account_id=String(info.aws_account_id??s.aws_account_id??'').slice(0,64);
 s.user_info={...info,email:s.email,user_arn:s.actor_arn,aws_account_id:s.aws_account_id};
 const jwt=typeof s.jwt==='string'&&s.jwt.length>=12&&s.jwt.length<32768;
 const refresh=typeof s.tokens?.refresh_token==='string'&&s.tokens.refresh_token.length<32768;
 if(!jwt||!refresh||!s.tokens?.access_token||!accountId(s))throw fail('CREDENTIAL');
 endpointFor(s,opts);
 if(!s.client||typeof s.client!=='object')throw fail('CREDENTIAL');
 const issuer=String(s.client.issuer_url??s.discovery?.issuer_url??'');
 if(issuer){
  let u;try{u=new URL(issuer)}catch{throw fail('CREDENTIAL')}
  if(u.protocol!=='https:'||u.username||u.password||
    !u.hostname.endsWith('.amazonaws.com'))throw fail('CREDENTIAL');
 }
 return s;
}
function identityOf(payload){
 const source=payload?.userInfo??payload?.data?.userInfo??payload?.data??payload;
 if(!source||typeof source!=='object'||Array.isArray(source))return {};
 const pick=(...keys)=>keys.map(k=>source[k]).find(v=>typeof v==='string'&&v.trim())??'';
 return {
  email:pick('email','emailAddress'),
  user_arn:pick('userArn','user_arn'),
  aws_account_id:pick('awsAccountId','aws_account_id','accountId'),
  user_name:pick('userName','user_name','username'),
  account_name:pick('accountName','account_name'),
  display_name:pick('displayName','display_name'),
 };
}
async function boundedText(response,size=65536){
 const t=await response.text();
 if(t.length>size)throw fail('RESPONSE_SIZE');
 try{return JSON.parse(t)}catch{throw fail('UPSTREAM')}
}
export function createAwsQuickDriver({
 vault,fetchImpl=fetch,getAccounts=()=>[],now=()=>Date.now(),
 loginFactory=startOAuthLogin,localSource=loadCredManSession,
 allowTestLoopback=false,loginDir,logger,
}={}){
  const snapshots=new Map(),rollback=new Map(),backends=new Map(),writes=new Set();
 const threads=createSessionStore({max:200,ttlMs:24*60*60*1000});
 let login=null,disposed=false;
 const vaultReady=()=>typeof vault?.resolve==='function'&&
  typeof vault?.set==='function'&&typeof vault?.unset==='function';
 async function fetchBound(url,init){
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),12000);
  const relay=()=>abort.abort();
  if(init?.signal?.aborted)relay();
  else init?.signal?.addEventListener('abort',relay,{once:true});
  try{return await fetchImpl(url,{...init,redirect:'manual',signal:abort.signal})}
  finally{clearTimeout(timer);init?.signal?.removeEventListener('abort',relay)}
 }
 async function readSession(account){
  if(!vaultReady()||account?.providerId!==AWS_QUICK_ID)throw fail('CREDENTIAL');
  const match=REF.exec(String(account.credentialRef??''));
  if(!match||match[1]!==account.id)throw fail('CREDENTIAL');
  let value;try{value=await vault.resolve(ID_KEY(account.id))}catch{}
  const raw=typeof value==='string'?value:value?.value;
  let stored;try{stored=JSON.parse(raw)}catch{throw fail('CREDENTIAL')}
  const data=sanitized(stored,{allowLoopback:allowTestLoopback});
  if(accountId(data)!==account.id)throw fail('CREDENTIAL');
  return data;
 }
  async function ownBackend(account){
   const id=account.id;
   if(backends.has(id))return backends.get(id);
  const backend=createDirectBackend({
   load:()=>readSession(account),
   fetchImpl:fetchBound,
   persist:async fresh=>{
    const normalized=sanitized(fresh,{allowLoopback:allowTestLoopback});
    if(accountId(normalized)!==id)throw fail('CREDENTIAL');
    const former=await readSession(account);
    if(identityKey(former)!==identityKey(normalized))throw fail('CREDENTIAL');
    await vault.set(ID_KEY(id),JSON.stringify(normalized));
   },
  });
  backends.set(id,backend);
  return backend;
 }
 async function userInfo(session,signal){
  const base=endpointFor(session,{allowLoopback:allowTestLoopback});
  const auth=session.tokens?.access_token;
  if(typeof auth!=='string'||auth.length<12)throw fail('CREDENTIAL');
  let res;try{
   res=await fetchBound(base+'/integration/quick-work/user-info',{
    method:'POST',headers:{Authorization:'Bearer '+auth,
      'content-type':'application/json',Accept:'application/json'},
    body:'{}',signal});
  }catch{throw fail('UPSTREAM')}
  if(res.status===401||res.status===403)throw fail('CREDENTIAL',res.status);
  if(!res.ok)throw fail('UPSTREAM',res.status);
  const info=identityOf(await boundedText(res));
   if(!info.user_arn&&!info.email)throw fail('CREDENTIAL');
   // Local Quick CredMan records may contain only an email or only a
   // provider ARN. Do not reject the FIRST official identity enrichment;
   // reject any conflicting identity or tenant already present instead.
   const old=session?.user_info??{};
   const previousArn=goodIdentity(old.user_arn||session.actor_arn);
   const previousEmail=goodIdentity(old.email||session.email).toLowerCase();
   if(previousArn&&info.user_arn&&previousArn!==info.user_arn)
    throw fail('CREDENTIAL');
   if(previousEmail&&info.email&&previousEmail!==info.email.toLowerCase())
    throw fail('CREDENTIAL');
   if(info.aws_account_id&&session.aws_account_id&&
     info.aws_account_id!==session.aws_account_id)throw fail('CREDENTIAL');
   return info;
  }
  async function verified(session,signal){
   // Only contact a fixed allowed Quick data-plane host; never trust a
   // credential source for an arbitrary remote token destination.
   endpointFor(session,{allowLoopback:allowTestLoopback});
   const info=await userInfo(session,signal);
   return sanitized({...session,user_info:{...session.user_info,...info}},
    {allowLoopback:allowTestLoopback});
  }
 async function stageSession(session,{stageRollback=true}={}){
  if(!vaultReady()||disposed)throw fail('CREDENTIAL');
  const result=await verified(session);
   const id=accountId(result),ref='driver:'+AWS_QUICK_ID+':'+id;
   if(writes.has(id))throw fail('BUSY');
   writes.add(id);
   try{
    const configured=getAccounts();
    if(Array.isArray(configured)&&configured.some(x=>x.id===id&&
      (x.providerId!==AWS_QUICK_ID||x.credentialRef!==ref)))throw fail('CREDENTIAL');
    let old;try{old=await vault.resolve(ID_KEY(id))}catch{}
    const before=typeof old==='string'?old:old?.value;
    if(before){
     const existing=sanitized(JSON.parse(before),{allowLoopback:allowTestLoopback});
     if(identityKey(existing)!==identityKey(result))throw fail('CREDENTIAL');
    }
    const replacement=JSON.stringify(result);
    let rollbackToken;
    if(before!==replacement){
     await vault.set(ID_KEY(id),replacement);
     if(stageRollback){
      rollbackToken=randomUUID();
      rollback.set(rollbackToken,{id,previous:before??null,replacement});
     }
    }
    snapshots.set(id,{accountName:localName(result.user_info),
     verifiedAt:now(),authVerified:true,balanceState:'not_checked'});
    return {id,providerId:AWS_QUICK_ID,credentialRef:ref,
     ...(before?{alreadyOwned:true}:{}),...(rollbackToken?{rollbackToken}:{})};
   }finally{writes.delete(id)}
  }
 async function rollbackCandidate({account}={}){
  const match=REF.exec(String(account?.credentialRef??''));
  if(!match||match[1]!==account.id)return;
  const pending=rollback.get(account?.rollbackToken);
  if(!pending||pending.id!==account.id)return;
  let cur;try{cur=await vault.resolve(ID_KEY(account.id))}catch{}
  const current=typeof cur==='string'?cur:cur?.value;
  if(current===pending.replacement){
   if(pending.previous===null)await vault.unset(ID_KEY(account.id));
   else await vault.set(ID_KEY(account.id),pending.previous);
  }
  rollback.delete(account.rollbackToken);
  snapshots.delete(account.id);
  const backend=backends.get(account.id);
  if(backend){await disposeQuickBackend(backend);backends.delete(account.id)}
 }
 function completeCandidate({account}={}){
  const r=rollback.get(account?.rollbackToken);
  if(r?.id===account?.id)rollback.delete(account.rollbackToken);
 }
 async function importLocal(){
   if(process.platform!=='win32'&&localSource===loadCredManSession)
    throw fail('NOT_SUPPORTED');
  // Explicit user action only. Never write the desktop Credential Manager.
  let found;try{found=await localSource()}catch{throw fail('CREDENTIAL')}
  if(!found)throw fail('CREDENTIAL');
  return stageSession(found,{stageRollback:true});
 }
 async function usageFor(backend,signal){
  const result=await quickUsage(()=>backend.session(),{fetchImpl:fetchBound,signal});
  if(result?.signIn==='expired')throw fail('CREDENTIAL',401);
  if(result?.error)return {balanceState:'unavailable',quotaRefreshState:'unavailable'};
  const windows=Array.isArray(result?.windows)?result.windows.slice(0,12):[];
  const first=windows.find(w=>Number.isFinite(w.balance))??
   windows.find(w=>Number.isFinite(w.limit)&&Number.isFinite(w.amount));
  const remaining=first?(Number.isFinite(first.balance)?first.balance:
    Math.max(0,first.limit-first.amount)):null;
  return {planName:typeof result?.plan==='string'?result.plan.slice(0,90):'',
    quotaWindows:windows.map(row=>{
     const total=Number.isFinite(row.limit)?row.limit:null;
     const used=Number.isFinite(row.amount)?row.amount:null;
     const left=Number.isFinite(row.balance)?row.balance:
       total!==null&&used!==null?Math.max(0,total-used):null;
     const resetAt=Date.parse(row.resetsAt??'');
     return {label:String(row.name??'Quick额度').slice(0,65),
       ...(left!==null?{left}:{}),...(used!==null?{used}:{}),
       ...(total!==null?{total}:{}),unit:'h',
       ...(Number.isFinite(resetAt)?{endAt:resetAt}:{})};
    }),   ...(Number.isFinite(remaining)?{
    balance:remaining,balanceUnit:'h',balanceCheckedAt:now(),
    balanceState:'available'}:{balanceState:'not_returned'}),
   quotaCheckedAt:now(),
   ...(typeof result?.until==='string'&&result.until?{
    membershipResetAt:Date.parse(result.until)}:{})};
 }
 async function refreshAccountStatus({account,signal}={}){
  try{
   const backend=await ownBackend(account);
   await backend.ensure();
    let session=await backend.session();
    let stored=await readSession(account);
    let info;
    try{info=await userInfo({...stored,...session},signal)}
    catch(error){
     if(error?.status!==401||signal?.aborted)throw error;
     // The access token may be revoked before its local expiry. Refresh
     // once through the existing OAuth grant, then verify the same identity.
     session=await backend.session({fresh:true});
     stored=await readSession(account);
     info=await userInfo({...stored,...session},signal);
    }
   if(identityKey({...stored,user_info:{...stored.user_info,...info}})!==
     identityKey(stored))throw fail('CREDENTIAL');
   const quota=await usageFor(backend,signal).catch(e=>
    e?.code==='CREDENTIAL'?{balanceState:'not_checked'}:
      {balanceState:'unavailable'});
   const old=snapshots.get(account.id)??{};
   snapshots.set(account.id,{...old,
    accountName:localName({...stored.user_info,...info}),
    verifiedAt:now(),authVerified:true,...quota});
   return {state:'online',authVerified:true,checkedAt:now()};
  }catch(e){
   return {state:e?.code==='CREDENTIAL'?'expired':'unavailable',
    authVerified:false};
  }
 }
 async function refresh({account,signal}={}){
  const status=await refreshAccountStatus({account,signal});
  return {state:status.state,message:status.state==='online'?
   'Amazon Quick 自有账号身份与用量已只读核验，实际模型推理需另行验收':
   'Amazon Quick 授权暂未通过官方实时账号接口确认'};
 }
 async function listModels({account}={}){
  await readSession(account);
  return MODES.map(mode=>({id:mode,
   name:'Quick '+mode+' · 服务端动态选模 · 倍率待确认'}));
 }
 async function generate({account,model,options={},signal}={}){
  if(!MODES.includes(model))throw fail('MODEL');
  if(signal?.aborted)throw fail('CANCELLED');
  const backend=await ownBackend(account);
  const messages=toChatMessages(options);
  if(!messages.some(m=>m.role==='user'&&typeof m.content==='string'&&m.content.trim()))
   throw fail('EMPTY');
  const tools=visibleTools(options.tools);
  const body={model,messages,stream:false,
   ...(tools.length?{tools}:{}),
   ...(options.toolChoice?{tool_choice:options.toolChoice}:{}),
   ...(options.reasoningEffort?{reasoning_effort:options.reasoningEffort}:{})};
  // Native handler manages exact AWS event-stream CRC, agentic turn lifecycle,
  // thread reuse, image limits and constrained text-based tool fallback.
  const response=await handleChatCompletions({body,
   outpostMgr:backend,sessions:threads,
   options:{identity:account.id,log:()=>{}},signal});
  if(!response.ok)throw fail(response.status===401?'CREDENTIAL':
   response.status===429?'RATE_LIMIT':'UPSTREAM',response.status);
  const parsed=await boundedText(response,2097152);
  const choice=parsed?.choices?.[0],message=choice?.message??{};
  const text=typeof message.content==='string'?message.content:'';
  const rawCalls=Array.isArray(message.tool_calls)?message.tool_calls:[];
  const toolCalls=rawCalls.map(call=>({
   id:call.id,name:call.function?.name,arguments:call.function?.arguments
  }));
  if(choice?.finish_reason!=='stop'&&choice?.finish_reason!=='tool_calls')
   throw fail('INCOMPLETE_STREAM');
  if(!text.trim()&&!toolCalls.length)throw fail('INCOMPLETE_STREAM');
  snapshots.set(account.id,{...snapshots.get(account.id),
   modelInferenceVerifiedAt:now(),modelInferenceVerifiedModel:model});
  return {text,reasoning:String(message.reasoning_content??''),
   toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',
   usage:parsed?.usage??null};
 }
 async function logout({account}={}){
  await readSession(account);
  await vault.unset(ID_KEY(account.id));
  snapshots.delete(account.id);
  const backend=backends.get(account.id);
  if(backend){await disposeQuickBackend(backend);backends.delete(account.id)}
   if(login?.account?.id===account.id)login={status:'idle',at:now()};
   return {revokedUpstream:false,
   message:'仅删除 DSH 自有 Amazon Quick 凭据；不会退出原客户端'};
 }
 function loginStatus(){
  if(!login)return {status:'idle'};
  return {status:login.status,at:login.at,
   ...(login.status==='waiting'?{loginUrl:login.url}:{}),
   ...(login.status==='done'&&login.account?{account:login.account}:{}),
   ...(login.status==='discovery_saved'?{hint:'请重新申请已记住租户的授权链接'}:{})};
 }
 async function startLogin(){
  if(!vaultReady()||disposed)throw fail('CREDENTIAL');
  if(login?.status==='waiting')return loginStatus();
  const dir=loginDir??(process.platform==='win32'&&existsSync('E:\\Temp')?
   'E:\\Temp\\dsh-native-router-quick-oauth':
   join(homedir(),'.dsh','plugins','dsh-native-router','aws-quick-oauth'));
  mkdirSync(dir,{recursive:true,mode:0o700});
  const discovery=takeDiscovery(dir);
  const opts={fetchImpl:fetchBound,timeoutMs:10*60*1000,dir,
   ...(discovery?{discovery}:{})};
  const session=await loginFactory(opts);
  const flow={status:'waiting',at:now(),url:session.url,
   cancel:session.cancel,submit:session.submit};
  login=flow;
  Promise.resolve(session.done).then(async saved=>{
   const account=await stageSession(saved,{stageRollback:true});
   if(login!==flow||flow.status!=='waiting'){
    await rollbackCandidate({account});return;
   }
   flow.account=account;flow.status='done';flow.at=now();
   }).catch(()=>{
    if(login===flow&&flow.status==='waiting'){
     flow.status='error';flow.at=now();
    }
   });
  return loginStatus();
 }
 async function pollLogin(){return loginStatus()}
 async function submitLogin({callbackUrl}={}){
  if(login?.status!=='waiting'||typeof login.submit!=='function')throw fail('BUSY');
  if(typeof callbackUrl!=='string'||callbackUrl.length>12000)throw fail('CREDENTIAL');
  try{await login.submit(callbackUrl)}catch(e){
   if(e?.kind==='discovery-saved'){
    login.cancel?.();login.status='discovery_saved';
    return loginStatus();
   }
   throw fail('CREDENTIAL');
  }
  return loginStatus();
 }
 async function cancelLogin(){
  const flow=login;
  if(!flow)return {status:'idle'};
  flow.status='canceled';flow.at=now();
  flow.cancel?.();
  if(flow.account?.rollbackToken)await rollbackCandidate({account:flow.account});
  return loginStatus();
 }
 async function dispose(){
  disposed=true;await cancelLogin();
  for(const backend of backends.values())await disposeQuickBackend(backend);
  backends.clear();
 }
 return {
  independentProvider:AWS_QUICK_ID,providerName:'Amazon Quick · DSH 自有会员',
  authMethod:'Amazon Quick 网页 OAuth PKCE / 本地凭据一次性独立接管',
  get runtimeReady(){return vaultReady()},
  accountSnapshot:account=>snapshots.get(account?.id)??{},
  startLogin,pollLogin,submitLogin,loginStatus,cancelLogin,
  importLocal,stageSession,rollbackCandidate,completeCandidate,
  refresh,refreshAccountStatus,listModels,generate,logout,dispose,
 };
}
