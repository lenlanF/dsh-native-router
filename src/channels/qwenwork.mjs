// QwenWork member route: direct DSH native COSY signing and OAuth device flow.
// MIT implementation adapted from hulibuld/dsh-get-it-for-free v3.5.4 /
// dsh-qwenwork-connect. No original desktop, shim/gateway listener or API key.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {UpstreamError} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {visibleTools} from '../host-tools.mjs';
import {publicAccountName} from '../account-facts.mjs';
import {createSignerSession,buildInferBody}
 from './qwenwork-vendor/signer-session.mjs';
import {parseCatalog} from './qwenwork-vendor/catalog.mjs';
import {SseParser,parseQwenWorkFrame} from './qwenwork-vendor/sse.mjs';
import {decodeBody,looksEncoded} from './qwenwork-vendor/cosy.mjs';

export const QWENWORK_ID='own_qwenwork';
export const QWENWORK_GATEWAY='https://gateway.qwenwork.cn';
const CLIENT_ID='e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb';
const REF=/^driver:own_qwenwork:(qw_[a-f0-9]{28})$/;
const KEY=id=>'NATIVE_ROUTER_QWENWORK_'+id.slice(3).toUpperCase();
const idFor=(uid,organization='')=>'qw_'+createHash('sha256')
 .update('dsh-native-router:qwenwork:org\\0'+uid+'\\0'+organization)
 .digest('hex').slice(0,28);
const ID=/^[a-zA-Z0-9_.@-]{1,160}$/;
const safeToken=t=>typeof t==='string'&&t.length>=16&&t.length<=16384&&
 !/[\r\n\0-\x1f]/.test(t);
const err=(code='UPSTREAM',status=0)=>new UpstreamError(
 'QwenWork independent member account unavailable',{code,status});
function unpackJwt(token){
 try{
  const payload=token.split('.')[1];
  if(!payload||payload.length>8192)return {};
  return JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
 }catch{return {}}
}
function remoteUid(user){
 if(!user||typeof user!=='object')return '';
 for(const k of ['id','uid','user_id','userId']){
  const raw=user[k],uid=typeof raw==='number'&&Number.isSafeInteger(raw)?String(raw):
   typeof raw==='string'?raw.trim():'';
  if(ID.test(uid))return uid;
 }
 return '';
}
function organizationOf(user){
 const raw=user?.organization_id??user?.organizationId??user?.biz_org_id??user?.orgId??'';
 const text=typeof raw==='number'&&Number.isSafeInteger(raw)?String(raw):
   typeof raw==='string'?raw.trim():'';
 return ID.test(text)?text:'';
}
const parseBody=async response=>{
 const text=await response.text();
 if(text.length>2*1024*1024)throw err('RESPONSE_SIZE');
 let content=text;
 if(looksEncoded(content))try{content=decodeBody(content)}catch{throw err('UPSTREAM')}
 try{return JSON.parse(content)}catch{throw err('UPSTREAM')}
};
const tokenFields=payload=>{
 const claims=unpackJwt(payload.token);
 const uid=payload.user_id??payload.userId??claims.user_id??claims.sub;
 const identity=typeof uid==='number'&&Number.isSafeInteger(uid)?String(uid):uid;
 if(!safeToken(payload.token)||!ID.test(identity??''))throw err('CREDENTIAL');
 const refresh=payload.refresh_token??payload.refreshToken??'';
 const expires=payload.expires_at??claims.exp??null;
 const expiresAt=typeof expires==='number'
  ?(expires>1e12?expires:expires*1000):
   (typeof expires==='string'?Date.parse(expires):0);
 return {token:payload.token,refreshToken:typeof refresh==='string'&&refresh.length<16384?refresh:'',
  expiresAt:Number.isFinite(expiresAt)&&expiresAt>0?expiresAt:0,
  user:{id:identity,name:payload.user_name??claims.username??'',
   username:claims.username??'',email:claims.email??'',
   organization_id:claims.biz_org_id??'',data_policy_agreed:true},
  loginDeviceId:payload.machineId};
};
function contextOf(data){
 const raw=data?.data??data,user=raw?.user??null;
 const uid=remoteUid(user);
 const quota=raw?.quota??{};
 const remain=quota.remaining??quota.remaining_quota??quota.left;
 return {uid,user,
  ...(typeof remain==='number'&&Number.isFinite(remain)&&remain>=0
   ?{balance:remain,balanceUnit:typeof quota.unit==='string'?quota.unit:'credits',
     balanceCheckedAt:Date.now(),balanceState:'verified'}:{})};
}
const MODEL_PATH='/algo/api/v2/model/list?Encode=1';
const INFER_TIMEOUT_MS=145000;
const MAX_CONTENT=2*1024*1024;

