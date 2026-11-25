// Native Router's independently owned MiMo Desktop account driver.
// This is NOT the public MiMo API-Key route. Explicit one-time import from
// an already-logged-in MiMo Desktop account stores a copy in DSH Credentials.
// Runtime inference and SSO refresh NEVER read Desktop or another plugin.
import {createHash,randomBytes} from 'node:crypto';
import {copyFileSync,existsSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createMimoDesktopSessionTransport,MIMO_DESKTOP_ACCOUNT_MODELS}
 from './mimo-desktop-session.mjs';
import {createMimoDesktopLoginFlow} from './mimo-desktop-login.mjs';
import {UpstreamError} from '../failure.mjs';

export const MIMO_DESKTOP_ID='own_mimo_desktop';
// Candidates are upstream account-route model IDs, not an entitlement or
// zero-cost claim. The transport uses this very same guarded allowlist.
const models=MIMO_DESKTOP_ACCOUNT_MODELS;
const TOKEN=/^sp_[a-f0-9]{24}$/;
const inFlight=new Set();
// RC.28/29 assigned the same ID to every region. New accounts always have
// region-specific IDs; legacy records remain readable without rewriting.
const legacyIdFor=session=>'sp_'+createHash('sha256')
 .update('dsh-native-router:mimo-desktop\0'+session.userId+'\0'+session.passToken)
 .digest('hex').slice(0,24);
const idFor=session=>'sp_'+createHash('sha256')
 .update('dsh-native-router:mimo-desktop:region\0'+session.region+'\0'+session.userId+'\0'+session.passToken)
 .digest('hex').slice(0,24);
const credentialKey=id=>'NATIVE_ROUTER_MIMO_DESKTOP_'+id.slice(3).toUpperCase();
const fail=(code='CREDENTIAL')=>new UpstreamError(
 'MiMo Desktop independent account credential is unavailable',{code});

