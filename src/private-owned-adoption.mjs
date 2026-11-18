// Owner-confirmed, one-way independent adoption of Lingxi, Loomy and
// ZCode Start Plan private login sessions. Only a fresh local source record
// with an exact opaque id is copied, never the original file/database.
// Stored secrets use the DSH Credentials service; no token enters config.
import {PRIVATE_PROVIDERS,ownedPrivateId} from './channels/private-owned.mjs';
const SUPPORTED=new Set(Object.keys(PRIVATE_PROVIDERS));
const credentialKey=id=>'NATIVE_ROUTER_PRIVATE_'+id.slice(3).toUpperCase();
const USED=new Set();
const fallback={
 lingxi:['qwen3.8_flash'],
 loomy:['spark-x2.6','DeepSeek-V4.1-Flash','GLM-5.3-Flash','qwen3.8-flash','mimo-v2.5','auto'],
 'zcode-start-plan':['GLM-5.3-Flash','GLM-5.3'],
};
export function createPrivateOwnedAdoption({inventory,configStore,vault,makeCredentialRef,
 adapter,now=()=>Date.now()}={}){
 async function getRef(){
  if(typeof makeCredentialRef==='function')return makeCredentialRef;
  const {credentialRef}=await import('@deepseek-ai/dsh-credentials');
  return credentialRef;
 }
 async function adopt({providerId,accountId,consent}={}){
  if(consent!==true)return {state:'consent_required'};
  if(!SUPPORTED.has(providerId)||!/^local_[a-f0-9]{20}$/.test(String(accountId)))
   return {state:'unsupported'};
  if(typeof configStore?.replace!=='function'||typeof vault?.resolve!=='function'
   ||typeof vault?.set!=='function'||typeof vault?.unset!=='function')
   return {state:'credentials_unavailable'};
  const id=ownedPrivateId(providerId,accountId);
  if(!id)return {state:'unsupported'};
  const key=providerId+':'+accountId;
  if(USED.has(key))return {state:'busy'};
  USED.add(key);
  try{
   const cfg=configStore.get();
   const ownerId=PRIVATE_PROVIDERS[providerId].ownedId,refName=credentialKey(id);
   const ref=(await getRef())(refName);
   const previous=cfg.accounts.find(x=>x.id===id);
   if(previous){
    if(previous.providerId!==ownerId||previous.credentialRef!=='driver:'+ownerId+':'+id)
     return {state:'conflict'};
    const existing=await vault.resolve(ref);
    if(typeof (existing?.value??existing)!=='string')
     return {state:'credentials_missing'};
    return {state:'already_owned',providerId:ownerId,accountId:id,
     originalUnchanged:true};
   }
   if(cfg.providers.some(x=>x.id===ownerId&&x.protocol!=='native-channel'))
    return {state:'provider_conflict'};
   // Read raw source authorization ONLY after the user explicitly chose it.
   // The opaque account ID must still match the current persistent source.
   const original=await inventory?.readCredential?.(providerId,accountId);
   if(!original||original.providerId!==providerId||original.accountId!==accountId
      ||typeof original.secret!=='string'||!original.secret)
    return {state:'source_missing_or_changed'};
   const current=await vault.resolve(ref);
   if(current)return {state:'conflict'};
   await vault.set(ref,original.secret);
   let written=false;
   try{
    const fresh=configStore.get();
    if(fresh.accounts.some(x=>x.id===id))throw Error('Account identity collision');
    const provider=fresh.providers.find(x=>x.id===ownerId);
    const source=fresh.providers.find(x=>x.id===providerId);
    const models=[...new Set([...(provider?.models||[]),...(source?.models||[]),
      ...fallback[providerId]])].filter(x=>typeof x==='string'&&x.length<160).slice(0,30);
    const providers=provider?fresh.providers.map(x=>x.id===ownerId
       ?{...x,enabled:true,models}:x):
      [...fresh.providers,{id:ownerId,name:providerId+' · 聚合路由自有',
        protocol:'native-channel',baseUrl:'',enabled:true,models,supportsTools:true}];
    const accounts=[...fresh.accounts,{
      id,providerId:ownerId,credentialRef:'driver:'+ownerId+':'+id,
      enabled:true,weight:1,autoCheckin:PRIVATE_PROVIDERS[providerId].autoCheckin}];
    let routes=fresh.routes;
    const routeId=('private_'+providerId).slice(0,63);
    if(!routes.some(x=>x.id===routeId)){
      routes=[...routes,{id:routeId,name:providerId+' · 独立模型链',
       mode:'priority',enabled:true,maxSwitches:3,
       tiers:models.map(model=>({providerId:ownerId,model,free:false,accountIds:[]}))
         .slice(0,10)}];
    }
    configStore.replace({...fresh,providers,accounts,routes,
      sessionReuse:{...fresh.sessionReuse,
       linkedIds:[...new Set([...(fresh.sessionReuse.linkedIds||[]),id])].slice(-200),
       linkedOrigins:{...fresh.sessionReuse.linkedOrigins,[id]:'own-source-pack'}}});
    written=true;
   }finally{
    if(!written)await vault.unset(ref).catch(()=>{});
   }
   adapter?.invalidateCatalog?.();
   return {state:'stored_unverified',providerId:ownerId,accountId:id,
    originalUnchanged:true,activation:'requires_live_model_validation'};
  }catch{return {state:'unavailable'}}
  finally{USED.delete(key)}
 }
 return {adopt};
}
