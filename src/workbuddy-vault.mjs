// Read-only, license-compatible metadata parsing for the installed MIT
// dsh-connect-workbuddy v5 vault format. Never modify or refresh the original.
// Store locations and account identifiers must never reach the browser.
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {publicAccountName} from './account-facts.mjs';

const FILENAME=/^[a-f0-9]{24}\.json$/;
const PUBLIC=/^local_[a-f0-9]{20}$/;
const MAX_VAULT_FILE=256*1024;
const MAX_ACCOUNTS=64;
const REGION=['cn','global'];
const domainRegion=domain=>{
 const host=typeof domain==='string'
  ?domain.replace(/^https?:\/\//i,'').split('/')[0].toLowerCase():'';
 if(host==='www.workbuddy.cn'||host==='workbuddy.cn')return 'cn';
 if(host==='www.workbuddy.ai'||host==='workbuddy.ai')return 'global';
 return null;
};
const digest=x=>createHash('sha256').update(x).digest('hex');
export const workbuddyPublicId=(region,localId)=>
 PUBLIC.test(localId)?localId:'local_'+digest('dsh-native-router-inventory\0workbuddy-'+region+'\0'+localId).slice(0,20);

function readDocument(file,region,expectedName){
 try{
  const st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<64||st.size>MAX_VAULT_FILE)return null;
  const d=JSON.parse(readFileSync(file,'utf8'));
  if(d?.version!==1||typeof d.auth!=='object'||typeof d.account!=='object'
    ||Array.isArray(d.auth)||Array.isArray(d.account))return null;
  const auth=d.auth,acct=d.account;
  if(typeof auth.accessToken!=='string'||!auth.accessToken
     ||auth.accessToken.length>16384||/[\s\u0000-\u001f]/.test(auth.accessToken)
     ||typeof auth.refreshToken!=='string'||auth.refreshToken.length>16384
     ||/[\s\u0000-\u001f]/.test(auth.refreshToken)
     ||domainRegion(auth.domain)!==region)return null;
  const stable=[acct.uin,acct.uid,acct.nickname].find(x=>
    (typeof x==='string'&&x.length>0&&x.length<=256)
      ||(typeof x==='number'&&Number.isSafeInteger(x)&&x>=0));
  if(stable===undefined)return null;
  const id=digest('workbuddy\0'+String(stable)).slice(0,24);
  if(expectedName!==id+'.json')return null;
  // For handoff, copy only server-native auth fields and safe account identity.
  // A field can be encrypted in the desktop original; such records do not pass
  // this parser's session validation and must use official client re-login.
  const token={accessToken:auth.accessToken,refreshToken:auth.refreshToken,
   domain:region==='cn'?'www.workbuddy.cn':'www.workbuddy.ai',
   expiresAt:auth.expiresAt??0,
   ...(auth.refreshExpiresAt!==undefined?{refreshExpiresAt:auth.refreshExpiresAt}:{}),
   ...(auth.lastRefreshTime!==undefined?{lastRefreshTime:auth.lastRefreshTime}:{}),
   ...('uid' in acct?{uid:String(acct.uid)}:{}),
   ...('uin' in acct?{uin:String(acct.uin)}:{}),
   ...('enterpriseId' in acct?{enterpriseId:String(acct.enterpriseId)}:{})};
   return {id,region,token,label:publicAccountName(acct)}; }catch{return null}
}
export function createWorkbuddyVaultInventory({home=homedir()}={}){
 const root=join(home,'.dsh','workbuddy-vault');
 function rows(region){
  if(!REGION.includes(region))return [];
  const dir=join(root,region);
  let names=[];
  try{names=readdirSync(dir).filter(name=>FILENAME.test(name)).sort().slice(0,MAX_ACCOUNTS)}
  catch{return []}
  return names.map(name=>readDocument(join(dir,name),region,name)).filter(Boolean);
 }
 function discover(){
  const accounts=[];
  for(const region of REGION){
   for(const item of rows(region))accounts.push({
     providerId:'workbuddy-'+region,providerName:'WorkBuddy '+(region==='cn'?'国内':'国际'),
     accountId:workbuddyPublicId(region,item.id),
     label:'WorkBuddy '+(region==='cn'?'国内':'国际')+' · 本机独立授权',
     source:'workbuddy-vault-'+region,
     credentialDetected:true,loginVerified:false,
     portable:true,state:'private_authorization_unverified',
   });
  }
  return accounts;
 }
 function readCredential(providerId,accountId){
  const region=providerId==='workbuddy-cn'?'cn':providerId==='workbuddy-global'?'global':null;
  if(!region||!PUBLIC.test(String(accountId)))return null;
  const match=rows(region).filter(item=>workbuddyPublicId(region,item.id)===accountId);
  if(match.length!==1)return null;
   return {providerId,accountId,secret:JSON.stringify(match[0].token),
     ...(match[0].label?{label:match[0].label}:{})}; }
 return {discover,readCredential};
}
