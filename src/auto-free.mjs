// Dynamic AutoFree is a *model* pool, never a credential/account pool.
// Only upstream zero prices, source free metadata, WorkBuddy's explicit x0.00
// credit multiplier, or an OWNER'S opt-in marking may enable a model.
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
const ID=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MODEL=/^[^\u0000-\u001f]{1,160}$/;
const OWN=new Set(SOURCE_PACK_PROVIDERS);
const isId=value=>typeof value==='string'&&ID.test(value);
const isModel=value=>typeof value==='string'&&MODEL.test(value)&&value.trim()!=='';
const zero=value=>typeof value==='number'&&Number.isFinite(value)&&value===0||
  typeof value==='string'&&value.trim()!==''&&Number(value)===0;
function zeroPair(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return false;
 const input=row.input??row.prompt??row.inputCost;
 const output=row.output??row.completion??row.outputCost;
 return zero(input)&&zero(output);
}
const positive=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>0;
export function contradictsFree(row,providerId=''){
 return row?.isFree===false||row?.free===false||row?.pricingConflict===true||row?.pricingIncomplete===true
  ||positive(row?.costMultiplier)||[row?.pricing,row?.price,row?.cost].some(p=>p&&typeof p==='object'&&
  ['input','output','prompt','completion','inputCost','outputCost'].some(k=>positive(p[k])))
  ||(/^(?:own_)?workbuddy(?:-|$)/.test(providerId)&&/(?:^|[\s·(])x\s*(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)(?:$|[\s·)])/i.test(row?.name??''));
}
export function freeEvidence(model,providerId='',peers=[model]){
 if(!model||typeof model!=='object'||peers.some(row=>contradictsFree(row,providerId)))return null;
 if(providerId==='codearts'&&model.priceSource==='codearts-official-credit-ratio'&&model.costMultiplier===0)return 'CodeArts 官方零积分倍率';
 if(providerId==='own_zcode'||model.accessRestriction==='OFFICIAL_CLIENT_ONLY'||model.freeAllowance==='zcode-start-plan-gift')return null;
   if(providerId==='own_loomy'&&model.freeAllowance==='loomy-daily-gift'
      &&model.id==='spark-x2.6')
     return 'Loomy 官方每日赠送积分专用 Spark X2.6（永久积分不可用）';
   if(model.isFree===true||model.upstreamFreeLabel===true||model.free===true)
   return '来源明确标记免费';
 if(zeroPair(model.pricing??model.price??model.cost))
  return '来源输入与输出价格均为零';
 // WorkBuddy catalog exposes a literal x0.00 credit multiplier in the
 // *display name*, e.g. "Hy4 Flash · x0.00". Treat only WorkBuddy's exact
 // zero multiplier as its free credit usage, not arbitrary "free" in names.
 if(['workbuddy','workbuddy-global','own_workbuddy',
   'own_workbuddy-cn','own_workbuddy-global'].includes(providerId)
   &&typeof model.name==='string'
   &&/(?:^|[\s·(])x\s*0(?:\.0+)?(?:$|[\s·)])/i.test(model.name))
  return 'WorkBuddy 目录标记 x0.00 积分倍率';
 return null;
}
const empty=()=>({state:'not_scanned',models:[],catalog:[],sourceAccounts:[],
 scannedAt:null,hostCount:0,sourceCount:0,unknownPricing:0,errors:0,issues:[]});
