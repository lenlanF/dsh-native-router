// MIT native channel-pack reuse for plugin-private Loomy and ZCode sessions.
// This is an owner-approved, one-way migration into the already bundled DSH
// channel-pack's persisted account pool and DSH Credentials namespace.
// Chat, login, refresh and check-in are executed by pack-native.js, NOT copied.
import {createHash} from 'node:crypto';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {ownCredentialRef} from './credential-ref.mjs';

const SOURCE=Object.freeze({
 loomy:Object.freeze({provider:'loomy',owned:'own_loomy',
  models:['spark-x2.6','DeepSeek-V4.1-Flash','GLM-5.3-Flash','qwen3.8-flash','mimo-v2.5','auto'],checkin:true}),
 'zcode-start-plan':Object.freeze({provider:'zcode',owned:'own_zcode',
  models:['GLM-5.3-Flash','GLM-5.3'],checkin:true}),
});
const inflight=new Set();
const accountKey=(provider,id)=>'nr_'+createHash('sha256')
 .update('native-router-own-pack-private\0'+provider+'\0'+id).digest('hex').slice(0,32);
export function privatePackSourceMap(provider){return SOURCE[provider]??null}
export function privatePackOwnedId(providerId,sourceAccountId){
 const source=SOURCE[providerId];
 return source&&/^local_[a-f0-9]{20}$/.test(String(sourceAccountId))
  ?sourceAccountOpaqueId(source.provider,accountKey(providerId,sourceAccountId)):null;
}
export function createPrivatePackAdoption({inventory,configStore,ownedPack,adapter,
 makeCredentialRef}={}){
 const getRef=async()=>{
  if(makeCredentialRef)return makeCredentialRef;
  return ownCredentialRef;
 };
 async function adopt({providerId,accountId,consent}={}){
  if(consent!==true)return {state:'consent_required'};
  const source=SOURCE[providerId];
  if(!source||typeof accountId!=='string'||!/^local_[a-f0-9]{20}$/.test(accountId))
   return {state:'unsupported'};
  if(!configStore?.get||!configStore?.replace
    ||configStore.get().embeddedPack?.enabled!==true)
   return {state:'native_login_disabled'};
  if(ownedPack?.status?.().state!=='mounted')
   return {state:'native_login_not_ready'};
  const context=ownedPack.ownedAdoptionContext?.();
  const pool=context?.pool,credentials=context?.credentials;
  if(!pool||!['file','settings'].includes(pool.store?.kind)
   ||typeof pool.listAllAccounts!=='function'||typeof pool.addAccount!=='function'
   ||typeof credentials?.resolve!=='function'
   ||typeof credentials?.set!=='function'||typeof credentials?.unset!=='function')
   return {state:'persistent_credentials_unavailable'};
  const poolId=accountKey(providerId,accountId),opaque=sourceAccountOpaqueId(source.provider,poolId);
  const credentialName='NATIVE_ROUTER_PRIVATE_PACK_'+poolId.slice(3).toUpperCase();
  const key=providerId+':'+accountId;
  if(inflight.has(key))return {state:'busy'};
  inflight.add(key);
  try{
   const ref=(await getRef())(credentialName);
   const previous=await pool.listAllAccounts();
   if(!Array.isArray(previous))return {state:'unavailable'};
   const duplicate=previous.find(row=>row.id===poolId);
   if(duplicate){
    if(duplicate.provider!==source.provider||duplicate.credentialRef!==credentialName)
     return {state:'conflict'};
    const resolved=await credentials.resolve(ref);
    if(typeof resolved?.value!=='string'||!resolved.value)return {state:'credentials_missing'};
   }else{
    const original=await inventory?.readCredential?.(providerId,accountId);
    if(original?.providerId!==providerId||original.accountId!==accountId
     ||typeof original.secret!=='string'||!original.secret)
     return {state:'source_missing_or_changed'};
    let parsed;
    try{parsed=JSON.parse(original.secret)}catch{return {state:'invalid_source_credential'}}
    if(source.provider==='loomy'){
      if(typeof parsed?.access_token!=='string'||!parsed.access_token)
       return {state:'invalid_source_credential'};
    }else if(typeof parsed?.zcode_jwt!=='string'||!parsed.zcode_jwt
     ||typeof parsed?.device_mid!=='string'||!parsed.device_mid)
     return {state:'invalid_source_credential'};
    if(await credentials.resolve(ref))return {state:'conflict'};
    await credentials.set(ref,original.secret);
    let created=false;
    try{
     const current=await pool.listAllAccounts();
     if(!Array.isArray(current)||current.some(row=>row.id===poolId))
      throw Error('Private source account collision');
     await pool.addAccount({id:poolId,provider:source.provider,
      credentialRef:credentialName,nickname:source.provider+' · 独立账号',
      enabled:true,createdAt:Date.now(),refreshable:false});
     created=true;
    }finally{if(!created)await credentials.unset(ref).catch(()=>{})}
   }
   const cfg=configStore.get();
   const previousAccount=cfg.accounts.find(x=>x.id===opaque);
   if(previousAccount&&(previousAccount.providerId!==source.owned
       ||previousAccount.credentialRef!=='driver:'+source.owned+':'+opaque))
    return {state:'conflict'};
   const prevProvider=cfg.providers.find(x=>x.id===source.owned);
   if(prevProvider&&prevProvider.protocol!=='native-channel')return {state:'conflict'};
   const models=[...new Set([...(prevProvider?.models??[]),...source.models])];
   const providers=prevProvider?cfg.providers.map(x=>x.id===source.owned
      ?{...x,models,enabled:true}:x):
     [...cfg.providers,{id:source.owned,name:source.provider+' · 聚合路由自有',
      protocol:'native-channel',enabled:true,models,supportsTools:true}];
   const accounts=previousAccount?cfg.accounts:[...cfg.accounts,{
      id:opaque,providerId:source.owned,credentialRef:'driver:'+source.owned+':'+opaque,
      enabled:true,weight:1,autoCheckin:source.checkin}];
   // No automatic chain synthesis or mutation on account import.
   const routes=cfg.routes;
   configStore.replace({...cfg,providers,accounts,routes,
    sessionReuse:{...cfg.sessionReuse,
     linkedIds:[...new Set([...(cfg.sessionReuse.linkedIds??[]),opaque])].slice(-200),
     linkedOrigins:{...cfg.sessionReuse.linkedOrigins,[opaque]:'own-source-pack'}}});
   adapter?.invalidateCatalog?.();
   return {state:duplicate?'already_owned':'stored_unverified',
    ownedProviderId:source.owned,accountId:opaque,originalUnchanged:true,
    activation:'requires_model_verification'};
  }catch{return {state:'unavailable'}}
  finally{inflight.delete(key)}
 }
 return {adopt};
}
