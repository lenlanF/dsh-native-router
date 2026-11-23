// WorkBuddy growth rewards: only already-earned, zero-cost official claims.
// The independent account owns its Bearer credential. Never imitate a user,
// spend energy, draw prizes, accept unfinished tasks, travel or buy a tier.
// API contracts cross-checked against MIT 88lin/workbuddy-auto-signin
// (growth tasks completed -> claim, arrived travel -> claim).
import {createHash} from 'node:crypto';
const TASK=/^[a-zA-Z0-9_-]{1,96}$/;
const MAX_BYTES=128*1024,MAX_TASKS=60;
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
const record=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const point=x=>{
  const n=typeof x==='number'?x:typeof x==='string'&&/^\d+(?:\.\d+)?$/.test(x.trim())
    ?Number(x.trim()):NaN;
  return Number.isFinite(n)&&n>0&&n<=1e9?n:null;
};
const nested=reply=>record(record(reply?.data)?.data??reply?.data??reply);
const originOf=(auth,region,baseOverride)=>{
  if(typeof baseOverride==='function'){
    const url=new URL(baseOverride(auth));
    if(!['https:','http:'].includes(url.protocol)
      ||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))
      throw Error('Unsafe WorkBuddy growth override');
    return url.origin;
  }
  if(region!=='cn')throw Error('Growth Center has not been verified for this region');
  const url=new URL(String(auth?.endpoint||'https://copilot.tencent.com'));
  if(!['https://copilot.tencent.com','https://www.workbuddy.cn'].includes(url.origin))
    throw Error('Unrecognized WorkBuddy growth service');
  return url.origin;
};
export function createWorkBuddyGrowthReader({fetchImpl=fetch,baseOverride,timeoutMs=9500}={}){
  function client(auth,region,signal){
    const base=originOf(auth,region,baseOverride)+'/v2/activity/growth';
    if(typeof auth?.access!=='string'||auth.access.length<12||auth.enterprise)
      throw Error('Personal WorkBuddy credential is required');
    const headers={authorization:'Bearer '+auth.access,
      accept:'application/json','content-type':'application/json',
      'user-agent':'WorkBuddy',...(auth.uid?{'x-user-id':auth.uid}:{}),
      ...(auth.domain?{'x-domain':auth.domain}:{})};
    return async (path,body)=>{
      const cancellation=AbortSignal.timeout(Math.min(Math.max(timeoutMs,1000),15000));
      const combined=signal?AbortSignal.any([signal,cancellation]):cancellation;
      const response=await fetchImpl(base+path,{
        method:body===undefined?'GET':'POST',headers,redirect:'manual',
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:combined});
      if(!response.ok)throw Error('WorkBuddy growth source unavailable');
      const text=await response.text();
      if(text.length>MAX_BYTES)throw Error('Growth result too large');
      const payload=JSON.parse(text);
      if(!payload||typeof payload!=='object'||payload?.code!==undefined
        &&payload.code!==0&&payload.code!==200)
        throw Error('WorkBuddy growth result rejected');
      return payload;
    };
  }
  async function tasks(req){
    const body=nested(await req('/tasks'));
    return Array.isArray(body.tasks)?body.tasks.slice(0,MAX_TASKS):[];
  }
  function fromTask(row){
    const task=record(row),code=task.task_code;
    if(typeof code!=='string'||!TASK.test(code)||task.locked===true)return null;
    const status=task.accept_status;
    if(!['completed','claimed'].includes(status))return null;
    const credit=point(task.reward_credit);
    if(!credit)return null;
    return {kind:'workbuddy_growth_task_'+hash(code),
      name:typeof task.title==='string'&&task.title.trim()?
        task.title.trim().slice(0,78):'WorkBuddy 成长任务积分',
      active:true,claimed:status==='claimed',credit,
      _target:{type:'task',code}};
  }
  function fromTravel(reply){
    const body=nested(reply),id=body.record_id;
    if(body.state!=='arrived'||!(typeof id==='string'||typeof id==='number')
      ||!TASK.test(String(id)))return null;
    // No official advertised credit -> cannot prove a precise wallet delta.
    const credit=point(body.reward_credit);
    if(!credit)return null;
    return {kind:'workbuddy_growth_travel_'+hash(String(id)),
      name:'Buddy 旅行免费积分礼物',active:true,claimed:false,credit,
      _target:{type:'travel',recordId:String(id)}};
  }
  async function discover(auth,region,signal){
    const req=client(auth,region,signal);
    const [taskResult,travelResult]=await Promise.allSettled([
      tasks(req),req('/buddy/travel/status')]);
    if(taskResult.status==='rejected'&&travelResult.status==='rejected')
      throw Error('WorkBuddy growth API not available');
    const offers=[];
    if(taskResult.status==='fulfilled')for(const row of taskResult.value){
      const offer=fromTask(row);
      if(offer)offers.push(offer);
    }
    if(travelResult.status==='fulfilled'){
      const offer=fromTravel(travelResult.value);
      if(offer)offers.push(offer);
    }
    return offers;
  }
  async function claim(auth,region,offer,signal){
    const expected=offer?._target;
    if(!expected||!['task','travel'].includes(expected.type))
      throw Error('Invalid free-growth claim target');
    const req=client(auth,region,signal);
    // The second read prevents claiming an unrelated/expired/changed task.
    const latest=(await discover(auth,region,signal)).find(row=>
      row.kind===offer.kind&&row.claimed===false
      &&row.credit===offer.credit&&row._target?.type===expected.type
      &&(expected.type==='task'?row._target.code===expected.code:
        row._target.recordId===expected.recordId));
    if(!latest)return {confirmed:false,accepted:false,reason:'not_eligible'};
    if(expected.type==='task'){
      await req('/tasks/'+encodeURIComponent(expected.code)+'/claim',{});
      const after=(await tasks(req)).find(row=>row?.task_code===expected.code);
      return {accepted:true,confirmed:after?.accept_status==='claimed',
        credit:offer.credit};
    }
    const reply=await req('/buddy/travel/claim',{record_id:expected.recordId});
    const claimed=point(nested(reply).reward_credit);
    const after=nested(await req('/buddy/travel/status'));
    return {accepted:true,confirmed:claimed===offer.credit
       &&!(after.state==='arrived'&&String(after.record_id)===expected.recordId),
      credit:claimed};
  }
  return {discover,claim};
}
