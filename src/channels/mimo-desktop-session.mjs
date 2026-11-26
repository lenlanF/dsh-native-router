// MiMo Desktop *client-session* transport, not the billable MiMo API-Key service.
// SSO uses a one-time owner-approved passToken in Native Router's own vault.
// No original desktop files, plugin account-pool services or extra HTTP gateway
// are accessed once that credential has been adopted.
// Protocol informed by MIT decolua/9router (open-sse/shared/mimoAccount.js).
import {createHash} from 'node:crypto';
import {UpstreamError} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {openAiTools,visibleTools} from '../host-tools.mjs';
import {decodeOpenAIResponse,validateModelCalls} from '../provider/openai.mjs';
import {publicAccountName} from '../account-facts.mjs';

// Account-session-only models, never cloud API / commercial API-key models.
// Upstream MIT decolua/9router open-sse/executors/xiaomi-mimo.js declares
// the same three v2.6 account-route IDs. One allowlist serves the picker
// AND transport; retaining expired Preview IDs as defaults causes 400s.
export const MIMO_DESKTOP_ACCOUNT_MODELS=Object.freeze([
 'mimo-v2.6-pro','mimo-v2.6-flash','mimo-v2.6-pro-ultraspeed',
]);

const REGIONS=Object.freeze({
 cn:['mimopc','https://mimo-server-cn.xiaomimimo.com'],
 sgp:['mimosgp','https://mimo-server-sgp.xiaomimimo.com'],
 ams:['mimoams','https://mimo-server-ams.xiaomimimo.com'],
 ru:['mimoru','https://mimo-server-ru.xiaomimimo.com'],
 in:['mimoin','https://mimo-server-in.xiaomimimo.com'],
});
const SESSION_MS=30*60*1000;
const MAX_REPLY=16*1024*1024;
const ua='miNative PC/Normal Windows_NT/10.0.19045 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop';
const safePart=value=>typeof value==='string'&&value.length<=4096
 &&!/[;\r\n\u0000-\u001f]/.test(value);
const fail=(code='UPSTREAM',status=0)=>new UpstreamError(
 'MiMo Desktop session is unavailable',{code,status});
