// Privacy-preserving installed DSH router audit: read-only, no network,
// no credential stores, no account names/IDs/balances in output.
// Usage: node tools/audit-installed-state-readonly.mjs
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isRetiredProvider} from '../src/config.mjs';

const validName=value=>typeof value==='string'&&value.trim().length>0
  &&!(/^(?:账号|账户|account|user)\s*[-_#]?\s*\d+$/i.test(value.trim()));
const keyOf=account=>createHash('sha256').update(
  account.providerId+'\0'+account.id+'\0'+account.credentialRef).digest('hex');

export function auditInstalledDsh({dshHome=join(homedir(),'.dsh'),
 now=Date.now()}={}){
 const base=join(dshHome,'plugins','dsh-native-router');
 const read=(file)=>{
   const full=join(base,file);
   if(!existsSync(full))return null;
   try{return JSON.parse(readFileSync(full,'utf8'))}catch{return {invalid:true}}
 };
 const pkgFile=join(dshHome,'profiles','desktop','node_modules',
  'dsh-native-router','package.json');
 const pkg=existsSync(pkgFile)?(()=>{
   try{return JSON.parse(readFileSync(pkgFile,'utf8'))}catch{return {invalid:true}}
 })():null;
 const cfg=read('config.json'),publicRows=read('account-public-facts.json'),
  verification=read('account-verification.json'),
  signins=read('checkins.json'),receipts=read('reward-claims.json');
 const rawAccounts=Array.isArray(cfg?.accounts)?cfg.accounts:[];
 const retiredAccounts=rawAccounts.filter(a=>isRetiredProvider(a?.providerId));
 const retiredIds=new Set(retiredAccounts.map(a=>a.id));
 const retiredBindings=new Set(retiredAccounts.flatMap(a=>[keyOf(a),createHash('sha256').update([a.providerId,a.id,a.credentialRef].join('\\0')).digest('hex')]));
 const safeRows=rawAccounts.filter(a=>!isRetiredProvider(a?.providerId));
 const publicMap=new Map((Array.isArray(publicRows?.rows)?publicRows.rows:[])
  .filter(x=>typeof x?.binding==='string').map(x=>[x.binding,x]));
 const checkMap=new Map((Array.isArray(verification?.checks)?verification.checks:[])
  .filter(x=>typeof x?.id==='string').map(x=>[x.id,x]));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const groups=new Map();
 const total={configured:0,enabled:0,named:0,identityReported:0,maskedIdentityOnly:0,balanceReported:0,
   recentBalance:0,observedQuota:0,recentQuota:0,observedEntitlementState:0,
   balanceUnitMissing:0,balanceUnreported:0,
   onlineProbeRecent:0,onlineProbeStale:0,expiredProbeRecent:0,
   modelProofRecent:0,modelProofUnverified:0};
 for(const acc of safeRows){
   if(!acc?.id||!acc?.providerId||!acc?.credentialRef)continue;
   const binding=keyOf(acc);
   const f=publicMap.get(binding),v=checkMap.get(acc.id);
   const auth=v?.binding===binding?v:null;
   const row=groups.get(acc.providerId)??{channel:acc.providerId,
     configured:0,enabled:0,named:0,identityReported:0,maskedIdentityOnly:0,balanceReported:0,balanceUnitMissing:0,
     recentBalance:0,observedQuota:0,recentQuota:0,observedEntitlementState:0,
     balanceUnreported:0,onlineProbeRecent:0,onlineProbeStale:0,
     expiredProbeRecent:0,modelProofRecent:0,modelProofUnverified:0};
   const count=(key)=>{total[key]++;row[key]++};
   count('configured');if(acc.enabled!==false)count('enabled');
   const named=validName(f?.name);
   const masked=typeof f?.maskedPhone==='string'&&/^\d{3}\*{4}\d{4}$/.test(f.maskedPhone);
   if(named)count('named');
   if(named||masked)count('identityReported');
   if(masked&&!named)count('maskedIdentityOnly');
   const observation=f?.observation;
   const age=now-(observation?.at??0);
   const recentObservation=age>=0&&age<=30*60*1000;
   if(recentObservation)count('observedEntitlementState');
   const quota=Number.isInteger(observation?.quotaWindowCount)&&observation.quotaWindowCount>0
     ||observation?.membershipState==='active'&&observation.membershipPercentObserved===true
     ||observation?.rollingState==='available'&&observation.rollingPercentObserved===true;
   if(quota){count('observedQuota');if(recentObservation)count('recentQuota');}
   if(typeof f?.balance==='number'&&Number.isFinite(f.balance)&&f.balance>=0){
     count('balanceReported');
     const balanceAge=now-(f.balanceCheckedAt??0);
     if(balanceAge>=0&&balanceAge<=30*60*1000
       &&(!observation||observation.balanceState==='available'))count('recentBalance');
     if(typeof f?.balanceUnit!=='string'||!f.balanceUnit.trim())
       count('balanceUnitMissing');
   }else count('balanceUnreported');
   const probeAge=now-(auth?.checkedAt??0);
   const recent=probeAge>=0&&probeAge<=15*60*1000;
   if(auth?.state==='online'){
     count(recent?'onlineProbeRecent':'onlineProbeStale');
   }else if(auth?.state==='expired'&&recent)count('expiredProbeRecent');
   const modelAge=now-(auth?.modelProofAt??0);
   if(modelAge>=0&&modelAge<=24*60*60*1000
     &&(auth?.modelProofAt??0)>(auth?.modelFailedAt??0))count('modelProofRecent');
   else count('modelProofUnverified');
   groups.set(acc.providerId,row);
 }
 const history=Array.isArray(signins?.history)?signins.history:[];
 const todayHistory=history.filter(x=>x?.date===today&&!isRetiredProvider(x?.providerId)&&!retiredIds.has(x?.accountId));
 const countStates=rows=>rows.reduce((out,x)=>{
   const state=['success','failed','pending_confirmation','no_task',
     'client_required','unsupported'].includes(x?.state)?x.state:'other';
   out[state]=(out[state]??0)+1;return out;
 },{});
 const latest=new Map();
 for(const [i,row] of todayHistory.entries()){
   const key=typeof row.accountId==='string'&&row.accountId?JSON.stringify([row.providerId??'',row.accountId]):'unknown:'+i;
   const old=latest.get(key);
   if(!old||old.state!=='success'&&(row.state==='success'||(row.at??0)>=(old.at??0)))latest.set(key,row);
 }
 const todayFinal=[...latest.values()];
 const rewardRows=(Array.isArray(receipts?.receipts)?receipts.receipts:[]).filter(x=>!retiredBindings.has(x?.binding)&&!String(x?.kind??'').startsWith('doubao_task_'));
 return {auditedAt:new Date(now).toISOString(),installedVersion:pkg?.version??'missing',
  configStatus:cfg?.invalid?'invalid':cfg?'present':'missing',
  publicFactsStatus:publicRows?.invalid?'invalid':publicRows?'present':'missing',
  verificationStatus:verification?.invalid?'invalid':verification?'present':'missing',
  globalAutomaticActivitiesEnabled:cfg?.checkin?.autoEnabled===true,
  perSourceAutoEnabled:cfg?.checkin?.autoSourceAccounts===true,
  providerCount:Array.isArray(cfg?.providers)?cfg.providers.filter(p=>!isRetiredProvider(p?.id)).length:0,
  routeCount:Array.isArray(cfg?.routes)?cfg.routes.filter(r=>!Array.isArray(r?.tiers)||!r.tiers.length||r.tiers.some(t=>!isRetiredProvider(t?.providerId))).length:0,
  accounts:total,channels:[...groups.values()].sort((a,b)=>a.channel.localeCompare(b.channel)),
  todayShanghai:today,
   todayCheckins:{count:todayFinal.length,byState:countStates(todayFinal)},
   todayCheckinAttempts:{count:todayHistory.length,byState:countStates(todayHistory)},
  rewardReceipts:{count:rewardRows.length,
   confirmed:rewardRows.filter(x=>x?.state==='confirmed').length,
   pending:rewardRows.filter(x=>x?.state!=='confirmed').length},
  readOnly:true,liveOfficialAPIQueried:false,modelInferenceExecuted:false,
 };
}
const called=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(called)console.log(JSON.stringify(auditInstalledDsh(),null,2));
