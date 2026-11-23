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
// Never discard an old one-shot receipt: doing so could re-submit an
// already-claimed activity on older accounts. Full journal fails closed.
const MAX=10000;
const hash=v=>createHash('sha256').update(v).digest('hex');
const numeric=x=>Number.isFinite(x)&&x>=0?x:null;
const valid=r=>r&&/^[a-f0-9]{64}$/.test(r.key)
  &&/^[a-f0-9]{64}$/.test(r.binding)
  &&KINDS.has(r.kind)&&STATES.has(r.state)&&Number.isSafeInteger(r.at)&&r.at>0
  &&(r.credit===undefined||Number.isFinite(r.credit)&&r.credit>=0&&r.credit<=1e9);
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
    ||typeof account?.credentialRef!=='string'||!KINDS.has(offer?.kind))return '';
  const expiry=numeric(offer.endAt)??0,credit=numeric(offer.credit)??0;
  return hash([account.providerId,account.id,account.credentialRef,
    offer.kind,expiry,credit].join('\0'));
 };
 return {
  get blocked(){return blocked},
  get error(){return blocked?'历史活动回执损坏或不可写，已禁止重复领取':null},
  begin(account,offer){
   const key=keyOf(account,offer);
   if(!key||blocked)return false;
   if(rows.some(r=>r.key===key)||rows.length>=MAX)return false;
   const entry={key,binding:bindingOf(account),kind:offer.kind,state:'submitted',at:now()};
   persist([...rows,entry]);
   return true;
  },
  finish(account,offer,state,{credit}={}){
   const key=keyOf(account,offer);
   if(!key||!STATES.has(state)||blocked)return false;
   const index=rows.findIndex(r=>r.key===key);
   if(index<0)return false;
   const next=rows.map((r,i)=>i===index?{...r,state,
     ...(state==='confirmed'&&Number.isFinite(credit)&&credit>=0&&credit<=1e9
       ?{credit}:{} )}:r);
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
     ...(Number.isFinite(row.credit)?{credit:row.credit}:{})}:null;
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