function validate(session){
 if(!session||typeof session!=='object'||!safePart(session.passToken)
   ||session.passToken.length<8||!['cn','sgp','ams','ru','in'].includes(session.region??'cn')
   ||(session.userId!==undefined&&!safePart(session.userId))
   ||(session.cUserId!==undefined&&!safePart(session.cUserId)))
  throw fail('CREDENTIAL');
 return {region:session.region??'cn',passToken:session.passToken,
  userId:session.userId??'',cUserId:session.cUserId??''};
}
const allowedUrl=raw=>{
 let url;
 try{url=new URL(raw)}catch{throw fail('UPSTREAM')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||
   !['account.xiaomi.com',...Object.values(REGIONS).map(x=>new URL(x[1]).hostname)].includes(url.hostname))
   throw fail('UPSTREAM');
 return url;
};
const extractCookies=(response,jar)=>{
 const headers=typeof response?.headers?.getSetCookie==='function'
  ?response.headers.getSetCookie():[];
 for(const value of headers){
  const item=/^\s*([^=;\s]+)=([^;]*)/.exec(value);
  if(item&&safePart(item[2])&&item[2])jar[item[1]]=item[2];
 }
};
const outputCookies=(jar,sid)=>{
 const out={};
 const secret=jar.serviceToken??jar[sid+'_serviceToken'];
 if(!safePart(secret)||!secret)throw fail('AUTH',401);
 out.serviceToken=secret;
 for(const [name,value] of Object.entries(jar)){
  if(name==='userId'||name==='cUserId'||name===sid+'_ph'||name===sid+'_slh'
    ||name==='mimopc_ph'||name==='mimopc_slh'){
   if(safePart(value)&&value)out[name]=value;
  }
 }
 return Object.entries(out).map(([k,v])=>k+'='+v).join('; ');
};
async function boundedText(response,{max=MAX_REPLY}={}){
 if(!response?.body)return response.text();
 let total=0,output='';const decoder=new TextDecoder();
 for await(const chunk of response.body){
  total+=chunk.byteLength;
  if(total>max)throw fail('RESPONSE_SIZE');
  output+=decoder.decode(chunk,{stream:true});
 }
 return output+decoder.decode();
}
function parseServiceLogin(raw){
 const clean=raw.replace(/^&&&START&&&/,'');
 const nonce=/"nonce"\s*:\s*(\d+)/.exec(clean)?.[1];
 let payload;
 try{payload=JSON.parse(clean)}catch{throw fail('AUTH',401)}
 if(payload?.code!==0||typeof payload.location!=='string'
  ||typeof payload.ssecurity!=='string'||!payload.ssecurity
  ||!(nonce||payload.nonce))throw fail('AUTH',401);
 return {location:payload.location,nonce:nonce??String(payload.nonce),
  ssecurity:payload.ssecurity};
}
function safeMembership(reading,now){
  if(!reading||typeof reading!=='object'||reading.code!==0)
    return {membershipState:'unavailable',balanceState:'not_supported'};
  const root=reading.data??{},section=root.subscription??root;
  if(!section||typeof section!=='object'||!Object.hasOwn(section,'current'))
    return {membershipState:'unavailable',balanceState:'not_supported'};
  const current=section.current;
  if(current===null)return {membershipState:'not_subscribed',balanceState:'not_supported',
    quotaCheckedAt:now};
  if(!current||typeof current!=='object')
    return {membershipState:'unavailable',balanceState:'not_supported'};
  const rawPercent=current.percent;
  const pct=Number(rawPercent);
  const reliable=rawPercent!==null&&rawPercent!==undefined&&
    (typeof rawPercent==='number'||typeof rawPercent==='string'&&rawPercent.trim()!=='')&&
    Number.isFinite(pct)&&pct>=0&&pct<=100;
  const code=typeof current.planCode==='string'&&/^[A-Za-z0-9._-]{1,48}$/.test(current.planCode)
    ?current.planCode:'';
  const tier=Number.isInteger(current.planTier)&&current.planTier>=1&&current.planTier<=4
    ?current.planTier:null;
  const rawReset=current.nextResetTime;
  const reset=typeof rawReset==='number'&&Number.isFinite(rawReset)?
    (rawReset<1e11?rawReset*1000:rawReset):
    typeof rawReset==='string'&&rawReset.trim()?Date.parse(rawReset):NaN;
  return {membershipState:'active',balanceState:'not_supported',
    ...(code?{membershipPlanName:code}:tier?{membershipPlanName:'Desktop 会员等级 '+tier}:{}),
    ...(reliable?{membershipPercentRemaining:pct}:{}),
    ...(Number.isFinite(reset)&&reset>0?{membershipResetAt:reset}:{}),
    quotaCheckedAt:now};
}
export function parseMimoRollingUsage(doc,now=Date.now()){
  if(doc?.code!==0||!doc?.data||typeof doc.data!=='object')
    return {usageState:'unavailable'};
  const u=doc.data,raw=u.percent;
  if(typeof raw!=='number'||!Number.isFinite(raw)||raw<0||raw>100)
    return {usageState:'unavailable'};
  // The account endpoint exposes both resetDate and resetAt. Preserve a
  // real epoch reset when the formatted date is omitted; never invent one.
  const epoch=typeof u.resetAt==='number'&&Number.isSafeInteger(u.resetAt)&&u.resetAt>0
    ?(u.resetAt<1e11?u.resetAt*1000:u.resetAt):null;
  const hasDate=u.resetDate!==null&&u.resetDate!==undefined&&u.resetDate!=='';
  if(!hasDate&&epoch===null)return {usageState:'no_cycle'};
  const reset=epoch??(typeof u.resetDate==='string'
    ?(/^\d{4}-\d{2}-\d{2}$/.test(u.resetDate)
      ?Date.parse(u.resetDate+'T00:00:00+08:00'):Date.parse(u.resetDate)):NaN);
  if(!Number.isFinite(reset)||reset<=now)return {usageState:'unavailable'};
  return {usageState:'available',usagePercentRemaining:raw,
    usageResetAt:reset,usageCheckedAt:now};
}
export function createMimoDesktopSessionTransport({
 fetchImpl=fetch,now=()=>Date.now(),ttlMs=SESSION_MS,timeoutMs=120000,
}={}){
 const cache=new Map(),pending=new Map();
 async function acquire(session,signal){
  const s=validate(session);
  const [sid,base]=REGIONS[s.region];
  const jar={userId:s.userId,passToken:s.passToken,cUserId:s.cUserId};
  const login=new URL('https://account.xiaomi.com/pass/serviceLogin');
  login.search=new URLSearchParams({_locale:'zh_CN',_snsNone:'true',sid,_json:'true'});
  const initial=await fetchImpl(login.toString(),{
   headers:{Cookie:Object.entries(jar).filter(([,v])=>v).map(([k,v])=>k+'='+v).join('; '),
    Accept:'application/json','User-Agent':'MiClaw/1.0'},signal,
  });
  if(!initial?.ok)throw fail('AUTH',initial?.status??0);
  const challenge=parseServiceLogin(await boundedText(initial,{max:65536}));
  const target=allowedUrl(challenge.location);
  const sign=createHash('sha1').update('nonce='+challenge.nonce+'&'+challenge.ssecurity).digest('base64');
  target.searchParams.set('clientSign',sign);
  let next=target;
  for(let i=0;i<8;i++){
   // Desktop clears initial Cookie header for the signed redirect phase.
   const res=await fetchImpl(next.toString(),{
    redirect:'manual',headers:{'User-Agent':'MiClaw/1.0'},signal,
   });
   extractCookies(res,jar);
   const loc=res?.headers?.get?.('location');
   if(res.status>=300&&res.status<400&&loc){
    next=allowedUrl(new URL(loc,next).toString());
    continue;
   }
   if(res.status>=400)throw fail('AUTH',res.status);
   return {base,cookie:outputCookies(jar,sid)};
  }
  throw fail('UPSTREAM');
 }
 const sessionKey=session=>{
  const s=validate(session);
  return createHash('sha256').update(JSON.stringify([s.region,s.passToken,s.userId])).digest('hex');
 };
 const invalidate=session=>cache.delete(sessionKey(session));
 async function cookieFor(session,signal){
  const key=sessionKey(session),cached=cache.get(key);
  if(cached&&now()-cached.at<ttlMs)return cached.value;
  if(pending.has(key))return pending.get(key);
  const task=acquire(session,signal).then(result=>{
   cache.set(key,{at:now(),value:result});return result;
  }).finally(()=>pending.delete(key));
  pending.set(key,task);
  return task;
 }
 async function authorized(session,urlPath,init={},signal){
  let auth=await cookieFor(session,signal);
  for(let attempt=0;attempt<2;attempt++){
   const response=await fetchImpl(auth.base+urlPath,{
    ...init,headers:{...(init.headers??{}),Cookie:auth.cookie,'User-Agent':ua},signal,
   });
   if(response.status!==401)return response;
   invalidate(session);
   if(attempt===0)auth=await cookieFor(session,signal);
  }
  throw fail('AUTH',401);
 }
 return {
  invalidate,
   async probe({session,signal,includeQuota=true}={}){
     try{
      const response=await authorized(session,'/api/user/xiaomi/me',{
       headers:{Accept:'application/json'}},signal);
      if(!response.ok)return {state:response.status===401||response.status===403?'expired':'error',
       httpStatus:response.status,authVerified:false};
      const result=JSON.parse(await boundedText(response,{max:65536}));
      const user=result?.data?.user??result?.data;
      const identity=user?.userId??user?.id??user?.user_id;
      const verified=result?.code===0&&user&&typeof user==='object'
        &&(typeof identity==='string'&&identity.trim()||Number.isSafeInteger(identity)&&identity>0);
      if(!verified)return {state:'pending',authVerified:false};
      const accountName=publicAccountName({
       displayName:user?.displayName,nickname:user?.nickName,
       name:user?.name,userName:user?.userName,username:user?.username},user);
      if(includeQuota===false)return {state:'online',authVerified:true,...(accountName?{accountName}:{})};
      // Desktop membership and API/Token Plan credit are different products.
      // This read-only endpoint uses the same mimopc session, not a paid API key.
      // A failed quota read never invalidates the proven member identity.
       // Subscription and naturally replenished 7-day usage are INDEPENDENT
       // official reads. The old sequential 7-second shared timer silently
       // aborted usage after a slow subscription response, hiding free quota.
       const budget=new AbortController(),cancel=()=>budget.abort();
       const timer=setTimeout(cancel,9500);
       if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
       try{
        const [quota,usage]=await Promise.all([
         (async()=>{
          try{
           const res=await authorized(session,'/api/user/xiaomi/subscription/self',
             {headers:{Accept:'application/json'}},budget.signal);
           if(res.status===404)return {membershipState:'not_supported',balanceState:'not_supported'};
           if(!res.ok)return {membershipState:'unavailable',balanceState:'not_supported'};
           return safeMembership(JSON.parse(await boundedText(res,{max:65536})),now());
          }catch{return {membershipState:'unavailable',balanceState:'not_supported'}}
         })(),
         (async()=>{
          try{
           const res=await authorized(session,'/api/user/usage',
             {headers:{Accept:'application/json'}},budget.signal);
           if(res.status===404)return {usageState:'not_supported'};
           if(!res.ok)return {usageState:'unavailable'};
           return parseMimoRollingUsage(JSON.parse(await boundedText(res,{max:65536})),now());
          }catch{return {usageState:'unavailable'}}
         })(),
        ]);
        return {state:'online',authVerified:true,
         ...(accountName?{accountName}:{}),...quota,...usage};
       }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
     }catch(error){
      return {state:error?.code==='AUTH'||error?.code==='CREDENTIAL'?'expired':'error',
       authVerified:false};
     }
   },
  async generate({session,model,options={},signal}={}){
   validate(session);
   if(typeof model!=='string'||!MIMO_DESKTOP_ACCOUNT_MODELS.includes(model))
    throw fail('MODEL');
   const tools=visibleTools(options.tools);
   const body={model:'xiaomi/'+model,messages:toChatMessages(options),stream:true,
    ...(tools.length?{tools:openAiTools(tools),tool_choice:options.toolChoice??'auto'}:{}),
    ...(Number.isInteger(options.maxTokens)&&options.maxTokens>0?
      {max_tokens:options.maxTokens}:{})};
   const timeout=new AbortController();
   const onAbort=()=>timeout.abort(signal?.reason);
   if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
   const timer=setTimeout(()=>timeout.abort(),timeoutMs);
   try{
    const response=await authorized(session,'/api/route/chat/completions',{
     method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},
     body:JSON.stringify(body)},timeout.signal);
    if(!response.ok)throw fail(response.status===401||response.status===403?'AUTH':'UPSTREAM',
     response.status);
    const result=decodeOpenAIResponse(await boundedText(response),
      response.headers?.get?.('content-type')??'text/event-stream');
    return validateModelCalls(result,options.tools);
   }catch(error){
    if(timeout.signal.aborted)throw fail(signal?.aborted?'CANCELLED':'TIMEOUT');
    // Source-side errors and parser bodies may include raw session material.
    // Pass only the bounded failure class/status into the host routing engine.
    if(error instanceof UpstreamError)throw fail(error.code??'UPSTREAM',
      Number.isInteger(error.status)?error.status:0);
    throw fail('UPSTREAM');
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort)}
  },
 };
}