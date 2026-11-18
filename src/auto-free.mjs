// Automatic FREE-MODEL pool. This is NOT an account pool and never copies credentials.
// Entries require an explicit upstream free signal or authoritative zero pricing.
// Missing pricing, name-based guesses, and an installed-but-unauthenticated login
// are NOT evidence of free billing or working inference.
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';

const ID=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MODEL=/^[^\u0000-\u001f]{1,160}$/;
const OWN=new Set(SOURCE_PACK_PROVIDERS);
function zero(value){
 return typeof value==='number'&&Number.isFinite(value)&&value===0||
   typeof value==='string'&&value.trim()!==''&&Number(value)===0;
}
export function freeEvidence(model){
 if(!model||typeof model!=='object'||model.isFree===false||model.free===false)return null;
 if(model.isFree===true||model.upstreamFreeLabel===true||model.free===true)
   return '来源明确标记免费';
 const cost=model.pricing??model.price??model.cost;
 if(cost&&typeof cost==='object'&&!Array.isArray(cost)){
  const input=cost.input??cost.prompt??cost.inputCost;
  const output=cost.output??cost.completion??cost.outputCost;
  if(zero(input)&&zero(output))return '来源输入与输出价格均为零';
 }
 return null;
}
const validId=x=>typeof x==='string'&&ID.test(x);
const validModel=x=>typeof x==='string'&&MODEL.test(x)&&!!x.trim();
const empty=()=>({state:'not_scanned',models:[],catalog:[],scannedAt:null,hostCount:0,sourceCount:0,unknownPricing:0,errors:0});
export function createAutoFreePool({hostProviderInventory,ownedPack,
 getConfig,now=()=>Date.now(),ttlMs=90000,timeoutMs=2600}={}){
 let cache=empty(),lastSignature='',pending=null;
 const hostIds=()=>{
  try{return (hostProviderInventory?.status?.().hostProviders??[])
   .map(x=>x.providerId).filter(id=>validId(id)&&id!=='native-router'
    &&!id.startsWith('native-router-source-')&&!id.startsWith('own_')).slice(0,32)}
  catch{return []}
 };
 const packStatus=()=>ownedPack?.status?.()??{state:'disabled'};
 const signature=()=>hostIds().join('|')+'|'+packStatus().state+
   '|'+(getConfig?.()?.providers??[]).map(p=>p.id+':'+p.enabled).join('|');
 const bounded=async task=>{
  let timer;
  try{return await Promise.race([Promise.resolve().then(task),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);timer.unref?.()})])}
  finally{if(timer)clearTimeout(timer)}
 };
 async function run(){
  const hosts=hostIds(),models=[],catalog=[],seen=new Set();
  let unknownPricing=0,errors=0,hostCount=0,sourceCount=0;
  function add(providerId,row,kind,accountId){
   const model=typeof row==='string'?row:row?.id;
   if(!validId(providerId)||!validModel(model))return;
   const key=providerId+'\u0000'+model;
   if(seen.has(key)||catalog.length>=400)return;
   seen.add(key);
   const evidence=freeEvidence(row);
   const entry={providerId,model,name:typeof row?.name==='string'?row.name.slice(0,120):model,
    kind,...(accountId?{accountId}:{})};
   catalog.push({...entry,free:evidence!==null,...(evidence?{evidence}:{})});
   if(!evidence){unknownPricing++;return}
   models.push({...entry,evidence});
  }
  const jobs=hosts.map(providerId=>async()=>{
   const result=await bounded(()=>hostProviderInventory.listHostModels(providerId));
   if(result?.state!=='ready'||!Array.isArray(result.models)){errors++;return}
   hostCount++;
   for(const model of result.models)add(providerId,model,'host');
  });
  const pack=packStatus();
  if(pack.state==='mounted'){
   const accounts=await bounded(()=>ownedPack.listAccounts());
   if(accounts?.state==='ready'&&Array.isArray(accounts.accounts)){
    const byProvider=new Map();
    for(const row of accounts.accounts){
     if(row?.enabled!==true||!OWN.has(row.providerId)||typeof row.id!=='string')continue;
     const list=byProvider.get(row.providerId)??[];
     list.push(row);byProvider.set(row.providerId,list);
    }
    for(const [providerId,rows] of byProvider){
     // Multi-account routing is refused unless the reviewed exact-selection
     // guard was actually activated in the original source pack.
     if(rows.length!==1&&!pack.experimentalMultiAccountProviders?.includes(providerId))continue;
     jobs.push(async()=>{
      const result=await bounded(()=>ownedPack.listModels(providerId));
      if(result?.state!=='ready'||!Array.isArray(result.models)){errors++;return}
      sourceCount++;
      const accountId=rows.length===1?sourceAccountOpaqueId(providerId,rows[0].id):null;
      for(const model of result.models)add('own_'+providerId,model,'owned-source',accountId);
     });
    }
   }else errors++;
  }
  // Limit parallel upstream directory calls; never create a login/refresh.
  let index=0;
  const workers=Array.from({length:Math.min(6,jobs.length)},async()=>{
   while(index<jobs.length){
    const job=jobs[index++];
    try{await job()}catch{errors++}
   }
  });
  await Promise.all(workers);
  models.sort((a,b)=>a.providerId.localeCompare(b.providerId)||a.model.localeCompare(b.model));
  catalog.sort((a,b)=>a.providerId.localeCompare(b.providerId)||a.model.localeCompare(b.model));
  cache={state:'ready',models,catalog,scannedAt:now(),hostCount,sourceCount,
   unknownPricing,errors};
  lastSignature=signature();
  return snapshot();
 }
 function snapshot(){return {...cache,models:cache.models.map(x=>({...x})),
   catalog:cache.catalog.map(x=>({...x}))}}
 function refresh({force=false}={}){
  if(pending)return pending;
  if(!force&&cache.state==='ready'&&now()-cache.scannedAt<ttlMs&&lastSignature===signature())
   return Promise.resolve(snapshot());
  pending=run().finally(()=>{pending=null});
  return pending;
 }
 function effectiveConfig(raw){
  const cfg=structuredClone(raw??getConfig?.()??{});
  const ids=new Set(cfg.providers.map(p=>p.id));
  for(const providerId of hostIds()){
   if(ids.has(providerId))continue;
   cfg.providers.push({id:providerId,name:providerId+' · DSH 已注册',
    protocol:'dsh-host',baseUrl:'',enabled:true,models:[],
    supportsTools:true,timeoutMs:120000});
   ids.add(providerId);
  }
  // Source providers become directly usable when an independent login
  // produced an enabled source-account entry and a verified free model was
  // found. No account reference is written back to router config.
  const accountIds=new Set(cfg.accounts.map(a=>a.id));
  for(const row of cache.catalog.filter(x=>x.kind==='owned-source')){
   if(!ids.has(row.providerId)){
    cfg.providers.push({id:row.providerId,name:row.providerId.slice(4)+' · 自有授权',
     protocol:'native-channel',baseUrl:'',enabled:true,models:[],
     supportsTools:true,timeoutMs:120000});
    ids.add(row.providerId);
   }
   if(row.accountId&&!accountIds.has(row.accountId)&&cfg.providers.find(p=>p.id===row.providerId)?.protocol==='native-channel'){
    cfg.accounts.push({id:row.accountId,providerId:row.providerId,
     credentialRef:'driver:'+row.providerId+':'+row.accountId,enabled:true,weight:1,autoCheckin:false});
    accountIds.add(row.accountId);
   }
  }
  return cfg;
 }
 function tiers(){
  const cfg=effectiveConfig();
  return cache.models.filter(row=>cfg.providers.some(p=>p.id===row.providerId&&p.enabled
    &&p.protocol===(row.kind==='host'?'dsh-host':'native-channel'))).map(row=>({
     providerId:row.providerId,model:row.model,free:true,
     accountIds:row.accountId?[row.accountId]:[],
  }));
 }
 return {refresh,snapshot,effectiveConfig,tiers,invalidate(){cache=empty();lastSignature=''}};
}
