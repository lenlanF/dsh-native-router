import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {sourceModelEligible} from './source-model-eligibility.mjs';
const packIds=new Set(SOURCE_PACK_PROVIDERS);
const canonical=id=>String(id??'').replace(/^own_/,'');
const online=row=>row?.enabled===true&&row.connectionState==='online';
// Management directory: only expose account-bound private routes after
// official authentication. External host providers remain independent.
export function createOwnedModelDirectory({configStore,accountCenter,checkinCenter,embeddedPack,hostProviderInventory}={}){
 const config=()=>configStore.get();
 const rows=()=>accountCenter?.list?.().accounts??[];
 const sourceRows=()=>checkinCenter?.sourceSnapshot?.()??[];
 function targets(){
  const cfg=config(),local=rows(),sources=sourceRows(),out=new Map();
  for(const provider of cfg.providers??[]){
   if(provider.protocol!=='native-channel'||provider.enabled!==true)continue;
   const members=local.filter(a=>a.providerId===provider.id&&online(a)&&a.runtimeMode==='owned'
      &&cfg.accounts?.some(b=>b.id===a.id&&b.providerId===a.providerId&&b.enabled===true));
   if(members.length)out.set(provider.id,{providerId:provider.id,name:provider.name,
      members:members.map(a=>a.id),kind:'native'});
  }
  const ignored=new Set(cfg.sessionReuse?.ignoredIds??[]);
  for(const row of sources){
   if(!online(row)||row.sourceAccount!==true||!packIds.has(row.providerId))continue;
   if(ignored.has(row.id)&&!cfg.accounts?.some(a=>a.id===row.id))continue;
   if(!sourceModelEligible(row.providerId,{accounts:local,sourceRows:[row],ignoredIds:[...ignored]}))continue;
   const bound=cfg.accounts?.find(a=>a.id===row.id);
   const id=bound?.providerId??'own_'+row.providerId;
   const provider=cfg.providers?.find(p=>p.id===id);
   if(bound&&(!bound.enabled||provider?.enabled!==true||provider.protocol!=='native-channel'))continue;
   if(provider&&(!provider.enabled||provider.protocol!=='native-channel'))continue;
   if(!out.has(id))out.set(id,{providerId:id,name:provider?.name??row.providerName??row.providerId,
     members:[],kind:'source',sourceId:row.providerId});
  }
  return out;
 }
 function knownOwned(id){
  return config().providers?.some(p=>p.id===id&&p.protocol==='native-channel')||
    (id.startsWith('own_')&&packIds.has(canonical(id)))||id.startsWith('native-router-source-');
 }
 function providers(){
  const eligible=targets();
  const external=(hostProviderInventory?.status?.().hostProviders??[]).filter(p=>!knownOwned(p.providerId));
  return [...external,...[...eligible.values()].map(p=>({providerId:p.providerId,name:p.name,
    family:'native-router-owned',accountAccess:'owned-verified',loginVerified:true}))];
 }
 async function listModels(id){
  const entry=targets().get(id);
  if(!entry)return knownOwned(id)?{state:'unavailable',providerId:id,models:[]}
    :await hostProviderInventory?.listHostModels?.(id)??{state:'unavailable',providerId:id,models:[]};
  const models=new Map();
  const merge=rows=>{for(const row of rows??[]){
   if(typeof row?.id!=='string'||!row.id.trim()||row.id.length>160||/[\u0000-\u001f]/.test(row.id))continue;
   if(!models.has(row.id))models.set(row.id,{...row,name:row.name??row.id});
  }};
  let ready=false;
  if(entry.kind==='source'){
   const result=await embeddedPack?.listModels?.(entry.sourceId);
   if(result?.state==='ready'&&targets().get(id)?.sourceId===entry.sourceId){merge(result.models);ready=true}
  }else for(const accountId of entry.members.slice(0,32)){
   try{
     const result=await accountCenter.listTestModels(accountId,{officialOnly:true});
    if(result?.state==='ready'&&targets().get(id)?.members.includes(accountId)){
     merge(result.models.map(row=>({id:row.id,name:row.name,...(row.free===true?{isFree:true}:{}),...(row.pricing?{pricing:row.pricing}:{})})));
     ready=true;
    }
   }catch{}
  }
  if(!targets().has(id))return {state:'unavailable',providerId:id,models:[]};
  return {state:ready&&models.size?'ready':'unavailable',providerId:id,models:[...models.values()],loginVerified:true};
 }
 return {providers,listModels};
}
