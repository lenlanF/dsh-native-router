// Native Router's independently owned MiMo Desktop account driver.
// This is NOT the public MiMo API-Key route. Explicit one-time import from
// an already-logged-in MiMo Desktop account stores a copy in DSH Credentials.
// Runtime inference and SSO refresh NEVER read Desktop or another plugin.
import {createHash,randomBytes} from 'node:crypto';
import {copyFileSync,existsSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createMimoDesktopSessionTransport} from './mimo-desktop-session.mjs';
import {UpstreamError} from '../failure.mjs';

export const MIMO_DESKTOP_ID='own_mimo_desktop';
const models=Object.freeze(['mimo-x-pro-preview','mimo-x-flash-preview']);
const TOKEN=/^sp_[a-f0-9]{24}$/;
const inFlight=new Set();
const idFor=session=>'sp_'+createHash('sha256')
 .update('dsh-native-router:mimo-desktop\0'+session.userId+'\0'+session.passToken)
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
 transport=createMimoDesktopSessionTransport(),now=()=>Date.now(),
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
  if(!session||idFor(session)!==account.id)throw fail();
  return session;
 }
 return {
  independentProvider:MIMO_DESKTOP_ID,
  providerName:'小米 MiMo Desktop · 聚合路由自有',
  candidateModels:supportedModels,
  authMethod:'本机 MiMo Desktop 已登录会话 · 一次性独立接管',
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
   if(typeof vault?.resolve!=='function'||typeof vault?.set!=='function')throw fail();
   const key=credentialKey(candidateId);
   if(inFlight.has(key))throw fail();
   inFlight.add(key);
   try{
    const exists=await vault.resolve(key);
    if(exists)throw fail();
    await vault.set(key,JSON.stringify(source));
    discovered.delete(candidateId);
    return {id:candidateId,credentialRef:'driver:'+MIMO_DESKTOP_ID+':'+candidateId};
   }finally{inFlight.delete(key)}
  },
  async rollbackCandidate({account}={}){
   const id=account?.id;
   if(!TOKEN.test(String(id??''))||account?.providerId!==MIMO_DESKTOP_ID)return;
   try{await vault?.unset?.(credentialKey(id))}catch{}
  },
  async refresh({account,signal}={}){
   try{
    const session=await ownedSession(account);
    const remote=await transport.probe({session,signal});
    if(remote.authVerified===true){
     snapshots.set(account.id,{authVerified:true,
      ...(typeof remote.accountName==='string'?{accountName:remote.accountName}:{})});
     return {state:'online',message:'本插件自有 MiMo Desktop 会话已通过服务器身份核验；模型推理需单独实测'};
    }
    snapshots.delete(account.id);
    return {state:remote.state==='expired'?'expired':remote.state==='error'?'error':'pending',
     message:'MiMo Desktop 会话未通过实时身份核验；不提供虚假已登录状态'};
   }catch{
    snapshots.delete(account?.id);
    return {state:'expired',message:'本插件自己的 MiMo Desktop 授权已缺失、过期或引用失效'};
   }
  },
  async listModels({account,signal}={}){
   const session=await ownedSession(account);
   const state=await transport.probe({session,signal});
   return state.authVerified===true?supportedModels.map(id=>({id})):[];
  },
  async generate({account,model,options={},signal}={}){
   const session=await ownedSession(account);
   const output=await transport.generate({session,model,options,signal});
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
