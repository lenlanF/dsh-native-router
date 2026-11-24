import {readFileSync} from 'node:fs';
import {freeEvidence} from './auto-free.mjs';
import {publicAdministrativeError} from './public-diagnostics.mjs';
// Version is read from this installed package, never hardcoded into the UI.
const PLUGIN_VERSION=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
import {createOwnedModelDirectory} from './owned-model-directory.mjs';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {mergeAccountSources,visiblePrivateSourceAccounts} from './account-source-view.mjs';
// Owner-authenticated DSH Connection admin APIs; same-origin management writes, loopback-only HTTP.
const BASE='/plugins/dsh-native-router';
// Stable owner-facing migration results. Never forward raw upstream failures,
// source credential names, paths, account identifiers, or exception messages.
const ADOPTION_ERRORS=Object.freeze({
 consent_required:'请先明确确认接管本账号',
 credentials_unavailable:'DSH 凭据服务不可用，尚未复制授权；请检查插件运行依赖及宿主凭据服务',
 credentials_missing:'已存在接管记录，但自有凭据已缺失；请先核查账号，避免重复覆盖',
 native_login_disabled:'自有多渠道账号池未启用；保存设置并重新加载 DSH 后重试',
 native_login_not_ready:'自有渠道包尚未挂载，请在「自主登录」查看加载诊断后重试',
 persistent_credentials_unavailable:'自有账号池未连接持久化凭据存储；未改动原账号',
 source_missing_or_changed:'原账号授权在扫描后已变化，请重新扫描并核对登录状态',
 invalid_source_credential:'原账号授权格式未通过校验，请检查原插件登录状态',
 provider_conflict:'同名自有 Provider 配置冲突；需先检查现有渠道配置',
 conflict:'发现已有冲突的接管记录，未覆盖账号或凭据',
 busy:'该账号的接管操作仍在执行，请勿重复提交',
 unavailable:'接管服务暂不可用；请检查 DSH 凭据服务及运行依赖',
 unsupported:'该渠道尚无经过验证的独立接管方案，请使用自主登录',
});
function json(res,status,value){
  res.statusCode=status;
  res.setHeader?.('content-type','application/json; charset=utf-8');
  res.setHeader?.('cache-control','no-store');
  res.end(JSON.stringify(value));
}
function isLoopback(req){
  const addr=req.socket?.remoteAddress??'';
  return addr==='127.0.0.1'||addr==='::1'||addr==='::ffff:127.0.0.1';
}
function sameOrigin(req){
  const origin=req.headers?.origin;
  if(!origin)return true; // DSH Connection already authenticated the owner Peer.
  try{
    const parsed=new URL(origin);
    if(parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)return false;
    // DSH Connection owns identity and upstream Host admission. Enforce exact
    // browser Origin/Host equality, but do NOT hardcode localhost: the Host
    // can legitimately serve the authenticated DSH UI over remote HTTPS.
    const host=req.headers?.host;
    if(typeof host!=='string'||!host||parsed.host.toLowerCase()!==host.toLowerCase())
      return false;
    if(parsed.protocol==='https:')return true;
    return parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  }catch{return false}
}
function readJson(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0,finished=false;
    req.on('data',chunk=>{
      if(finished)return;
      size+=chunk.byteLength;
      if(size>1048576){finished=true;reject(new Error('Request body exceeds 1 MiB'));return}
      chunks.push(chunk);
    });
    req.on('end',()=>{
      if(finished)return;
      finished=true;
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}
      catch{reject(new Error('Request body must be valid JSON'))}
    });
    req.on('error',error=>{if(!finished){finished=true;reject(error)}});
  });
}
export function registerRouterRoutes(ctx,{configStore,adapter,accountCenter,checkinCenter,
  embeddedPack,sessionReuse,accountAdoption,hostProviderInventory,credentialsBridge,activityCenter,ownerAcceptance}){
  const server=ctx.get?.('webServer')??ctx.webServer;
  if(!server?.register)return()=>{};
  const dispose=[];
  const mount=(path,handler)=>{
    const d=server.register({kind:'exact',path:BASE+path,handler});
    if(typeof d==='function')dispose.push(d);
  };
  const ownedDirectory=createOwnedModelDirectory({configStore,accountCenter,checkinCenter,embeddedPack,hostProviderInventory});
  const publicSessionReuse=()=>{
    const base=sessionReuse?.snapshot?.()??{enabled:false,channels:[]};
    return {...base,hostProviders:ownedDirectory.providers()};
  };
  if(ownerAcceptance)mount('/acceptance',async(req,res)=>{
    if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
    if(req.method==='GET')return json(res,200,{ok:true,result:ownerAcceptance.snapshot()});
    if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
    try{
      const body=await readJson(req);
      if(body?.action==='start')return json(res,202,{ok:true,result:ownerAcceptance.start(body)});
      if(body?.action==='cancel')return json(res,200,{ok:true,result:ownerAcceptance.cancel(body.requestId)});
      return json(res,400,{ok:false,error:'Invalid acceptance action'});
    }catch(error){const failure=publicAdministrativeError(error,400);
      return json(res,failure.status,{ok:false,error:failure.error})}
  });
  mount('/config',async(req,res)=>{
    if(!isLoopback(req))return json(res,403,{error:'Loopback only'});
    if(req.method==='GET')return json(res,200,{ok:true,config:configStore.get()});
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    if(!sameOrigin(req))return json(res,403,{error:'Cross-origin update rejected'});
    try{
      const incoming=await readJson(req);
      const current=configStore.get();
      const next=configStore.replace(incoming);
      adapter.invalidateCatalog();
      return json(res,200,{ok:true,config:next,restartRequired:true,
        message:'Changes saved. Restart DSH Host to refresh provider and host failover registration.'});
    }catch(error){
      const failure=publicAdministrativeError(error,400);
      return json(res,failure.status,{ok:false,error:failure.error,...(failure.code?{code:failure.code}:{})});
    }
  });
  mount('/status',(req,res)=>{
    if(!isLoopback(req))return json(res,403,{error:'Loopback only'});
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    return json(res,200,{ok:true,...adapter.getStatus(),version:PLUGIN_VERSION,embeddedPack:embeddedPack?.status?.()??{state:'unavailable'},
      credentialService:credentialsBridge?.status?.()??{state:'unknown',available:false},
      sessionReuse:publicSessionReuse()});
  });
  // AutoFree is an ephemeral model pool, never a persisted model chain.
  mount('/models/autofree',async(req,res)=>{
    if(!isLoopback(req))return json(res,403,{ok:false,error:'Loopback only'});
    if(req.method!=='GET')return json(res,405,{ok:false,error:'Method not allowed'});
    return json(res,200,{ok:true,result:adapter.autoFreeSnapshot?.()??{state:'unavailable',models:[],catalog:[]}});
  });
  mount('/models/autofree/refresh',async(req,res)=>{
    if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
    if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
    try{return json(res,200,{ok:true,result:await adapter.refreshAutoFree()})}
    catch{return json(res,503,{ok:false,error:'免费模型目录刷新失败；未修改任何账号或手工模型链'})}
  });
  // All ORIGINAL DSH Providers, not just those in native-router's config.
  // This read-only catalog powers the Agent-level failover model picker.
  // Bounded concurrency, no credential enumeration and no login side effects.
  const allowHostModels=(providerId,rows)=>{
    const selection=configStore.get().hostModelSelection?.[providerId]??[];
    return !selection.length?rows:rows.filter(row=>selection.includes(
      typeof row==='string'?row:row?.id));
  };
  mount('/host/catalog',async(req,res)=>{
    if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
    if(req.method!=='GET')return json(res,405,{ok:false,error:'Method not allowed'});
     const ids=[...new Set(ownedDirectory.providers()
      .map(row=>row.providerId)
      .filter(id=>typeof id==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(id)
        &&id!=='native-router'&&!id.startsWith('native-router-source-')))].slice(0,160);
    ids.unshift('native-router');
    const result=new Array(ids.length);
    let index=0;
    const normalizeRow=(id,row)=>{
      const model=typeof row==='string'?row:row?.id;
      if(typeof model!=='string'||!model.trim()||model.length>160
        ||/[\u0000-\u001f]/.test(model))return null;
      const name=typeof row?.name==='string'?row.name.slice(0,120):model;
      const free=freeEvidence({id:model,name,isFree:row?.isFree,free:row?.free,
        upstreamFreeLabel:row?.upstreamFreeLabel,pricing:row?.pricing},id);
       const input=row?.pricing?.input,output=row?.pricing?.output;
       const safePrice=v=>Number.isFinite(v)&&v>=0||typeof v==='string'
         &&v.length<=32&&/^[\w\s.$/+-]+$/.test(v);
       const pricing=safePrice(input)&&safePrice(output)?{input,output}:null;
       return {id:model,name,...(free?{freeHint:free}:{}),
         ...(pricing?{pricing}:{})};
    };
    const workers=Array.from({length:Math.min(8,ids.length)},async()=>{
      while(index<ids.length){
        const i=index++,id=ids[i];
        try{
          const source=id==='native-router'
            ?{state:'ready',models:await adapter.listModels()}
             :await ownedDirectory.listModels(id);
          const rows=source?.state==='ready'&&Array.isArray(source.models)?source.models:[];
           const seen=new Set(),availableModels=[];
           for(const row of rows){
             if(availableModels.length>=250)break;
             const model=normalizeRow(id,row);
             if(!model||seen.has(model.id))continue;
             seen.add(model.id);availableModels.push(model);
           }
           const models=allowHostModels(id,availableModels);
           result[i]={id,name:id==='native-router'?'聚合路由':id,
             state:source?.state==='ready'?'ready':'unavailable',
             discoveredCount:availableModels.length,allowedCount:models.length,models};
         }catch{result[i]={id,name:id,state:'unavailable',discoveredCount:0,allowedCount:0,models:[]}}
      }
    });
    await Promise.all(workers);
    return json(res,200,{ok:true,providers:result,checkedAt:Date.now(),
       truncated:ownedDirectory.providers().length>160});
  });
  mount('/host/models',async(req,res)=>{
   if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
   if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
   try{
    const body=await readJson(req),providerId=body?.providerId;
    if(typeof providerId!=='string'||providerId.length<1||providerId.length>100
      ||/[\u0000-\u001f]/.test(providerId))
     return json(res,400,{ok:false,error:'Invalid DSH provider'});
     const result=await ownedDirectory.listModels(providerId);
    const visible=result.state==='ready'&&Array.isArray(result.models)?
      {...result,availableModels:result.models,
        models:allowHostModels(providerId,result.models)}:result;
    return json(res,result.state==='ready'?200:503,{ok:result.state==='ready',result:visible,
       ...(result.state==='ready'?{}:{error:'渠道模型目录不可用；独立来源须先完成鉴权'})});
   }catch{return json(res,400,{ok:false,error:'Invalid host model query'})}
  });
  if(accountCenter){
    mount('/channels/accounts',async(req,res)=>{
      if(!isLoopback(req))return json(res,403,{error:'Loopback only'});
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
       await accountCenter?.refreshReadOnly?.().catch(()=>{});
       await checkinCenter?.refreshSources?.().catch(()=>{});
      const rawEmbedded=embeddedPack?.listAccounts?await embeddedPack.listAccounts().catch(()=>
        ({state:'unavailable',accounts:[]})):{state:'unavailable',accounts:[]};
       const sourceRows=(checkinCenter?.snapshot?.().accounts??[]).filter(a=>a.sourceAccount);
       const sourceMap=new Map(sourceRows.map(a=>[a.id,a]));
       const ownerConfig=configStore.get();
       const ignoredIds=ownerConfig.sessionReuse?.ignoredIds??[];
       const embeddedAccounts={...rawEmbedded,accounts:visiblePrivateSourceAccounts(
         rawEmbedded.accounts,{ignoredIds,configuredAccounts:ownerConfig.accounts??[]}).map(row=>{
         const source=sourceMap.get(sourceAccountOpaqueId(row.providerId,row.id));
         // The source-pack may still retain an enabled login after its Native
         // Router Provider is disabled. Expose effective owner state on BOTH
         // public account cards and the raw embeddedAccounts inventory.
         const enabled=row.enabled===true&&source?.enabled!==false;
         return {...row,enabled,nickname:source?.nickname||row.nickname||'',
           connectionState:!enabled?'disabled':source?.connectionState==='online'?
             'online':'not_checked',
           ...(source?.maskedPhone?{maskedPhone:source.maskedPhone}:{}),
           ...(Number.isFinite(source?.balance)?{balance:source.balance,
             balanceUnit:source.balanceUnit,balanceCheckedAt:source.balanceCheckedAt}:{}),
           balanceState:source?.balanceState??'not_checked'};
       })};
       const roster=accountCenter.list();
       const checkins=new Map((checkinCenter?.snapshot?.().accounts??[])
         .map(row=>[row.id,row]));
       roster.accounts=roster.accounts.map(row=>{
         const current=checkins.get(row.id);
          return current?{...row,checkinState:current.checkinState,
            checkinMessage:current.checkinMessage,autoCheckin:current.autoCheckin,
            autoCheckinEffective:current.autoCheckinEffective===true,
            activitiesSupported:current.activitiesSupported===true,
            ...(current.activityClaims?{activityClaims:current.activityClaims}:{}),
            ...(Number.isFinite(current.expiringPoints)&&current.expiringPoints>0
              &&current.balanceUnit==='积分'?{expiringPoints:current.expiringPoints,
              ...(Number.isFinite(current.expiringAt)?{expiringAt:current.expiringAt}:{})}:{})}:row;
       });
       const {channels,accounts}=mergeAccountSources({roster,embeddedAccounts,sourceRows,
         ignoredIds,embeddedStatus:embeddedPack?.status?.()??{}});
       return json(res,200,{ok:true,...roster,channels,accounts,embeddedAccounts,
         sessionReuse:publicSessionReuse()});
    });    // Explicit login/session reuse is mediated by DSH's authenticated
    // Connection owner Peer. No source token or auth file is returned.
    mount('/channels/reuse/scan',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      if(!sessionReuse?.snapshot?.().enabled)return json(res,409,{
        ok:false,error:'请先在本插件内开启复用本机登录态并保存配置'});
       try{return json(res,200,{ok:true,...await sessionReuse.scan({importReferences:false})})}      catch{return json(res,503,{ok:false,error:'已有登录态扫描暂不可用，不会清除原程序账号'})}
    });
    // Account takeover is an explicit per-account owner action. The public
    // inventory exposes no credential references or tokens.
    mount('/channels/adopt/preview',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='GET')return json(res,405,{ok:false,error:'Method not allowed'});
      const result=await accountAdoption?.preview?.()??{state:'unavailable',accounts:[]};
      return json(res,200,{ok:true,result});
    });
    // Verify only owner-approved locally adopted accounts, in THIS same tab.
    // No original plugin credentials are exported and this cannot auto-adopt.
    mount('/channels/adopt/verify',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      const inventory=await accountAdoption?.preview?.().catch(()=>null);
      const available=new Set(configStore.get().accounts.filter(a=>a.enabled).map(a=>a.id));
      const ids=[...new Set((inventory?.accounts??[]).map(a=>a.ownedAccountId)
        .filter(id=>typeof id==='string'&&available.has(id)))].slice(0,20);
      const results=[];
      for(const id of ids){
        try{
          const row=await accountCenter.verify(id);
          results.push({id,state:row.state,message:String(row.message??'').slice(0,120)});
        }catch{results.push({id,state:'error',message:'本账号暂不能完成验证；原插件登录态不受影响'})}
      }
      return json(res,200,{ok:true,attempted:results.length,results});
    });
    mount('/channels/adopt',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.providerId!=='string'||typeof body?.accountId!=='string'
          ||body?.consent!==true)return json(res,400,{ok:false,error:'Explicit account migration consent required'});
        const result=await accountAdoption?.adopt?.({providerId:body.providerId,
          accountId:body.accountId,consent:true})??{state:'unavailable'};
        const state=typeof result?.state==='string'?result.state:'unavailable';
        const ok=state==='stored_unverified'||state==='already_owned';
        const error=ADOPTION_ERRORS[state]??'接管尚未完成，请检查自有渠道状态；原账号保持不变';
        // A successful owner-approved adoption should be verified by a
        // bounded background metadata probe, not require another click.
        if(ok&&typeof accountCenter?.autoCheckDue==='function')
          setImmediate(()=>void accountCenter.autoCheckDue().catch(()=>{}));
        return json(res,ok?200:state==='busy'?409:state==='credentials_unavailable'?503:409,
          {ok,result:{...result,state},...(ok?{message:state==='already_owned'
            ?'该账号已接管到本插件，未重复写入授权；尚需验证模型可用性'
            :'授权副本已保存到本插件，原账号保持不变；需验证模型及签到'}:{error})});
      }catch{return json(res,400,{ok:false,error:'Invalid migration request'})}
    });
    // Explicit, owner-authenticated upstream channel-pack actions.
    // The source pack remains disabled unless all isolated-host gates pass.
    mount('/channels/embedded/models',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.providerId!=='string'||body.providerId.length>64)
          return json(res,400,{ok:false,error:'Invalid provider ID'});
        const result=await embeddedPack?.listModels?.(body.providerId)
          ??{state:'unavailable',providerId:body.providerId,models:[]};
        return json(res,result.state==='ready'?200:result.state==='invalid'?400:503,{
          ok:result.state==='ready',result,
          ...result.state==='ready'?{}:{error:'上游模型目录暂不可用，未修改任何模型或账号'},
        });
      }catch{return json(res,400,{ok:false,error:'上游模型请求格式不正确'})}
    });
    mount('/channels/embedded/account-state',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.providerId!=='string'||typeof body?.accountId!=='string'
          ||typeof body?.enabled!=='boolean')
          return json(res,400,{ok:false,error:'Invalid account state request'});
        const result=await embeddedPack?.changeAccountEnabled?.({
          providerId:body.providerId,accountId:body.accountId,enabled:body.enabled,
        })??{state:'unavailable',changed:false};
        const accepted=['updated','unchanged'].includes(result.state);
        return json(res,accepted?200:result.state==='invalid'?400:409,{
          ok:accepted,result,
          ...accepted?{}:{error:'未能确认上游账号状态更改，请刷新后检查'},
        });
      }catch{return json(res,400,{ok:false,error:'上游账号请求格式不正确'})}
    });
    mount('/channels/embedded/account-remove',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.providerId!=='string'||typeof body?.accountId!=='string'
          ||body?.acknowledgedSourceCredentialDeletion!==true)
          return json(res,400,{ok:false,error:'Explicit source credential deletion confirmation required'});
        const result=await embeddedPack?.removeSourceAccount?.({
          providerId:body.providerId,accountId:body.accountId,
        })??{state:'unavailable',removed:false};
        return json(res,result.state==='removed'?200:result.state==='invalid'?400:409,{
          ok:result.state==='removed',result,
          ...(result.state==='removed'?{}:{error:result.state==='referenced'
            ?'请先移除本插件对此来源渠道的账号引用，再尝试删除来源账号'
            :'未确认来源账号删除，未声称已清理上游凭据'}),
        });
      }catch{return json(res,400,{ok:false,error:'来源账号删除请求无效'})}
    });
    // Explicit per-account model catalog for the built-in REAL inference
    // tester. Read-only, owner-authenticated and never invokes generation.
    mount('/channels/accounts/models',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.accountId!=='string'||body.accountId.length>80)
          return json(res,400,{ok:false,error:'Invalid account ID'});
        const result=await accountCenter.listTestModels(body.accountId);
        return json(res,200,{ok:true,result});
      }catch(error){return json(res,error?.status??503,{ok:false,
        error:'无法获取本账号可测试的真实模型目录；未发送推理请求'});}
    });
    mount('/channels/accounts/action',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(body?.action==='refresh-all')return json(res,200,{ok:true,...await accountCenter.refreshAll()});
        if(body?.action==='refresh-selected'){
          if(!Array.isArray(body.providerIds)||!body.providerIds.length||body.providerIds.length>64||
             body.providerIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))
            return json(res,400,{ok:false,error:'Invalid selected channels'});
          const ids=[...new Set(body.providerIds)];
          const native=await accountCenter.refreshAll({providerIds:ids,skipVerified:true});
          const sources=checkinCenter?.sourceSnapshot?.()??[];
          let skipped=0,attempted=0;
          for(const providerId of ids){
             const members=sources.filter(row=>row.providerId===providerId&&row.enabled);
             if(!embeddedPack?.status?.()?.channels?.includes(providerId)&&!members.length)continue;
             const refreshed=await checkinCenter?.refreshSources?.({onlyProviderId:providerId,skipVerified:true})??[];
             const knownOnline=new Set(members.filter(row=>row.connectionState==='online').map(row=>row.id));
             const selected=refreshed.filter(row=>row.providerId===providerId&&row.enabled);
             skipped+=selected.filter(row=>knownOnline.has(row.id)).length;
             attempted+=selected.filter(row=>!knownOnline.has(row.id)).length;
           }
           return json(res,200,{ok:true,...native,attempted:native.attempted+attempted,skipped:(native.skipped??0)+skipped});        }
         if(typeof body?.accountId!=='string'||body.accountId.length>80)
           return json(res,400,{ok:false,error:'Invalid account ID'});
        let result;
        switch(body.action){
          case 'login':result=await accountCenter.verify(body.accountId,{login:true});break;
          case 'refresh':result=await accountCenter.verify(body.accountId);break;
          case 'model-test':result=await accountCenter.verifyModel(body.accountId,{modelId:body.modelId});break;
          case 'enable':result=accountCenter.setEnabled(body.accountId,body.enabled);break;
          case 'logout':result=await accountCenter.logout(body.accountId);break;
          default:{const e=new Error('Unknown account action');e.status=400;throw e}
        }
        return json(res,200,{ok:true,result});
      }catch(error){const failure=publicAdministrativeError(error);
        return json(res,failure.status,{ok:false,error:failure.error,...(failure.code?{code:failure.code}:{})})}
    });
    // Owner-initiated MiMo Desktop membership login. No commercial API Key
    // endpoint, browser session material or original-plugin credentials exposed.
    mount('/channels/mimo/login',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(!['start','poll','cancel'].includes(body?.action))
          return json(res,400,{ok:false,error:'Invalid MiMo login action'});
        if(body.action==='start'&&!['cn','sgp','ams','ru','in'].includes(body.region??'cn'))
          return json(res,400,{ok:false,error:'Invalid MiMo account region'});
        const result=body.action==='start'?await accountCenter.startMimoLogin({region:body.region??'cn'}):
          body.action==='poll'?await accountCenter.pollMimoLogin():await accountCenter.cancelMimoLogin();
        const publicStatus={status:result?.status??'error',at:result?.at??0,
          account:result?.account?.id?{id:result.account.id,providerId:'own_mimo_desktop'}:null,
          error:result?.status==='error'?'MiMo Desktop 会员授权未完成':null};
        return json(res,200,{ok:true,result:publicStatus});
      }catch{return json(res,409,{ok:false,error:'MiMo 会员独立授权暂不可用'})}
    });
    mount('/channels/doubao/cookie',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.cookie!=='string'||body.cookie.length>32768)
          return json(res,400,{ok:false,error:'Invalid Doubao cookie'});
        return json(res,200,{ok:true,result:await accountCenter.addDoubaoCookie({cookie:body.cookie})});
      }catch{return json(res,400,{ok:false,error:'豆包 Cookie 未通过校验，未写入公开配置'})}
    });
    mount('/channels/doubao/login',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(!['start','poll','cancel'].includes(body?.action))return json(res,400,{ok:false,error:'Invalid login action'});
        const status=body.action==='start'?await accountCenter.startDoubaoLogin():
          body.action==='poll'?await accountCenter.pollDoubaoLogin():await accountCenter.cancelDoubaoLogin();
        const publicStatus={status:status?.status??'error',at:status?.at??0,
          account:status?.account?.id?{id:status.account.id,providerId:'own_doubao'}:null,
          error:status?.status==='error'?'登录未完成，请重新尝试':null};
        return json(res,200,{ok:true,result:publicStatus});
      }catch{return json(res,409,{ok:false,error:'豆包独立扫码登录暂不可用'})}
    });
    mount('/channels/meoo/cookie',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(typeof body?.cookie!=='string'||body.cookie.length>32768)
          return json(res,400,{ok:false,error:'Invalid Meoo cookie'});
        const result=await accountCenter.addMeooCookie({cookie:body.cookie});
        return json(res,200,{ok:true,result:{id:result.id,providerId:'own_meoo_web',
          alreadyOwned:result.alreadyOwned===true,stored:result.stored===true}});
      }catch{return json(res,400,{ok:false,error:'秒悟会员身份未获远端验证；未保存授权'})}
    });
    mount('/channels/meoo/login',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(!['start','poll','cancel'].includes(body?.action))
          return json(res,400,{ok:false,error:'Invalid Meoo login action'});
        const status=body.action==='start'?await accountCenter.startMeooLogin():
           body.action==='poll'?await accountCenter.pollMeooLogin():await accountCenter.cancelMeooLogin();
        return json(res,200,{ok:true,result:{status:status?.status??'error',
          at:status?.at??0,
          account:status?.account?.id?{id:status.account.id,providerId:'own_meoo_web'}:null,
          error:status?.status==='error'?'秒悟网页登录未完成':null}});
      }catch{return json(res,409,{ok:false,error:'秒悟独立浏览器授权暂不可用'})}
    });
    // Owner-authenticated device grant; never send verifier/token to UI.
    mount('/channels/qwenwork/login',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(!['start','poll','cancel'].includes(body?.action))
          return json(res,400,{ok:false,error:'Invalid device action'});
        const result=body.action==='start'?accountCenter.startQwenLogin():
          body.action==='poll'?await accountCenter.pollQwenLogin():
            await accountCenter.cancelQwenLogin();
        const url=result?.status==='waiting'?result.loginUrl:'';
        if(url&&!/^https:\/\/gateway\.qwenwork\.cn\/device\/selectAccounts\?/.test(url))
          return json(res,503,{ok:false,error:'Invalid upstream authorization origin'});
        return json(res,200,{ok:true,result:{status:result?.status??'error',
          at:result?.at??0,...(url?{loginUrl:url}:{}),
          account:result?.account?.id?{id:result.account.id,providerId:'own_qwenwork'}:null,
          error:result?.status==='error'?'千问办公设备码授权未完成':null}});
      }catch{return json(res,409,{ok:false,error:'千问办公自有授权暂不可用'})}
    });
    // Amazon Quick owner grant: OAuth callback never enters public config or
    // response body. One-time source credential import is a separate opt-in.
    mount('/channels/aws-quick/login',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))
        return json(res,403,{ok:false,error:'Owner browser access required'});
      if(req.method!=='POST')
        return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(!['start','poll','submit','cancel'].includes(body?.action))
          return json(res,400,{ok:false,error:'Invalid Amazon Quick login action'});
        if(body.action==='submit'&&(typeof body.callbackUrl!=='string'||
          body.callbackUrl.length>12000))
          return json(res,400,{ok:false,error:'Invalid OAuth callback'});
        const status=body.action==='start'?await accountCenter.startAwsQuickLogin():
          body.action==='poll'?await accountCenter.pollAwsQuickLogin():
          body.action==='submit'?await accountCenter.submitAwsQuickLogin({
            callbackUrl:body.callbackUrl}):await accountCenter.cancelAwsQuickLogin();
        const url=status?.status==='waiting'?status.loginUrl:'';
        if(url&&!/^https:\/\/(?:quick\.aws\.com\/sn(?:\?|$)|oidc\.[a-z0-9-]+\.amazonaws\.com\/authorize\?)/.test(url))
          return json(res,503,{ok:false,error:'Unexpected Amazon Quick sign-in origin'});
        return json(res,200,{ok:true,result:{
          status:status?.status??'error',at:status?.at??0,
          ...(url?{loginUrl:url}:{}),
          ...(status?.hint?{hint:String(status.hint).slice(0,180)}:{}),
          account:status?.account?.id?{id:status.account.id,
            providerId:'own_aws_quick'}:null,
          error:status?.status==='error'?'Amazon Quick 网页授权未完成':null}});
      }catch{
        return json(res,409,{ok:false,
          error:'Amazon Quick 自有授权尚未通过身份核验，请使用官方账号授权'});
      }
    });
    mount('/channels/aws-quick/import-local',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))
        return json(res,403,{ok:false,error:'Owner browser access required'});
      if(req.method!=='POST')
        return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(body?.consent!==true)
          return json(res,400,{ok:false,error:'Explicit local account consent is required'});
        const result=await accountCenter.importAwsQuickLocal();
        return json(res,200,{ok:true,result:{id:result.id,
          providerId:'own_aws_quick',
          alreadyOwned:result.alreadyOwned===true,stored:result.stored===true}});
      }catch{return json(res,409,{ok:false,
        error:'本机 Amazon Quick 登录凭据未获官方身份确认；未写入账号池'})}
    });
    mount('/channels/import',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{const body=await readJson(req);
         if(typeof body?.providerId!=='string'||typeof body?.candidateId!=='string')
           return json(res,400,{ok:false,error:'Invalid provider or candidate'});
        return json(res,200,{ok:true,result:await accountCenter.importCandidate(body.providerId,body.candidateId)});
       }catch(error){const failure=publicAdministrativeError(error);
        return json(res,failure.status,{ok:false,error:failure.error,...(failure.code?{code:failure.code}:{})})}
    });
    mount('/channels/discover',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{const body=await readJson(req);
         if(typeof body?.providerId!=='string'||body.providerId.length>64)
           return json(res,400,{ok:false,error:'Invalid provider ID'});
        return json(res,200,{ok:true,...await accountCenter.discover(body.providerId)});
       }catch(error){const failure=publicAdministrativeError(error);
        return json(res,failure.status,{ok:false,error:failure.error,...(failure.code?{code:failure.code}:{})})}
    });
  }
  // Connection Owner only: a read-only catalog of VERIFIED free automatic
  // claim workflows. Unknown-paid, purchase, CAPTCHA or unimplemented tasks
  // are never surfaced as executable activities.
  if(activityCenter){
    mount('/activities',async(req,res)=>{
      if(!isLoopback(req))return json(res,403,{error:'Loopback only'});
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      return json(res,200,{ok:true,...activityCenter.snapshot()});
    });
    mount('/activities/refresh',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))
        return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{return json(res,200,{ok:true,...await activityCenter.refresh()})}
      catch{return json(res,503,{ok:false,error:'活动来源读取暂不可用'})}
    });
  }
  if(checkinCenter){
    mount('/activities/action',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))
        return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(body?.action!=='run-channel'||typeof body.providerId!=='string'
          ||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(body.providerId))
          return json(res,400,{ok:false,error:'Invalid activity action'});
        return json(res,200,{ok:true,
          result:await checkinCenter.runActivityChannel(body.providerId)});
      }catch(error){const failure=publicAdministrativeError(error);
        return json(res,failure.status,{ok:false,error:failure.error})}
    });
    mount('/checkins',async(req,res)=>{
      if(!isLoopback(req))return json(res,403,{error:'Loopback only'});
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
       await accountCenter?.refreshReadOnly?.().catch(()=>{});
       await checkinCenter.refreshSources?.();
       return json(res,200,{ok:true,...checkinCenter.snapshot()});
    });
    mount('/checkins/action',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{const body=await readJson(req);
         if(body?.action==='run-channel'&&typeof body.providerId==='string'
           &&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(body.providerId))
           return json(res,200,{ok:true,
             result:await checkinCenter.runChannel(body.providerId)});
         if(body?.action!=='run'||typeof body.accountId!=='string'||body.accountId.length>80)
           return json(res,400,{ok:false,error:'Invalid check-in action'});
        return json(res,200,{ok:true,result:await checkinCenter.run(body.accountId)});
       }catch(error){const failure=publicAdministrativeError(error);
        return json(res,failure.status,{ok:false,error:failure.error,...(failure.code?{code:failure.code}:{})})}
    });
  }
  return ()=>{for(const d of dispose.reverse())try{d()}catch{}};
}
