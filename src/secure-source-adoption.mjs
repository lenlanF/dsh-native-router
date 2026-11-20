// One-time, explicitly authorized migration into native-router's own account store.
// Secrets exist only in process memory and the DSH Credentials service.
// Nothing here reads profile files, serializes tokens into config, or deletes
// the original plugin's account or credential.
import {createHash} from 'node:crypto';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {publicAccountName} from './account-facts.mjs';


const SUPPORTED=new Set(SOURCE_PACK_PROVIDERS);
const safeId=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(x);
const refPattern=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const inProgress=new Set();
export function ownedAdoptionIdentity(providerId,sourceAccountId){
 if(!SUPPORTED.has(providerId)||!safeId(sourceAccountId))return null;
 const digest=createHash('sha256').update('dsh-native-router-adoption\0'+providerId+'\0'+sourceAccountId)
  .digest('hex').slice(0,32);
 return {accountId:'nr_'+digest,credentialName:'NATIVE_ROUTER_OWN_'+digest.toUpperCase()};
}
export async function adoptPortableAccount({providerId,sourceAccountId,source,ownPool,
 credentials,makeCredentialRef}={}){
 const identity=ownedAdoptionIdentity(providerId,sourceAccountId);
 if(!identity||typeof source?.portableCredentialSource!=='function'
   ||typeof ownPool?.listAllAccounts!=='function'||typeof ownPool?.addAccount!=='function'
   ||typeof credentials?.resolve!=='function'||typeof credentials?.set!=='function'
   ||typeof credentials?.unset!=='function'||typeof makeCredentialRef!=='function'
   ||ownPool.store?.kind==='memory'||!['file','settings'].includes(ownPool.store?.kind))
  return {state:'unavailable'};
 const key=providerId+':'+sourceAccountId;
 if(inProgress.has(key))return {state:'busy'};
 inProgress.add(key);
 try{
  const accounts=await ownPool.listAllAccounts();
  if(!Array.isArray(accounts))return {state:'unavailable'};
  const collisions=accounts.filter(row=>row?.id===identity.accountId);
  const privateRef=makeCredentialRef(identity.credentialName);
  if(collisions.length){
   if(collisions.length!==1||collisions[0]?.provider!==providerId
     ||collisions[0]?.credentialRef!==identity.credentialName)
    return {state:'conflict'};
   const existing=await credentials.resolve(privateRef);
   return typeof existing?.value==='string'&&existing.value.length>0
      ?{state:'already_owned',accountId:identity.accountId,providerId,
         nickname:publicAccountName(collisions[0])}
     :{state:'unavailable'};
  }
  const first=await source.portableCredentialSource(providerId,sourceAccountId);
  if(!first||first.providerId!==providerId||first.sourceAccountId!==sourceAccountId
    ||!refPattern.test(first.credentialRef)
    ||first.credentialRef.startsWith('NATIVE_ROUTER_OWN_'))
   return {state:'not_transferable'};
  const originalRef=makeCredentialRef(first.credentialRef);
  const secret=await credentials.resolve(originalRef);
  if(typeof secret?.value!=='string'||!secret.value||secret.value.length>262144)
   return {state:'not_transferable'};
  // Catch account logout/change between first discovery and cloning.
  const second=await source.portableCredentialSource(providerId,sourceAccountId);
  if(!second||second.credentialRef!==first.credentialRef
    ||second.providerId!==providerId||second.sourceAccountId!==sourceAccountId)
   return {state:'source_changed'};
  // Never overwrite a previously stored private credential, including
  // an interrupted migration. Owner must resolve such a case explicitly.
  if(await credentials.resolve(privateRef))return {state:'conflict'};
  await credentials.set(privateRef,secret.value);
  let added=false;
  try{
   const updated=await ownPool.listAllAccounts();
   if(!Array.isArray(updated)||updated.some(row=>row?.id===identity.accountId))
    throw Error('Private account identity changed');
   await ownPool.addAccount({id:identity.accountId,provider:providerId,
    credentialRef:identity.credentialName,
     nickname:publicAccountName({nickname:first.nickname}),
    enabled:true,createdAt:Date.now(),refreshable:first.refreshable===true});
   added=true;
  }finally{
   if(!added)await credentials.unset(privateRef).catch(()=>{});
  }
  const confirm=await ownPool.listAllAccounts();
  const own=Array.isArray(confirm)?confirm.filter(row=>row?.id===identity.accountId
    &&row.provider===providerId&&row.credentialRef===identity.credentialName):[];
  const saved=await credentials.resolve(privateRef);
  if(own.length!==1||typeof saved?.value!=='string'||!saved.value)
   return {state:'unconfirmed'};
   return {state:'adopted',accountId:identity.accountId,providerId,
     nickname:publicAccountName(own[0])};
 }catch{return {state:'unavailable'}}
 finally{inProgress.delete(key)}
}
