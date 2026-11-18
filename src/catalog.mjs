import {resolveCredential} from './accounts.mjs';
export function directModelId(providerId, model){return 'direct:'+providerId+':'+encodeURIComponent(model)}
export function directModelDecode(id){
  const m=/^direct:([a-zA-Z][a-zA-Z0-9_-]{0,63}):(.+)$/.exec(id);
  if(!m)return null;
  try{return {providerId:m[1],model:decodeURIComponent(m[2])}}catch{return null}
}
export function createCatalog({getConfig,fetchImpl=fetch,resolveKey=resolveCredential,credentialOptions={},ttlMs=60000,channelDrivers=new Map(),hostProviderInventory,autoFreePool}){
  const driverFor=id=>channelDrivers instanceof Map?channelDrivers.get(id):channelDrivers?.[id];
  const hostRegistered=id=>id!=='native-router'&&hostProviderInventory?.status?.()
    .hostProviders?.some(row=>row.providerId===id)===true;
  let cached=[],updatedAt=0,sourceAvailability='';
  const sourceState=()=>[...(channelDrivers instanceof Map?channelDrivers.entries():Object.entries(channelDrivers??{}))]
    .filter(([,driver])=>driver?.isSourceBridge===true)
    .map(([id,driver])=>id+':'+(driver.runtimeReady===true?'mounted':'unavailable')).sort().join('|');
  async function list(signal){
    // One bounded, read-only discovery shared with the dynamic AutoFree pool.
    // Host login and independent channel source accounts are NOT copied.
    if(autoFreePool)await autoFreePool.refresh().catch(()=>null);
    const currentSourceAvailability=sourceState()+'|host:'+
      (hostProviderInventory?.status?.().hostProviders??[]).map(row=>row.providerId).sort().join(',');
    if(updatedAt&&sourceAvailability===currentSourceAvailability&&Date.now()-updatedAt<ttlMs)
      return cached.map(x=>({...x}));
    const cfg=autoFreePool?autoFreePool.effectiveConfig(getConfig()):getConfig();
    const all=autoFreePool?.snapshot?.().catalog??[];
    const result=autoFreePool?[{provider:'native-router',id:'autofree',
      name:'AutoFree · 自动免费模型池',inputModalities:['text']}]:[];
    result.push(...cfg.routes.filter(r=>r.enabled&&r.tiers.some(tier=>{
      const p=cfg.providers.find(row=>row.id===tier.providerId);
       const driver=driverFor(p?.id);
       return p?.enabled && (p.protocol==='dsh-host'
         ?hostRegistered(p.id)&&!tier.accountIds?.length
         :(p.protocol!=='native-channel'||
          (typeof driver?.generate==='function'&&(driver?.isSourceBridge!==true||driver.runtimeReady===true)))
          && cfg.accounts.some(a=>a.enabled&&a.providerId===tier.providerId));
    })).map(r=>({
      provider:'native-router',id:'chain:'+r.id,name:r.name,inputModalities:['text'],
    })));
    for(const p of cfg.providers.filter(p=>p.enabled)){
      const driver=driverFor(p.id);
      if(p.protocol==='dsh-host'&&!hostRegistered(p.id))continue;
       if(p.protocol==='native-channel'&&(typeof driver?.generate!=='function'||
         (driver?.isSourceBridge===true&&driver.runtimeReady!==true)))continue;
      const models=new Set([...p.models,...all.filter(row=>row.providerId===p.id).map(row=>row.model)]);
      const accounts=cfg.accounts.filter(a=>a.providerId===p.id&&a.enabled).slice(0,32);
      if(accounts.length && models.size===0){
        // Do not let the first expired account hide working models behind a
        // second account. Discover independently and union the visible IDs.
        for(const account of accounts){
          if(signal?.aborted)break;
          try{
            let found=[];
            if(p.protocol==='native-channel'){
              if(typeof driver?.listModels==='function')
                found=await driver.listModels({provider:p,account,signal})??[];
            }else{
              const token=await resolveKey(account,credentialOptions);
              const headers=p.protocol==='anthropic-messages' ?
                {'x-api-key':token,'anthropic-version':'2023-06-01'}:{authorization:'Bearer '+token};
              const res=await fetchImpl(p.baseUrl+'/models',{headers,signal});
              if(res.ok){const data=await res.json();found=data?.data??[]}
            }
            if(Array.isArray(found))for(const m of found){
              const modelId=typeof m==='string'?m:m?.id;
              if(typeof modelId==='string'&&modelId.trim()&&modelId.length<150)
                models.add(modelId.trim());
              if(models.size>=256)break;
            }
          }catch{ /* One unhealthy account must not hide healthy peers. */ }
          if(models.size>=256)break;
        }
      }
      for(const model of models)result.push({provider:'native-router',id:directModelId(p.id,model),
        name:p.name+' / '+model,inputModalities:['text']});
    }
    cached=result;
     updatedAt=Date.now();
     sourceAvailability=currentSourceAvailability;
    return result.map(x=>({...x}));
  }
  return {list,invalidate(){updatedAt=0}};
}
