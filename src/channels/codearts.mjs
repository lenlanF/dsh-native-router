// CodeArts native channel, Phase 1: user-provisioned temporary AK/SK accounts.
// No OAuth data import, login scanning, credential persistence or background refresh.
import {signCodeArtsRequest} from './codearts-crypto.mjs';
import {randomUUID} from 'node:crypto';
import {visibleTools,openAiTools} from '../host-tools.mjs';
import {toChatMessages} from '../protocol.mjs';
import {decodeOpenAIResponse,validateModelCalls} from '../provider/openai.mjs';
import {UpstreamError,safeRetryAfter} from '../failure.mjs';

const DEFAULT_BASE='https://snap-access.cn-north-4.myhuaweicloud.com';
const ID=/^[A-Z][A-Z0-9_]{0,30}$/;
const REF=/^driver:codearts:ca_([A-Z][A-Z0-9_]{0,30})$/;
const MAX_BYTES=16*1024*1024;
const CONFIG_PATH='/v1/model/builtin';
function names(env){
 return [...new Set(String(env.CODEARTS_ACCOUNT_IDS??'').split(',').map(x=>x.trim()).filter(Boolean))]
   .filter(x=>ID.test(x)).slice(0,50);
}
function credential(env,label){
 if(!ID.test(label))throw new UpstreamError('Invalid CodeArts profile ID',{code:'CREDENTIAL'});
 const root='CODEARTS_'+label+'_';
 const accessKeyId=env[root+'AK'],secretAccessKey=env[root+'SK'],securityToken=env[root+'TOKEN'];
 const expiresAt=env[root+'EXPIRES_AT'];
 if(![accessKeyId,secretAccessKey,securityToken].every(x=>typeof x==='string'&&x.trim()))
  throw new UpstreamError('CodeArts AK/SK/security-token environment profile incomplete',{code:'CREDENTIAL'});
 if([accessKeyId,secretAccessKey,securityToken].some(x=>x.length>16384))
  throw new UpstreamError('CodeArts credential exceeds limit',{code:'CREDENTIAL'});
 return {accessKeyId,secretAccessKey,securityToken,expiresAt:typeof expiresAt==='string'?expiresAt:''};
}
function extractRows(body){
 const candidates=[body?.builtinModels,body?.data?.models,body?.data?.list,body?.data?.items,body?.models,body?.data];
 const rows=candidates.find(Array.isArray);
 if(!rows)throw new UpstreamError('CodeArts model catalog has unknown response shape',{code:'BAD_JSON'});
 const models=rows.filter(row=>typeof row==='string'||(row?.enable!==false&&row?.display_enabled!==false))
  .map(row=>typeof row==='string'?row:row?.model_id??row?.id??row?.modelId)
  .filter(x=>typeof x==='string'&&x.length&&x.length<150);
 return [...new Set(models)].map(id=>({id}));
}
export function createCodeArtsDriver({env=process.env,fetchImpl=fetch,now=()=>Date.now(),
 endpoint=DEFAULT_BASE,timeoutMs=25000}={}){
 if(endpoint!==DEFAULT_BASE&&!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(endpoint))
  throw Error('CodeArts endpoint override requires a loopback test server');
 const chosen=new Set();
 function profile(account){
  const label=REF.exec(account?.credentialRef??'')?.[1];
  if(!label||account.id!=='ca_'+label)throw new UpstreamError('Invalid CodeArts account binding',{code:'CREDENTIAL'});
  const cred=credential(env,label);
  if(cred.expiresAt){
   const ms=Date.parse(cred.expiresAt);
   if(!Number.isFinite(ms)||ms<=now())throw new UpstreamError('CodeArts temporary STS credential expired; renew account authorization',{status:401,code:'CREDENTIAL'});
  }
  return cred;
 }
 async function request(account,path,{method='GET',body='',signal,headers={},ms=timeoutMs}={}){
  if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
  const cred=profile(account),url=endpoint+path;
  const payload=typeof body==='string'?body:JSON.stringify(body);
  const signed=signCodeArtsRequest(url,{method,body:payload,credential:cred,now:now(),
   headers:{'content-type':'application/json','accept':path===CONFIG_PATH?'application/json':'text/event-stream',
     'x-auth-token':cred.securityToken,'x-language':'zh-cn',
     ...(path===CONFIG_PATH?{'agent-type':'PromptCenter'}:
       {'x-snap-traceid':randomUUID().replaceAll('-',''),'app-id':'CodeAgent3.0','is_confidential':'false'}),
     ...headers}});
  const abort=new AbortController();
  const propagate=()=>abort.abort(signal.reason??new DOMException('Aborted','AbortError'));
  signal?.addEventListener('abort',propagate,{once:true});
  const timer=setTimeout(()=>abort.abort(new DOMException('Timeout','TimeoutError')),ms);
  try{
   const response=await fetchImpl(url,{method:signed.method,headers:signed.headers,
      ...(method!=='GET'?{body:payload}:{}),signal:abort.signal,redirect:'error'});
   if(!response.ok)throw new UpstreamError('CodeArts HTTP '+response.status,{
     status:response.status,retryAfterMs:safeRetryAfter(response.headers?.get?.('retry-after'))});
   let size=0,text='';const decoder=new TextDecoder();
   for await(const chunk of response.body??[]){
    if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
    size+=chunk.byteLength;
    if(size>MAX_BYTES)throw new UpstreamError('CodeArts upstream response too large',{code:'RESPONSE_SIZE'});
    text+=decoder.decode(chunk,{stream:true});
   }
   return {text:text+decoder.decode(),contentType:response.headers?.get?.('content-type')??'application/json'};
  }catch(error){
   if(abort.signal.aborted&&!signal?.aborted)throw new UpstreamError('CodeArts upstream timeout',{code:'TIMEOUT',status:408});
   throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',propagate)}
 }
 async function modelList(account,signal){
  const {text}=await request(account,CONFIG_PATH,{signal,ms:Math.min(timeoutMs,15000)});
  let json;try{json=JSON.parse(text)}catch{throw new UpstreamError('CodeArts model list JSON invalid',{code:'BAD_JSON'})}
  if(typeof json?.code==='number'&&json.code!==0)throw new UpstreamError('CodeArts model catalog rejected request',{code:'UPSTREAM'});
  return extractRows(json);
 }
 function find(account){return REF.exec(account?.credentialRef??'')?.[1]??null}
 return {
  authMethod:'临时 AK/SK 环境变量（三件套；本版不执行 OAuth）',
  async discover(){
   chosen.clear();
   for(const name of names(env)){try{credential(env,name);chosen.add(name)}catch{}}
   return [...chosen].map(label=>({id:'ca_'+label,label:'CodeArts / '+label,source:'用户配置的环境变量账号'}));
  },
  async importCandidate({candidateId,consent}={}){
   const label=/^ca_([A-Z][A-Z0-9_]{0,30})$/.exec(candidateId??'')?.[1];
   if(!consent||!label||!chosen.has(label))throw Error('CodeArts profile must be discovered and explicitly confirmed');
   credential(env,label);
   chosen.delete(label);
   return {id:'ca_'+label,credentialRef:'driver:codearts:ca_'+label};
  },
  async refresh({account}={}){
   try{await modelList(account);return {state:'online',message:'CodeArts 临时 AK/SK 签名验证及模型目录访问通过'}}
   catch(error){
    return {state:error?.status===401||error?.status===403?'expired':error?.status===429?'limited':'error',
      message:error?.code==='CREDENTIAL'?'CodeArts 临时凭据缺失或已过期':
       'CodeArts 签名模型目录验证未通过（'+String(error?.code??error?.status??'network').slice(0,36)+'）'};
   }
  },
  async logout(){return {revokedUpstream:false,message:'仅解除本插件账号绑定；环境变量中的临时凭据未被撤销'}},
  async listModels({account,signal}={}){return modelList(account,signal)},
  async generate({account,model,options={},signal}={}){
   if(typeof model!=='string'||!model.trim())throw new UpstreamError('Invalid CodeArts model ID',{code:'MODEL'});
   const tools=visibleTools(options.tools);
   const payload={model,messages:toChatMessages(options),stream:true,
     ...(tools.length?{tools:openAiTools(tools),tool_choice:options.toolChoice??'auto'}:{})};
   const maxTokens=options.maxTokens??options.max_tokens;
   if(Number.isInteger(maxTokens)&&maxTokens>0)payload.max_tokens=maxTokens;
   // A benefit model is NOT assumed free from name or user tag: maas_type must be
   // derived from authoritative provider entitlement discovery in a later phase.
   const reply=await request(account,'/api/v2/chat/completions',{method:'POST',body:payload,signal});
   return validateModelCalls(decodeOpenAIResponse(reply.text,reply.contentType),options.tools);
  },
 };
}
