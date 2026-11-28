// Loomy onboarding status is not proof of task completion. Read official
// status and reconcile existing receipts without asserting unfinished work.
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
// Read-only v2 points statement, referenced by Magpie's Loomy usage reader.
// No inferred limit from the remaining balance, no claim or model request.
export async function readLoomyDailyStatement({credential,fetchImpl=fetch}={}){
 const token=tokenOf(credential);
 if(!token)return {state:'unavailable'};
 try{
  const data=await responseBody(await fetchImpl('https://loomyad.xunfei.cn/api/v2/points/records?pageNo=1&pageSize=1&direction=debit&granularity=chat',{
   method:'GET',redirect:'error',headers:{Accept:'application/json',token,Authorization:'Bearer '+token},
   signal:AbortSignal.timeout(5000)}));
  const wallet=data?.data??data;
  const n=v=>(typeof v==='number'||typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v))&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1e12?Number(v):NaN;
  const quota=n(wallet?.dailyLimitPoints),balance=n(wallet?.dailyRemainingPoints);
  const evidence=loomyDailyQuota({quota,balance,consumed:quota-balance});
  if(!evidence)return {state:'unavailable'};
  for(const [key,value] of [['dailyQuota',quota],['dailyBalance',balance],['dailyConsumed',quota-balance]])
   if(wallet[key]!==undefined&&Math.abs(n(wallet[key])-value)>=1e-6||wallet[key]!==undefined&&!Number.isFinite(n(wallet[key])))return {state:'unavailable'};
  const day=wallet.dailyCycleDate;
  if(day!==undefined&&(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(day)))return {state:'unavailable'};
  return {state:'available',dailyQuotaEvidence:evidence,dailyCycleDate:day?.slice(0,10)??''};
 }catch{return {state:'unavailable'}}
}
async function request(c,path,{fetchImpl=fetch}={}){
 const token=tokenOf(c);
 if(!token)return null;
 try{
  const response=await fetchImpl(BASE+path,{
   method:'GET',redirect:'error',
   headers:{Accept:'application/json',token},
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
     credit:task.points,claimed:data.tasks[key]===true,active:true,requiresAction:true
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
export async function claimLoomyFreeTasks({credential,fetchImpl=fetch,
 onObserved,previousReceipt,now=()=>Date.now()}={}){
 const initial=await readLoomyFreeTasks({credential,fetchImpl});
 if(initial.state!=='available')return {state:'unavailable',confirmed:0,pending:0,eligible:0};
 const wallet=await readLoomyWallet({credential,fetchImpl});
 if(wallet.state!=='available')return {state:'unavailable',confirmed:0,pending:0,eligible:0};
 let eligible=0,pending=0;
 for(const offer of initial.tasks){
  if(!offer.claimed){eligible++;continue}
  // A historical submitted receipt may be reconciled; never initiate a
  // completion mutation for an unperformed task. Multiple ambiguous offers
  // can have the same award, so a shared wallet delta is not task-specific.
  let previous=null;try{previous=await previousReceipt?.(offer)}catch{}
  if(previous&&previous.state!=='confirmed')pending++;
 }
 return {state:eligible?'client_required':pending?'pending_confirmation':'no_task',confirmed:0,pending,eligible};
}
