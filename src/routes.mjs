// Owner-authenticated DSH Connection admin APIs; same-origin management writes, loopback-only HTTP.
const BASE='/plugins/dsh-native-router';
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
export function registerRouterRoutes(ctx,{configStore,adapter,accountCenter,checkinCenter,embeddedPack,sessionReuse,hostProviderInventory}){
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
      sessionReuse:sessionReuse?.snapshot?.()??{enabled:false,channels:[]}});
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
      const embeddedAccounts=embeddedPack?.listAccounts?await embeddedPack.listAccounts():{state:'unavailable',accounts:[]};
      return json(res,200,{ok:true,...accountCenter.list(),embeddedAccounts,
        sessionReuse:sessionReuse?.snapshot?.()??{enabled:false,channels:[]}});
    });
    // Explicit login/session reuse is mediated by DSH's authenticated
    // Connection owner Peer. No source token or auth file is returned.
    mount('/channels/reuse/scan',async(req,res)=>{
      if(!isLoopback(req)||!sameOrigin(req))return json(res,403,{ok:false,error:'Access rejected'});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'Method not allowed'});
      if(!sessionReuse?.snapshot?.().enabled)return json(res,409,{
        ok:false,error:'请先在本插件内开启复用本机登录态并保存配置'});
      try{return json(res,200,{ok:true,...await sessionReuse.scan()})}
      catch{return json(res,503,{ok:false,error:'已有登录态扫描暂不可用，不会清除原程序账号'})}
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
