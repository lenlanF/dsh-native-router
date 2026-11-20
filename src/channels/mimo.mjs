// Self-owned MiMo source: API credential survives desktop shutdown;
// optional desktop SSO engine is owned by the running MiMo app, not a DSH plugin.
// Source design: guiling875/dsh-mimo-connect (MIT), with our own isolated vault.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {UpstreamError,safeRetryAfter} from '../failure.mjs';
import {toChatMessages} from '../protocol.mjs';
import {openAiTools,visibleTools} from '../host-tools.mjs';
import {decodeOpenAIResponse,validateModelCalls} from '../provider/openai.mjs';
import {mimoDesktopProcesses,resolveMimoEngine} from './mimo-engine.mjs';

const OWN_ID='own_mimo';
const OWN_REF=/^driver:own_mimo:(mi_[a-f0-9]{28})$/;
const DEFAULT_BASE='https://api.xiaomimimo.com/v1';
const MAX_RESPONSE=16*1024*1024;
const DESKTOP_CHAT=new Set(['mimo-desktop/mimo-auto','mimo-desktop/mimo-pro','mimo-desktop/mimo-flash']);
const keyFor=id=>'NATIVE_ROUTER_MIMO_'+id.slice(3).toUpperCase();
const fingerprint=(type,value)=>'mi_'+createHash('sha256').update('native-router-mimo\0'+type+'\0'+value).digest('hex').slice(0,28);
function normalizedBase(input=DEFAULT_BASE){
 const url=new URL(String(input||DEFAULT_BASE));
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
  throw new Error('MiMo API endpoint must be a credential-free HTTPS URL');
 return url.href.replace(/\/+$/,'');
}
function scanLocalKey(env){
 // Independently configured Open Platform keys take precedence over desktop data.
 // Discovery is read-only: importing still requires the user's explicit approval.
 if(typeof env.MIMO_API_KEY==='string'&&env.MIMO_API_KEY.trim().length>=8){
  try{return {kind:'api',key:env.MIMO_API_KEY.trim(),
   baseUrl:normalizedBase(env.MIMO_BASE_URL||DEFAULT_BASE),source:'environment'}}catch{}
 }
 const home=homedir();
 const dirs=[
  env.MIMOCODE_HOME,
  env.XDG_DATA_HOME&&join(env.XDG_DATA_HOME,'mimocode'),
  env.APPDATA&&join(env.APPDATA,'Xiaomi MiMo','mimocode'),
  join(home,'.local','share','mimocode'),
 ].filter(Boolean);
 for(const dir of new Set(dirs)){
  const file=join(dir,'auth.json');
  if(!existsSync(file))continue;
  try{
   const data=JSON.parse(readFileSync(file,'utf8'))?.xiaomi;
   if(data?.type!=='api'||typeof data.key!=='string')continue;
   const key=data.key.trim();
   if(!key||key==='xiaomi-sso-session')continue;
   const baseUrl=normalizedBase(data.metadata?.base_url||DEFAULT_BASE);
   if(new URL(baseUrl).hostname.toLowerCase()==='mimo-desktop.sso.invalid')continue;
   return {kind:'api',key,baseUrl,source:'local-auth-json'};
  }catch{}
 }
 return null;
}
function parseCredential(raw){
 let data;try{data=JSON.parse(raw)}catch{throw new UpstreamError('MiMo credential invalid',{code:'CREDENTIAL'})}
 if(data?.kind==='engine')return {kind:'engine'};
 if(data?.kind!=='api'||typeof data.key!=='string'||data.key.length<8)
  throw new UpstreamError('MiMo API credential invalid',{code:'CREDENTIAL'});
 try{return {kind:'api',key:data.key,baseUrl:normalizedBase(data.baseUrl)}}
 catch{throw new UpstreamError('MiMo API endpoint invalid',{code:'CREDENTIAL'})}
}
function chatModels(rows){
 return rows.filter(row=>{
  if(typeof row?.id!=='string'||row.id.length>160||!row.id)return false;
  return !row.id.startsWith('mimo-desktop/')||DESKTOP_CHAT.has(row.id);
 }).map(row=>({id:row.id,name:typeof row.name==='string'?row.name:row.id})).slice(0,100);
}
async function readBody(res,signal){
 const size=Number(res.headers?.get?.('content-length')||0);
 if(size>MAX_RESPONSE)throw new UpstreamError('MiMo reply exceeds 16 MiB',{code:'RESPONSE_SIZE'});
 let text='',bytes=0;
 if(!res.body)return res.text();
 const decoder=new TextDecoder();
 for await(const part of res.body){
  if(signal?.aborted)throw new UpstreamError('MiMo cancelled',{code:'CANCELLED'});
  bytes+=part.byteLength;
  if(bytes>MAX_RESPONSE)throw new UpstreamError('MiMo reply exceeds 16 MiB',{code:'RESPONSE_SIZE'});
  text+=decoder.decode(part,{stream:true});
 }
 return text+decoder.decode();
}
export function createMimoDriver({vault,env=process.env,fetchImpl=fetch,
 engineResolver=resolveMimoEngine,findDesktop=mimoDesktopProcesses,
 localKeyReader=scanLocalKey,now=()=>Date.now()}={}){
 const pending=new Map(),cachedStatus=new Map();
 async function credential(account){
  const match=OWN_REF.exec(String(account?.credentialRef??''));
  if(!match||account?.providerId!==OWN_ID||account?.id!==match[1])
   throw new UpstreamError('Invalid self-owned MiMo account binding',{code:'CREDENTIAL'});
  if(typeof vault?.resolve!=='function')throw new UpstreamError('Credentials service unavailable',{code:'CREDENTIAL'});
  let found;
  try{found=await vault.resolve(keyFor(match[1]))}catch{}
  const text=typeof found==='string'?found:found?.value;
  if(typeof text!=='string'||!text)throw new UpstreamError('MiMo credential not found in private vault',{code:'CREDENTIAL'});
  return parseCredential(text);
 }
 async function connection(account){
  const stored=await credential(account);
  if(stored.kind==='api')return {baseUrl:stored.baseUrl,token:stored.key,kind:'api'};
  const engine=await engineResolver({env,fetchImpl});
  if(!engine?.baseUrl||!engine?.token||!/^(?:http:\/\/127\.0\.0\.1|http:\/\/\[::1\]|http:\/\/localhost):\d+\/v1$/.test(engine.baseUrl))
   throw new UpstreamError('MiMo desktop engine is not running or its local authorization failed',{code:'CLIENT_REQUIRED'});
  return {...engine,kind:'engine'};
 }
 async function send(account,method,path,{body,signal,timeoutMs=20000}={}){
  const own=await connection(account);
  const controller=new AbortController();
  const cancel=()=>controller.abort(signal?.reason);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(own.baseUrl+path,{
    method,headers:{authorization:'Bearer '+own.token,accept:path==='/models'?'application/json':'text/event-stream',
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
   if(!response?.ok)throw new UpstreamError('MiMo upstream HTTP '+response?.status,{
    status:response?.status,retryAfterMs:safeRetryAfter(response?.headers?.get?.('retry-after'))});
   return response;
  }catch(error){
   if(controller.signal.aborted&&!signal?.aborted)
    throw new UpstreamError('MiMo upstream timed out',{code:'TIMEOUT',status:408});
   throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 }
 async function listModels({account,signal}={}){
  const res=await send(account,'GET','/models',{signal,timeoutMs:12000});
  let payload;try{payload=JSON.parse(await readBody(res,signal))}catch{
   throw new UpstreamError('MiMo model directory invalid',{code:'BAD_JSON'});
  }
  const list=Array.isArray(payload?.data)?payload.data:[];
  const result=chatModels(list);
  cachedStatus.set(account.id,{at:now(),models:result.length,kind:(await credential(account)).kind});
  return result;
 }
 async function generate({account,model,options={},signal}={}){
  if(typeof model!=='string'||model.length>160||!model.trim())throw new UpstreamError('Invalid MiMo model ID',{code:'MODEL'});
  const tools=visibleTools(options.tools);
  const body={model,messages:toChatMessages(options),stream:true,
   ...(tools.length?{tools:openAiTools(tools),tool_choice:options.toolChoice??'auto'}:{})};
  const max=options.maxTokens??options.max_tokens;
  if(Number.isInteger(max)&&max>0)body.max_tokens=max;
  const res=await send(account,'POST','/chat/completions',{body,signal,timeoutMs:Math.min(600000,options.timeoutMs??120000)});
  const text=await readBody(res,signal);
  return validateModelCalls(decodeOpenAIResponse(text,res.headers?.get?.('content-type')??'text/event-stream'),options.tools);
 }
 async function refresh({account,signal}={}){
  try{
   const rows=await listModels({account,signal});
   return {state:rows.length?'online':'pending',
    message:rows.length?'MiMo 自有授权已通过模型目录鉴权；实际推理仍须验证':'MiMo 模型目录为空，需检查账号权限'};
  }catch(error){
   if(error?.code==='CLIENT_REQUIRED')return {state:'client_required',message:'小米桌面会话需要本机 MiMo 引擎运行'};
   return {state:error?.status===401||error?.status===403?'expired':'error',
     message:'MiMo 自有账号鉴权未通过'};
  }
 }
 async function store(kind,key,baseUrl){
  if(typeof vault?.set!=='function')throw new UpstreamError('Credentials service cannot store MiMo account',{code:'CREDENTIAL'});
  const item=kind==='api'?{kind,key,baseUrl:normalizedBase(baseUrl)}:{kind:'engine'};
  const id=fingerprint(kind,kind==='api'?key+'\0'+item.baseUrl:'local-desktop');
  await vault.set(keyFor(id),JSON.stringify(item));
  return {id,credentialRef:'driver:'+OWN_ID+':'+id,providerId:OWN_ID};
 }
 async function addCredential({apiKey,baseUrl}={}){
  if(typeof apiKey!=='string'||apiKey.trim().length<8||apiKey.length>4096||/[\r\n\u0000]/.test(apiKey))
   throw new Error('MiMo API Key invalid');
  return store('api',apiKey.trim(),baseUrl||DEFAULT_BASE);
 }
 async function discover(){
  pending.clear();const list=[];
  const credential=localKeyReader(env);
   if(credential?.kind==='api'){
    const candidateId=fingerprint('api',credential.key+'\0'+credential.baseUrl);
    pending.set(candidateId,{...credential});
    const fromEnv=credential.source==='environment';
    list.push({id:candidateId,label:fromEnv?'MiMo 环境变量 API Key（独立运行）':'MiMo 桌面端 API Key（独立运行）',
     source:fromEnv?'mimo-environment-key':'mimo-local-key'});
   }  const processes=await findDesktop();
  if(processes.length){
   const candidateId=fingerprint('engine','local-desktop');
   pending.set(candidateId,{kind:'engine'});
   list.push({id:candidateId,label:'MiMo 已登录桌面引擎（依赖 MiMo 客户端）',source:'mimo-desktop-engine'});
  }
  return list;
 }
 async function importCandidate({candidateId,consent}={}){
  if(consent!==true||!pending.has(candidateId))throw new Error('MiMo candidate not discovered or approval missing');
  const item=pending.get(candidateId);pending.delete(candidateId);
  if(item.kind==='engine'){
   const engine=await engineResolver({env,fetchImpl,force:true});
   if(!engine?.models?.some(id=>DESKTOP_CHAT.has(id)))
    throw new Error('MiMo desktop engine failed ownership and chat-model verification');
   return store('engine');
  }
  return store('api',item.key,item.baseUrl);
 }
 async function logout({account}={}){
  const match=OWN_REF.exec(String(account?.credentialRef??''));
  if(match&&account?.id===match[1])await vault?.unset?.(keyFor(match[1]));
  cachedStatus.delete(account?.id);
  return {revokedUpstream:false,message:'MiMo 本插件凭据已删除；没有修改小米官方账号登录状态'};
 }
 function accountSnapshot(account){
  const status=cachedStatus.get(account?.id);
  return status?{label:status.kind==='api'?'MiMo API Key':'MiMo Desktop',
    modelCount:status.models,balanceState:'not_checked'}:{label:'MiMo 自有授权',balanceState:'not_checked'};
 }
 return {authMethod:'官方 API Key / 本机 MiMo 登录态',
  listModels,generate,refresh,login:refresh,logout,discover,importCandidate,
  addCredential,accountSnapshot};
}
