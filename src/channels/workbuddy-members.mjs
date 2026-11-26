// Self-owned WorkBuddy member metadata and benefit reads, never the original plugin.
// Protocol derived from MIT dingminhua/dsh-connect-workbuddy src/upstream.ts and oauth.ts.
// A cached model catalog says nothing about remaining spendable credits.
import {publicAccountName} from '../account-facts.mjs';
import {giftWalletFacts} from '../gift-wallet.mjs';
const CN='https://www.codebuddy.cn',GLOBAL='https://www.workbuddy.ai';
const MAX=128*1024,MAX_ROWS=80;
const num=v=>{
 const n=typeof v==='number'?v:typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v.trim())?
  Number(v.trim()):NaN;
 return Number.isFinite(n)&&n>=0&&n<=1e13?n:null;
};
const record=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
const date=v=>{
 if(typeof v==='number'&&Number.isFinite(v)&&v>0)return v<1e11?v*1000:v;
 if(typeof v!=='string'||!v.trim())return null;
 const parsed=Date.parse(v.includes('T')?v:v.replace(' ','T'));
 return Number.isFinite(parsed)?parsed:null;
};
const clampName=s=>typeof s==='string'?s.trim().slice(0,75):'';
export function parseWorkBuddyCredits(payload,{enterprise=false,now=Date.now()}={}){
 const root=record(payload?.data)??{},inner=record(root.Data)??root;
 const raw=record(inner.Response)??record(root.Response)??root;
 const answer=record(raw.Data)??raw;
 if(enterprise){
  const total=num(answer.limitNum),spent=num(answer.credit);
  if(total===null||spent===null)return null;
  const remain=Math.max(0,total-spent),refresh=date(answer.cycleResetTime);
  return {balance:remain,balanceUnit:'积分',
   quotaWindows:[{kind:'monthly',label:'企业月度积分',total,used:Math.min(spent,total),
    left:remain,...(refresh?{endAt:refresh}:{})}],
   ...(refresh&&refresh>now&&refresh<=now+7*86400000&&remain>0
     ?{expiringPoints:remain,expiringAt:refresh}:{}),
   balanceCheckedAt:now,balanceState:'available'};
 }
 if(!Array.isArray(answer.Accounts)||answer.Accounts.length>MAX_ROWS)return null;
 if(!answer.Accounts.length)return {balance:0,balanceUnit:'积分',quotaWindows:[],
   quotaState:'no_active_package',balanceCheckedAt:now,balanceState:'available'};
 let total=0,ordinary=0,unknown=0;const packages=[],giftBuckets=[];
 for(const row of answer.Accounts.slice(0,MAX_ROWS)){
  if(!record(row))return null;
  const kind=Number(row.CapacityType)===4?'monthly':'grant';
  const label=clampName(row.PackageName);
  const explicitGift=kind!=='monthly'&&['活动赠送积分','每日赠送积分','签到赠送积分','赠送积分','活动赠送'].includes(label);
  const explicitOrdinary=kind==='monthly'||['充值积分','购买积分','永久积分','基础积分包'].includes(label);
  const hasCycle=row.CycleCapacityRemainPrecise!==undefined||
   row.CycleCapacityRemain!==undefined;
  const remaining=num(hasCycle?row.CycleCapacityRemainPrecise??row.CycleCapacityRemain:
   row.CapacityRemainPrecise??row.CapacityRemain);
  if(remaining===null)return null;
  const size=num(hasCycle?row.CycleCapacitySizePrecise??row.CycleCapacitySize??
   row.CapacitySizePrecise??row.CapacitySize:
   row.CapacitySizePrecise??row.CapacitySize);
  const reset=date(row.CycleEndTime),expires=date(row.ExpiredTime);
  if(expires!==null&&expires<=now)continue;
  if(kind==='monthly'&&reset!==null&&reset+1000<=now)return null;
  if(kind==='grant'&&remaining===0)continue;
  total+=remaining;
   if(explicitGift&&expires!==null)giftBuckets.push({remaining,expires});
   else if(explicitOrdinary&&!explicitGift)ordinary+=remaining;
   else unknown+=remaining;
  packages.push({kind,label:label|| (kind==='monthly'?'月度积分':'其他积分包'),
   total:size??remaining,used:size===null?0:Math.max(size-remaining,0),left:remaining,
   ...(kind==='monthly'&&reset?{endAt:reset+1000}:{}),
   ...(kind==='grant'&&expires?{endAt:expires}:{})});
 }
 if(!packages.length)return {balance:0,balanceUnit:'积分',quotaWindows:[],quotaState:'no_active_package',balanceCheckedAt:now,balanceState:'available'};
 // Official independent WorkBuddy credit packages form the summed wallet;
 // only these exact non-overlapping points buckets may be aggregated into
 // an expiring-soon total. Five-hour/week model limits must never be added.
 const soon=packages.filter(p=>Number.isFinite(p.endAt)&&p.endAt>now
   &&p.endAt<=now+7*86400000);
 const expiring=Math.round(soon.reduce((sum,p)=>sum+p.left,0)*1e4)/1e4;
 const gifted=Math.round(giftBuckets.reduce((sum,p)=>sum+p.remaining,0)*1e4)/1e4;
 return {balance:Math.round(total*1e4)/1e4,balanceUnit:'积分',quotaWindows:packages,
  ...giftWalletFacts({balance:Math.round(total*1e4)/1e4,gift:gifted,ordinary:Math.round(ordinary*1e4)/1e4,unknown:Math.round(unknown*1e4)/1e4,now,expiryKnown:true,expiresAt:gifted>0?Math.min(...giftBuckets.map(p=>p.expires)):null}),
  ...(expiring>0?{expiringPoints:expiring,
    expiringAt:Math.min(...soon.map(p=>p.endAt))}:{}),
  balanceCheckedAt:now,balanceState:'available'};
}
export function parseWorkBuddyProfile(payload,auth={}){
 const root=record(payload?.data)??{},profile=record(root.Data)??root;
 const uid=String(profile.uid??profile.Uid??profile.userId??profile.UserID??'').trim();
 if(!uid)return {};
 // When vault gave a stable UID, do not attach another person's profile.
 if(auth.uid&&uid!==String(auth.uid))return {};
 const name=publicAccountName({id:uid,displayName:profile.displayName,
  accountName:profile.enterpriseUserName,nickname:profile.nickname,
  nickName:profile.NickName,name:profile.ScreenName,
  username:profile.preferred_username});
  return name?{accountName:name,authVerified:true}:{authVerified:true};
}
export function parseWorkBuddyBenefit(payload,kind){
 const x=record(payload?.data);
 if(!x||typeof x.active!=='boolean'||typeof x.claimed!=='boolean')return null;
 const credit=num(x.credit_num),end=date(x.end_time);
 return {kind,active:x.active,claimed:x.claimed,
  ...(credit!==null?{credit}:{}),...(end?{endAt:end}:{})};
}
export function workBuddyBillingBase(auth={},region='cn'){
 if(region==='cn')return CN;
 const host=String(auth.domain??'').toLowerCase().replace('https://','').replace('http://','');
 return host==='www.codebuddy.ai'?'https://www.codebuddy.ai':GLOBAL;
}
export function createWorkBuddyMemberReader({fetchImpl=fetch,now=()=>Date.now(),
 timeoutMs=9500,baseOverride}={}){
 function requestFor(auth,region,signal){
  const base=typeof baseOverride==='function'?baseOverride(auth):workBuddyBillingBase(auth,region);
   // Match the installed official WorkBuddy billing client's balanced
   // request identity; billing and catalog use different host/UA contracts.
   // Device headers are omitted rather than inventing machine identity.
   const headers={authorization:'Bearer '+auth.access,accept:'application/json',
    'content-type':'application/json',
    'user-agent':region==='cn'?'WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0':'WorkBuddy/5.8.3',
    'x-requested-with':'XMLHttpRequest','x-codebuddy-request':'1',
    'accept-language':region==='cn'?'zh-CN':'en-US',
    'x-product':'WorkBuddy','x-agent-purpose':'conversation',
    'x-ide-name':'WorkBuddy','x-ide-type':'WorkBuddy','x-ide-version':'5.8.3',
    origin:base,referer:base+'/',
    ...(auth.uid?{'x-user-id':auth.uid}:{}),
    ...(auth.domain?{'x-domain':auth.domain}:{}),
    ...(auth.enterprise?{'x-enterprise-id':auth.enterprise,'x-tenant-id':auth.enterprise}:{})};
  return async (path,body,signalOverride)=>{
   const timeout=AbortSignal.timeout(timeoutMs);
   const linked=signalOverride??signal;
   const combined=linked?AbortSignal.any([linked,timeout]):timeout;
   const res=await fetchImpl(base+path,{
    method:body===undefined?'GET':'POST',headers,
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:combined});
   if(!res.ok)throw Error('WorkBuddy metadata unavailable');
   const text=await res.text();
   if(text.length>MAX)throw Error('WorkBuddy metadata too large');
   let parsed;try{parsed=JSON.parse(text)}catch{throw Error('WorkBuddy metadata malformed')}
   if(parsed?.code!==0)throw Error('WorkBuddy metadata rejected');
   return parsed;
  };
 }
 async function profile(auth,region,signal){
  const req=requestFor(auth,region,signal);
  for(const path of ['/v2/plugin/account','/v2/plugin/login/account']){
   try{
    const data=parseWorkBuddyProfile(await req(path),auth);
    if(data.authVerified===true)return data;
   }catch{}
  }
  const name=publicAccountName({
   displayName:auth.displayName,enterpriseUserName:auth.enterpriseUserName,
   nickname:auth.nickname});
  return name?{accountName:name}:{};
 }
 async function credits(auth,region,signal){
  const req=requestFor(auth,region,signal);
  if(auth.enterprise){
   const result=parseWorkBuddyCredits(
    await req('/billing/meter/get-enterprise-user-usage',{}),
    {enterprise:true,now:now()});
   if(!result)throw Error('WorkBuddy enterprise balance empty');
   return result;
  }
  const start=new Date(now());
  const format=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),
   String(d.getDate()).padStart(2,'0')].join('-')+' '+[
   String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0'),
   String(d.getSeconds()).padStart(2,'0')].join(':');
  const body={PageNumber:1,PageSize:100,ProductCode:'p_tcaca',Status:[0,3],
   PackageEndTimeRangeBegin:format(start),
   PackageEndTimeRangeEnd:format(new Date(start.getTime()+365*101*86400000))};
  const result=parseWorkBuddyCredits(await req('/v2/billing/meter/get-user-resource',body),
   {now:now()});
  if(!result)throw Error('WorkBuddy personal balance empty');
  return result;
 }
 async function benefits(auth,region,signal){
  if(auth.enterprise)return [];
  const req=requestFor(auth,region,signal);
  const kinds=[['compensation','/billing/meter/compensation-status'],
   ['gift','/billing/meter/check-gift-claimed']];
  const results=await Promise.all(kinds.map(async([kind,path])=>{
   try{return parseWorkBuddyBenefit(await req(path,{}),kind)}catch{return null}
  }));
  return results.filter(Boolean);
 }
 async function dailyStatus(auth,region,signal){
  const envelope=await requestFor(auth,region,signal)(
   '/v2/billing/meter/checkin-activity-status',{},signal);
  const row=record(envelope.data);
  if(!row||typeof row.active!=='boolean')
   throw Error('WorkBuddy daily task status missing');
  return {active:row.active,
   checkedInToday:typeof row.today_checked_in==='boolean'?row.today_checked_in:null};
 }
 async function claimDaily(auth,region,signal){
  return requestFor(auth,region,signal)('/v2/billing/meter/daily-checkin',{},signal);
 }
 async function claimBenefit(auth,region,kind,signal){
  const route={compensation:'/billing/meter/claim-compensation',
   gift:'/billing/meter/claim-gift'}[kind];
  if(!route||auth.enterprise)throw Error('This WorkBuddy account cannot claim a personal reward');
  const current=await benefits(auth,region,signal);
  const verified=current.find(x=>x.kind===kind);
  if(!verified||!verified.active||verified.claimed)
   return {state:'no_task',kind};
  const req=requestFor(auth,region,signal);
  await req(route,{});
  const after=await benefits(auth,region,signal);
  return after.find(x=>x.kind===kind)?.claimed===true?
   {state:'success',kind,confirmed:true}:{state:'pending_confirmation',kind};
 }
 return {profile,credits,benefits,claimBenefit,dailyStatus,claimDaily};
}