function normalSession(value){
 if(!value||typeof value!=='object'||typeof value.passToken!=='string'
   ||value.passToken.length<8||value.passToken.length>4096
   ||/[\u0000-\u001f;]/.test(value.passToken))return null;
 const userId=typeof value.userId==='string'&&value.userId.length<=128
   &&!/[^\x21-\x7e]|[;=]/.test(value.userId)?value.userId:'';
 const cUserId=typeof value.cUserId==='string'&&value.cUserId.length<=128
   &&!/[^\x21-\x7e]|[;=]/.test(value.cUserId)?value.cUserId:'';
 const region=['cn','sgp','ams','ru','in'].includes(value.region)?value.region:'cn';
 return {passToken:value.passToken,userId,cUserId,region};
}
// Read-only attempt only during a deliberate scan/import. No socket/CDP
// listener, browser profile mutation or original-plugin dependency.
// Chromium AppBound-encrypted cookies are not silently bypassed: a missing
// plaintext passToken is reported as no available Desktop session.
export async function readMimoDesktopSession({
 platform=process.platform,profile=join(homedir(),'AppData','Roaming','Xiaomi MiMo',
  'Partitions','xiaomi-account','Network','Cookies'),
 tempRoot='E:\\Temp',
}={}){
 if(platform!=='win32'||!existsSync(profile)||!existsSync(tempRoot))return null;
 let db=null,temporary='';
 try{
  const sqlite=await import('node:sqlite');
  if(typeof sqlite.DatabaseSync!=='function')return null;
  temporary=join(tempRoot,'dsh-mimo-cookie-'+randomBytes(10).toString('hex')+'.db');
  copyFileSync(profile,temporary);
  db=new sqlite.DatabaseSync(temporary,{readOnly:true});
  const rows=db.prepare('SELECT name,value FROM cookies WHERE host_key IN (?,?)')
   .all('.account.xiaomi.com','account.xiaomi.com');
  const jar=Object.fromEntries(rows.filter(r=>['passToken','userId','cUserId'].includes(r.name)
   &&typeof r.value==='string'&&r.value).map(r=>[r.name,r.value]));
  return normalSession({...jar,region:'cn'});
 }catch{return null}
 finally{
  try{db?.close()}catch{}
  if(temporary)try{unlinkSync(temporary)}catch{}
 }
}
export function createMimoDesktopDriver({
 vault,readCurrentSession=readMimoDesktopSession,
  transport=createMimoDesktopSessionTransport(),loginFactory=createMimoDesktopLoginFlow,
  getAccounts=()=>[],now=()=>Date.now(),
}={}){
 const discovered=new Map(),snapshots=new Map(),inferenceProof=new Map();
 const supportedModels=[...models];
 function keyFor(account){
  const id=String(account?.id??'');
  if(account?.providerId!==MIMO_DESKTOP_ID||!TOKEN.test(id)
    ||account.credentialRef!=='driver:'+MIMO_DESKTOP_ID+':'+id)
   throw fail();
  return credentialKey(id);
 }
 async function ownedSession(account){
  const ref=keyFor(account);
  if(typeof vault?.resolve!=='function')throw fail();
  let raw;
  try{raw=await vault.resolve(ref)}catch{throw fail()}
  const value=typeof raw==='string'?raw:raw?.value;
  if(typeof value!=='string'||value.length>8000)throw fail();
  let payload;
  try{payload=JSON.parse(value)}catch{throw fail()}
  const session=normalSession(payload);
  if(!session||![idFor(session),legacyIdFor(session)].includes(account.id))throw fail();
  return session;
 }
 async function persistOwnedSession(input,{allowExisting=false}={}){
  const source=normalSession(input);
  if(!source||typeof vault?.resolve!=='function'||typeof vault?.set!=='function')throw fail();
  const regionalId=idFor(source),regionalKey=credentialKey(regionalId);
  if(inFlight.has(regionalKey))throw fail();
  inFlight.add(regionalKey);
  try{
   let id=regionalId,key=regionalKey;
   const legacyId=legacyIdFor(source);
   if(legacyId!==regionalId){
    let old;
    try{old=await vault.resolve(credentialKey(legacyId))}catch{}
    const raw=typeof old==='string'?old:old?.value;
    let existing;
    try{if(raw)existing=normalSession(JSON.parse(raw))}catch{}
    // Only reuse the OLD vault ID if this is the exact same region and
    // membership; a legacy overseas account must not capture new CN login.
    if(existing?.region===source.region&&existing.userId===source.userId
      &&existing.passToken===source.passToken){
      id=legacyId;key=credentialKey(id);
    }
   }
   let previous;
   try{previous=await vault.resolve(key)}catch{}
   if(previous){
    if(!allowExisting)throw fail();
    return {id,providerId:MIMO_DESKTOP_ID,
     credentialRef:'driver:'+MIMO_DESKTOP_ID+':'+id,alreadyOwned:true};
   }
   await vault.set(key,JSON.stringify(source));
   return {id,providerId:MIMO_DESKTOP_ID,
    credentialRef:'driver:'+MIMO_DESKTOP_ID+':'+id};
  }finally{inFlight.delete(regionalKey)}
 }
  async function rollbackCandidate({account}={}){
   const id=String(account?.id??''),ref='driver:'+MIMO_DESKTOP_ID+':'+id;
   if(!TOKEN.test(id)||account?.providerId!==MIMO_DESKTOP_ID
     ||account.credentialRef!==ref||account.alreadyOwned===true)return;
   // A late cancel from a browser window must never delete an account that
   // has already been committed to DSH config (or belongs to another owner).
   const saved=typeof getAccounts==='function'?getAccounts():[];
   if(Array.isArray(saved)&&saved.some(x=>x.id===id&&
     x.providerId===MIMO_DESKTOP_ID&&x.credentialRef===ref))return;
   await vault?.unset?.(credentialKey(id));
  }
 // Quota endpoints may omit a number or explicitly end a cycle. Never merge
 // a previous percentage/reset into the new official entitlement snapshot.
 function quotaFacts(remote){
   return {balanceState:'not_supported',
     membershipState:remote.membershipState??'unavailable',
     membershipPlanName:typeof remote.membershipPlanName==='string'?remote.membershipPlanName:undefined,
     membershipPercentRemaining:remote.membershipState==='active'&&Number.isFinite(remote.membershipPercentRemaining)?remote.membershipPercentRemaining:undefined,
     membershipResetAt:remote.membershipState==='active'&&Number.isFinite(remote.membershipResetAt)?remote.membershipResetAt:undefined,
     quotaCheckedAt:Number.isFinite(remote.quotaCheckedAt)?remote.quotaCheckedAt:undefined,
     usageState:remote.usageState??'unavailable',
     usagePercentRemaining:remote.usageState==='available'&&Number.isFinite(remote.usagePercentRemaining)?remote.usagePercentRemaining:undefined,
     usageResetAt:remote.usageState==='available'&&Number.isFinite(remote.usageResetAt)?remote.usageResetAt:undefined,
     usageCheckedAt:Number.isFinite(remote.usageCheckedAt)?remote.usageCheckedAt:undefined};
 }
 async function verifyMembership(session){
   try{return (await transport.probe({session})).authVerified===true}
   catch{return false}
 }
 const browser=loginFactory({
   onSession:async session=>{
    const remote=await transport.probe({session});
    if(remote.authVerified!==true)throw fail('AUTH');
    const receipt=await persistOwnedSession(session,{allowExisting:true});
    snapshots.set(receipt.id,{...snapshots.get(receipt.id),
      authVerified:true,profileCheckedAt:now(),
      ...(remote.accountName?{accountName:remote.accountName}:{}),
      ...quotaFacts(remote)});
    return receipt;
   },
  verifySession:verifyMembership,
  onRollback:account=>rollbackCandidate({account}),
 });
 return {
  independentProvider:MIMO_DESKTOP_ID,
   providerName:'小米 MiMo Desktop · 聚合路由自有',
  candidateModels:supportedModels,
  authMethod:'本插件独立浏览器登录 / 可选原 MiMo Desktop 会话接管；无需客户端进程',
  startLogin:options=>browser.start(options),
  loginStatus:()=>browser.status(),
   cancelLogin:async()=>{
    const state=browser.status();
    if(state?.status==='done'){
     if(state.account)await rollbackCandidate({account:state.account});
     return browser.dismissCompleted?.()??{status:'canceled',at:now()};
    }
    return browser.cancel();
   },
  get runtimeReady(){return typeof vault?.resolve==='function'&&typeof vault?.set==='function'},
  accountSnapshot(account){return {
   ...(snapshots.get(account?.id)??{}),
   modelInferenceVerifiedAt:inferenceProof.get(account?.id)?.at??null}},
  async discover(){
   const source=normalSession(await readCurrentSession().catch(()=>null));
   if(!source)return [];
   const id=idFor(source);
   discovered.clear();discovered.set(id,{at:now()});
   return [{id,label:'小米 MiMo Desktop · 已发现会话（待核验）',source:'desktop-session'}];
  },
  async importCandidate({candidateId,consent}={}){
   if(consent!==true)throw fail();
   const scanned=discovered.get(candidateId);
   if(!scanned||now()-scanned.at>10*60*1000)throw fail();
   const source=normalSession(await readCurrentSession().catch(()=>null));
   if(!source||idFor(source)!==candidateId)throw fail();
   // Chromium Cookie presence is not proof of a live membership. Reject
   // expired/stale desktop sessions before storing any independent account.
   if(!await verifyMembership(source))throw fail('AUTH');
   const imported=await persistOwnedSession(source);
   discovered.delete(candidateId);
   return {id:imported.id,credentialRef:imported.credentialRef};
  },
  rollbackCandidate,
   async refresh({account,signal}={}){
    try{
     const session=await ownedSession(account);
     const remote=await transport.probe({session,signal});
     if(remote.authVerified===true){
      snapshots.set(account.id,{...snapshots.get(account.id),
       authVerified:true,profileCheckedAt:now(),
       ...(typeof remote.accountName==='string'&&remote.accountName?
        {accountName:remote.accountName}:{}),
        ...quotaFacts(remote)});
      return {state:'online',message:'MiMo Desktop 账号信息已核验；会员额度与 API Token Plan 分开显示'};
     }
     // A temporary remote outage must not discard a previously verified name.
     snapshots.set(account.id,{...snapshots.get(account.id),authVerified:false});
     return {state:remote.state==='expired'?'expired':remote.state==='error'?'error':'pending',
      message:'MiMo Desktop 当前未通过实时身份检查；已获取的账号名称只作历史参考'};
     }catch(error){
      snapshots.set(account?.id,{...snapshots.get(account?.id),authVerified:false});
      // A private DSH Credentials read failure is NOT an upstream HTTP 401.
      // The locally stored session may still be valid after Host recovery.
      // Only the official probe's explicit 'expired'/AUTH can revoke it.
      return {state:error?.code==='AUTH'?'expired':'error',
       message:'MiMo 独立授权查询未完成；本地凭据服务或网络故障不代表官方登录失效'};
     }
   },
   async refreshAccountStatus({account,signal}={}){
    const reply=await this.refresh({account,signal});
    return {state:reply.state,authVerified:reply.state==='online',
      ...(reply.state==='online'?{checkedAt:now()}:{})};
   },
   async listModels({account,signal}={}){
   const session=await ownedSession(account);
   const state=await transport.probe({session,signal,includeQuota:false});
   return state.authVerified===true?supportedModels.map(id=>({id})):[];
  },
  async generate({account,model,options={},signal}={}){
   const session=await ownedSession(account);
   const output=await transport.generate({session,model,options,signal});
   // A transport that returns a truncated, empty or tool-incomplete response
   // is not a successful member-model round trip. Only full useful text can
   // qualify as independent production inference evidence in AccountCenter.
   if(output?.finishReason==='stop'&&typeof output.text==='string'&&output.text.trim())
     inferenceProof.set(account.id,{at:now(),model});
   return output;
  },
  async logout({account}={}){
   const key=keyFor(account);
   if(typeof vault?.unset!=='function')throw fail();
   await vault.unset(key);
   snapshots.delete(account.id);inferenceProof.delete(account.id);
   return {revokedUpstream:false,
    message:'已解除聚合路由自有会话，未修改或退出原 MiMo Desktop 客户端'};
  },
 };
}