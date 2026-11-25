// Loomy silent official onboarding-claim flow. These are provider's OWN
// task-state/complete endpoints; no chat, PPT, sharing, skill installation,
// scheduler, external publishing, or purchase calls are made.
export const LOOMY_FREE_TASKS=Object.freeze({
 first_message:{name:'发送你的第一条消息',points:500},
 pick_skill:{name:'试试选择一个技能',points:1000},
 generate_ppt:{name:'生成第一份 PPT',points:1500},
 set_schedule:{name:'设置定时任务',points:1000},
 install_skill:{name:'在技能广场安装一个技能',points:1500},
 configure_remote:{name:'配置远程控制',points:1000},
 create_soul:{name:'创建你的第一个搭子',points:1500},
 share_soul:{name:'把搭子分享给朋友',points:2000},
});
// Retain only reconciled numeric daily-quota evidence, never provider payloads.
export function loomyDailyQuota(value){
 if(!value||!['quota','balance','consumed'].every(k=>Number.isFinite(value[k])&&value[k]>=0&&value[k]<=1e12)
   ||value.quota<=0||Math.abs(value.balance+value.consumed-value.quota)>=1e-6)return null;
 return {quota:value.quota,balance:value.balance,consumed:value.consumed};
}
export function loomyDailyReceipt(value){
 const quota=loomyDailyQuota(value);
 return quota&&typeof value.alreadyProcessed==='boolean'?{...quota,alreadyProcessed:value.alreadyProcessed}:null;
}
export function loomyDailyConfirmation(receipt,status,day,currentDay=day){
 const accepted=loomyDailyReceipt(receipt),wallet=loomyDailyQuota(status?.dailyQuotaEvidence);
 if(!accepted)return 'LOOMY_RECEIPT_MISSING';
 if(status?.active!==true||!wallet)return 'LOOMY_WALLET_UNCONFIRMED';
 if(currentDay!==day||(status.dailyCycleDate&&String(status.dailyCycleDate).slice(0,10)!==day))return 'LOOMY_DAY_MISMATCH';
 if(Math.abs(accepted.quota-wallet.quota)>=1e-6||wallet.consumed+1e-6<accepted.consumed)return 'LOOMY_QUOTA_MISMATCH';
 return null;
}
const BASE='https://loomyad.xunfei.cn/api/v1';
const API_TIMEOUT=9000;
const tokenOf=c=>typeof c?.access_token==='string'&&c.access_token.length>=8
 &&c.access_token.length<=8192&&!/[\r\n]/.test(c.access_token)
 ?c.access_token:'';
const responseBody=async response=>{
 if(response?.ok!==true)return null;
 try{
  const text=await response.text();
  if(typeof text!=='string'||text.length>65536)return null;
  const obj=JSON.parse(text);
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&obj.code==='000000'
    ?obj.data??null:null;
 }catch{return null}
};
async function request(c,path,{fetchImpl=fetch,key=null}={}){
 const token=tokenOf(c);
 if(!token)return null;
 try{
  const post=key!==null;
  const response=await fetchImpl(BASE+path,{
   method:post?'POST':'GET',redirect:'error',
   headers:{Accept:'application/json',token,
     ...(post?{'Content-Type':'application/json'}:{})},
   ...(post?{body:JSON.stringify({key})}:{}),
   signal:AbortSignal.timeout(API_TIMEOUT),
  });
  return responseBody(response);
 }catch{return null}
}
export async function readLoomyFreeTasks({credential,fetchImpl=fetch}={}){
 const data=await request(credential,'/onboarding/tasks',{fetchImpl});
 if(!data||!data.tasks||typeof data.tasks!=='object'
   ||Array.isArray(data.tasks))return {state:'unavailable',tasks:[]};
 const tasks=Object.entries(LOOMY_FREE_TASKS)
   .filter(([key])=>typeof data.tasks[key]==='boolean')
   .map(([key,task])=>({
     kind:'loomy_'+key,name:task.name,
     credit:task.points,claimed:data.tasks[key]===true,active:true
   }));
 return tasks.length?{state:'available',tasks}:{state:'unavailable',tasks:[]};
}
// The official point-account statement is the only usable reward evidence.
// A completed onboarding checkbox alone does NOT mean points were credited.
export async function readLoomyWallet({credential,fetchImpl=fetch}={}){
 const data=await request(credential,'/points/records?pageNo=1&pageSize=1&recordType=all',
   {fetchImpl});
 const value=data?.balance;
 const permanent=typeof value==='number'?value:
   typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;
 return Number.isFinite(permanent)&&permanent>=0&&permanent<=1e12?
   {state:'available',permanent}:{state:'unavailable'};
}
const credited=(before,after,points)=>before?.state==='available'
 &&after?.state==='available'&&Number.isFinite(points)&&points>0
 &&Math.abs((after.permanent-before.permanent)-points)<0.000001;
