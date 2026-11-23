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
export async function claimLoomyFreeTasks({credential,fetchImpl=fetch,
 beforeClaim,onOutcome,onObserved}={}){
 const initial=await readLoomyFreeTasks({credential,fetchImpl});
 if(initial.state!=='available')return {state:'unavailable',confirmed:0,pending:0,eligible:0};
 let confirmed=0,pending=0,eligible=0;
 for(const offer of initial.tasks){
  if(offer.claimed){
   try{await onObserved?.(offer,'confirmed')}catch{}
   continue;
  }
  eligible++;
  // The sender creates a durable identity-bound receipt BEFORE sending POST.
  let approved=false;
  try{approved=await beforeClaim?.(offer)===true}catch{}
  if(!approved)continue;
  const key=offer.kind.slice('loomy_'.length);
  // Exact API claim: no visible or background user action, only official
  // /onboarding/tasks/complete. Its reply alone does not prove points.
  await request(credential,'/onboarding/tasks/complete',{key,fetchImpl});
  const status=await readLoomyFreeTasks({credential,fetchImpl});
  const task=status.tasks.find(x=>x.kind===offer.kind);
  const done=status.state==='available'&&task?.claimed===true;
  try{await onOutcome?.(offer,done?'confirmed':'pending_confirmation')}catch{}
  if(done)confirmed++;
  else{
   pending++;
   // A task which still appears incomplete might require genuine visible
   // work. Do NOT brute-force its endpoint or fan out further task POSTs
   // after the first ambiguous remote result.
   break;
  }
 }
 return {state:pending?'pending_confirmation':confirmed?'confirmed':
   eligible?'no_new_confirmed':'no_task',confirmed,pending,eligible};
}
