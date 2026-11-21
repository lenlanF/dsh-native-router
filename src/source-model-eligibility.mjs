import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';

// Channel model discovery must not depend on a separate daily sign-in
// status refresh after a self-owned account has passed real authentication.
// An external/linked account with the same opaque source ID is NEVER allowed
// to borrow successful health evidence from this plugin's private pack.
export function privateSourceAccountRoutable(account,live,sourceOnline=false){
 if(!account||typeof account.id!=='string'||typeof account.providerId!=='string'
   ||account.enabled!==true
   ||account.credentialRef!=='driver:'+account.providerId+':'+account.id)return false;
 if(!live){
   // AutoFree's dynamic private accounts are constructed only from the
   // mounted embedded pack's account roster. An independently refreshed
   // source-health row can authorize that exact opaque identity before any
   // static account record exists. An imported/public/unknown provider never
   // inherits this privilege merely by sharing a source account ID.
   return sourceOnline===true&&/^sp_[a-f0-9]{24}$/.test(account.id)
     &&account.providerId.startsWith('own_')
     &&SOURCE_PACK_PROVIDERS.includes(account.providerId.slice(4));
 }
 if(live.id!==account.id||live.providerId!==account.providerId||live.enabled!==true
   ||live.runtimeMode!=='owned'||live.origin?.kind!=='independent-owned')return false;
 if(live.connectionState==='online')return true;
 // A recent independently authenticated source may finish before AccountCenter
 // records its parallel probe. Explicit expiration, disablement and failures
 // always win over potentially older positive health signals.
 return sourceOnline===true&&['pending','not_checked','recently_verified']
   .includes(live.connectionState);
}

const canonical=id=>typeof id==='string'&&id.startsWith('own_')?id.slice(4):id;
export function sourceModelEligible(providerId,{accounts=[],sourceRows=[],ignoredIds=[]}={}){
 if(typeof providerId!=='string'||!providerId||providerId.length>70)return false;
 const localAccounts=Array.isArray(accounts)?accounts:[];
 const ignored=new Set(Array.isArray(ignoredIds)?ignoredIds:[]);
 const owned=row=>canonical(row?.providerId)===providerId&&row.enabled===true
   &&row.runtimeMode==='owned'&&row.origin?.kind==='independent-owned';
 // Source health can precede AccountCenter's remote account probe, but must
 // never resurrect a user-removed account, nor override an explicitly disabled,
 // expired, or linked reference with the same opaque identity.
 const readOnly=(Array.isArray(sourceRows)?sourceRows:[]).some(row=>{
   if(row?.providerId!==providerId||typeof row.id!=='string'||row.enabled!==true
      ||row.connectionState!=='online'||row.sourceAccount!==true)return false;
   const local=localAccounts.find(a=>a.id===row.id);
   if(local)return owned(local)&&['online','pending','not_checked','recently_verified']
     .includes(local.connectionState);
   return !ignored.has(row.id);
 });
 if(readOnly)return true;
 // Own CodeArts QR accounts may retain the historical public "codearts"
 // provider ID. Their independent authenticated state remains eligible even
 // if the separate source daily-sign-in status has not refreshed yet.
 return localAccounts.some(row=>owned(row)&&row.connectionState==='online');
}
