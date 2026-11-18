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
function planModels(json){
 const candidates=json?.data?.models??json?.data?.plans??json?.models??[];
 return Array.isArray(candidates)?candidates.filter(x=>x&&typeof x==='object')
  .map(x=>({id:typeof x.id==='string'?x.id:x.model_id??x.modelId,name:x.name??x.id??x.model_id}))
  .filter(x=>typeof x.id==='string'&&x.id.length>0&&x.id.length<160)
  .slice(0,100):[];
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
 let text='',reasoning='',done=false,usage=null,toolCalls=[];
 for(const frame of body.split(/\r?\n\r?\n/)){
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
   if(choice.finish_reason)done=true;
  }
 }
 if(!done)throw new UpstreamError('Lingxi stream ended before finish_reason',{code:'TRUNCATED'});
 if(!text.trim()&&!reasoning.trim()&&!toolCalls.length)
  throw new UpstreamError('Lingxi returned empty response',{code:'EMPTY'});
 return {text,reasoning,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',usage};
}
export function createPrivateOwnedDriver({providerId,vault,makeCredentialRef,
 fetchImpl=fetch,endpointOverride={},timeoutMs=90000}={}){
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
    agent_input:{text:messages.filter(m=>m.role==='user').at(-1)?.content??'',
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
     ...(tools.length?{tools:openAiTools(tools),tool_choice:'auto'}:{})})},signal);
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
 async function checkIn({account,date:requestedDate}={}){
  if(providerId!=='lingxi')return {state:'unsupported'};
  const sid=await secretFor(account);
  const base=endpointOverride.lingxi??'https://lingxi.kdocs.cn';
  const headers=buildLingxiHeaders(sid,base);
  const taskRes=await send(base+'/api/public/v1/tasks',{headers},undefined);
  if(!taskRes.ok)throw httpFailure(taskRes,'Lingxi');
  const task=JSON.parse(await readCapped(taskRes));
  // Explicit upstream task record needed. Don't infer success from HTTP 200.
  const entries=task?.data?.tasks;
  const record=Array.isArray(entries)?entries.find(x=>x?.task_key==='daily_check_in'):null;
  if(!record)return {state:'unsupported',message:'上游未提供每日签到任务'};
  if(record.status==='claimed'||record.status==='completed')return {state:'no_task',message:'上游显示已领取，无需重复执行'};
  const extra=record.extra&&typeof record.extra==='object'?record.extra:{};
  const days=Array.isArray(extra.check_in_days)?extra.check_in_days:[];
  const candidate=days.find(x=>['available','claimable'].includes(x?.status));
  if(record.status!=='claimable'&&!candidate)
   return {state:'unsupported',message:'上游签到任务不可领取'};
  const rawDate=candidate?.date??extra.today_date??extra.claimable_date??record.date??task?.data?.today;
  const claimDate=typeof rawDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?rawDate:null;
  if(!claimDate||claimDate!==requestedDate)return {state:'no_task',message:'今日签到日期无法与上游匹配'};
  const url=base+'/api/public/v1/tasks/daily_check_in/claim?date='+encodeURIComponent(claimDate);
  const claimed=await send(url,{method:'POST',headers,body:'{}'},undefined);
  let payload;try{payload=JSON.parse(await readCapped(claimed))}catch{}
  if(!claimed.ok){
   return {state:'failed',message:'签到未获上游确认（HTTP '+claimed.status+'）'};
  }
  const result=String(payload?.result??'');
  if(result.toLowerCase()==='success')return {confirmed:true,date:requestedDate,
    state:'success',message:'上游已确认签到成功'};
  return {state:'failed',message:'签到接口没有明确成功结果，不推断已签到'};
 }
 return {authMethod:'本插件独立安全凭据 · 原 DSH 插件卸载后仍可验证',
  listModels,generate,refresh,login:refresh,
  ...(metadata.autoCheckin?{checkIn}:{}),
  nativeReady:true};
}
