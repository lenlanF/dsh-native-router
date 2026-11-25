import {isRetiredProvider} from './config.mjs';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {sourceModelEligible} from './source-model-eligibility.mjs';
const packIds=new Set(SOURCE_PACK_PROVIDERS);
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
   if(isRetiredProvider(provider.id)||provider.protocol!=='native-channel'||provider.enabled!==true)continue;
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
  if(typeof id!=='string'||isRetiredProvider(id)||id==='native-router'||id.startsWith('native-router-source-')||id.startsWith('own_'))return true;
  return Boolean(config().providers?.some(p=>p.id===id&&p.protocol==='native-channel')||
    embeddedPack?.status?.().ownedProviderIds?.includes(id));
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
  const models=new Map(),observedMembers=new Map();
  const valid=row=>typeof row?.id==='string'&&row.id.trim()&&row.id.length<=160&&!/[\u0000-\u001f]/.test(row.id);
  const merge=rows=>{for(const row of rows??[]){
   if(valid(row)&&!models.has(row.id))models.set(row.id,{...row,name:row.name??row.id});
  }};
  const addMember=(accountId,rows)=>{
   for(const row of rows??[]){
    if(!valid(row))continue;
    const peers=observedMembers.get(row.id)??new Map();
    if(!peers.has(accountId))peers.set(accountId,row);
    observedMembers.set(row.id,peers);
   }
  };
  let ready=false;
  if(entry.kind==='source'){
   const result=await embeddedPack?.listModels?.(entry.sourceId);
   if(result?.state==='ready'&&targets().get(id)?.sourceId===entry.sourceId){merge(entry.sourceId==='zcode'?result.models.map(row=>({...row,isFree:false,free:false,accessRestriction:'OFFICIAL_CLIENT_ONLY'})):result.models);ready=true}
  }else for(const accountId of entry.members.slice(0,32)){
   try{
    const result=await accountCenter.listTestModels(accountId,{officialOnly:true});
    if(result?.state==='ready'&&targets().get(id)?.members.includes(accountId)){
     addMember(accountId,result.models);
     ready=true;
    }
   }catch{}
  }
  if(entry.kind==='native'){
   const current=targets().get(id);
   if(current?.kind!=='native')return {state:'unavailable',providerId:id,models:[]};
   for(const [modelId,observed] of observedMembers){
    const peers=current.members.map(member=>observed.get(member)).filter(Boolean);
    if(!peers.length)continue;
    const first=peers[0],complete=peers.length===current.members.length;
    const shape=x=>JSON.stringify([x.costMultiplier??null,x.priceSource??null,x.pricing??null]);
    const conflict=peers.some(x=>x.pricingConflict===true||shape(x)!==shape(first));
    models.set(modelId,{id:modelId,name:first.name??modelId,
      isFree:complete&&!conflict&&peers.every(x=>x.free===true&&!x.accessRestriction),
      ...(peers.some(x=>x.accessRestriction==='OFFICIAL_CLIENT_ONLY')?{accessRestriction:'OFFICIAL_CLIENT_ONLY'}:{}),
      ...(conflict?{pricingConflict:true}:!complete?{pricingIncomplete:true}:{
       ...(Number.isFinite(first.costMultiplier)?{costMultiplier:first.costMultiplier}:{}),
       ...(first.priceSource?{priceSource:first.priceSource}:{}),
       ...(first.pricing?{pricing:first.pricing}:{})})});
   }
  }
  if(!targets().has(id))return {state:'unavailable',providerId:id,models:[]};
  return {state:ready&&models.size?'ready':'unavailable',providerId:id,models:[...models.values()],loginVerified:true};
 }
 return {providers,listModels};
}
