import {createRoutingEngine} from './router.mjs';
import {createCatalog,directModelDecode,conciseModelName} from './catalog.mjs';
import {createAccountPool} from './accounts.mjs';
import {requestOpenAI} from './provider/openai.mjs';
import {requestAnthropic} from './provider/anthropic.mjs';
import {validateModelCalls} from './provider/openai.mjs';
import {UpstreamError,safeHostFailure} from './failure.mjs';
import {toDshEvents} from './protocol.mjs';
import {RoutingError} from './router.mjs';
import {toSourceMessages,collectSourceDshStream} from './source-channel-driver.mjs';
import {visibleTools} from './host-tools.mjs';
import {createAutoFreePool,freeEvidence} from './auto-free.mjs';
import {allowsHostModel,filterHostRoutes} from './host-model-selection.mjs';

export const PROVIDER='native-router';
export function createNativeRouterAdapter({configStore,fetchImpl=fetch,env=process.env,vault,logger,channelDrivers=new Map(),hostProviderInventory,ownedPack}={}){
  if(!configStore?.get)throw new Error('ConfigStore required');
   let verifiedAccount=()=>true,observeInference=()=>{},ownedAccountCatalog=null;
   const autoFreePool=createAutoFreePool({hostProviderInventory,ownedPack,
     getConfig:()=>configStore.get(),ownedAccountCatalog:(a,options)=>ownedAccountCatalog?.(a,options),
     ownedCatalogEnabled:()=>ownedAccountCatalog!==null,
     ownedAccountEligible:a=>ownedAccountCatalog!==null&&verifiedAccount(a)===true});
   const getConfig=(snapshot,includeHost=true)=>{
     const cfg=autoFreePool.effectiveConfig(configStore.get(),snapshot,includeHost);
     cfg.accounts=cfg.accounts.filter(a=>{
       const p=cfg.providers.find(provider=>provider.id===a.providerId);
       return p?.protocol!=='native-channel'||verifiedAccount(a)===true;
     });
     return filterHostRoutes(cfg);
   };
  let freeCursor=0,ownedFreeCursor=0;
  const pool=createAccountPool();
  const counters={successfulTurns:0,failedAttempts:0,inputTokens:0,outputTokens:0};
  const history=[],ownedProofs=new Map();
  const driverFor=id=>channelDrivers instanceof Map?channelDrivers.get(id):channelDrivers?.[id];
  const transport=async arg=>{
    if(arg.provider.protocol==='dsh-host'){
      // Fail closed even if a caller supplies a stale direct-model ID.
      if(!allowsHostModel(configStore.get(),arg.provider.id,arg.model))
        throw new UpstreamError('Model excluded by owner host allowlist',
          {code:'MODEL_NOT_ALLOWED'});
      if(typeof hostProviderInventory?.streamHost!=='function')
        throw new UpstreamError('Original DSH provider is not connected',{code:'PROVIDER_NOT_READY'});
      if(arg.options.autoFreeSelection===true){
        const before=configStore.get(),policy=JSON.stringify(before.freePool??{});
        const rule=before.freePool?.models?.find(x=>x.providerId===arg.provider.id&&x.model===arg.model);
        const manual=rule?.free===true||(!rule&&before.freePool?.providerIds?.includes(arg.provider.id));
        if(!manual){
          let timer,onAbort;
          try{
            const live=await Promise.race([
              Promise.resolve().then(()=>hostProviderInventory.listHostModels(arg.provider.id)).catch(()=>null),
              new Promise(resolve=>{timer=setTimeout(()=>resolve(null),10000);onAbort=()=>resolve(null);arg.signal?.addEventListener('abort',onAbort,{once:true});if(arg.signal?.aborted)onAbort()})
            ]);
            if(arg.signal?.aborted)throw new UpstreamError('Model request cancelled',{code:'CANCELLED'});
            const peers=live?.state==='ready'&&Array.isArray(live.models)?live.models.filter(m=>m?.id===arg.model):[];
            if(!peers.some(m=>freeEvidence(m,arg.provider.id,peers)))throw new UpstreamError('Current host free entitlement not confirmed',{code:'COST_NOT_CONFIRMED_FREE'});
          }finally{clearTimeout(timer);if(onAbort)arg.signal?.removeEventListener('abort',onAbort)}
        }
        if(arg.signal?.aborted)throw new UpstreamError('Model request cancelled',{code:'CANCELLED'});
        const current=configStore.get();
        if(rule?.free===false||policy!==JSON.stringify(current.freePool??{})||!getConfig().providers.some(p=>p.id===arg.provider.id&&p.enabled&&p.protocol==='dsh-host')||!allowsHostModel(current,arg.provider.id,arg.model))
          throw new UpstreamError('Free host route authorization changed',{code:'COST_NOT_CONFIRMED_FREE'});
      }
      try{
        const native=await hostProviderInventory.streamHost({providerId:arg.provider.id,model:arg.model,
          messages:toSourceMessages(arg.options,arg.provider.id,arg.model),
          tools:visibleTools(arg.options.tools),signal:arg.signal,
          maxTokens:arg.options.maxTokens});
        return await collectSourceDshStream(native,{tools:arg.options.tools,signal:arg.signal});
      }catch(error){
        if(arg.signal?.aborted)throw new UpstreamError('Host request cancelled',{code:'CANCELLED'});
        throw safeHostFailure(error);
      }
    }
    if(arg.provider.protocol==='native-channel'){
       if(!allowsHostModel(configStore.get(),arg.provider.id,arg.model))
         throw new UpstreamError('Model excluded by owner channel allowlist',{code:'MODEL_NOT_ALLOWED'});
       const driver=driverFor(arg.provider.id);
      if(typeof driver?.generate!=='function')throw new UpstreamError('Native provider driver unavailable',{code:'PROVIDER_NOT_READY'});
       // Recheck the selected exact account before automatic free inference.
       const hostProof=arg.options.sessionId==='native-router-smoke-host'||arg.options.officialFreeOnly===true;
       if(hostProof&&(!ownedAccountCatalog||!configStore.get().accounts.some(a=>a.id===arg.account.id&&a.providerId===arg.provider.id&&a.credentialRef===arg.account.credentialRef&&a.enabled)))throw new UpstreamError('Official account catalog unavailable',{code:'COST_NOT_CONFIRMED_FREE'});
       if((hostProof||arg.options.autoFreeSelection===true)&&ownedAccountCatalog&&configStore.get().accounts.some(a=>a.id===arg.account.id&&a.providerId===arg.provider.id)){
        const before=configStore.get(),policy=JSON.stringify(before.freePool??{});
        const rule=before.freePool?.models?.find(x=>x.providerId===arg.provider.id&&x.model===arg.model);
        const manual=!hostProof&&(rule?.free===true||(!rule&&before.freePool?.providerIds?.includes(arg.provider.id)));
        if(!manual){
         const live=await Promise.resolve().then(()=>ownedAccountCatalog(arg.account,{signal:arg.signal})).catch(()=>null);
         const peers=live?.state==='ready'&&Array.isArray(live.models)?live.models.filter(m=>m?.id===arg.model):[];
         if(!peers.some(m=>m.free===true&&freeEvidence(m,arg.provider.id,peers)))
          throw new UpstreamError('Current account free entitlement not confirmed',{code:'COST_NOT_CONFIRMED_FREE'});
        }
        if(arg.signal?.aborted)throw new UpstreamError('Model request cancelled',{code:'CANCELLED'});
        const current=configStore.get();
        if(policy!==JSON.stringify(current.freePool??{})||!current.accounts.some(a=>a.id===arg.account.id&&a.providerId===arg.provider.id&&a.enabled&&a.credentialRef===arg.account.credentialRef)
          ||!current.providers.some(p=>p.id===arg.provider.id&&p.enabled&&p.protocol==='native-channel')||!verifiedAccount(arg.account)
          ||!allowsHostModel(current,arg.provider.id,arg.model))
          throw new UpstreamError('Free route authorization changed',{code:'COST_NOT_CONFIRMED_FREE'});
       }
       const result=await driver.generate({provider:arg.provider,account:arg.account,model:arg.model,
        options:arg.options,signal:arg.signal});
      if(!result||typeof result!=='object'||!['stop','tool_calls','length'].includes(result.finishReason))
        throw new UpstreamError('Native provider returned invalid completed response',{code:'TOOL_PROTOCOL'});
      return validateModelCalls(result,arg.options.tools);
    }
    return (arg.provider.protocol==='anthropic-messages'?requestAnthropic:requestOpenAI)(arg,{fetchImpl,env,vault});
  };
  const engine=createRoutingEngine({getConfig,request:transport,pool,onAttemptOutcome:result=>observeInference(result),onEvent:(evt,sessionId)=>{
    const proof=evt.routeId==='autofree-owned'?ownedProofs.get(sessionId):null;
    if(proof){if(evt.kind==='failure'){proof.failedAttempts++;proof.failedProviders.add(evt.providerId)}else if(evt.kind==='success')proof.completedProvider=evt.providerId;}
    if(evt.kind==='failure'){counters.failedAttempts++;logger?.warn?.('native-router: '+evt.code+' from '+evt.providerId+'/'+evt.model)}
    if(evt.kind==='success'){
      counters.successfulTurns++;
      counters.inputTokens+=Number.isFinite(evt.usage?.prompt_tokens)?evt.usage.prompt_tokens:0;
      counters.outputTokens+=Number.isFinite(evt.usage?.completion_tokens)?evt.usage.completion_tokens:0;
    }
    const {usage,...safe}=evt;
    history.push({at:Date.now(),...safe});if(history.length>50)history.shift();
  }});
  const catalog=createCatalog({getConfig,getEffectiveConfig:getConfig,fetchImpl,
    credentialOptions:{env,vault},channelDrivers,hostProviderInventory,autoFreePool,ownedFreeAvailable:snapshot=>ownedFreeTiers(snapshot).length>0});
  function currentFreeTiers(snapshot,includeHost=true){
   const current=getConfig(snapshot,includeHost);
   return autoFreePool.tiers(snapshot,includeHost).filter(tier=>{
    const p=current.providers.find(x=>x.id===tier.providerId&&x.enabled);
    return Boolean(p&&allowsHostModel(current,tier.providerId,tier.model)&&(p.protocol==='dsh-host'||
      current.accounts.some(a=>a.providerId===tier.providerId&&a.enabled&&(!tier.accountIds?.length||tier.accountIds.includes(a.id)))));
   });
  }
  function ownedFreeTiers(snapshot){
    if(!ownedAccountCatalog||snapshot?.state!=='ready')return [];
    const cfg=configStore.get();
      // Restrict this explicit picker entry to configured native accounts and
      // official evidence. Manual declarations remain available in AutoFree.
      return currentFreeTiers(snapshot,false).flatMap(tier=>{
        const evidence=snapshot.models.find(x=>x.providerId===tier.providerId&&x.model===tier.model);
        const p=cfg.providers.find(x=>x.id===tier.providerId&&x.enabled&&x.protocol==='native-channel');
        if(!p||!evidence?.evidence||evidence.kind!=='owned-source'||evidence.evidence.startsWith('用户手动'))return [];
        const driver=driverFor(p.id);
        if(typeof driver?.generate!=='function'||driver.modelAccessRestricted||driver.isSourceBridge===true&&driver.runtimeReady!==true)return [];
        const members=cfg.accounts.filter(a=>a.providerId===p.id&&a.enabled&&verifiedAccount(a)===true&&(!tier.accountIds?.length||tier.accountIds.includes(a.id)));
        return members.length?[{...tier,accountIds:members.map(a=>a.id),accountBindings:Object.fromEntries(members.map(a=>[a.id,a.credentialRef]))}]:[];
      });
  }
  function ownedDirectProvider(providerId){
    const p=configStore.get().providers.find(x=>x.id===providerId);
    return ownedAccountCatalog&&p?.protocol==='native-channel'?p:null;
  }
  function canResolveOwnedDirect(providerId,model){
    const p=ownedDirectProvider(providerId),driver=driverFor(providerId);
    return Boolean(p?.enabled&&typeof driver?.generate==='function'&&!driver.modelAccessRestricted
      &&(driver.isSourceBridge!==true||driver.runtimeReady===true)
      &&allowsHostModel(configStore.get(),providerId,model));
  }
  async function scopedOwnedDirect(direct,signal){
    const {providerId,model}=direct;
    if(!canResolveOwnedDirect(providerId,model))return [];
    const original=configStore.get().accounts.filter(a=>a.providerId===providerId&&a.enabled&&verifiedAccount(a)===true).slice(0,32);
    const accepted=[];let index=0;
    // An explicitly selected owned model must never trigger a full external
    // catalogue scan. Match the selected model to its exact live account(s).
    async function worker(){
      while(index<original.length&&!signal?.aborted){
        const a=original[index++],controller=new AbortController();
        const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
        if(signal?.aborted)cancel();
        const timeout=setTimeout(cancel,30000);
        let onAbort;
        try{
          const aborted=new Promise(resolve=>{onAbort=()=>resolve(null);controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort()});
          const result=await Promise.race([aborted,Promise.resolve().then(()=>controller.signal.aborted?null:ownedAccountCatalog(a,{signal:controller.signal})).catch(()=>null)]);
          if(!controller.signal.aborted&&result?.state==='ready'&&result.models?.some(m=>m.id===model&&!m.accessRestriction))accepted.push(a);
        }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);if(onAbort)controller.signal.removeEventListener('abort',onAbort)}
      }
    }
    await Promise.all(Array.from({length:Math.min(4,original.length)},()=>worker()));
    if(signal?.aborted)throw new RoutingError('CANCELLED','DSH request cancelled');
    if(!canResolveOwnedDirect(providerId,model))return [];
    const live=configStore.get();
    return accepted.filter(a=>verifiedAccount(a)===true&&live.accounts.some(b=>b.id===a.id&&b.providerId===providerId&&b.enabled&&b.credentialRef===a.credentialRef));
  }
  async function routeForModel(model,signal){
    if(typeof model!=='string')throw new RoutingError('ERR_ROUTE_NOT_FOUND','Invalid DSH model');
    if(model==='autofree-owned'){
      if(!ownedAccountCatalog)throw new RoutingError('ERR_FREE_EXHAUSTED','Owned account catalog unavailable');
      const snapshot=await autoFreePool.scanOwned();
      const cfg=configStore.get();
      const items=ownedFreeTiers(snapshot);
      if(!items.length)throw new RoutingError('ERR_FREE_EXHAUSTED','No currently verified official free owned model');
      const shift=ownedFreeCursor++%items.length,rotated=[...items.slice(shift),...items.slice(0,shift)];
      // Try a different channel before additional models of a failed one.
      const first=[],rest=[],providers=new Set();
      for(const item of rotated){(providers.has(item.providerId)?rest:first).push(item);providers.add(item.providerId)}
      const tiers=[...first,...rest].slice(0,50);
      return {id:model,name:'AutoFree Owned',mode:'free',enabled:true,tiers,freePolicySignature:JSON.stringify(cfg.freePool??{}),maxSwitches:tiers.length-1,exhaustionCooldownMs:21600000};
    }
    if(model==='autofree'){
      await autoFreePool.refresh();
      const items=currentFreeTiers();
      if(!items.length)throw new RoutingError('ERR_FREE_EXHAUSTED',
        'No upstream-confirmed free models are currently available; unknown pricing is excluded');
      const shift=freeCursor++%items.length;
      const ordered=[...items.slice(shift),...items.slice(0,shift)].slice(0,50);
      // Bind this execution to the owner's exact free/paid declarations.
      // A change while an upstream tier is failing must not allow a stale
      // previously-free backup to be invoked as paid by surprise.
      return {id:'autofree',name:'AutoFree',mode:'free',enabled:true,tiers:ordered,
        freePolicySignature:JSON.stringify(configStore.get().freePool??{}),
        maxSwitches:ordered.length-1,exhaustionCooldownMs:21600000};
    }
    if(model.startsWith('chain:'))return model.slice(6);
    const direct=directModelDecode(model);
    if(direct){
      if(ownedDirectProvider(direct.providerId)){
        const confirmed=await scopedOwnedDirect(direct,signal);
        if(!confirmed.length)throw new RoutingError('ERR_ROUTE_NOT_FOUND','Direct model unavailable in exact owned account catalog');
        return {id:model,name:model,mode:'pinned',enabled:true,tiers:[{providerId:direct.providerId,model:direct.model,free:false,accountIds:confirmed.map(a=>a.id),accountBindings:Object.fromEntries(confirmed.map(a=>[a.id,a.credentialRef]))}],maxSwitches:0};
      }
      const published=await catalog.list(signal);
      if(!published.some(row=>row.id===model))throw new RoutingError('ERR_ROUTE_NOT_FOUND','Direct model was not advertised by this provider');
      const config=getConfig(),provider=config.providers.find(p=>p.id===direct.providerId&&p.enabled);
      if(!provider)throw new RoutingError('ERR_ROUTE_NOT_FOUND','Provider not configured');
      return {id:model,name:model,mode:'pinned',enabled:true,tiers:[{providerId:direct.providerId,model:direct.model,free:false,accountIds:[]}],maxSwitches:0};
    }
    throw new RoutingError('ERR_ROUTE_NOT_FOUND','Unknown model: '+model);
  }
  async function* stream(options={}){
    if(options.signal?.aborted){
      yield {type:'finish',reason:{kind:'aborted',failure:{message:'Request cancelled'}}};return;
    }
    const id=await routeForModel(options.model,options.signal);
    const output=await engine.execute(id,{signal:options.signal,sessionId:options.sessionId??options.agentId??'',needTools:Array.isArray(options.tools)&&options.tools.length>0,...options});
    yield* toDshEvents(output);
  }
  return {
    providerInfo(){return {id:PROVIDER,name:'聚合路由'}},
    providerRetryPolicy(){return undefined},
    imageRequestPricing(){return undefined},
    imageRequestTarget(){return undefined},
    async listModels(){return catalog.list()},
    canResolveOwnedDirect,
    beginOwnedFreeProof(sessionId){
      if(typeof sessionId!=='string'||!/^native-router-proof-owned-[a-f0-9]{32}$/.test(sessionId)||ownedProofs.size>=1)throw Error('Owned proof already running or invalid');
      const record={failedAttempts:0,failedProviders:new Set(),completedProvider:null};ownedProofs.set(sessionId,record);
      return ()=>{if(ownedProofs.get(sessionId)===record)ownedProofs.delete(sessionId);return {failedAttempts:record.failedAttempts,failedProviderCount:record.failedProviders.size,
        completedProvider:record.completedProvider,crossChannelSwitch:!!record.completedProvider&&[...record.failedProviders].some(p=>p!==record.completedProvider)}};
    },
    async resolveModel(provider,model){
      if(model==='autofree-owned')return {provider:provider??PROVIDER,id:model,name:'聚合路由 · 自有免费自动切换',inputModalities:['text']};
      const direct=directModelDecode(model),owned=direct&&ownedDirectProvider(direct.providerId);
      if(owned){
        const row=autoFreePool.snapshot().catalog.find(x=>x.providerId===owned.id&&x.model===direct.model);
        return {provider:provider??PROVIDER,id:model,name:conciseModelName(owned.id,owned.name,direct.model,row?.name,row),inputModalities:['text']};
      }
      const rows=await catalog.list();const found=rows.find(x=>x.id===model);
      return {provider:provider??PROVIDER,id:model,name:found?.name??model,inputModalities:['text']}},
    async prepareCall(provider,model){return {model:await this.resolveModel(provider,model),stream}},
    stream,
     invalidateCatalog(){catalog.invalidate();autoFreePool.invalidate()},
     setInferenceObserver:fn=>{observeInference=typeof fn==='function'?fn:()=>{}},
     setOwnedAccountCatalogResolver:fn=>{ownedAccountCatalog=typeof fn==='function'?fn:null;autoFreePool.invalidate();catalog.invalidate()},
     setAccountVerificationResolver:fn=>{
       verifiedAccount=typeof fn==='function'?fn:()=>false;
       catalog.invalidate();
     },
    autoFreeSnapshot(){return autoFreePool.snapshot()},
    async refreshAutoFree(){await autoFreePool.refresh({force:true});catalog.invalidate();
      return autoFreePool.snapshot()},
    async auditAutoFree({ownedOnly=false}={}){
     const snapshot=ownedOnly?await autoFreePool.scanOwned():await autoFreePool.refresh({force:true}),tiers=currentFreeTiers(snapshot,!ownedOnly),cfg=getConfig(snapshot,!ownedOnly);
     const providers=new Map(),accounts=new Map();
     for(const tier of tiers){
      if(!providers.has(tier.providerId)){providers.set(tier.providerId,{providerId:tier.providerId,routeCount:0,accountCount:0});accounts.set(tier.providerId,new Set())}
      providers.get(tier.providerId).routeCount++;
      for(const a of cfg.accounts)if(a.enabled&&a.providerId===tier.providerId&&(!tier.accountIds?.length||tier.accountIds.includes(a.id)))accounts.get(tier.providerId).add(a.id);
     }
     for(const row of providers.values())row.accountCount=accounts.get(row.providerId).size;
     const manualCount=tiers.filter(t=>snapshot.models.some(m=>m.providerId===t.providerId&&m.model===t.model&&m.evidence?.startsWith('用户手动'))).length;
      return {state:snapshot.state,catalogCount:snapshot.catalog.length,routeCount:tiers.length,manualCount,errors:snapshot.errors,providers:[...providers.values()],...(snapshot.issues?.length?{issues:snapshot.issues}: {})};
    },
    getStatus(){const cfg=configStore.get();return {routes:cfg.routes.length,
      providers:getConfig().providers.length,accounts:getConfig().accounts.length,
      autoFree:{count:autoFreePool.snapshot().models.length,scannedAt:autoFreePool.snapshot().scannedAt},
      accountCooldowns:pool.status().exhausted,metrics:{...counters},recentRoutes:history.slice(-20)}},
  };
}
