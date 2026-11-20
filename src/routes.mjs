import {freeEvidence} from './auto-free.mjs';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {mergeAccountSources} from './account-source-view.mjs';
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
export function registerRouterRoutes(ctx,{configStore,adapter,accountCenter,checkinCenter,embeddedPack,sessionReuse,accountAdoption,hostProviderInventory,credentialsBridge}){
  const server=ctx.get?.('webServer')??ctx.webServer;
  if(!server?.register)return()=>{};
  const dispose=[];
  const mount=(path,handler)=>{
    const d=server.register({kind:'exact',path:BASE+path,handler});
    if(typeof d==='function')dispose.push(d);
  };
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
      return json(res,400,{ok:false,error:String(error?.message??error).slice(0,260)});
    }
  });
  mount('/status',(req,res)=>{
    if(!isLoopback(req))return json(res,403,{error:'Loopback only'});
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    return json(res,200,{ok:true,...adapter.getStatus(),embeddedPack:embeddedPack?.status?.()??{state:'unavailable'},
      credentialService:credentialsBridge?.status?.()??{state:'unknown',available:false},
      sessionReuse:sessionReuse?.snapshot?.()??{enabled:false,channels:[]}});
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
  mount('/host/catalog',async(req,res)=>{
    if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
    if(req.method!=='GET')return json(res,405,{ok:false,error:'Method not allowed'});
    const ids=[...new Set((hostProviderInventory?.status?.().hostProviders??[])
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
            :await hostProviderInventory?.listHostModels?.(id);
          const rows=source?.state==='ready'&&Array.isArray(source.models)?source.models:[];
          const seen=new Set(),models=[];
          for(const row of rows){
            if(models.length>=250)break;
            const model=normalizeRow(id,row);
            if(!model||seen.has(model.id))continue;
            seen.add(model.id);models.push(model);
          }
          result[i]={id,name:id==='native-router'?'聚合路由':id,
            state:source?.state==='ready'?'ready':'unavailable',models};
        }catch{result[i]={id,name:id,state:'unavailable',models:[]}}
      }
    });
    await Promise.all(workers);
    return json(res,200,{ok:true,providers:result,checkedAt:Date.now(),
      truncated:(hostProviderInventory?.status?.().hostProviders??[]).length>160});
  });
  mount('/host/models',async(req,res)=>{
   if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
   if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
   try{
    const body=await readJson(req),providerId=body?.providerId;
    if(typeof providerId!=='string'||providerId.length<1||providerId.length>100
      ||/[\u0000-\u001f]/.test(providerId))
     return json(res,400,{ok:false,error:'Invalid DSH provider'});
    const result=await hostProviderInventory?.listHostModels?.(providerId)
      ??{state:'unavailable',providerId,models:[]};
    return json(res,result.state==='ready'?200:503,{ok:result.state==='ready',result,
      ...(result.state==='ready'?{}:{error:'宿主路由模型目录不可用；未读取或修改原插件凭据'})});
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
       const embeddedAccounts={...rawEmbedded,accounts:(rawEmbedded.accounts??[]).map(row=>{
         const source=sourceMap.get(sourceAccountOpaqueId(row.providerId,row.id));
         return {...row,nickname:source?.nickname||row.nickname||'',
           connectionState:!row.enabled?'disabled':source?.connectionState==='online'?
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
           autoCheckinEffective:current.autoCheckinEffective===true}:row;
       });
       const {channels,accounts}=mergeAccountSources({roster,embeddedAccounts,sourceRows,
         embeddedStatus:embeddedPack?.status?.()??{}});
       return json(res,200,{ok:true,...roster,channels,accounts,embeddedAccounts,
         sessionReuse:sessionReuse?.snapshot?.()??{enabled:false,channels:[]}});
    });    // Explicit login/session reuse is mediated by DSH's authenticated
    // Connection owner Peer. No source token or auth file is returned.
    mount('/channels/reuse/scan',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      if(!sessionReuse?.snapshot?.().enabled)return json(res,409,{
        ok:false,error:'请先在本插件内开启复用本机登录态并保存配置'});
      try{return json(res,200,{ok:true,...await sessionReuse.scan()})}
      catch{return json(res,503,{ok:false,error:'已有登录态扫描暂不可用，不会清除原程序账号'})}
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
    mount('/channels/accounts/action',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{
        const body=await readJson(req);
        if(body?.action==='refresh-all')return json(res,200,{ok:true,...await accountCenter.refreshAll()});
        if(typeof body?.accountId!=='string'||body.accountId.length>80)throw Error('Valid accountId required');
        let result;
        switch(body.action){
          case 'login':result=await accountCenter.verify(body.accountId,{login:true});break;
          case 'refresh':result=await accountCenter.verify(body.accountId);break;
          case 'enable':result=accountCenter.setEnabled(body.accountId,body.enabled);break;
          case 'logout':result=await accountCenter.logout(body.accountId);break;
          default:{const e=new Error('Unknown account action');e.status=400;throw e}
        }
        return json(res,200,{ok:true,result});
      }catch(error){return json(res,error.status??400,{ok:false,error:String(error?.message??error).slice(0,200)})}
    });
    mount('/channels/import',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{const body=await readJson(req);
        if(typeof body?.providerId!=='string'||typeof body?.candidateId!=='string')throw Error('providerId and candidateId are required');
        return json(res,200,{ok:true,result:await accountCenter.importCandidate(body.providerId,body.candidateId)});
      }catch(error){return json(res,error.status??400,{ok:false,error:String(error?.message??error).slice(0,200)})}
    });
    mount('/channels/discover',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      try{const body=await readJson(req);
        if(typeof body?.providerId!=='string'||body.providerId.length>64)throw Error('Valid providerId required');
        return json(res,200,{ok:true,...await accountCenter.discover(body.providerId)});
      }catch(error){return json(res,error.status??400,{ok:false,error:String(error?.message??error).slice(0,200)})}
    });
  }
  if(checkinCenter){
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
        if(body?.action!=='run'||typeof body.accountId!=='string'||body.accountId.length>80)throw Error('Unknown check-in action');
        return json(res,200,{ok:true,result:await checkinCenter.run(body.accountId)});
      }catch(error){return json(res,error.status??400,{ok:false,error:String(error?.message??error).slice(0,200)})}
    });
  }
  return ()=>{for(const d of dispose.reverse())try{d()}catch{}};
}
