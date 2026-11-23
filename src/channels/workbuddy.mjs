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
import {publicAccountName} from '../account-facts.mjs';
import {createWorkBuddyMemberReader} from './workbuddy-members.mjs';
import {ownCredentialRef} from '../credential-ref.mjs';

const AUTH_FILES=['workbuddy-desktop.info','workbuddy-desktop-ai.info'];
const AUTH_TAIL=['CodeBuddyExtension','Data','Public','auth'];
const MAX_AUTH_BYTES=512*1024,MAX_RESPONSE_BYTES=16*1024*1024;
const HEADROOM_MS=5*60*1000;
const ID=/^wb_[0-9a-f]{20}$/;
const TOKEN_REF=/^driver:workbuddy:(wb_[0-9a-f]{20})$/;
const DOMAIN_CN='https://copilot.tencent.com',DOMAIN_INTL='https://www.codebuddy.ai';
// Original WorkBuddy hosts differ from the similarly named CodeBuddy IDE.
const OWN_DOMAINS=Object.freeze({cn:'https://www.workbuddy.cn',global:'https://www.workbuddy.ai'});
const OWNED_REF=/^driver:(own_workbuddy-cn|own_workbuddy-global):(wbp_[a-f0-9]{24})$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeText=value=>typeof value==='string'?value.trim().slice(0,180):
  Number.isFinite(value)?String(value):'';
