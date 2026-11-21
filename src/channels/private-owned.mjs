// Fully self-contained DSH native-channel drivers for explicitly cloned,
// independently stored original-plugin sessions. No dynamic imports of the
// original plugins and no reads of their data folders during inference.
// Secrets come exclusively from the DSH Credentials owner vault.
import {randomUUID,createHash} from 'node:crypto';
import {UpstreamError,safeRetryAfter} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {visibleTools,openAiTools} from '../host-tools.mjs';
import {validateModelCalls} from '../provider/openai.mjs';

// Loomy and ZCode are handled by the existing pinned MIT channel-pack.
// Lingxi is absent from that upstream source and needs its own adapter.
export const PRIVATE_PROVIDERS=Object.freeze({
 lingxi:{ownedId:'own_lingxi',models:['qwen3.8_flash'],autoCheckin:true},
});
const MAX_RESPONSE=16*1024*1024;
const OWN_REF=/^driver:(own_lingxi):(pr_[a-f0-9]{28})$/;
const keyFor=id=>'NATIVE_ROUTER_PRIVATE_'+id.slice(3).toUpperCase();
const ownedIdFor=x=>PRIVATE_PROVIDERS[x]?.ownedId;
export const ownedPrivateId=(providerId,accountId)=>{
 if(!ownedIdFor(providerId)||typeof accountId!=='string'
   ||!/^local_[a-f0-9]{20}$/.test(accountId))return null;
 return 'pr_'+createHash('sha256').update('dsh-native-router-private\0'+providerId+'\0'+accountId)
  .digest('hex').slice(0,28);
};
function httpFailure(response,kind){
 const status=Number(response?.status)||0;
 return new UpstreamError(kind+' upstream unavailable (HTTP '+status+')',
  {status,retryAfterMs:safeRetryAfter(response?.headers?.get?.('retry-after'))});
}
async function readCapped(response,signal){
 let length=0,body='';const dec=new TextDecoder();
 if(!response.body)return response.text();
 for await(const chunk of response.body){
  if(signal?.aborted)throw new UpstreamError('Cancelled',{code:'CANCELLED'});
  length+=chunk.byteLength;
  if(length>MAX_RESPONSE)throw new UpstreamError('Channel output too large',{code:'RESPONSE_SIZE'});
  body+=dec.decode(chunk,{stream:true});
 }
 return body+dec.decode();
}
function buildLingxiHeaders(secret,base){
 return {cookie:'wps_sid='+secret+'; csrf='+secret,
  accept:'application/json,text/event-stream','content-type':'application/json',
  origin:base,referer:base+'/'};
}
function strictZeroLingxiMultiplier(value){
  // The official Lingxi /sessions/plans response is the sole pricing source.
  // Reject approximate (~0x), undisclosed, negative and nonzero rates.
  return value===0 || typeof value==='string'
    && /^\s*(?:x\s*0(?:\.0+)?|0(?:\.0+)?\s*x)\s*$/i.test(value);
}
function lingxiRate(value){
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100)return value;
  if(typeof value!=='string')return null;
  const found=/^\s*(?:x\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*x)\s*$/i.exec(value);
  if(!found)return null;
  const n=Number(found[1]??found[2]);
  return Number.isFinite(n)&&n>=0&&n<=100?n:null;
}
function planModels(json){ // Follow the existing Lingxi adapter: data.plans lists client modes,
 // NOT inference models. Model id primarily uses entry.key.
 const candidates=Array.isArray(json?.data?.models)?json.data.models:[];
 const seen=new Set();return candidates.filter(x=>x&&typeof x==='object')
   .map(x=>({id:typeof x.key==='string'&&x.key?x.key:x.id,
     name:typeof x.name==='string'&&x.name?x.name:x.key??x.id,
      ...(strictZeroLingxiMultiplier(x.multiplier)?{upstreamFreeLabel:true}:{}),
      ...(lingxiRate(x.multiplier)!==null?{costMultiplier:lingxiRate(x.multiplier)}:{})}))  .filter(x=>typeof x.id==='string'&&x.id.length>0&&x.id.length<160
    &&!seen.has(x.id)&&seen.add(x.id))
  .slice(0,100);
}
function requireOwnAccount(providerId,account){
 const expectedProvider=ownedIdFor(providerId);
 const found=OWN_REF.exec(String(account?.credentialRef??''));
 if(!found||found[1]!==expectedProvider||account.providerId!==expectedProvider
    ||account.id!==found[2])
  throw new UpstreamError('Invalid independent account binding',{code:'CREDENTIAL'});
 return keyFor(found[2]);
}
function lingxiDecode(body){
  let text='',reasoning='',done=false,finishReason='stop',usage=null,toolCalls=[]; for(const frame of body.split(/\r?\n\r?\n/)){
  const data=frame.split(/\r?\n/).filter(x=>x.startsWith('data:'))
   .map(x=>x.slice(5).trim()).join('\n');
  if(!data)continue;
  if(data==='[DONE]')continue;
  let payload;try{payload=JSON.parse(data)}catch{throw new UpstreamError('Invalid Lingxi SSE frame',{code:'BAD_SSE'})}
  if(payload.code&& !['Success','success','OK','ok'].includes(payload.code))
   throw new UpstreamError('Lingxi SSE rejected request',{code:'UPSTREAM'});
  if(payload.usage)usage=payload.usage;
  for(const choice of payload.choices??[]){
   if(typeof choice.text==='string')text+=choice.text;
   if(typeof choice.delta?.content==='string')text+=choice.delta.content;
   if(typeof choice.delta?.reasoning_content==='string')reasoning+=choice.delta.reasoning_content;
   if(Array.isArray(choice.tool_calls)&&choice.tool_calls.length)
    toolCalls.push(...choice.tool_calls.map(x=>({id:x.id??randomUUID(),name:x.function?.name,
      arguments:x.function?.arguments??'{}'})));
    if(choice.finish_reason){done=true;if(choice.finish_reason==='length')finishReason='length';}  }
 }
 if(!done)throw new UpstreamError('Lingxi stream ended before finish_reason',{code:'TRUNCATED'});
 if(!text.trim()&&!reasoning.trim()&&!toolCalls.length)
  throw new UpstreamError('Lingxi returned empty response',{code:'EMPTY'});
  return {text,reasoning,toolCalls,finishReason:toolCalls.length?'tool_calls':finishReason,usage};}
