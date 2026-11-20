// Owner-approved WorkBuddy v5 MIT vault migration into the independent DSH
// Credentials service. No runtime import/dependency on dsh-connect-workbuddy.
// The original CN/global account vaults are never mutated.
import {createHash} from 'node:crypto';
import {ownCredentialRef} from './credential-ref.mjs';
import {publicAccountName,credentialPublicIdentity} from './account-facts.mjs';

const REGION=Object.freeze({
 'workbuddy-cn':{owner:'own_workbuddy-cn',original:'workbuddy',model:'auto'},
 'workbuddy-global':{owner:'own_workbuddy-global',original:'workbuddy-global',model:'default-model'},
});
const idFor=(providerId,sourceId)=>'wbp_'+createHash('sha256')
 .update('native-router-workbuddy-own\0'+providerId+'\0'+sourceId)
 .digest('hex').slice(0,24);
export const workbuddyOwnedId=idFor;
export const workbuddyVaultKey=ownedId=>'NATIVE_ROUTER_WB_'+ownedId.slice(4).toUpperCase();
const running=new Set();
export function createWorkbuddyVaultAdoption({inventory,configStore,vault,
 makeCredentialRef,adapter,drivers}={}){
 const resolveRef=async name=>(makeCredentialRef??ownCredentialRef)(name);
 async function adopt({providerId,accountId,consent}={}){
  if(consent!==true)return {state:'consent_required'};
  const provider=REGION[providerId];
  if(!provider||!/^local_[a-f0-9]{20}$/.test(String(accountId)))
   return {state:'unsupported'};
  if(typeof configStore?.get!=='function'||typeof configStore?.replace!=='function'
     ||typeof vault?.resolve!=='function'||typeof vault?.set!=='function'
     ||typeof vault?.unset!=='function')return {state:'credentials_unavailable'};
  const id=idFor(providerId,accountId);
  const key=providerId+':'+accountId;
  if(running.has(key))return {state:'busy'};
  running.add(key);
  let stage='credential_ref';
  try{
   const ref=await resolveRef(workbuddyVaultKey(id));
   const cfg=configStore.get();
   const existing=cfg.accounts.find(a=>a.id===id);
   if(existing){
    if(existing.providerId!==provider.owner
       ||existing.credentialRef!=='driver:'+provider.owner+':'+id)
      return {state:'conflict'};
    const saved=await vault.resolve(ref);
    if(typeof saved?.value!=='string'||!saved.value)return {state:'credentials_missing'};
    return {state:'already_owned',accountId:id,ownedProviderId:provider.owner,originalUnchanged:true};
   }
   if(cfg.providers.some(x=>x.id===provider.owner&&x.protocol!=='native-channel'))
    return {state:'provider_conflict'};
   stage='read_source';
   const source=await inventory?.readCredential?.(providerId,accountId);
   if(!source||source.providerId!==providerId||source.accountId!==accountId
       ||typeof source.secret!=='string'||source.secret.length>100000)
    return {state:'source_missing_or_changed'};
   let payload;
   try{payload=JSON.parse(source.secret)}catch{return {state:'invalid_source_credential'}}
   const expectedDomain=providerId==='workbuddy-cn'?'www.workbuddy.cn':'www.workbuddy.ai';
   if(!payload||payload.domain!==expectedDomain
     ||typeof payload.accessToken!=='string'||payload.accessToken.length<8
     ||typeof payload.refreshToken!=='string')return {state:'invalid_source_credential'};
   if(await vault.resolve(ref))return {state:'conflict'};
   stage='save_private_credential';
   await vault.set(ref,source.secret);
   // Resolve the actual account's catalog with its copied independent secret.
   // Model IDs in the original plugin's other region are not interchangeable.
   let onlineModels=[];
   const driver=drivers?.get?.(provider.owner);
   if(typeof driver?.listModels==='function'){
     const abort=new AbortController();
     const timeout=setTimeout(()=>abort.abort(),16000);
     try{
       const rows=await driver.listModels({account:{id,providerId:provider.owner,
         credentialRef:'driver:'+provider.owner+':'+id},signal:abort.signal});
       if(Array.isArray(rows))onlineModels=[...new Set(rows.map(row=>row?.id)
         .filter(x=>typeof x==='string'&&x.trim()&&x.length<=160))].slice(0,80);
     }catch{}finally{clearTimeout(timeout)}
   }

   let committed=false;
   try{
    const fresh=configStore.get();
    if(fresh.accounts.some(x=>x.id===id))throw Error('Account identity collision');
    const current=fresh.providers.find(x=>x.id===provider.owner);
    if(current&&current.protocol!=='native-channel')throw Error('Provider identity collision');
    const legacy=fresh.providers.find(x=>x.id===provider.original);
    const known=[...new Set([...(current?.models??[]),...(legacy?.models??[])]
      .filter(x=>typeof x==='string'&&x.length>0&&x.length<160))];
    const models=onlineModels.length?onlineModels:known.length?known:[provider.model];
    // Only a catalog-confirmed model is marked as chosen; offline fallback
    // stays unverified and must never display as a successful cloud test.
    // Catalog-confirmed models become directly available; no synthetic chains.
    const providers=current?fresh.providers.map(x=>x.id===provider.owner
      ?{...x,models,enabled:true}:x)
      :[...fresh.providers,{id:provider.owner,
         name:(providerId==='workbuddy-cn'?'WorkBuddy 国内':'WorkBuddy 国际')+' · 自有授权',
         protocol:'native-channel',enabled:true,models,supportsTools:true}];
     const migratedName=publicAccountName(source,credentialPublicIdentity(payload));
     const accounts=[...fresh.accounts,{id,providerId:provider.owner,
       credentialRef:'driver:'+provider.owner+':'+id,
       enabled:true,weight:1,autoCheckin:true,
       ...(migratedName?{displayName:migratedName}:{})}];    const routes=fresh.routes;
    stage='persist_owned_account';
    configStore.replace({...fresh,providers,accounts,routes,
      sessionReuse:{...fresh.sessionReuse,
       linkedIds:[...new Set([...(fresh.sessionReuse.linkedIds??[]),id])].slice(-200),
       linkedOrigins:{...fresh.sessionReuse.linkedOrigins,[id]:'own-source-pack'}}});
    committed=true;
   }finally{if(!committed)await vault.unset(ref).catch(()=>{})}
   adapter?.invalidateCatalog?.();
   return {state:'stored_unverified',accountId:id,ownedProviderId:provider.owner,
    originalUnchanged:true,modelCatalogVerified:onlineModels.length>0,
    activation:onlineModels.length?'requires_live_inference_validation':'requires_live_model_validation'};
  }catch(error){return {state:error?.code==='CREDENTIALS_UNAVAILABLE'?'credentials_unavailable':'unavailable',
    stage,originalUnchanged:true}}
  finally{running.delete(key)}
 }
 return {adopt};
}
