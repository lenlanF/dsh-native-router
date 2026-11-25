import {resolveCredential} from './accounts.mjs';
export function directModelId(providerId, model){return 'direct:'+providerId+':'+encodeURIComponent(model)}
export function directModelDecode(id){
  const m=/^direct:([a-zA-Z][a-zA-Z0-9_-]{0,63}):(.+)$/.exec(id);
  if(!m)return null;
  try{return {providerId:m[1],model:decodeURIComponent(m[2])}}catch{return null}
}
// Chat picker labels are presentation-only. Never infer x0.00 from a model ID
// or confuse a price per token with a credit multiplier.
const multiplier=/\bx\s*(\d+(?:\.\d+)?)(?=$|[\s·)])/i;
export function conciseChannelName(providerId,name){
  const fallback=providerId.startsWith('own_')?providerId.slice(4):providerId;
  const source=typeof name==='string'&&name.trim()?name:fallback;
  const normalized=source.replace(/\s*·\s*(?:DSH 已注册|自有授权|聚合路由自有|自有渠道)\s*$/gu,'').trim();
  if(['workbuddy-global','own_workbuddy-global'].includes(providerId)
    &&normalized===providerId)return 'WorkBuddy Global';
  if(['workbuddy','own_workbuddy'].includes(providerId)
    &&normalized===providerId)return 'WorkBuddy';
  return normalized||fallback;
}
export function conciseModelName(providerId,channel,model,sourceName){
  const label=typeof sourceName==='string'&&sourceName.trim()?sourceName:model;
  const match=label.match(multiplier);
  // Display only channel / model / actual source multiplier (or an unknown marker).
  const plain=label.replace(multiplier,'').replace(/\bFree now\b/gi,'')
    .replace(/[·\s()]+$/u,'').trim()||model;
  return conciseChannelName(providerId,channel)+' · '+plain+' · '+(match?'x'+match[1]:'x?');
}
import {allowsHostModel} from './host-model-selection.mjs';
export function createCatalog({getConfig,getEffectiveConfig,fetchImpl=fetch,
 resolveKey=resolveCredential,credentialOptions={},ttlMs=60000,
 channelDrivers=new Map(),hostProviderInventory,autoFreePool,
 accountDiscoveryTimeoutMs=2600,providerDiscoveryTimeoutMs=6500,
 maxConcurrentDiscoveries=3}={}){
  const driverFor=id=>channelDrivers instanceof Map?channelDrivers.get(id):channelDrivers?.[id];
  const hostRegistered=id=>id!=='native-router'&&hostProviderInventory?.status?.()
    .hostProviders?.some(row=>row.providerId===id)===true;
  let cached=[],updatedAt=0,sourceAvailability='',revision=0,inFlight=null;
  const sourceState=()=>[...(channelDrivers instanceof Map?channelDrivers.entries():Object.entries(channelDrivers??{}))]
    .filter(([,driver])=>driver?.isSourceBridge===true)
    .map(([id,driver])=>id+':'+(driver.runtimeReady===true?'mounted':'unavailable')).sort().join('|');
  // A slow account must not stall DSH's entire model selector. A small
  // worker pool asks independently authorized accounts in parallel and each
  // read-only request receives an abort signal plus a hard waiting deadline.
  // A source ignoring abort is never given more follow-up work on that worker.
  const perAccountMs=Math.max(10,Math.min(10000,Number(accountDiscoveryTimeoutMs)||2600));
  const perProviderMs=Math.max(10,Math.min(20000,Number(providerDiscoveryTimeoutMs)||6500));
  const discoveryWorkers=Math.max(1,Math.min(6,Number(maxConcurrentDiscoveries)||3));
  async function boundedDiscovery(provider,account,driver,signal,deadline){
    const remaining=deadline-Date.now();
    if(signal?.aborted||remaining<=0)return {rows:[],timedOut:true};
    const controller=new AbortController();
    const cancel=()=>controller.abort();
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    let timer;
    const cancelled=new Promise(resolve=>{
      const done=()=>resolve({rows:[],timedOut:true});
      if(controller.signal.aborted)done();
      else controller.signal.addEventListener('abort',done,{once:true});
    });
    timer=setTimeout(cancel,Math.min(perAccountMs,remaining));
    const request=Promise.resolve().then(async()=>{
      if(controller.signal.aborted)return [];
      if(provider.protocol==='native-channel')
        return typeof driver?.listModels==='function'
          ?await driver.listModels({provider,account,signal:controller.signal})??[]:[];
      const token=await resolveKey(account,credentialOptions);
      if(controller.signal.aborted)return [];
      const headers=provider.protocol==='anthropic-messages'
        ?{'x-api-key':token,'anthropic-version':'2023-06-01'}
        :{authorization:'Bearer '+token};
      const response=await fetchImpl(provider.baseUrl+'/models',{
        headers,signal:controller.signal});
      if(!response.ok)return [];
      const data=await response.json();
      return data?.data??[];
    }).then(rows=>({rows,timedOut:false}),()=>({rows:[],timedOut:false}));
    try{
      const result=await Promise.race([request,cancelled]);
      return controller.signal.aborted?{rows:[],timedOut:true}:result;
    }finally{
      clearTimeout(timer);
      signal?.removeEventListener('abort',cancel);
    }
  }
  async function discoverAccounts(provider,accounts,driver,signal,models,liveNames){
    let next=0;
    const deadline=Date.now()+perProviderMs;
    async function worker(){
      while(next<accounts.length&&models.size<256&&!signal?.aborted
        &&Date.now()<deadline){
        const account=accounts[next++];
        const result=await boundedDiscovery(provider,account,driver,signal,deadline);
        // Stop this worker when its source ignores cancellation. Otherwise
        // repeated hung calls could leak a new pending request per account.
        if(result.timedOut)return;
        if(!Array.isArray(result.rows))continue;
        for(const m of result.rows){
          const modelId=typeof m==='string'?m:m?.id;
          if(typeof modelId==='string'&&modelId.trim()&&modelId.length<150
            &&!/[\u0000-\u001f]/.test(modelId)){
            const clean=modelId.trim();
            models.add(clean);
            if(typeof m?.name==='string'&&m.name.trim()&&m.name.length<=120
              &&!/[\u0000-\u001f]/.test(m.name)&&!liveNames.has(clean))
              liveNames.set(clean,m.name.trim());
          }
          if(models.size>=256)break;
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(discoveryWorkers,accounts.length)},
      ()=>worker()));
  }
  async function scan(signal,startedRevision){
    // One bounded, read-only discovery shared with the dynamic AutoFree pool.
    // Host login and independent channel source accounts are NOT copied.
    if(autoFreePool)await autoFreePool.refresh().catch(()=>null);
     // A source login can expire between catalog requests. Include the
     // actual verified-account set in the cache signature rather than trusting
     // an old "model was listed" cache for its full TTL.
     // The adapter has ALREADY applied account verification to its effective
     // configuration. Do not call effectiveConfig() a second time: it would
     // recreate an unverified source account that the verifier just removed,
     // incorrectly advertising locked/expired models in the DSH picker.
     const cfg=typeof getEffectiveConfig==='function'?getEffectiveConfig():
       autoFreePool?autoFreePool.effectiveConfig(getConfig()):getConfig();
     // Provider enablement, model edits and model-chain changes are user
     // visible immediately, not after the 60-second model cache TTL.
     // Only nonsecret selector metadata is included in this in-RAM key.
     const accountSignature=cfg.accounts.filter(a=>a.enabled)
       .map(a=>[a.providerId,a.id]).sort();
     const providerSignature=cfg.providers.map(p=>[
       p.id,p.enabled,p.protocol,p.name,p.models,p.supportsTools]).sort();
     const routeSignature=cfg.routes.map(r=>[
       r.id,r.name,r.enabled,r.mode,r.tiers.map(t=>[t.providerId,t.model,t.accountIds])]).sort();
     const currentSourceAvailability=sourceState()+'|host:'+
       (hostProviderInventory?.status?.().hostProviders??[]).map(row=>row.providerId).sort().join(',')
       +'|selector:'+JSON.stringify([accountSignature,providerSignature,routeSignature,
         cfg.hostModelSelection??{}]);
     if(updatedAt&&sourceAvailability===currentSourceAvailability&&Date.now()-updatedAt<ttlMs)
       return cached.map(x=>({...x}));
    const all=autoFreePool?.snapshot?.().catalog??[];
    const result=autoFreePool?[{provider:'native-router',id:'autofree',
      name:'聚合路由 · AutoFree · x?',inputModalities:['text']}]:[];    result.push(...cfg.routes.filter(r=>r.enabled&&r.tiers.some(tier=>{
      const p=cfg.providers.find(row=>row.id===tier.providerId);
       const driver=driverFor(p?.id);
       return p?.enabled && (p.protocol==='dsh-host'
         ?hostRegistered(p.id)&&!tier.accountIds?.length
         :(p.protocol!=='native-channel'||
          (typeof driver?.generate==='function'&&!driver.modelAccessRestricted&&(driver?.isSourceBridge!==true||driver.runtimeReady===true)))
          && cfg.accounts.some(a=>a.enabled&&a.providerId===tier.providerId));
    })).map(r=>{
      const single=r.tiers.length===1?r.tiers[0]:null;
      const p=single?cfg.providers.find(x=>x.id===single.providerId):null;
      const found=single?all.find(x=>x.providerId===single.providerId&&x.model===single.model):null;
      return {provider:'native-router',id:'chain:'+r.id,
        name:single&&p?conciseModelName(p.id,p.name,single.model,found?.name):
          '聚合路由 · '+r.name+' · x?',
        inputModalities:['text']};
    }));
    // Across providers as well as across accounts, discovery must not be
    // head-of-line blocked. Limit concurrent channels to two so an installed
    // DSH with many adapters does not fan out unbounded network requests.
    // Keep deterministic Provider ordering when merging the final picker.
    const providers=cfg.providers.filter(p=>p.enabled);
    const providerResults=new Array(providers.length);
    let nextProvider=0;
    async function providerWorker(){
      while(nextProvider<providers.length&&!signal?.aborted){
        const index=nextProvider++,p=providers[index],driver=driverFor(p.id);
        if(p.protocol==='dsh-host'&&!hostRegistered(p.id))continue;
        if(p.protocol==='native-channel'&&(typeof driver?.generate!=='function'||driver.modelAccessRestricted
          ||(driver?.isSourceBridge===true&&driver.runtimeReady!==true)))continue;
        const sourceModels=all.filter(row=>row.providerId===p.id);
        const models=new Set([...p.models,...sourceModels.map(row=>row.model)].filter(model=>
          !['dsh-host','native-channel'].includes(p.protocol)||allowsHostModel(cfg,p.id,model)));
        const liveNames=new Map();
        const accounts=cfg.accounts.filter(a=>a.providerId===p.id&&a.enabled).slice(0,32);
        if(p.protocol==='native-channel'&&accounts.length===0)continue;
        // Manual IDs do not hide real models. Skip a second scan only when
        // the standalone source pack already returned the private catalog.
        const sourceAlreadyScanned=p.protocol==='native-channel'
          &&sourceModels.some(row=>row.kind==='owned-source');
        if(accounts.length&&(models.size===0||
          (p.protocol==='native-channel'&&!sourceAlreadyScanned)))
          await discoverAccounts(p,accounts,driver,signal,models,liveNames);
        const entries=[];
        for(const model of models){
          if(['dsh-host','native-channel'].includes(p.protocol)&&!allowsHostModel(cfg,p.id,model))continue;
          const discovered=sourceModels.find(row=>row.model===model);
          const name=conciseModelName(p.id,p.name,model,
            discovered?.name??liveNames.get(model));
          entries.push({provider:'native-router',id:directModelId(p.id,model),
            name,inputModalities:['text']});
        }
        providerResults[index]=entries;
      }
    }
    await Promise.all(Array.from({length:Math.min(2,providers.length)},
      ()=>providerWorker()));
    for(const rows of providerResults)if(rows?.length)result.push(...rows);
    // An owner logout/disable can invalidate this directory while an async
    // read-only model query is still in flight. Never publish a model that
    // belonged to the older authorization snapshot.
    if(startedRevision!==revision)return [];
    cached=result;
    updatedAt=Date.now();
    sourceAvailability=currentSourceAvailability;
    return result.map(x=>({...x}));
  }
  async function list(signal){
    // A model picker, settings panel and dashboard share one source scan.
    // Its lifetime is NOT owned by the first caller's AbortSignal: closing
    // that panel may cancel its own wait, but must not cancel another DSH
    // consumer or force a duplicate upstream directory request.
    if(signal?.aborted)return [];
    let entry=inFlight;
    if(entry?.revision!==revision){
      entry={revision,promise:scan(undefined,revision)};
      inFlight=entry;
      const completed=()=>{if(inFlight===entry)inFlight=null};
      entry.promise.then(completed,completed);
    }
    if(!signal)return (await entry.promise).map(row=>({...row}));
    let onAbort;
    const cancelled=new Promise(resolve=>{
      onAbort=()=>resolve(null);
      signal.addEventListener('abort',onAbort,{once:true});
      if(signal.aborted)onAbort();
    });
    try{
      const rows=await Promise.race([entry.promise,cancelled]);
      return Array.isArray(rows)?rows.map(row=>({...row})):[];
    }finally{signal.removeEventListener('abort',onAbort)}
  }
  return {list,invalidate(){revision++;updatedAt=0;cached=[];sourceAvailability=''}};
}