export function createPrivateOwnedDriver({providerId,vault,makeCredentialRef,
  fetchImpl=fetch,endpointOverride={},timeoutMs=90000,now=()=>Date.now()}={}){
 const metadata=PRIVATE_PROVIDERS[providerId];
 if(!metadata)throw Error('Unsupported independently managed provider');
 const keyRef=name=>typeof makeCredentialRef==='function'?makeCredentialRef(name):name;
 async function secretFor(account){
  const key=requireOwnAccount(providerId,account);
  if(typeof vault?.resolve!=='function')throw new UpstreamError('DSH Credentials unavailable',{code:'CREDENTIAL'});
  const value=await vault.resolve(keyRef(key)).catch(()=>null);
  const secret=typeof value==='string'?value:value?.value;
  if(typeof secret!=='string'||!secret.trim())
   throw new UpstreamError('Independent credential missing',{code:'CREDENTIAL'});
  if(secret.length>16384||/[\s\u0000-\u001f]/.test(secret))
   throw new UpstreamError('Invalid independent session',{code:'CREDENTIAL'});
  return secret;
 }
 function limitedSignal(signal){
  const ctrl=new AbortController();
  const cancel=()=>ctrl.abort(signal?.reason);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const clock=setTimeout(()=>ctrl.abort(new Error('Channel timeout')),timeoutMs);
  return {signal:ctrl.signal,close:()=>{clearTimeout(clock);signal?.removeEventListener('abort',cancel)}};
 }
 async function send(url,options,signal){
  const bound=limitedSignal(signal);
  try{return await fetchImpl(url,{...options,signal:bound.signal})}
  catch(error){
   if(bound.signal.aborted&&!signal?.aborted)
    throw new UpstreamError('Channel request timed out',{code:'TIMEOUT',status:408});
   if(signal?.aborted)throw new UpstreamError('Channel cancelled',{code:'CANCELLED'});
   throw new UpstreamError('Channel transport unavailable',{code:'UPSTREAM'});
  }finally{bound.close()}
 }
 async function lingxiModels(sid,signal){
  const base=endpointOverride.lingxi??'https://lingxi.kdocs.cn';
  const response=await send(base+'/api/aioffice/v1/sessions/plans',
   {headers:buildLingxiHeaders(sid,base)},signal);
  if(!response.ok)throw httpFailure(response,'Lingxi');
  return planModels(JSON.parse(await readCapped(response,signal)));
 }
 async function* modelsIterator(account,signal){
  const secret=await secretFor(account);
  const models=await lingxiModels(secret,signal);
  yield* models;
 }
 async function lingxiTurn(sid,model,options,signal){
  const messages=toChatMessages(options),tools=visibleTools(options.tools);
  const roots=endpointOverride.lingxi?[endpointOverride.lingxi]:
   ['https://lingxi.wps.cn','https://lingxi.kdocs.cn'];
  let base,session;
  for(const root of roots){
   const res=await send(root+'/api/aioffice/v1/cowork/sessions',
    {method:'POST',headers:buildLingxiHeaders(sid,root),
     body:JSON.stringify({session_type:'cowork_client',agent_version:2,
       env:{device_id:'dsh-native-router',device_name:'dsh',work_space_dir:'/tmp'}})},signal)
    .catch(()=>null);
   if(res?.ok){base=root;session=JSON.parse(await readCapped(res,signal));break}
   if(res?.status===429)throw httpFailure(res,'Lingxi');
  }
  const sessionId=session?.data?.session_id;
  if(!base||typeof sessionId!=='string')throw new UpstreamError('Lingxi session handshake failed',{code:'UPSTREAM'});
  const headers=buildLingxiHeaders(sid,base);
  const runRes=await send(base+'/api/public/v1/credits/runs',
   {method:'POST',headers,body:JSON.stringify({
    client_request_id:String(Date.now()),session_id:sessionId,
    model_provider:'lingxi',model_id:model,
     agent_input:{...(Number.isInteger(options.maxTokens)&&options.maxTokens>0
       ?{max_tokens:Math.min(options.maxTokens,16384)}:{}),
       text:messages.filter(m=>m.role==='user').at(-1)?.content??'',
       files:[],file_ids:[],refs:[],expect_model:model,permission_mode:'default',
      current_mode:'agent',browser_plugin_enabled:false}})},signal);
  if(!runRes.ok)throw httpFailure(runRes,'Lingxi');
  const run=JSON.parse(await readCapped(runRes,signal)),runId=run?.data?.run_id;
  if(typeof runId!=='string'||!runId)throw new UpstreamError('Lingxi run initiation incomplete',{code:'UPSTREAM'});
  const completion=await send(base+'/api/public/v1/agent-runtime/chat/completions',{
   method:'POST',headers:{...headers,'X-Client-Type':'lingxi_claw','X-Client-Lang':'zh-CN',
    'X-Cc-Agent-Type':'lingxi_claw','X-Request-Id':randomUUID(),
    'X-Cc-Session-ID':sessionId,'X-Cc-Run-ID':runId},
    body:JSON.stringify({stream:true,model,messages,
      ...(Number.isInteger(options.maxTokens)&&options.maxTokens>0
        ?{max_tokens:Math.min(options.maxTokens,16384)}:{}),     ...(tools.length?{tools:openAiTools(tools),tool_choice:'auto'}:{})})},signal);
  if(!completion.ok)throw httpFailure(completion,'Lingxi');
  return lingxiDecode(await readCapped(completion,signal));
 }
 async function listModels({account,signal}={}){
  const result=[];for await(const row of modelsIterator(account,signal))result.push(row);
  return result;
 }
 async function generate({account,model,options={},signal}={}){
  if(typeof model!=='string'||!model.trim()||model.length>160)
   throw new UpstreamError('Invalid independent model ID',{code:'MODEL'});
  const cred=await secretFor(account);
  const response=await lingxiTurn(cred,model,options,signal);
  return validateModelCalls(response,options.tools);
 }
 async function refresh({account}={}){
  try{
   const rows=await listModels({account});
   return {state:rows.length?'online':'pending',
     message:rows.length?'自有渠道模型目录鉴权通过':'账号记录有效，尚需模型调用验收'};
  }catch(error){
   return {state:error?.status===401||error?.status===403?'expired':'error',
    message:'自有渠道鉴权检查未通过'};
  }
 }
  const statusCache=new Map(),statusPending=new Map();
  const statusTTL=3*60*1000;
  const beijingDate=()=>{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',
      year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now());
    const part=k=>parts.find(x=>x.type===k)?.value;
    return part('year')+'-'+part('month')+'-'+part('day');
  };
  function balanceFrom(payload){
    const value=payload?.data;
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:
      typeof v==='string'&&v.trim()&&Number.isFinite(Number(v))?Number(v):null;
    const grants=['bonus_credits','purchased_credits']
      .flatMap(k=>Array.isArray(value[k])?value[k]:[])
      .map(x=>numeric(x?.balance)).filter(x=>x!==null);
    const total=numeric(value.total_balance)??numeric(value.balance)??
      (grants.length?grants.reduce((a,b)=>a+b,0):null);
    return total!==null&&total>=0?Math.round(total):null;
  }
  function taskFrom(payload,requestedDate){
    const daily=Array.isArray(payload?.data?.tasks)
      ?payload.data.tasks.find(x=>x?.task_key==='daily_check_in'):null;
    if(!daily)return {checkinOutcome:'unknown',checkinDate:null,taskStatus:'unknown'};
    const extra=daily.extra&&typeof daily.extra==='object'?daily.extra:{};
    const days=Array.isArray(extra.check_in_days)?extra.check_in_days:[];
    const day=days.find(x=>x?.date===requestedDate);
    const upstreamDate=[extra.today_date,extra.claimable_date,extra.date,
      daily.date,payload?.data?.today,payload?.data?.date].find(x=>
        typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x));
    const isToday=day||upstreamDate===requestedDate;
    const claimed=day?.status==='claimed'||day?.status==='completed'||
      (isToday&&['claimed','completed'].includes(daily.status));
    const claimable=day?.status==='claimable'||day?.status==='available'||
      daily.status==='claimable'&&(!upstreamDate||upstreamDate===requestedDate);
    return claimed?{checkinOutcome:'claimed',checkinDate:requestedDate,
        taskStatus:'claimed'}:
      claimable?{checkinOutcome:'claimable',checkinDate:requestedDate,
        taskStatus:'claimable',claimDate:day?.date??upstreamDate??null}:
      {checkinOutcome:'unknown',checkinDate:null,taskStatus:'unavailable'};
  }
  async function readAccountStatus(account,signal){
    const sid=await secretFor(account);
    const base=endpointOverride.lingxi??'https://lingxi.kdocs.cn';
    const headers=buildLingxiHeaders(sid,base);
    const timeout=new AbortController();
    const clock=setTimeout(()=>timeout.abort(),9000);
    clock.unref?.();
    const abort=()=>timeout.abort();
    if(signal?.aborted)abort();else signal?.addEventListener?.('abort',abort,{once:true});
    const read=async(path)=>{
      try{
        const res=await send(base+path,{headers},timeout.signal);
        if(!res.ok)return null;
        const json=JSON.parse(await readCapped(res,timeout.signal));
        return json?.result==='UserUnauthorized'?null:json;
      }catch{return null}
    };
    try{
      const [credits,task]=await Promise.all([
        read('/api/public/v1/credits/balance?credit_type=total'),
        read('/api/public/v1/tasks')]);
      if(!credits&&!task)return {state:'unavailable'};
      const date=beijingDate(),balance=balanceFrom(credits);
      return {state:'ready',checkedAt:Date.now(),
        ...(balance!==null?{balance,balanceUnit:'积分',balanceCheckedAt:Date.now()}:{}),
        ...(task?taskFrom(task,date):
          {checkinOutcome:'unknown',checkinDate:null,taskStatus:'unknown'})};
    }finally{
      clearTimeout(clock);
      signal?.removeEventListener?.('abort',abort);
    }
  }
  function accountSnapshot(account){
    return statusCache.get(account?.id)?.data??null;
  }
  async function refreshAccountStatus({account,force=false,signal}={}){
    if(providerId!=='lingxi'||!account)return {state:'unsupported'};
    const id=account.id,cached=statusCache.get(id);
    if(!force&&cached&&now()-cached.at<statusTTL)return cached.data;
    if(statusPending.has(id))return statusPending.get(id);
    const job=readAccountStatus(account,signal).then(result=>{
      if(result.state==='ready')statusCache.set(id,{at:Date.now(),data:result});
      else statusCache.set(id,{at:Date.now(),data:{state:'unavailable'}});
      return result;
    }).finally(()=>statusPending.delete(id));
    statusPending.set(id,job);
    return job;
  }
  async function checkIn({account,date:requestedDate}={}){
    if(providerId!=='lingxi')return {state:'unsupported'};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate))||
      requestedDate!==beijingDate())
      return {state:'failed',message:'签到日期与北京时间不匹配，未提交'};
    const before=await refreshAccountStatus({account,force:true});
    if(before.state!=='ready'||before.taskStatus==='unknown')
      return {state:'failed',message:'读取上游今日签到任务失败，未提交签到'};
    if(before.checkinOutcome==='claimed')
      return {confirmed:true,date:requestedDate,state:'success',
        message:'上游已确认今日签到完成'};
    if(before.checkinOutcome!=='claimable')
      return {state:'failed',message:'上游今日任务未明确开放领取，未提交'};
    const sid=await secretFor(account);
    const base=endpointOverride.lingxi??'https://lingxi.kdocs.cn';
    const headers=buildLingxiHeaders(sid,base);
    const claimDate=before.claimDate;
    const path='/api/public/v1/tasks/daily_check_in/claim'+
      (claimDate===requestedDate?'?date='+encodeURIComponent(claimDate):'');
    const response=await send(base+path,
      {method:'POST',headers,body:'{}'},undefined);
    let payload=null;
    try{payload=JSON.parse(await readCapped(response))}catch{}
    const result=String(payload?.result??'').toLowerCase();
    const after=await refreshAccountStatus({account,force:true});
    if(after.checkinOutcome==='claimed'&&after.checkinDate===requestedDate)
      return {confirmed:true,date:requestedDate,state:'success',
        message:'签到请求后，上游任务中心已确认今天签到完成'};
    if(!response.ok||payload?.result==='UserUnauthorized')
      return {state:'failed',message:'上游拒绝签到（HTTP '+Number(response.status||0)+'）'};
    if(result==='ok'||result==='success')
      return {state:'pending_confirmation',accepted:true,
        message:'上游已受理，任务中心仍未确认签到；定时重新查询'};
    return {state:'failed',message:'签到接口没有有效受理凭据，未确认成功'};
  }
  return {authMethod:'本插件独立安全凭据 · 原 DSH 插件卸载后仍可验证',
    listModels,generate,refresh,login:refresh,
    accountSnapshot,refreshAccountStatus,
    ...(metadata.autoCheckin?{checkIn}:{}),
    nativeReady:true};}