import {allowsHostModel} from './host-model-selection.mjs';
export function createAutoFreePool({hostProviderInventory,ownedPack,getConfig,
 now=()=>Date.now(),ttlMs=90000,timeoutMs=2600,ownedAccountCatalog,ownedAccountEligible,ownedCatalogEnabled=()=>typeof ownedAccountCatalog==='function'}={}){
 let cache=empty(),signatureSaved='',pending=null,ownedPending=null,revision=0;
 const hostIds=()=>{
  try{return (hostProviderInventory?.status?.().hostProviders??[])
    .map(x=>x.providerId).filter(id=>isId(id)&&id!=='native-router'
       &&!id.startsWith('native-router-source-')&&!id.startsWith('own_')
       &&(!ownedCatalogEnabled()||!(getConfig?.()?.providers??[]).some(p=>p.id===id&&p.protocol==='native-channel'))).slice(0,80)}
  catch{return []}
 };
 const packStatus=()=>ownedPack?.status?.()??{state:'disabled'};
 const owner=()=>getConfig?.()?.freePool??{providerIds:[],models:[]};
 const signature=(ownedOnly=false)=>{
  const cfg=getConfig?.()??{};
  // Do not reuse the previous source roster after the owner logs out,
  const accounts=(cfg.accounts??[]).map(a=>[a.id,a.providerId,a.enabled,a.credentialRef,ownedAccountEligible?.(a)===true]).sort();
  const ignored=(cfg.sessionReuse?.ignoredIds??[]).slice().sort();
  const origins=Object.entries(cfg.sessionReuse?.linkedOrigins??{}).sort();
  return JSON.stringify([ownedOnly?[]:hostIds(),packStatus().state,owner(),
    (cfg.providers??[]).map(p=>[p.id,p.enabled,p.protocol]).sort(),
    accounts,ignored,origins,cfg.hostModelSelection??{}]);
 };
 const bounded=async (job,budget=timeoutMs)=>{
  let timer;
  try{return await Promise.race([Promise.resolve().then(job),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(null),budget);timer.unref?.()})])}
  finally{if(timer)clearTimeout(timer)}
 };
 function snapshot(){return structuredClone(cache)}
 function markedEvidence(row,providerId,peers){
  if(providerId==='own_zcode'||row.accessRestriction==='OFFICIAL_CLIENT_ONLY'||row.freeAllowance==='zcode-start-plan-gift')return null;
  const cfg=owner(),override=(cfg.models??[]).find(x=>x.providerId===providerId&&x.model===row.id);
  if(override)return override.free?'用户手动标记免费（费用由用户确认）':null;
  if((cfg.providerIds??[]).includes(providerId))
   return '用户手动标记渠道全部模型免费（费用由用户确认）';
  return freeEvidence(row,providerId,peers);
 }
 async function run({ownedOnly=false}={}){
  const hosts=ownedOnly?[]:hostIds(),models=[],catalog=[],sourceAccounts=[],seen=new Set();
  let unknownPricing=0,errors=0,hostCount=0,sourceCount=0;  const issues=new Map();
  const recordIssue=(providerId,code)=>{
   errors++;
   const key=providerId+':'+code;
   const row=issues.get(key)??{providerId,code,count:0};
   row.count++;issues.set(key,row);
  };

  function add(providerId,row,kind,peers,accountIds){
   const model=typeof row==='string'?row:row?.id;
   if(!isId(providerId)||!isModel(model)||!allowsHostModel(getConfig?.(),providerId,model))return;
   const key=providerId+'\u0000'+model;
   if(seen.has(key)||catalog.length>=600)return;
   seen.add(key);
   const normalized=typeof row==='string'?{id:row,name:row}:row;
   const evidence=kind==='owned-source'&&providerId==='zcode'?null:markedEvidence(normalized,providerId,peers??[normalized]);
   const entry={providerId,model,name:typeof normalized.name==='string'?normalized.name.slice(0,120):model,kind,...(accountIds?.length?{accountIds:[...accountIds]}:{})};
   catalog.push({...entry,free:evidence!==null,...(evidence?{evidence}:{})});
   if(!evidence){unknownPricing++;return}
   models.push({...entry,evidence});
  }
  const jobs=hosts.map(providerId=>async()=>{
    const result=await bounded(()=>hostProviderInventory.listHostModels(providerId)).catch(()=>null);
    if(result?.state!=='ready'||!Array.isArray(result.models)){recordIssue(providerId,'HOST_CATALOG_UNAVAILABLE');return}
   hostCount++;
    for(const model of result.models)add(providerId,model,'host',result.models.filter(x=>(typeof x==='string'?x:x?.id)===(typeof model==='string'?model:model?.id)));
  });
  const pack=packStatus();
  // A standalone CodeArts QR login may retain its original public provider ID
  // even though the credentials are owned by this plugin. Never synthesize an
  // own_codearts shadow of that exact account: DSH account IDs are globally
  // unique and a phantom provider would be unroutable.
  const configured=getConfig?.()??{};
  // Configured independent providers must use exact account catalogs, not
  // the generic source pack (which omits membership/gift/rate evidence).
  const configuredNative=new Set(ownedCatalogEnabled()?
    (configured.providers??[]).filter(p=>p.protocol==='native-channel').map(p=>p.id):[]);
  for(const providerId of configuredNative){
   if(!configured.providers.some(p=>p.id===providerId&&p.enabled))continue;
   const members=(configured.accounts??[]).filter(a=>a.providerId===providerId&&a.enabled&&ownedAccountEligible?.(a)===true).slice(0,32);
   if(!members.length)continue;
   const observed=[];
   jobs.push(async()=>{
    for(const a of members){
     const result=await bounded(()=>ownedAccountCatalog(a),30000).catch(()=>null);
     if(result?.state==='ready'&&Array.isArray(result.models))observed.push({id:a.id,models:result.models});
      else recordIssue(providerId,'ACCOUNT_CATALOG_UNAVAILABLE');
    }
    if(!observed.length)return;
    sourceCount++;
    const byModel=new Map();
    for(const member of observed)for(const model of member.models){
     if(!isModel(model?.id))continue;
     const list=byModel.get(model.id)??[];
     list.push({accountId:member.id,model});byModel.set(model.id,list);
    }
    for(const list of byModel.values()){
     const first=list[0].model,ids=[...new Set(list.map(x=>x.accountId))];
     const all=ids.length===members.length&&list.every(x=>x.model.free===true&&!contradictsFree(x.model,providerId));
     const row={...first,free:all,isFree:all,pricingIncomplete:ids.length!==members.length};
     add(providerId,row,'owned-source',[row],ids);
    }
    for(const member of observed)if(!sourceAccounts.some(x=>x.accountId===member.id))
     sourceAccounts.push({providerId,accountId:member.id});
   });
  }
  const ignoredIds=new Set(configured.sessionReuse?.ignoredIds??[]);
  const configuredIds=new Set((configured.accounts??[]).map(a=>a.id));
  const targetProvider=(sourceId,accountId)=>{
   const account=configured.accounts?.find(a=>a.id===accountId);
   const provider=configured.providers?.find(p=>p.id===sourceId);
   const ownBound=account?.providerId===sourceId
     &&account?.credentialRef==='driver:'+sourceId+':'+accountId
     &&configured.sessionReuse?.linkedOrigins?.[accountId]==='own-source-pack'
     &&account.enabled===true&&provider?.enabled===true
     &&provider.protocol==='native-channel';
   return ownBound?sourceId:'own_'+sourceId;
  };
  if(pack.state==='mounted'){
    const accounts=await bounded(()=>ownedPack.listAccounts()).catch(()=>null);
   if(accounts?.state==='ready'&&Array.isArray(accounts.accounts)){
    const byProvider=new Map();
    for(const row of accounts.accounts){
     if(row?.enabled!==true||!OWN.has(row.providerId)||!isId(row.id))continue;
     const safeRef=sourceAccountOpaqueId(row.providerId,row.id);
     if(ignoredIds.has(safeRef)&&!configuredIds.has(safeRef))continue;
     const fullId=targetProvider(row.providerId,safeRef);
     sourceAccounts.push({providerId:fullId,accountId:safeRef});
     const list=byProvider.get(row.providerId)??[];
     list.push(row);byProvider.set(row.providerId,list);
    }
     for(const [providerId,rows] of byProvider){
      const eligibleProviderIds=new Set(rows.map(row=>targetProvider(providerId,sourceAccountOpaqueId(providerId,row.id))));
      // Configured independent channels already have exact-account reads above.
      // Do not call or count a second generic source catalog for them.
      const unconfigured=[...eligibleProviderIds].filter(id=>!configuredNative.has(id));
      if(!unconfigured.length)continue;
      if(rows.length>1&&!pack.experimentalMultiAccountProviders?.includes(providerId)){
       for(const target of unconfigured)recordIssue(target,'SOURCE_ACCOUNT_SCOPE_UNVERIFIED');
       continue;
      }
      jobs.push(async()=>{
       const result=await bounded(()=>ownedPack.listModels(providerId)).catch(()=>null);
       if(result?.state!=='ready'||!Array.isArray(result.models)){
        for(const target of unconfigured)recordIssue(target,'SOURCE_CATALOG_UNAVAILABLE');return;
       }
       sourceCount++;
       for(const model of result.models)for(const target of unconfigured)
        add(target,model,'owned-source',result.models.filter(x=>(typeof x==='string'?x:x?.id)===(typeof model==='string'?model:model?.id)));
      });
     }
    }else recordIssue('source-pack','SOURCE_ROSTER_UNAVAILABLE');
  }
  let index=0;
  await Promise.all(Array.from({length:Math.min(6,jobs.length)},async()=>{
   while(index<jobs.length){
    const job=jobs[index++];
     try{await job()}catch{recordIssue('catalog-scan','SCAN_UNAVAILABLE')}
   }
  }));
  const sort=(a,b)=>a.providerId.localeCompare(b.providerId)||a.model.localeCompare(b.model);
  // An owner may explicitly supply an exact model ID that is absent from
  // the upstream catalog. Never synthesize a model for an unregistered Host
  // or a source channel without an enabled independent login.
  for(const mark of owner().models??[]){
   if(mark.free!==true||!isId(mark.providerId)||!isModel(mark.model))continue;
    const native=configuredNative.has(mark.providerId);
    const ids=native?sourceAccounts.filter(a=>a.providerId===mark.providerId&&configured.accounts?.some(x=>x.id===a.accountId&&x.enabled&&ownedAccountEligible?.(x)===true)).map(a=>a.accountId):undefined;
    const isHost=!native&&hosts.includes(mark.providerId);
    const isOwn=native?ids.length>0:sourceAccounts.some(a=>a.providerId===mark.providerId);
    if((isHost&&allowsHostModel(getConfig?.(),mark.providerId,mark.model))||isOwn)
     add(mark.providerId,{id:mark.model,name:mark.model},isHost?'host':'owned-source',undefined,ids);
  }
  models.sort(sort);catalog.sort(sort);
   return {state:'ready',models,catalog,sourceAccounts,scannedAt:now(),hostCount,sourceCount,
     unknownPricing,errors,issues:[...issues.values()].sort((a,b)=>a.providerId.localeCompare(b.providerId)||a.code.localeCompare(b.code))};
 }
 function refresh({force=false}={}){
  if(pending)return pending;
  if(!force&&cache.state==='ready'&&now()-cache.scannedAt<ttlMs&&signatureSaved===signature())
   return Promise.resolve(snapshot());
  pending=(async()=>{
   // The user may log out, disable an account or change free/paid markings
   // while a source is answering an async models/roster request. Never
   // publish that older roster under the newer config's cache signature.
   // Retry once against the latest owner state; ongoing churn fails closed.
   for(let attempt=0;attempt<2;attempt++){
    const startedSignature=signature(),startedRevision=revision;
    const result=await run();
     if(startedRevision===revision&&startedSignature===signature()){
      cache=result;signatureSaved=startedSignature;return snapshot();
     }
     cache=empty();signatureSaved='';
   }
   cache=empty();signatureSaved='';
   return snapshot();
  })().finally(()=>{pending=null});
  return pending;
 }
 // Read-only isolated audit: it never queries any external Provider and
 // never replaces the full AutoFree routing cache with a partial snapshot.
 function scanOwned(){
   if(ownedPending)return ownedPending;
   ownedPending=(async()=>{
    for(let attempt=0;attempt<2;attempt++){
     const before=signature(true),startedRevision=revision;
     const result=await run({ownedOnly:true});
     if(before===signature(true)&&startedRevision===revision)return structuredClone(result);
    }
    return empty();
   })().finally(()=>{ownedPending=null});
   return ownedPending;
 }
 function effectiveConfig(raw,sourceSnapshot=cache,includeHost=true){
  const cfg=structuredClone(raw??getConfig?.()??{});
  cfg.providers??=[];cfg.accounts??=[];
  const ids=new Set(cfg.providers.map(p=>p.id));
  for(const providerId of includeHost?hostIds():[]){
   if(ids.has(providerId))continue;
   cfg.providers.push({id:providerId,name:providerId+' · DSH 已注册',
    protocol:'dsh-host',baseUrl:'',enabled:true,models:[],
    supportsTools:true,timeoutMs:120000});ids.add(providerId);
  }
  const sourceProviders=new Set(sourceSnapshot.catalog.filter(x=>x.kind==='owned-source').map(x=>x.providerId));
  for(const providerId of sourceProviders){
   if(ids.has(providerId))continue;
   cfg.providers.push({id:providerId,name:providerId.slice(4)+' · 自有授权',
    protocol:'native-channel',baseUrl:'',enabled:true,models:[],
    supportsTools:true,timeoutMs:120000});ids.add(providerId);
  }
  const accountIds=new Set(cfg.accounts.map(a=>a.id));
  for(const row of sourceSnapshot.sourceAccounts){
   if(!sourceProviders.has(row.providerId)||!ids.has(row.providerId)||accountIds.has(row.accountId)
    ||cfg.sessionReuse?.ignoredIds?.includes(row.accountId)
    ||cfg.providers.find(p=>p.id===row.providerId)?.protocol!=='native-channel')continue;
   cfg.accounts.push({id:row.accountId,providerId:row.providerId,
    credentialRef:'driver:'+row.providerId+':'+row.accountId,
    enabled:true,weight:1,autoCheckin:false});accountIds.add(row.accountId);
  }
  return cfg;
 }
 function tiers(sourceSnapshot=cache,includeHost=true){
  const cfg=effectiveConfig(undefined,sourceSnapshot,includeHost);
  return sourceSnapshot.models.filter(row=>{
   const p=cfg.providers.find(p=>p.id===row.providerId&&p.enabled);
   if(!p||p.protocol!==(row.kind==='host'?'dsh-host':'native-channel'))return false;
    return row.kind==='host'||cfg.accounts.some(a=>a.enabled&&a.providerId===row.providerId&&(!row.accountIds?.length||row.accountIds.includes(a.id)));
   }).map(row=>{
    const ids=cfg.accounts.filter(a=>a.enabled&&a.providerId===row.providerId&&(!row.accountIds?.length||row.accountIds.includes(a.id))).map(a=>a.id);
    return {providerId:row.providerId,model:row.model,free:true,
      accountIds:row.accountIds?.length?ids:row.kind==='owned-source'&&ids.length===1?ids:[]};
   });
 }
 return {refresh,scanOwned,snapshot,effectiveConfig,tiers,invalidate(){
  revision++;cache=empty();signatureSaved='';
 }};
}
