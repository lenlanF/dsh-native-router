// Owner-confirmed upgrade from an existing DSH source account pool into
// native-router's *own* private channel-pack account pool and Credentials refs.
// No original logout/delete, no token in HTTP/config/logs and no background
// credential scanning. Unsupported plugin-private sessions require native login.
import {adoptPortableAccount,ownedAdoptionIdentity} from './secure-source-adoption.mjs';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS} from './embedded-pack.mjs';

export function createAccountAdoption({configStore,originalSource,ownedPack,adapter,
 makeCredentialRef,installedInventory,privateOwnedAdoption,privatePackAdoption,workbuddyVaultAdoption}={}){
 const loadRef=async()=>{
  if(typeof makeCredentialRef==='function')return makeCredentialRef;
  const module=await import('@deepseek-ai/dsh-credentials');
  if(typeof module.credentialRef!=='function')throw Error('DSH Credentials unavailable');
  return module.credentialRef;
 };
  async function preview(){
   const original=await originalSource?.portableAccounts?.()??{state:'unavailable',accounts:[]};
   const privatePlugins=await installedInventory?.scan?.().catch(()=>null);
   const owned=ownedPack?.status?.()??{state:'disabled'};
   const transferable=(original.accounts??[]).slice(0,100).map(row=>({
    providerId:row.providerId,accountId:row.accountId,
    label:row.label,portable:row.portable===true,
    state:row.portable===true?'available_for_owner_consent':'requires_native_login',
   }));
   // Private plugin inventories cannot be upgraded by the generic AccountPool
   // copier; each format requires a separate protocol and user authorization.
   const privateRows=(privatePlugins?.accounts??[]).map(row=>({
    providerId:row.providerId,accountId:row.accountId,
    label:row.label,portable:row.providerId==='lingxi'
      ?typeof privateOwnedAdoption?.adopt==='function':
       ['loomy','zcode-start-plan'].includes(row.providerId)
        ?typeof privatePackAdoption?.adopt==='function':
         ['workbuddy-cn','workbuddy-global'].includes(row.providerId)
          &&typeof workbuddyVaultAdoption?.adopt==='function',
    privatePortable:true,requiresPack:['loomy','zcode-start-plan'].includes(row.providerId),
    state:'private_authorization_unverified',source:row.source,
   }));
   return {state:original.state==='ready'||privatePlugins?.state==='ready'?'ready':'unavailable',
    ownPackState:owned.state,plugins:privatePlugins?.plugins??[],
    pluginScanIssues:privatePlugins?.issues??[],
    accounts:[...transferable,...privateRows].slice(0,100)};
  }
 async function adopt({providerId,accountId,consent}={}){
  if(consent!==true)return {state:'consent_required'};
  if(['workbuddy-cn','workbuddy-global'].includes(providerId))
    return workbuddyVaultAdoption?.adopt?.({providerId,accountId,consent})??{state:'unsupported'};
  if(/^local_[a-f0-9]{20}$/.test(String(accountId))
    &&['loomy','zcode-start-plan'].includes(providerId))
   return privatePackAdoption?.adopt?.({providerId,accountId,consent})??{state:'unsupported'};
  const identity=ownedAdoptionIdentity(providerId,accountId);
  if(!identity)return privateOwnedAdoption?.adopt?.({providerId,accountId,consent})??{state:'unsupported'};
  const cfg=configStore?.get?.();
  if(!cfg?.embeddedPack?.enabled)return {state:'native_login_disabled'};
  const existing=cfg.providers.find(p=>p.id===providerId);
  if(existing&&!['native-channel','dsh-host'].includes(existing.protocol))
   return {state:'provider_conflict'};
  const context=ownedPack?.ownedAdoptionContext?.();
  if(!context||ownedPack?.status?.().state!=='mounted')
   return {state:'native_login_not_ready'};
  let ref;
  try{ref=await loadRef()}catch{return {state:'credentials_unavailable'}}
  const copy=await adoptPortableAccount({providerId,sourceAccountId:accountId,
   source:originalSource,ownPool:context.pool,
   credentials:context.credentials,makeCredentialRef:ref});
  if(!['adopted','already_owned'].includes(copy.state))return copy;
  try{
   const now=configStore.get();
   const current=now.providers.find(row=>row.id===providerId);
   if(current&&!['native-channel','dsh-host'].includes(current.protocol))
    return {state:'provider_conflict'};
   const ownId=sourceAccountOpaqueId(providerId,copy.accountId);
   const ownedProviderId='own_'+providerId;
   const owned=now.providers.find(row=>row.id===ownedProviderId);
   if(owned&&owned.protocol!=='native-channel')return {state:'provider_conflict'};
   const account=now.accounts.find(row=>row.id===ownId);
   if(account&&!(account.providerId===ownedProviderId
     &&account.credentialRef==='driver:'+ownedProviderId+':'+ownId))
    return {state:'provider_conflict'};
   // Never change or disable the original provider; create a separate
   // owned channel and an independent model chain, with a fallback only on
   // existing priority-mode chains. Pinned routing is preserved as-is.
   const modelIds=[...new Set((current?.models||[]).filter(x=>typeof x==='string'&&x.trim()))];
   const providers=owned?now.providers.map(row=>row.id===ownedProviderId
     ?{...row,models:[...new Set([...(row.models||[]),...modelIds])],enabled:true}:row)
    :[...now.providers,{id:ownedProviderId,name:providerId+' · 自有渠道',
      protocol:'native-channel',baseUrl:'',models:modelIds,enabled:true,supportsTools:true}];
   const accounts=account?now.accounts:[...now.accounts,{
    id:ownId,providerId:ownedProviderId,credentialRef:'driver:'+ownedProviderId+':'+ownId,
    enabled:true,weight:1,
    autoCheckin:SOURCE_DAILY_SIGNIN_PROVIDERS.includes(providerId)}];
   let routes=now.routes.map(route=>{
    if(route.mode!=='priority')return route;
    const eligible=route.tiers.filter(tier=>tier.providerId===providerId);
    if(!eligible.length)return route;
    const tiers=[...route.tiers];
    for(const tier of eligible)if(!tiers.some(t=>t.providerId===ownedProviderId&&t.model===tier.model))
      tiers.push({providerId:ownedProviderId,model:tier.model,free:false,accountIds:[]});
    return {...route,tiers,maxSwitches:Math.max(route.maxSwitches,1)};
   });
   const standaloneId='owned_'+providerId;
   if(modelIds.length&&!routes.some(route=>route.id===standaloneId))
    routes=[...routes,{id:standaloneId,name:providerId+' · 自有模型',
      mode:'priority',enabled:true,maxSwitches:1,
      tiers:[{providerId:ownedProviderId,model:modelIds[0],free:false,accountIds:[]}]}];
   const next={...now,providers,accounts,routes,
    sessionReuse:{...now.sessionReuse,
     linkedIds:[...new Set([...(now.sessionReuse.linkedIds||[]),ownId])].slice(-200),
     linkedOrigins:{...now.sessionReuse.linkedOrigins,[ownId]:'own-source-pack'}}};
   configStore.replace(next);
   adapter?.invalidateCatalog?.();
   const conflicting=ownedPack.status()?.skippedProviders?.includes(providerId)===true;
   return {state:'stored_unverified',providerId,accountId:ownId,
    ownedProviderId,activation:conflicting
      ?'requires_original_stop_and_host_restart':'requires_model_verification',
    originalAccountUnchanged:true};
  }catch{
   // Private copy exists and can be recovered on an owner retry; do NOT
   // delete it during an uncertain config write and never touch original.
   return {state:'config_pending',originalAccountUnchanged:true};
  }
 }
 return {preview,adopt};
}
