// Private, credential-free cache of account verification outcomes.
// A status is evidence from a bounded read-only probe, NOT proof that a
// provider stays online forever. The original DSH credentials are never read.
import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const MAX_ROWS=200;
const STATES=new Set(['online','expired','limited','error','pending','client_required']);
const ACCOUNT_ID=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const digest=account=>createHash('sha256').update(
  account.providerId+'\0'+account.id+'\0'+account.credentialRef).digest('hex');
const goodTime=value=>Number.isSafeInteger(value)&&value>0&&value<Date.now()+300000;
const safeRow=row=>row&&typeof row==='object'&&!Array.isArray(row)
  &&ACCOUNT_ID.test(row.id)&&/^[a-f0-9]{64}$/.test(row.binding)
  &&STATES.has(row.state)&&goodTime(row.checkedAt)
  &&(row.verifiedAt===null||goodTime(row.verifiedAt))
  &&(row.modelProofAt===undefined||goodTime(row.modelProofAt))
  &&(row.modelFailedAt===undefined||goodTime(row.modelFailedAt))
  &&(row.modelProofId===undefined||typeof row.modelProofId==='string'
    &&row.modelProofId.length<=120&&row.modelProofId.trim()
    &&!/[\u0000-\u001f]/.test(row.modelProofId));
// Verification periods are wall-clock timestamps persisted outside the DSH
// process. Restarting the host NEVER resets the next-due timestamp. This
// is deliberately separate from any model-catalog or inference cache.
export function verificationPeriodMs(state,healthyMs=15*60*1000){
 const interval=Number.isFinite(healthyMs)&&healthyMs>0?healthyMs:15*60*1000;
 if(state==='error'||state==='pending')return Math.min(interval,3*60*1000);
 if(state==='expired'||state==='limited')return Math.min(interval,10*60*1000);
 return interval;
}
export function verificationWithinPeriod(row,at=Date.now(),healthyMs=15*60*1000){
 if(!row||!Number.isSafeInteger(row.checkedAt)||row.checkedAt<=0||!Number.isFinite(at))
  return false;
 const elapsed=at-row.checkedAt;
 return elapsed>=0&&elapsed<verificationPeriodMs(row.state,healthyMs);
}
export function createAccountVerificationStore({path}={}){
 let rows={};let damaged=false,writeFailed=false;
 if(path&&existsSync(path)){
  try{
   const doc=JSON.parse(readFileSync(path,'utf8'));
   if(doc?.version!==1||!Array.isArray(doc.checks)||doc.checks.length>MAX_ROWS
      ||doc.checks.some(row=>!safeRow(row)))throw Error('Invalid verification state');
   rows=Object.fromEntries(doc.checks.map(row=>[row.id,row]));
  }catch{rows={};damaged=true}
 }
 const persist=()=>{
  if(!path||damaged)return;
  const body=JSON.stringify({version:1,checks:Object.values(rows).slice(-MAX_ROWS)},null,2)+'\n';
   const tmp=path+'.tmp-'+process.pid+'-'+randomUUID();
   try{
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(tmp,body,{mode:0o600,flag:'wx'});
    renameSync(tmp,path);
   }catch(error){
    writeFailed=true;
    try{unlinkSync(tmp)}catch{}
    throw error;
   }
  };
 return {
  get(account){
   if(!account||!ACCOUNT_ID.test(account.id))return null;
   const row=rows[account.id];
   return row?.binding===digest(account)?{...row}:null;
  },
  set(account,{state,at}){
   if(!account||!ACCOUNT_ID.test(account.id)||!STATES.has(state)
      ||!Number.isSafeInteger(at)||at<=0)return false;
   const existing=this.get(account);
   rows[account.id]={id:account.id,binding:digest(account),state,
     checkedAt:at,verifiedAt:state==='online'?at:existing?.verifiedAt??null,
     ...(existing?.modelProofAt?{modelProofAt:existing.modelProofAt,
       modelProofId:existing.modelProofId}:{}),
     ...(existing?.modelFailedAt?{modelFailedAt:existing.modelFailedAt}:{})};
   const entries=Object.values(rows);
   if(entries.length>MAX_ROWS){
    entries.sort((a,b)=>a.checkedAt-b.checkedAt);
    rows=Object.fromEntries(entries.slice(-MAX_ROWS).map(row=>[row.id,row]));
   }
   persist();
   return true;
  },
  getModelTest(account){
   const row=this.get(account);
   return row?.modelProofAt||row?.modelFailedAt?{
     state:(row.modelFailedAt??0)>=(row.modelProofAt??0)?'failed':'verified',
     at:row.modelProofAt??null,modelId:row.modelProofId??null,
     failedAt:row.modelFailedAt??null,
   }:null;
  },
  setModelTest(account,{at,modelId}={}){
   const existing=this.get(account);
   if(!existing||!Number.isSafeInteger(at)||at<=0||
     typeof modelId!=='string'||!modelId.trim()||modelId.length>120
     ||/[\u0000-\u001f]/.test(modelId))return false;
   rows[account.id]={...existing,modelProofAt:at,modelProofId:modelId};
   delete rows[account.id].modelFailedAt;
   persist();return true;
  },
  setModelTestFailure(account,{at}={}){
   const existing=this.get(account);
   if(!existing||!Number.isSafeInteger(at)||at<=0)return false;
   rows[account.id]={...existing,modelFailedAt:at};
   persist();return true;
  },
  forget(id){
   if(Object.prototype.hasOwnProperty.call(rows,id)){
    delete rows[id];persist();
   }
  },
   get writable(){return !damaged&&!writeFailed},
 };
}