const privateText=value=>typeof value==='string'&&value.trim().length<=16384?value.trim():'';
// WorkBuddy's live /v3/config models carry their credit rate in `credits`
// (e.g. "x0.00 credits"), NOT in `name`. The MIT original parser uses this
// exact field; never infer a zero cost from model names, fallback rosters or IDs.
function officialZeroCredit(item){
  return typeof item?.credits==='string'
    && /^\s*x\s*0(?:\.0+)?(?:\s+credits?)?\s*$/i.test(item.credits);
}
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
  const uid=safeText(parsed.uid)||safeText(auth.uid)||safeText(claims.sub);
  const uin=safeText(parsed.uin)||safeText(auth.uin)||safeText(claims.uin);
  const accountId=uin||uid||'unidentified_'+sha(access).slice(0,12);
  const nickname=safeText(parsed.displayName)||safeText(auth.displayName)||
   safeText(parsed.enterpriseUserName)||safeText(auth.enterpriseUserName)||
   safeText(parsed.nickname)||safeText(parsed.nickName)||safeText(auth.nickname)||
   safeText(claims.nickname)||safeText(claims.preferred_username);
  const refresh=privateText(parsed.refreshToken)||privateText(auth.refreshToken);
  const refreshed=timestamp(parsed.lastRefreshAtMs)||timestamp(parsed.lastRefreshTime)||
   timestamp(auth.lastRefreshAtMs)||timestamp(auth.lastRefreshTime);
  const expiresAt=timestamp(parsed.expiresAt)||timestamp(auth.expiresAt)||
   timestamp((Number(claims.exp)||0)*1000);
  const domain=safeText(parsed.domain)||safeText(auth.domain)||safeText(parsed.apiDomain)||safeText(claims.iss);
  const endpoint=/codebuddy\.ai|workbuddy\.ai/i.test(domain)?DOMAIN_INTL:DOMAIN_CN;
  return {accountId,uid,uin,nickname,access,refresh,expiresAt,
   lastRefreshAtMs:refreshed,domain,endpoint,
   enterprise:safeText(parsed.enterpriseId)||safeText(auth.enterpriseId)||
     safeText(parsed.enterprise_id)||safeText(auth.enterprise_id)||safeText(claims.enterprise_id),
   tenant:safeText(parsed.tenantId)||safeText(auth.tenantId)||safeText(claims.tenant_id)};
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
  ownedRegion=null,ownedVault=null,makeCredentialRef,
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
  async function ownedCredentialRef(id){
    const ref=makeCredentialRef??ownCredentialRef;
    return ref('NATIVE_ROUTER_WB_'+id.slice(4).toUpperCase());
  }
  async function readOwnedAuth(account){
    const match=OWNED_REF.exec(String(account?.credentialRef??''));
    if(!OWN_DOMAINS[ownedRegion]||!match||match[1]!=='own_workbuddy-'+ownedRegion
       ||account?.providerId!==match[1]||account?.id!==match[2])
      throw new UpstreamError('Invalid WorkBuddy independent account binding',{code:'CREDENTIAL'});
    const resolved=await ownedVault?.resolve?.(await ownedCredentialRef(account.id));
    let data;try{data=JSON.parse(resolved?.value??resolved)}catch{}
    const expectedDomain=ownedRegion==='cn'?'www.workbuddy.cn':'www.workbuddy.ai';
    if(data?.domain!==expectedDomain)throw new UpstreamError('WorkBuddy source region mismatch',{code:'CREDENTIAL'});
    const auth=validateAuth({auth:data});
    if(!auth)throw new UpstreamError('WorkBuddy private credential not usable',{code:'CREDENTIAL'});
    return {...auth,endpoint:OWN_DOMAINS[ownedRegion]};
  }
  async function writeOwnedRefresh(accountId,auth,cached){
    if(!ownedRegion)return;
    if(typeof ownedVault?.set!=='function')throw new UpstreamError('DSH Credentials unavailable',{code:'CREDENTIAL'});
    await ownedVault.set(await ownedCredentialRef(accountId),JSON.stringify({
      accessToken:cached.access,refreshToken:cached.refresh,
      expiresAt:Math.floor(cached.expiresAt/1000),
      domain:ownedRegion==='cn'?'www.workbuddy.cn':'www.workbuddy.ai',
      ...(auth.uid?{uid:auth.uid}:{}),
      ...(auth.uin?{uin:auth.uin}:{}),
      ...(auth.enterprise?{enterpriseId:auth.enterprise}:{}),
      ...(auth.tenant?{tenantId:auth.tenant}:{}),
      ...(auth.nickname?{nickname:auth.nickname}:{}),
    }));
  }
  async function findAccount(account){
    if(ownedRegion){
      const auth=await readOwnedAuth(account);
      const prior=tokenCache.get(account.id);
      return prior&&prior.expiresAt>auth.expiresAt?{...auth,...prior}:auth;
    }
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
    return ownedRegion?OWN_DOMAINS[ownedRegion]:auth.endpoint===DOMAIN_INTL?DOMAIN_INTL:DOMAIN_CN;
  }
  function headers(auth,model=''){
    const requestId=randomUUID().replaceAll('-','');
    const hd={
      authorization:'Bearer '+auth.access,
      accept:'text/event-stream, application/json',
      'content-type':'application/json',
      'x-requested-with':'XMLHttpRequest',
      'x-agent-intent':'craft',
      'x-domain':ownedRegion?(ownedRegion==='cn'?'www.workbuddy.cn':'www.workbuddy.ai'):
        endpoint(auth)===DOMAIN_INTL?'www.codebuddy.ai':'www.codebuddy.cn',
      'x-product':'SaaS',
      'x-ide-type':'VSCode','x-ide-name':'VSCode',
      'x-ide-version':'1.119.0',
      'x-product-version':'4.9.29177644',
      'x-request-id':requestId,
      'x-conversation-id':randomUUID().replaceAll('-',''),
      'x-conversation-request-id':requestId,
    };
    if(ownedRegion){
      // Header contract traced to installed MIT dsh-connect-workbuddy 5.24.10.
      // Include conversation message identity and the official CLI UA; a
      // synthetic CodeBuddy product or missing conversation ID is rejected.
      const base=endpoint(auth);
      hd['user-agent']='CLI/2.63.2 CodeBuddy/2.63.2';
      hd.origin=base;hd.referer=base+'/';
      hd['x-conversation-message-id']=randomUUID();
      hd['x-conversation-id']=randomUUID();
      hd['x-conversation-request-id']=randomUUID();
      hd['x-requested-with']='XMLHttpRequest';
      hd['x-product']='SaaS';
      hd['x-user-id']=auth.accountId||auth.sub||'';
      if(!hd['x-user-id']){delete hd['x-user-id'];hd['x-no-user-id']='1'}
      if(!auth.enterprise){hd['x-no-enterprise-id']='1'}
      else{hd['x-enterprise-id']=auth.enterprise;hd['x-tenant-id']=auth.enterprise}
      delete hd['x-ide-name'];delete hd['x-ide-type'];
      delete hd['x-ide-version'];delete hd['x-product-version'];
      delete hd['x-agent-intent'];
    }
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
        method:'POST',headers:ownedRegion?{
          accept:'application/json, text/plain, */*',
          'x-refresh-token':auth.refresh,'x-auth-refresh-source':'workbuddy',
          origin:endpoint(auth),referer:endpoint(auth)+'/',
          'user-agent':'CLI/2.63.2 CodeBuddy/2.63.2',
          ...(auth.enterprise?{'x-enterprise-id':auth.enterprise}:{}),
        }:{authorization:'Bearer '+auth.refresh,'content-type':'application/json',accept:'application/json'},
        ...(ownedRegion?{}:{body:'{}'}),signal:request.signal,
      });
      if(!res.ok)return null;
      let payload;try{payload=JSON.parse(await readResponse(res,request.signal))}catch{return null}
      const next=payload?.data;
      if(payload.code!==0||typeof next?.accessToken!=='string'||!next.accessToken)return null;
      const expiresIn=Number(next.expiresIn)||3600;
      const cached={access:next.accessToken,refresh:typeof next.refreshToken==='string'?next.refreshToken:auth.refresh,
        expiresAt:now()+expiresIn*1000,sub:jwtClaims(next.accessToken).sub||auth.sub};
      if(ownedRegion)await writeOwnedRefresh(accountId,auth,cached);
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
    if(ownedRegion){
      // Match the licensed original WorkBuddy plugin's split model catalogs.
      // CN uses the product-desktop UA and a legacy personal roster fallback;
      // global merges CLI and desktop catalogs (neither is a superset).
      let auth=await validSession(account,signal);
      const request=linkedSignal(signal,Math.min(timeoutMs,18000));
      const readCatalog=async(path,userAgent,withOrigin=false)=>{
        const send=a=>fetchImpl(endpoint(a)+path,{
          headers:{
            authorization:'Bearer '+a.access,accept:'application/json',
            ...(a.accountId?{'x-user-id':a.accountId}:{}),
            'x-domain':ownedRegion==='cn'?'www.workbuddy.cn':'www.workbuddy.ai',
            'x-product':'SaaS','x-requested-with':'XMLHttpRequest',
            'user-agent':userAgent,
            ...(withOrigin?{origin:endpoint(a),referer:endpoint(a)+'/'}:{}),
          },signal:request.signal});
        let res=await send(auth);
        if([401,403].includes(res.status)&&auth.refresh){
          const renewed=await refreshVolatile(auth,account.id,signal);
          if(renewed){auth=renewed;res=await send(auth)}
        }
        if(!res.ok)throw new UpstreamError('WorkBuddy model catalog HTTP '+res.status,{status:res.status});
        let doc;try{doc=JSON.parse(await readResponse(res,request.signal))}catch{
          throw new UpstreamError('Malformed WorkBuddy model catalog',{code:'BAD_JSON'})}
        if(doc?.code!==0||!Array.isArray(doc?.data?.models))
          throw new UpstreamError('WorkBuddy model catalog rejected',{code:'BAD_JSON'});
        const map=new Map();
        for(const item of doc.data.models){
          if(typeof item?.id==='string'&&item.id.length<160&&item.id
             &&item.supportsToolCall!==false)
             map.set(item.id,{id:item.id,name:typeof item.name==='string'?item.name:item.id,
               ...(officialZeroCredit(item)?{upstreamFreeLabel:true}:{})});
        }
        const cli=Array.isArray(doc?.data?.agents)
          ?doc.data.agents.find(x=>x?.name==='cli'&&Array.isArray(x.models)):null;
        const ids=cli?.models?.length?cli.models:[...map.keys()];
        return ids.filter(x=>typeof x==='string'&&map.has(x)).map(x=>map.get(x));
      };
      try{
        let rows;
        if(ownedRegion==='global'){
          const cli=await readCatalog('/v3/config','CLI/2.63.2 CodeBuddy/2.63.2').catch(()=>[]);
          const desktop=await readCatalog('/v3/config','WorkBuddy/5.8.3').catch(()=>[]);
          const seen=new Map();
           for(const item of [...cli,...desktop]){
             const prior=seen.get(item.id);
             if(!prior||(!prior.upstreamFreeLabel&&item.upstreamFreeLabel))seen.set(item.id,item);
           }
          rows=[...seen.values()];
        }else{
          const ua='WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0';
          rows=await readCatalog('/v3/config',ua,true).catch(()=>
            readCatalog('/v2/enterprises/personal/models',ua,true));
        }
        if(!rows.length)throw new UpstreamError('No WorkBuddy models confirmed by upstream',{code:'MODEL_CATALOG'});
        return rows.slice(0,160);
      }finally{request.cleanup()}
    }

    const {text}=await request(account,'/v3/config',{signal,maxMs:Math.min(timeoutMs,15000)});
    let response;
    try{response=JSON.parse(text)}catch{throw new UpstreamError('Invalid WorkBuddy model catalog',{code:'BAD_JSON'})}
    const rows=response?.data?.models;
    if(!Array.isArray(rows))throw new UpstreamError('WorkBuddy model catalog unavailable',{code:'BAD_JSON'});
    return rows.filter(x=>typeof x?.id==='string'&&x.id&&x.supportsToolCall!==false)
       .map(x=>({id:x.id,name:typeof x.name==='string'?x.name:x.id,
         ...(officialZeroCredit(x)?{upstreamFreeLabel:true}:{})}));
  }
  // Metadata-only diagnosis of incomplete OpenAI SSE. No model content, headers,
  // cookie, user identity or upstream free-form error is ever retained.
  function safeStreamPhase(body,contentType){
    if(!contentType.includes('text/event-stream'))return 'NON_SSE_INCOMPLETE';
    if(!/(?:^|\r?\n)data:\s*\S/m.test(body))return 'NO_SSE_FRAMES';
    const done=/(?:^|\r?\n)data:\s*\[DONE\]\s*(?:\r?\n|$)/m.test(body);
    const finish=/(?:^|[,{])\s*"finish_reason"\s*:\s*"(?:stop|length|tool_calls)"/m.test(body);
    if(!done&&finish)return 'FINISH_FRAME_MISSING_DONE';
    if(!done)return 'MISSING_DONE_AND_FINISH';
    if(!finish)return 'DONE_MISSING_FINISH';
    return 'UNCLASSIFIED_SSE';
  }
  const memberReader=createWorkBuddyMemberReader({fetchImpl,now,baseOverride:allowTestEndpoint});
  const memberSnapshots=new Map(),benefitInflight=new Set();
  async function fetchMemberFacts(account,signal){
    const auth=await validSession(account,signal);
    const region=ownedRegion??(auth.endpoint===DOMAIN_INTL?'global':'cn');
    const [profile,credits,benefits]=await Promise.allSettled([
      memberReader.profile(auth,region,signal),
      memberReader.credits(auth,region,signal),
      memberReader.benefits(auth,region,signal),
    ]);
    const latest=memberSnapshots.get(account.id)??{};
    const profileRow=profile.status==='fulfilled'?profile.value:{};
    const creditRow=credits.status==='fulfilled'?credits.value:null;
    const benefitsRow=benefits.status==='fulfilled'?benefits.value:null;
    const name=publicAccountName(profileRow,{displayName:auth.nickname},account);
    const next={...latest,
      ...(name?{accountName:name}:{}),
      ...(creditRow??{
        balanceState:Number.isFinite(latest.balance)?'available':'not_returned',
        creditFetchState:'unavailable',
      }),
      ...(benefitsRow?{benefits:benefitsRow,
        availableBenefits:benefitsRow.filter(x=>x.active&&!x.claimed).length,
        benefitsCheckedAt:now()}:{}),
      profileCheckedAt:now(),
    };
    memberSnapshots.set(account.id,next);
    return {state:creditRow||profileRow?.authVerified===true?'online':'unavailable',
      authVerified:!!creditRow||profileRow?.authVerified===true,
      ...next};
  }
  async function workbuddyDailyCheckIn({account,date}={}){
    if(!ownedRegion)return {state:'unsupported'};
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return {state:'failed',message:'签到日期非法'};
    const auth=await validSession(account);
    if(auth.enterprise)return {state:'no_task',message:'企业账号无个人每日签到活动'};
    const url=ownedRegion==='cn'?'https://www.codebuddy.cn':'https://www.workbuddy.ai';
    const request=linkedSignal(undefined,Math.min(timeoutMs,15000));
    const hd={authorization:'Bearer '+auth.access,accept:'application/json',
      'content-type':'application/json',
      ...(auth.accountId?{'x-user-id':auth.accountId}:{}),
      'x-domain':ownedRegion==='cn'?'www.workbuddy.cn':'www.workbuddy.ai'};
    const post=async path=>{
      const response=await fetchImpl(url+path,{method:'POST',headers:hd,body:'{}',signal:request.signal});
      if(!response.ok)return {ok:false};
      let payload;try{payload=JSON.parse(await readResponse(response,request.signal))}catch{}
      return {ok:payload?.code===0,data:payload?.data??{}};
    };
    try{
      const statusPath='/v2/billing/meter/checkin-activity-status';
      const before=await post(statusPath);
      if(!before.ok)return {state:'failed',message:'WorkBuddy 今日签到状态无法验证'};
      if(before.data?.today_checked_in===true)return {confirmed:true,date,
        message:'WorkBuddy 上游确认今日已经签到'};
      if(before.data?.active!==true)return {state:'no_task',message:'今日签到活动未开放'};
      const claimed=await post('/v2/billing/meter/daily-checkin');
      if(!claimed.ok)return {state:'failed',message:'WorkBuddy 签到请求未被上游接受'};
      const after=await post(statusPath);
      if(after.ok&&after.data?.today_checked_in===true)return {confirmed:true,date,
        message:'WorkBuddy 今日签到已由上游二次确认'};
      return {state:'pending_confirmation',accepted:true,message:'已请求签到，但尚未核实上游今日状态'};
    }catch{return {state:'failed',message:'WorkBuddy 签到通信未成功'}}
    finally{request.cleanup()}
  }
  // A user-triggered check-in, or the already opt-in automatic check-in
  // scheduler, also collects officially eligible account gifts/compensation.
  // It never guesses campaigns, never buys, and never retries a POST whose
  // outcome is uncertain (the upstream may already have credited it).
  async function workbuddyCheckIn({account,date}={}){
    const daily=await workbuddyDailyCheckIn({account,date});
    if(!ownedRegion||daily.state==='client_required')return daily;
    let auth;try{auth=await validSession(account)}catch{return daily}
    if(auth.enterprise)return daily;
    const region=ownedRegion,available=await memberReader.benefits(auth,region).catch(()=>[]);
    let claimed=0,uncertain=0;
    for(const benefit of available){
      if(!benefit?.active||benefit.claimed||
        !['gift','compensation'].includes(benefit.kind))continue;
      const key=account.id+'\0'+benefit.kind+'\0'+date;
      if(benefitInflight.has(key)){uncertain++;continue}
      // Remains locked for the day even if a network error leaves outcome
      // ambiguous; refresh metadata before ANY later deliberate re-claim.
      benefitInflight.add(key);
      try{
        const outcome=await memberReader.claimBenefit(auth,region,benefit.kind);
        if(outcome.confirmed===true)claimed++;
        else if(outcome.state==='pending_confirmation')uncertain++;
      }catch{uncertain++}
    }
    // The display refresh is read-only and never re-sends a reward claim.
    if(available.some(x=>x.active&&!x.claimed))
      await fetchMemberFacts(account).catch(()=>{});
    if(daily.confirmed||claimed>0)
      return {confirmed:true,date,message:claimed?
        'WorkBuddy 今日签到/活动奖励已读取官方确认 · 新增领取 '+claimed+' 项':
        daily.message};
    if(uncertain>0)return {state:'pending_confirmation',
      message:'WorkBuddy 活动领取回执尚未确认，停止重复领取'};
    return daily;
  }
  return {
    ...(ownedRegion?{checkIn:workbuddyCheckIn}:{}),
    authMethod:ownedRegion?'WorkBuddy 自有凭据 · 已与原 DSH 插件分离':
       'WorkBuddy 桌面客户端登录态（只读引用）',
    async discover(){
       if(ownedRegion)return [];
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
       if(ownedRegion)throw Error('Use explicit WorkBuddy vault adoption instead');
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
     async refresh({account,signal}={}){
       try{
        await modelList(account,signal);
        // Metadata reads use this owner's exact signed session, never the
        // original WorkBuddy plugin, and do not spend generation credits.
        await fetchMemberFacts(account,signal).catch(()=>{});
        return {state:'online',message:'WorkBuddy 官方模型和个人积分信息已发起核对；账号详情来自自有授权'};
       }catch(e){
        return {state:e?.status===401||e?.status===403||e?.code==='CREDENTIAL'?'expired':e?.status===429?'limited':'error',
          message:e?.status===401||e?.status===403||e?.code==='CREDENTIAL'
            ?'WorkBuddy 授权已失效或本地凭据不可用，请检查登录状态':
            'WorkBuddy 远程连接暂不可用'};
       }
     },
     accountSnapshot(account){
       const row=memberSnapshots.get(account?.id)??{};
       const name=publicAccountName(row,account);
       return {...row,...(name?{accountName:name}:{})};
     },
     async refreshAccountStatus({account,signal}={}){
       try{
        const facts=await fetchMemberFacts(account,signal);
        return {state:facts.authVerified===true?'online':'unavailable',
         authVerified:facts.authVerified===true,
         ...(facts.authVerified===true?{checkedAt:now()}:{})};
       }catch{return {state:'unavailable',authVerified:false}}
     },
    async logout({account}={}){
       if(ownedRegion){
         const owner='own_workbuddy-'+ownedRegion;
         const found=OWNED_REF.exec(String(account?.credentialRef??''));
         if(!found||found[1]!==owner||found[2]!==account?.id)throw Error('Invalid owned WorkBuddy identity');
         await ownedVault?.unset?.(await ownedCredentialRef(account.id));
         tokenCache.delete(account.id);
         return {revokedUpstream:false,message:'已解除聚合路由独立授权，原插件账号未改变'};
       }
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
      const messages=toChatMessages(options);
      if(ownedRegion&&!messages.some(row=>row.role==='system'))messages.unshift({role:'system',content:'You are a helpful assistant.'});
      const payload={model,messages,stream:true,
        ...(tools.length?{tools:openAiTools(tools),tool_choice:options.toolChoice??'auto'}:{})};
      const maxTokens=options.maxTokens??options.max_tokens;
      if(Number.isInteger(maxTokens)&&maxTokens>0)payload.max_tokens=maxTokens;
      const reply=await request(account,'/v2/chat/completions',{method:'POST',body:payload,model,signal});
       try{return validateModelCalls(decodeOpenAIResponse(reply.text,reply.contentType),options.tools)}
       catch(error){
         if(error?.code==='TRUNCATED')error.safeStreamPhase=safeStreamPhase(reply.text,reply.contentType);
         throw error;
       }
    },
  };
}