export async function claimLoomyFreeTasks({credential,fetchImpl=fetch,
 beforeClaim,onOutcome,onObserved,previousReceipt,now=()=>Date.now()}={}){
 const initial=await readLoomyFreeTasks({credential,fetchImpl});
 if(initial.state!=='available')return {state:'unavailable',confirmed:0,pending:0,eligible:0};
 let confirmed=0,pending=0,eligible=0;
 // Provider task status and wallet statement must both be available before
 // we ever submit a free task-completion POST.
 let wallet=await readLoomyWallet({credential,fetchImpl});
 if(wallet.state!=='available')return {state:'unavailable',confirmed,pending,eligible};
 for(const offer of initial.tasks){
  if(offer.claimed){
   // Network errors can leave a previously accepted POST ambiguous. Only an
   // exact wallet increase, compared with the durable pre-POST balance,
   // upgrades its receipt. Old rc89 receipts had no baseline and stay hidden.
   let previous=null;
   try{previous=await previousReceipt?.(offer)}catch{}
   if(previous&&previous.state!=='confirmed'&&Number.isFinite(previous.baselineBalance)
       &&credited({state:'available',permanent:previous.baselineBalance},wallet,offer.credit)){
     try{await onObserved?.(offer,'confirmed',{
       credit:offer.credit,proof:'official_wallet_delta',verifiedAt:now()})}catch{}
   }
   continue;
  }
  eligible++;
  // Record the official balance before the POST in the durable owner receipt.
  // Failed wallet reads must not initiate any completion request.
  wallet=await readLoomyWallet({credential,fetchImpl});
  if(wallet.state!=='available')return {state:'unavailable',confirmed,pending,eligible};
  let approved=false;
  try{approved=await beforeClaim?.(offer,{baselineBalance:wallet.permanent})===true}catch{}
  if(!approved)continue;
  const key=offer.kind.slice('loomy_'.length);
  // Only an API-level task completion, never a visible task operation.
  await request(credential,'/onboarding/tasks/complete',{key,fetchImpl});
  const status=await readLoomyFreeTasks({credential,fetchImpl});
  const task=status.tasks.find(x=>x.kind===offer.kind);
  const after=await readLoomyWallet({credential,fetchImpl});
  const done=status.state==='available'&&task?.claimed===true
    &&credited(wallet,after,offer.credit);
  const metadata=done?{credit:offer.credit,
    proof:'official_wallet_delta',verifiedAt:now()}:{};
  try{await onOutcome?.(offer,done?'confirmed':'pending_confirmation',metadata)}catch{}
  if(done)confirmed++;
  else{
   pending++;
   // A task can demand genuine visible work, or the wallet can lag behind
   // a checkbox. Never keep posting other offers on an unverified outcome.
   break;
  }
 }
 return {state:pending?'pending_confirmation':confirmed?'confirmed':
   eligible?'no_new_confirmed':'no_task',confirmed,pending,eligible};
}
