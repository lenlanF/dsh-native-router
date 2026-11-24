// Durable one-shot activity reward receipts. A receipt is written BEFORE a
// remote POST; ambiguous replies cannot cause duplicate claims after reboot.
// Persist SHA-256 binding fingerprints, never plaintext account IDs or credentials.
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {defaultConfigPath} from './config.mjs';
const KINDS=new Set(['gift','compensation','raccoon_login',
 ...['first_message','pick_skill','generate_ppt','set_schedule','install_skill',
 'configure_remote','create_soul','share_soul'].map(key=>'loomy_'+key)]);
const STATES=new Set(['submitted','confirmed','pending_confirmation']);
// WorkBuddy Growth Center task/travel IDs are hashed before they become
// public receipt kinds: no arbitrary path, task code or user identifier is
// allowed inside this persisted journal.
const allowedKind=kind=>typeof kind==='string'&&(
  KINDS.has(kind)||/^workbuddy_growth_(?:task|travel)_[a-f0-9]{24}$/.test(kind));
// Never discard an old one-shot receipt: doing so could re-submit an
// already-claimed activity on older accounts. Full journal fails closed.
const MAX=10000;
const hash=v=>createHash('sha256').update(v).digest('hex');
const numeric=x=>Number.isFinite(x)&&x>=0?x:null;
const valid=r=>r&&/^[a-f0-9]{64}$/.test(r.key)
  &&/^[a-f0-9]{64}$/.test(r.binding)
  &&(allowedKind(r.kind)||/^doubao_task_[a-f0-9]{24}$/.test(r.kind))&&STATES.has(r.state)&&Number.isSafeInteger(r.at)&&r.at>0
  &&(r.credit===undefined||Number.isFinite(r.credit)&&r.credit>=0&&r.credit<=1e9)
  &&(r.baselineBalance===undefined||Number.isFinite(r.baselineBalance)&&r.baselineBalance>=0&&r.baselineBalance<=1e12)
  &&(r.proof===undefined||r.proof==='official_wallet_delta')
  &&(r.verifiedAt===undefined||Number.isSafeInteger(r.verifiedAt)&&r.verifiedAt>0);
export function createActivityClaimStore({path=join(dirname(defaultConfigPath()),'reward-claims.json'),
 now=()=>Date.now()}={}){
 let rows=[],blocked=false;
 if(path&&existsSync(path)){
  try{
   const doc=JSON.parse(readFileSync(path,'utf8'));
   if(doc?.version!==1||!Array.isArray(doc.receipts)||doc.receipts.length>MAX
     ||doc.receipts.some(r=>!valid(r)))throw Error('Invalid reward receipts');
   rows=doc.receipts;
  }catch{blocked=true}
 }
 const persist=next=>{
  if(blocked)throw Error('Reward receipt store unavailable');
  if(!path){rows=next;return}
  const temp=path+'.tmp-'+process.pid+'-'+randomUUID();
  mkdirSync(dirname(path),{recursive:true});
  try{
   writeFileSync(temp,JSON.stringify({version:1,receipts:next},null,2)+'\n',
     {flag:'wx',mode:0o600});
   renameSync(temp,path);
  }catch(error){
   blocked=true;
   try{unlinkSync(temp)}catch{}
   throw error;
  }
  rows=next;
 };
 const bindingOf=account=>account&&[account.providerId,account.id,account.credentialRef]
   .every(v=>typeof v==='string'&&v)?hash([account.providerId,account.id,
     account.credentialRef].join('\\0')):'';
 const keyOf=(account,offer)=>{
  if(typeof account?.providerId!=='string'||typeof account?.id!=='string'
    ||typeof account?.credentialRef!=='string'||!allowedKind(offer?.kind))return '';
  const expiry=numeric(offer.endAt)??0,credit=numeric(offer.credit)??0;
  return hash([account.providerId,account.id,account.credentialRef,
    offer.kind,expiry,credit].join('\0'));
 };
 return {
  get blocked(){return blocked},
  get error(){return blocked?'历史活动回执损坏或不可写，已禁止重复领取':null},
  begin(account,offer,{baselineBalance}={}){
   const key=keyOf(account,offer);
   if(!key||blocked)return false;
   if(rows.some(r=>r.key===key)||rows.length>=MAX)return false;
   const entry={key,binding:bindingOf(account),kind:offer.kind,state:'submitted',at:now(),
     ...(typeof offer.kind==='string'
        &&(offer.kind.startsWith('loomy_')||offer.kind.startsWith('workbuddy_growth_')
          ||['gift','compensation'].includes(offer.kind))
        &&Number.isFinite(baselineBalance)&&baselineBalance>=0&&baselineBalance<=1e12
       ?{baselineBalance}:{})};
   persist([...rows,entry]);
   return true;
  },
  finish(account,offer,state,{credit,proof,verifiedAt}={}){
   const key=keyOf(account,offer);
   if(!key||!STATES.has(state)||blocked)return false;
   const index=rows.findIndex(r=>r.key===key);
   if(index<0)return false;
   const next=rows.map((r,i)=>i===index?{...r,state,
     ...(state==='confirmed'&&Number.isFinite(credit)&&credit>=0&&credit<=1e9
       ?{credit}:{}),
     ...(state==='confirmed'
       &&(r.kind.startsWith('loomy_')||r.kind.startsWith('workbuddy_growth_')
         ||['gift','compensation'].includes(r.kind))
       &&proof==='official_wallet_delta'&&Number.isFinite(r.baselineBalance)
       &&Number.isSafeInteger(verifiedAt)&&verifiedAt>0
       ?{proof,verifiedAt}:{})}:r);
   persist(next);
   return true;
  },
  state(account,offer){
   const key=keyOf(account,offer);
   return key?rows.find(r=>r.key===key)?.state??null:null;
  },
  receipt(account,offer){
   const key=keyOf(account,offer);
   const row=key?rows.find(r=>r.key===key):null;
   return row?{state:row.state,at:row.at,
     ...(Number.isFinite(row.credit)?{credit:row.credit}:{}),
     ...(Number.isFinite(row.baselineBalance)?{baselineBalance:row.baselineBalance}:{}),
     ...(row.proof==='official_wallet_delta'&&Number.isFinite(row.verifiedAt)?
       {proof:row.proof,verifiedAt:row.verifiedAt}:{})}:null;
  },
  summary(account){
   const binding=bindingOf(account);
   const selected=rows.filter(r=>binding&&r.binding===binding);
   return {confirmed:selected.filter(r=>r.state==='confirmed').length,
    unconfirmed:selected.filter(r=>r.state!=='confirmed').length,
    lastAt:selected.length?Math.max(...selected.map(r=>r.at)):null};
  },
  count(){return rows.length},
 };
}