export function createQwenWorkDriver({vault,fetchImpl=fetch,now=()=>Date.now(),
 getAccounts=()=>[],}={}){
 let pending=null;
 const snapshots=new Map(),modelsCache=new Map(),proof=new Map(),
  rollbackJournal=new Map(),locks=new Set();
 const runtimeReady=()=>typeof vault?.resolve==='function'&&
   typeof vault?.set==='function'&&typeof vault?.unset==='function';
 async function request(path,{token,method='GET',body,headers={},signal,timeoutMs=15000}={}){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//'))
   throw err('UPSTREAM');
  const abort=new AbortController(),relay=()=>abort.abort();
  const timer=setTimeout(relay,timeoutMs);
  if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
  try{
   const res=await fetchImpl(QWENWORK_GATEWAY+path,{
    method,headers:{...headers,...(token?{authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
    signal:abort.signal,redirect:'manual',
   });
   if(res.status===401||res.status===403)throw err('CREDENTIAL',res.status);
   if(!res.ok||res.status>=300)throw err('UPSTREAM',res.status);
   return res;
  }catch(e){
   if(signal?.aborted)throw err('CANCELLED');
   if(abort.signal.aborted)throw err('TIMEOUT');
   throw e instanceof UpstreamError?e:err('UPSTREAM');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',relay)}
 }
 async function remoteContext(credential,signal){
  const response=await request(
   '/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing',
   {token:credential.token,headers:{accept:'application/json',
     'user-agent':'qoderwork/1.0.5'},signal});
   const result=contextOf(await parseBody(response));
   if(!result.uid||remoteUid(credential.user)!==result.uid)throw err('CREDENTIAL');
   const storedOrg=organizationOf(credential.user),remoteOrg=organizationOf(result.user);
   if(storedOrg&&remoteOrg&&storedOrg!==remoteOrg)throw err('CREDENTIAL');
   return {...result,organizationId:remoteOrg||storedOrg};
  }
 async function ownedCredential(account){
  const match=REF.exec(String(account?.credentialRef??''));
  if(account?.providerId!==QWENWORK_ID||!match||match[1]!==account?.id||!runtimeReady())
   throw err('CREDENTIAL');
  let raw;try{raw=await vault.resolve(KEY(account.id))}catch{throw err('CREDENTIAL')}
  const text=typeof raw==='string'?raw:raw?.value;
  let value;try{value=JSON.parse(text)}catch{throw err('CREDENTIAL')}
   if(!value||!safeToken(value.token)||
     idFor(remoteUid(value.user),value.user?.organization_id??'')!==account.id||
    !ID.test(value.loginDeviceId??''))throw err('CREDENTIAL');
  return value;
 }
 async function currentCredential(account,signal){
  const old=await ownedCredential(account);
  if(!old.expiresAt||old.expiresAt-now()>120000)return old;
  if(!safeToken(old.refreshToken))throw err('CREDENTIAL');
  if(locks.has(account.id))throw err('BUSY');
  locks.add(account.id);
  try{
   const body=await parseBody(await request('/api/v1/deviceToken/refresh',{
    method:'POST',body:{refresh_token:old.refreshToken},
    headers:{accept:'application/json','content-type':'application/json'},signal}));
   const newToken=body?.device_token??body?.deviceToken??body?.token;
    if(!safeToken(newToken))throw err('CREDENTIAL');
    const claim=unpackJwt(newToken);
    const claimedId=claim.user_id??claim.sub;
    if(claimedId!==undefined&&String(claimedId)!==remoteUid(old.user))throw err('CREDENTIAL');
    const claimedOrg=organizationOf({organization_id:claim.biz_org_id});
    if(claimedOrg&&claimedOrg!==organizationOf(old.user))throw err('CREDENTIAL');
   const refresh=body?.refresh_token??body?.refreshToken??old.refreshToken;
   const parsed=tokenFields({...body,token:newToken,refresh_token:refresh,
    user_id:remoteUid(old.user),machineId:old.loginDeviceId});
   const updated={...old,...parsed,user:old.user,
    loginDeviceId:old.loginDeviceId};
   let raw;try{raw=await vault.resolve(KEY(account.id))}catch{}
   const latest=typeof raw==='string'?raw:raw?.value;
   if(latest!==JSON.stringify(old))throw err('BUSY');
   await vault.set(KEY(account.id),JSON.stringify(updated));
   return updated;
  }finally{locks.delete(account.id)}
 }
 async function storeCredential(payload,{stageRollback=false}={}){
  if(!runtimeReady())throw err('CREDENTIAL');
  const token=tokenFields(payload);
  const confirmed=await remoteContext(token);
    const organization=confirmed.organizationId;
    const id=idFor(confirmed.uid,organization),key=KEY(id);
  if(locks.has(id))throw err('BUSY');
  locks.add(id);
  try{
   if(getAccounts().some(x=>x.id===id&&(x.providerId!==QWENWORK_ID||
     x.credentialRef!=='driver:'+QWENWORK_ID+':'+id)))throw err('CREDENTIAL');
   let raw;try{raw=await vault.resolve(key)}catch{}
   const previous=typeof raw==='string'?raw:raw?.value;
   let prior;try{if(previous)prior=JSON.parse(previous)}catch{}
   if(previous&&(remoteUid(prior?.user)!==confirmed.uid||
       String(prior?.user?.organization_id??'')!==organization))
     throw err('CREDENTIAL');
    const actual={...token,user:{...token.user,...confirmed.user,
     id:confirmed.uid,organization_id:organization}};
   const replacement=JSON.stringify(actual);
   let rollbackToken;
   if(previous!==replacement){
    await vault.set(key,replacement);
    if(stageRollback){
     rollbackToken=randomUUID();
     rollbackJournal.set(rollbackToken,{id,previous:previous??null,replacement});
     if(rollbackJournal.size>30)rollbackJournal.delete(rollbackJournal.keys().next().value);
    }
    modelsCache.delete(id);proof.delete(id);
   }
   snapshots.set(id,{nickname:publicAccountName({
     nickname:confirmed.user?.name,displayName:confirmed.user?.username},actual.user)??'',
    verifiedAt:now(),...(confirmed.balance!==undefined?{balance:confirmed.balance,
      balanceUnit:confirmed.balanceUnit,balanceState:'verified',balanceCheckedAt:now()}:{
      balanceState:'not_checked'})});
   return {id,providerId:QWENWORK_ID,credentialRef:'driver:'+QWENWORK_ID+':'+id,
    ...(previous?{alreadyOwned:true}:{}),...(rollbackToken?{rollbackToken}:{})};
  }finally{locks.delete(id)}
 }
 async function rollbackCandidate({account}={}){
  const match=REF.exec(String(account?.credentialRef??''));
  if(account?.providerId!==QWENWORK_ID||!match||match[1]!==account.id)return;
  const item=rollbackJournal.get(account.rollbackToken);
  if(item?.id!==account.id)return;
  let raw;try{raw=await vault.resolve(KEY(account.id))}catch{}
  const current=typeof raw==='string'?raw:raw?.value;
  if(current===item.replacement){
   if(item.previous===null)await vault.unset(KEY(account.id));
   else await vault.set(KEY(account.id),item.previous);
  }
  rollbackJournal.delete(account.rollbackToken);
  snapshots.delete(account.id);modelsCache.delete(account.id);
 }
 function completeCandidate({account}={}){
  if(rollbackJournal.get(account?.rollbackToken)?.id===account?.id)
   rollbackJournal.delete(account.rollbackToken);
 }
 async function refresh({account,signal}={}){
  try{
   const credential=await currentCredential(account,signal);
   const remote=await remoteContext(credential,signal);
    snapshots.set(account.id,{...snapshots.get(account.id),
     verifiedAt:now(),
     ...(publicAccountName({nickname:remote.user?.name,username:remote.user?.username},
       credential.user)?{nickname:publicAccountName({nickname:remote.user?.name,
       username:remote.user?.username},credential.user)}:{}),
     ...(remote.balance!==undefined?{
      balance:remote.balance,balanceUnit:remote.balanceUnit,
      balanceState:'available',balanceCheckedAt:now()}:{balanceState:'not_returned'})});
   return {state:'online',message:'千问办公自有账号已通过官方账号上下文鉴权，模型回复须另行完整验收'};
  }catch(e){return {state:e?.code==='CREDENTIAL'?'expired':'error',
    message:'千问办公自有身份未确认，登录目录不视为成功'};}
 }
 async function listModels({account,signal}={}){
  const credential=await currentCredential(account,signal);
  await remoteContext(credential,signal);
  const signer=await createSignerSession({credential,
   identity:{env:{QWEN_COSY_VERSION:'1.1.32'}}});
  const signed=signer.signRequest({path:MODEL_PATH,method:'GET'});
  const path=new URL(signed.url).pathname+new URL(signed.url).search;
  const response=await request(path,{method:'GET',headers:signed.headers,signal});
  const raw=await parseBody(response);
  // Use the exact same scene for model identity and rate evidence. An
  // empty preferred scene is not evidence that all fallback rates are unknown.
  let source=[],rows=[];
  for(const scene of ['qwork','app','chat']){
   if(!Array.isArray(raw?.[scene]))continue;
   const parsed=parseCatalog({[scene]:raw[scene]});
   if(parsed.length){source=raw[scene];rows=parsed;break}
  }
  if(!rows.length)throw err('MODEL');
  const models=rows.filter(x=>typeof x.id==='string'&&x.id.length<=120).map(row=>{
   const peers=source.filter(x=>typeof x?.key==='string'&&x.key.trim()===row.id);
   const rates=peers.map(x=>typeof x.price_factor==='number'&&Number.isFinite(x.price_factor)&&x.price_factor>=0?x.price_factor:null);
   const conflict=peers.some(x=>x.enable===false)||new Set(rates.filter(x=>x!==null)).size>1;
   const incomplete=!rates.length||rates.some(x=>x===null);
   const rate=!conflict&&!incomplete?rates[0]:null;
   return {id:row.id,name:row.shortName+(rate!==null?' · x'+rate.toFixed(2):' · 费率待确认'),
    ...(conflict?{pricingConflict:true,isFree:false}:incomplete?{pricingIncomplete:true}:{}),
    ...(rate!==null?{billingRate:rate,costMultiplier:rate,...(rate>0?{isFree:false}:{})}:{})};
  });
  modelsCache.set(account.id,models);
  return models;
 }
 async function generate({account,model,options={},signal}={}){
  if(signal?.aborted)throw err('CANCELLED');
  if(visibleTools(options.tools).length)throw err('TOOL_PROTOCOL');
  const models=await listModels({account,signal});
  if(!models.some(x=>x.id===model))throw err('MODEL');
  const credential=await currentCredential(account,signal);
  const session=await createSignerSession({credential,
    identity:{env:{QWEN_COSY_VERSION:'1.1.32'}}});
  const messages=toChatMessages(options);
  if(!messages.some(x=>x.role==='user'&&typeof x.content==='string'&&x.content.trim()))
   throw err('EMPTY');
  const body=buildInferBody({messages,modelKey:model,modelSource:'system',
   sessionType:'qoder_work',tools:[],sessionId:options.sessionId,
   maxOutputTokens:Number.isInteger(options.maxTokens)&&options.maxTokens>0?
    Math.min(options.maxTokens,32000):32000});
  const signed=session.signInferRequest(body,{modelKey:model});
  const signedPath=new URL(signed.url).pathname+new URL(signed.url).search;
   // The HTTP header timeout alone cannot bound an SSE stream that never
   // finishes; keep a second independent deadline through the final frame.
   const streamAbort=new AbortController();
   const relay=()=>streamAbort.abort(signal?.reason??'canceled');
   if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
   const timer=setTimeout(()=>streamAbort.abort('timeout'),INFER_TIMEOUT_MS);
   try{
    const response=await request(signedPath,{method:'POST',body:signed.body,
     headers:signed.headers,signal:streamAbort.signal,timeoutMs:INFER_TIMEOUT_MS});
    if(!String(response.headers.get('content-type')??'').includes('text/event-stream'))
     throw err('UPSTREAM');
    const parser=new SseParser(),parts=[],thoughts=[];
    let finish=false,total=0,frames=0;
     const handleFrame=data=>{
      if(++frames>8000)throw err('RESPONSE_SIZE');
      const event=parseQwenWorkFrame(data);
      if(event.kind==='error')throw err('UPSTREAM');
      if(event.kind!=='chunk')return;
      if(Array.isArray(event.delta?.tool_calls)&&event.delta.tool_calls.length)
       throw err('TOOL_PROTOCOL');
      if(event.delta?.content)parts.push(event.delta.content);
      if(event.delta?.reasoning)thoughts.push(event.delta.reasoning);
      if(parts.join('').length>MAX_CONTENT||thoughts.join('').length>MAX_CONTENT)
       throw err('RESPONSE_SIZE');
      if(event.finishReason==='stop')finish=true;
      if(event.finishReason==='length')throw err('INCOMPLETE_STREAM');
     };
     for await(const chunk of response.body){
      if(streamAbort.signal.aborted)throw err(signal?.aborted?'CANCELLED':'TIMEOUT');
      total+=chunk.byteLength;
      if(total>16*1024*1024)throw err('RESPONSE_SIZE');
      for(const data of parser.push(chunk))handleFrame(data);
     }
     // The last valid SSE record need not have a trailing newline.
     for(const data of parser.flush())handleFrame(data);
    if(streamAbort.signal.aborted)throw err(signal?.aborted?'CANCELLED':'TIMEOUT');
    if(!finish||!parts.join('').trim())throw err('INCOMPLETE_STREAM');
    proof.set(account.id,{at:now(),model});
    return {text:parts.join(''),reasoning:thoughts.join(''),
     toolCalls:[],finishReason:'stop',usage:null};
   }catch(e){
    if(streamAbort.signal.aborted)throw err(signal?.aborted?'CANCELLED':'TIMEOUT');
    throw e instanceof UpstreamError?e:err('UPSTREAM');
   }finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort',relay);
    streamAbort.abort('released');
   }
  }
 async function logout({account}={}){
  await ownedCredential(account);
  await vault.unset(KEY(account.id));
  snapshots.delete(account.id);modelsCache.delete(account.id);proof.delete(account.id);
  return {revokedUpstream:false,
   message:'已删除聚合路由自己的千问办公授权，不退出原桌面或其他插件'};
 }
 const status=()=>pending?{status:pending.status,at:pending.at,
  ...(pending.status==='waiting'?{loginUrl:pending.url}:{}),
  ...(pending.status==='done'&&pending.account?{account:pending.account}:{})}:{status:'idle'};
 function startLogin(){
  if(!runtimeReady())throw err('CREDENTIAL');
  if(pending?.status==='waiting'&&now()-pending.at<5*60*1000)return status();
  const verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const nonce=randomUUID(),machineId=randomUUID();
  const url=new URL('/device/selectAccounts',QWENWORK_GATEWAY);
  for(const [k,v] of Object.entries({challenge,challenge_method:'S256',nonce,
    machine_id:machineId,client_id:CLIENT_ID,redirect_uri:'qwenwork-cn://'}))
   url.searchParams.set(k,v);
  pending={status:'waiting',at:now(),url:url.toString(),nonce,
   verifier,machineId,account:null};
  return status();
 }
  async function pollLogin(){
   const flow=pending;
   if(!flow)return {status:'idle'};
   if(flow.status!=='waiting')return status();
   if(now()-flow.at>=5*60*1000){
    pending={status:'expired',at:flow.at};return status();
   }
   if(flow.polling||Number(flow.retryAfter??0)>now())return status();
   flow.polling=true;
   const qs=new URLSearchParams({nonce:flow.nonce,verifier:flow.verifier,
    challenge_method:'S256'});
   try{
    const result=await fetchImpl(QWENWORK_GATEWAY+'/api/v1/deviceToken/poll?'+qs,{
     method:'GET',redirect:'manual',
     headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(pending!==flow)return status();
    if(result.status===404){
     flow.failures=0;flow.retryAfter=0;return status();
    }
    if(result.status===401||result.status===403||result.status===400)
     throw err('CREDENTIAL',result.status);
    if(!result.ok||result.status>=300)throw err('UPSTREAM',result.status);
    const body=await parseBody(result);
    if(!safeToken(body?.token))throw err('CREDENTIAL');
    const receipt=await storeCredential({...body,machineId:flow.machineId},{stageRollback:true});
    if(pending!==flow){
     await rollbackCandidate({account:receipt});return status();
    }
    pending={status:'done',at:flow.at,account:receipt};
    return status();
   }catch(error){
    if(pending===flow){
     if(error?.code==='CREDENTIAL')pending={status:'error',at:flow.at};
     else{
      // Temporary network errors, 429 and 5xx must not force a new QR login.
      // Keep the original challenge until its five-minute official deadline.
      flow.failures=(flow.failures??0)+1;
      flow.retryAfter=now()+Math.min(16000,2000*2**Math.min(flow.failures-1,3));
     }
    }
    return status();
   }finally{flow.polling=false;}
  }
 async function cancelLogin(){
  const flow=pending;
  pending={status:'canceled',at:now()};
  if(flow?.status==='done'&&flow.account?.rollbackToken)
   await rollbackCandidate({account:flow.account});
  return status();
 }
 return {
  independentProvider:QWENWORK_ID,
  providerName:'千问办公 · 聚合路由自有',
  authMethod:'设备码 PKCE 网页授权 · 直接 COSY 原生签名',
  get runtimeReady(){return runtimeReady()},
  accountSnapshot:account=>({...snapshots.get(account?.id),
    modelInferenceVerifiedAt:proof.get(account?.id)?.at??null}),
  startLogin,pollLogin,loginStatus:status,cancelLogin,
  storeCredential,rollbackCandidate,completeCandidate,
   refresh,login:refresh,
   async refreshAccountStatus({account,signal}={}){
    const reply=await refresh({account,signal});
    return {state:reply.state,authVerified:reply.state==='online',
     ...(reply.state==='online'?{checkedAt:now()}:{})};
   },listModels,generate,logout,
 };
}
