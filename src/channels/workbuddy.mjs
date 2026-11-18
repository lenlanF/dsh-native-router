// WorkBuddy native provider: explicit, read-only desktop auth discovery and
// OpenAI-like upstream protocol. Never writes the desktop client's auth files.
import {readFile,stat,mkdir,rename,writeFile,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {visibleTools,openAiTools} from '../host-tools.mjs';
import {toChatMessages} from '../protocol.mjs';
import {decodeOpenAIResponse,validateModelCalls} from '../provider/openai.mjs';
import {UpstreamError,safeRetryAfter} from '../failure.mjs';
import {defaultConfigPath} from '../config.mjs';

const AUTH_FILES=['workbuddy-desktop.info','workbuddy-desktop-ai.info'];
const AUTH_TAIL=['CodeBuddyExtension','Data','Public','auth'];
const MAX_AUTH_BYTES=512*1024,MAX_RESPONSE_BYTES=16*1024*1024;
const HEADROOM_MS=5*60*1000;
const ID=/^wb_[0-9a-f]{20}$/;
const TOKEN_REF=/^driver:workbuddy:(wb_[0-9a-f]{20})$/;
const DOMAIN_CN='https://copilot.tencent.com',DOMAIN_INTL='https://www.codebuddy.ai';
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeText=value=>typeof value==='string'?value.trim().slice(0,180):
  Number.isFinite(value)?String(value):'';
const privateText=value=>typeof value==='string'&&value.trim().length<=16384?value.trim():'';
function timestamp(value){
  const num=Number(value);
  if(Number.isFinite(num)&&num>0)return num<1e11?num*1000:num;
  const time=typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?time:0;
}
function jwtClaims(token){
  try{
    const raw=token.split('.')[1];
    const parsed=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{return {}}
}
function validateAuth(parsed){
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const auth=parsed.auth&&typeof parsed.auth==='object'&&!Array.isArray(parsed.auth)?parsed.auth:{};
  const access=privateText(parsed.accessToken)||privateText(parsed.access_token)||privateText(auth.accessToken);
  if(!access)return null;
  const claims=jwtClaims(access);
  const accountId=safeText(parsed.uin)||safeText(auth.uin)||safeText(parsed.uid)||safeText(auth.uid)
    ||'unidentified_'+sha(access).slice(0,12);
  const nickname=safeText(parsed.nickname)||safeText(parsed.nickName)||safeText(parsed.displayName)
    ||safeText(auth.nickname)||'WorkBuddy 账号';
  const refresh=privateText(parsed.refreshToken)||privateText(auth.refreshToken);
  const refreshed=timestamp(parsed.lastRefreshAtMs)||timestamp(parsed.lastRefreshTime)||
    timestamp(auth.lastRefreshAtMs)||timestamp(auth.lastRefreshTime);
  const expiresAt=timestamp(parsed.expiresAt)||timestamp(auth.expiresAt)||
    timestamp((Number(claims.exp)||0)*1000);
  const domain=safeText(parsed.domain)||safeText(auth.domain)||safeText(parsed.apiDomain)||safeText(claims.iss);
  const endpoint=/codebuddy\.ai|workbuddy\.ai/i.test(domain)?DOMAIN_INTL:DOMAIN_CN;
  return {accountId,nickname,access,refresh,expiresAt,lastRefreshAtMs:refreshed,endpoint,
    sub:safeText(claims.sub),enterprise:safeText(claims.enterprise_id),tenant:safeText(claims.tenant_id)};
}
function possibleFiles(env){
  const home=env.USERPROFILE||homedir();
  const dirs=[
    env.LOCALAPPDATA||join(home,'AppData','Local'),
    env.APPDATA||join(home,'AppData','Roaming'),
  ];
  const files=[];
  if(env.WORKBUDDY_AUTH_FILE)files.push(resolve(env.WORKBUDDY_AUTH_FILE));
  for(const root of dirs)for(const file of AUTH_FILES)files.push(join(root,...AUTH_TAIL,file));
  return [...new Set(files)];
}
async function readAuth(file,io){
  let info;
  try{info=await io.stat(file)}catch(e){if(e?.code==='ENOENT'||e?.code==='ENOTDIR')return null;throw e}
  if(!info.isFile()||info.size>MAX_AUTH_BYTES||info.size<2)throw Error('WorkBuddy auth file size or type invalid');
  let payload;try{payload=JSON.parse(await io.readFile(file,'utf8'))}catch{throw Error('WorkBuddy auth file is not valid JSON')}
  return validateAuth(payload);
}
function publicId(accountId,file){return 'wb_'+sha(accountId+'\0'+resolve(file)).slice(0,20)}
function sourceManifestPath(dshConfigPath){return join(dirname(dshConfigPath),'workbuddy-sources.json')}
export function createWorkBuddyDriver({
  env=process.env,now=()=>Date.now(),fetchImpl=fetch,
  fileIO={stat,readFile,mkdir,rename,writeFile,unlink},manifestPath=sourceManifestPath(defaultConfigPath()),
  authFiles,allowTestEndpoint,timeoutMs=30000,
}={}){
  const listed=()=>Array.isArray(authFiles)?authFiles:possibleFiles(env);
  // Volatile session tokens are never copied to disk. Desktop files stay read-only.
  const tokenCache=new Map();
  let discovered=new Map();
  let scanTime=0;
  async function enumerate(){
    const byId=new Map();
    for(const file of listed()){
      let auth;try{auth=await readAuth(file,fileIO)}catch{continue}
      if(!auth)continue;
      const id=publicId(auth.accountId,file);
      const prev=byId.get(auth.accountId);
      const current={id,file,auth};
      if(!prev||auth.lastRefreshAtMs>prev.auth.lastRefreshAtMs)byId.set(auth.accountId,current);
    }
    return [...byId.values()];
  }
  async function loadManifest(){
    let raw;try{raw=await fileIO.readFile(manifestPath,'utf8')}
    catch(e){if(e?.code==='ENOENT')return {};throw Error('WorkBuddy source manifest cannot be read')}
    let data;
    try{data=JSON.parse(raw)}catch{throw Error('WorkBuddy source manifest damaged: writes blocked')}
    if(!data||data.version!==1||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))
      throw Error('WorkBuddy source manifest invalid: writes blocked');
    for(const [key,value]of Object.entries(data.entries)){
      if(!ID.test(key)||!value||typeof value.file!=='string'||typeof value.accountId!=='string')
        throw Error('WorkBuddy source manifest contains invalid entries');
    }
    return data.entries;
  }
  async function saveManifest(entries){
    const dir=dirname(manifestPath),temp=manifestPath+'.tmp-'+randomUUID();
    await fileIO.mkdir(dir,{recursive:true});
    const data=JSON.stringify({version:1,entries},null,2)+'\n';
    await fileIO.writeFile(temp,data,{mode:0o600,flag:'wx'});
    try{await fileIO.rename(temp,manifestPath)}
    catch(error){await fileIO.unlink(temp).catch(()=>{});throw error}
  }
  async function findAccount(account){
    const id=TOKEN_REF.exec(account?.credentialRef??'')?.[1];
    if(!id||account?.id!==id)throw new UpstreamError('Invalid WorkBuddy account reference',{code:'CREDENTIAL'});
    const entries=await loadManifest(),record=entries[id];
    if(!record)throw new UpstreamError('Imported WorkBuddy source reference not found',{code:'CREDENTIAL'});
    const auth=await readAuth(record.file,fileIO);
    if(!auth||publicId(auth.accountId,record.file)!==id||auth.accountId!==record.accountId)
      throw new UpstreamError('WorkBuddy desktop account changed; reimport required',{code:'CREDENTIAL'});
    const previous=tokenCache.get(id);
    if(previous&&previous.expiresAt>auth.expiresAt)return {...auth,...previous};
    if(previous&&auth.expiresAt>=previous.expiresAt)tokenCache.delete(id);
    return auth;
  }
  function endpoint(auth){
    // Never allow untrusted contents of a local auth file to select an arbitrary host.
    if(allowTestEndpoint)return allowTestEndpoint(auth);
    return auth.endpoint===DOMAIN_INTL?DOMAIN_INTL:DOMAIN_CN;
  }
  function headers(auth,model=''){
    const requestId=randomUUID().replaceAll('-','');
    const hd={
      authorization:'Bearer '+auth.access,
      accept:'text/event-stream, application/json',
      'content-type':'application/json',
      'x-requested-with':'XMLHttpRequest',
      'x-agent-intent':'craft',
      'x-domain':endpoint(auth)===DOMAIN_INTL?'www.codebuddy.ai':'www.codebuddy.cn',
      'x-product':'SaaS',
      'x-ide-type':'VSCode','x-ide-name':'VSCode',
      'x-ide-version':'1.119.0',
      'x-product-version':'4.9.29177644',
      'x-request-id':requestId,
      'x-conversation-id':randomUUID().replaceAll('-',''),
      'x-conversation-request-id':requestId,
    };
    if(model)hd['x-model-id']=model;
    if(auth.sub)hd['x-user-id']=auth.sub;
    if(auth.enterprise)hd['x-enterprise-id']=auth.enterprise;
    if(auth.tenant)hd['x-tenant-id']=auth.tenant;
    return hd;
  }
  function linkedSignal(signal,ms){
    const controller=new AbortController();
    const propagate=()=>controller.abort(signal.reason??new DOMException('Aborted','AbortError'));
    signal?.addEventListener('abort',propagate,{once:true});
    if(signal?.aborted)propagate();
    const t=setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),ms);
    return {signal:controller.signal,cleanup:()=>{clearTimeout(t);signal?.removeEventListener('abort',propagate)},
      controller};
  }
  async function readResponse(res,signal){
    let body='',size=0;const decoder=new TextDecoder();
    for await(const chunk of res.body??[]){
      if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
      size+=chunk.byteLength;
      if(size>MAX_RESPONSE_BYTES)throw new UpstreamError('WorkBuddy response too large',{code:'RESPONSE_SIZE'});
      body+=decoder.decode(chunk,{stream:true});
    }
    return body+decoder.decode();
  }
  async function refreshVolatile(auth,accountId,signal){
    if(!auth.refresh)return null;
    const request=linkedSignal(signal,Math.min(timeoutMs,12000));
    try{
      const res=await fetchImpl(endpoint(auth)+'/v2/plugin/auth/token/refresh',{
        method:'POST',headers:{authorization:'Bearer '+auth.refresh,'content-type':'application/json',accept:'application/json'},
        body:'{}',signal:request.signal,
      });
      if(!res.ok)return null;
      let payload;try{payload=JSON.parse(await readResponse(res,request.signal))}catch{return null}
      const next=payload?.data;
      if(payload.code!==0||typeof next?.accessToken!=='string'||!next.accessToken)return null;
      const expiresIn=Number(next.expiresIn)||3600;
      const cached={access:next.accessToken,refresh:typeof next.refreshToken==='string'?next.refreshToken:auth.refresh,
        expiresAt:now()+expiresIn*1000,sub:jwtClaims(next.accessToken).sub||auth.sub};
      tokenCache.set(accountId,cached);
      return {...auth,...cached};
    }catch(e){if(signal?.aborted)throw e;return null}
    finally{request.cleanup()}
  }
  async function validSession(account,signal){
    let auth=await findAccount(account);
    if(auth.expiresAt && auth.expiresAt-now()<=HEADROOM_MS && auth.refresh){
      const refreshed=await refreshVolatile(auth,account.id,signal);
      if(refreshed)auth=refreshed;
    }
    if(auth.expiresAt&&auth.expiresAt<=now())
      throw new UpstreamError('WorkBuddy desktop token expired; please sign in to the official client',{status:401});
    return auth;
  }
  async function request(account,path,{method='GET',body,model='',signal,maxMs=timeoutMs}={}){
    let auth=await validSession(account,signal);
    const req=linkedSignal(signal,maxMs);
    try{
      const send=a=>fetchImpl(endpoint(a)+path,{method,headers:headers(a,model),
        ...(body?{body:JSON.stringify(body)}:{}),signal:req.signal});
      let res=await send(auth);
      if((res.status===401||res.status===403)&&auth.refresh){
        const next=await refreshVolatile(auth,account.id,signal);
        if(next){auth=next;res=await send(auth)}
      }
      if(!res.ok)throw new UpstreamError('WorkBuddy upstream HTTP '+res.status,{
        status:res.status,retryAfterMs:safeRetryAfter(res.headers?.get?.('retry-after'))});
      return {text:await readResponse(res,signal),contentType:res.headers?.get?.('content-type')??'text/event-stream'};
    }catch(error){
      if(req.controller.signal.aborted&&!signal?.aborted)throw new UpstreamError('WorkBuddy request timeout',{code:'TIMEOUT',status:408});
      throw error;
    }finally{req.cleanup()}
  }
  async function modelList(account,signal){
    const {text}=await request(account,'/v3/config',{signal,maxMs:Math.min(timeoutMs,15000)});
    let response;
    try{response=JSON.parse(text)}catch{throw new UpstreamError('Invalid WorkBuddy model catalog',{code:'BAD_JSON'})}
    const rows=response?.data?.models;
    if(!Array.isArray(rows))throw new UpstreamError('WorkBuddy model catalog unavailable',{code:'BAD_JSON'});
    return rows.filter(x=>typeof x?.id==='string'&&x.id&&x.supportsToolCall!==false)
      .map(x=>({id:x.id,name:typeof x.name==='string'?x.name:x.id}));
  }
  return {
    authMethod:'WorkBuddy 桌面客户端登录态（只读引用）',
    async discover(){
      const candidates=await enumerate();
      discovered=new Map(candidates.map(row=>[row.id,row]));
      scanTime=now();
       return candidates.map(row=>({id:row.id,
         label:row.auth.nickname,source:'WorkBuddy 桌面端（只读）',
         // A missing refresh token and an expired access token are not a
         // reusable login; never import an already-expired signed-out client.
         reusable:!row.auth.expiresAt||row.auth.expiresAt>now()
           ||!!row.auth.refresh}));
    },
    async importCandidate({candidateId,consent}={}){
      if(consent!==true||!ID.test(candidateId)||now()-scanTime>10*60*1000||!discovered.has(candidateId))
        throw Error('WorkBuddy candidate requires recent discovery and explicit confirmation');
      const matching=(await enumerate()).find(row=>row.id===candidateId);
      if(!matching)throw Error('WorkBuddy login changed since discovery; rescan required');
      const entries=await loadManifest();
      if(entries[candidateId]){
        // Recovery: source metadata might have been written before a separate
        // config-store commit failed. Re-attach the same verified reference.
        if(entries[candidateId].file!==matching.file||entries[candidateId].accountId!==matching.auth.accountId)
          throw Error('WorkBuddy candidate conflicts with previous imported source');
        discovered.delete(candidateId);
        return {id:candidateId,credentialRef:'driver:workbuddy:'+candidateId};
      }
      entries[candidateId]={file:matching.file,accountId:matching.auth.accountId,
        savedAt:now()};
      await saveManifest(entries);
      discovered.delete(candidateId);
      return {id:candidateId,credentialRef:'driver:workbuddy:'+candidateId};
    },
    async login({account}={}){
      return this.refresh({account});
    },
    async refresh({account}={}){
      try{
        await modelList(account);
        return {state:'online',message:'WorkBuddy 远端模型目录校验通过（引用桌面端登录态）'};
      }catch(e){
        return {state:e?.status===401||e?.status===403?'expired':e?.status===429?'limited':'error',
          message:e?.status===401?'桌面端登录已失效，请使用官方客户端重新登录':
            'WorkBuddy 远程连接验证未通过（'+String(e?.code??e?.status??'network').slice(0,36)+'）'};
      }
    },
    async logout({account}={}){
      const id=TOKEN_REF.exec(account?.credentialRef??'')?.[1];
      if(!id)throw Error('Invalid WorkBuddy account reference');
      const entries=await loadManifest();
      if(!entries[id])return {revokedUpstream:false};
      delete entries[id];
      await saveManifest(entries);
      tokenCache.delete(id);
      return {revokedUpstream:false,message:'仅解除本插件绑定，未退出官方桌面客户端'};
    },
    async listModels({account,signal}={}){return modelList(account,signal)},
    async generate({account,model,options={},signal}={}){
      if(typeof model!=='string'||!model.trim())throw new UpstreamError('Invalid WorkBuddy model',{code:'MODEL'});
      const tools=visibleTools(options.tools);
      const payload={model,messages:toChatMessages(options),stream:true,
        ...(tools.length?{tools:openAiTools(tools),tool_choice:options.toolChoice??'auto'}:{})};
      const maxTokens=options.maxTokens??options.max_tokens;
      if(Number.isInteger(maxTokens)&&maxTokens>0)payload.max_tokens=maxTokens;
      const reply=await request(account,'/v2/chat/completions',{method:'POST',body:payload,model,signal});
      return validateModelCalls(decodeOpenAIResponse(reply.text,reply.contentType),options.tools);
    },
  };
}
