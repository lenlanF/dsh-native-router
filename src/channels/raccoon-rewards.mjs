// Raccoon official read-only task verification, separate from the bundled
// source pack's daily-credits reader. Its upstream parser defaults a failed
// /tasks request to loginRewardPending=false; that is NOT proof of completion.
// This module fails CLOSED and never sends a claim or a model request.
const ENDPOINT='https://xiaohuanxiong.com/api/web/points/v1/tasks';
const PENDING=new Set(['pending','not_started','not_completed','uncompleted',
 'incomplete','available','todo']);
const DAILY_HOST='https://xiaohuanxiong.com';
const DAILY_PATHS=Object.freeze([
 '/api/web/auth/v1/user_info',
 '/api/web/office/v3/online_activities',
 '/api/web/office/v3/setting_info',
 '/api/web/office/v3/projects',
]);
export async function triggerRaccoonFreeDaily({credential,fetchImpl=fetch,
 timeoutMs=5500}={}){
 const token=credential?.access_token;
 if(typeof token!=='string'||token.length<12||token.length>8192||
   /[\r\n]/.test(token))return {state:'unavailable'};
 // Same free web office GET endpoints as the pinned Raccoon client's
 // verified daily_grant process. Strict allowlist: NEVER send a POST here,
 // never access chat/model credits or any purchase/upgrade endpoint.
 const headers={
  Authorization:'Bearer '+token,
  Accept:'application/json, text/plain, */*',
  'Accept-Language':'zh-CN,zh;q=0.9',
  Origin:DAILY_HOST,Referer:DAILY_HOST+'/work/home',
  'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'X-Raccoon-Language':'zh',
  ...(typeof credential.office_identity==='string'&&
    /^[A-Za-z0-9_-]{1,100}$/.test(credential.office_identity)
    ?{'X-Org-Code':credential.office_identity}:{})
 };
 let successful=0;
 for(const path of DAILY_PATHS){
  try{
   const response=await fetchImpl(DAILY_HOST+path,{
    method:'GET',redirect:'error',headers,
    signal:AbortSignal.timeout(Math.max(1000,Math.min(timeoutMs,10000)))});
   if(response?.ok===true)successful++;
  }catch{}
 }
 return successful>0?{state:'triggered'}:{state:'unavailable'};
}

const normalize=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function parseRaccoonLoginTask(payload){
 if(!payload||payload.code!==0||!Array.isArray(payload.data?.new_user_task_states))
   return {state:'unavailable'};
 const matches=payload.data.new_user_task_states.filter(item=>
   item&&typeof item==='object'&&!Array.isArray(item)&&item.key==='desktop_login');
 if(matches.length!==1)return {state:'unavailable'};
 const status=normalize(matches[0].status);
 if(status==='completed')return {state:'completed'};
 if(PENDING.has(status))return {state:'pending'};
 return {state:'unavailable'};
}
export async function readRaccoonLoginTask({credential,fetchImpl=fetch,
 timeoutMs=9500}={}){
 const token=credential?.access_token;
 if(typeof token!=='string'||token.length<12||token.length>8192||
   /[\\r\\n]/.test(token))return {state:'unavailable'};
 const host='https://xiaohuanxiong.com';
 try{
  const response=await fetchImpl(ENDPOINT,{
   method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token,Accept:'application/json',
    Origin:host,Referer:host+'/work/home',
    'User-Agent':'Raccoon Work/1.0.35 (Windows)',
    'X-Raccoon-Language':'zh',
    ...(typeof credential.office_identity==='string'&&
      /^[A-Za-z0-9_-]{1,100}$/.test(credential.office_identity)
      ?{'X-Org-Code':credential.office_identity}:{})},
   signal:AbortSignal.timeout(Math.min(15000,Math.max(1000,timeoutMs))),
  });
  if(response?.ok!==true)return {state:'unavailable'};
  const text=await response.text();
  if(typeof text!=='string'||text.length>65536)return {state:'unavailable'};
  return parseRaccoonLoginTask(JSON.parse(text));
 }catch{return {state:'unavailable'}}
}
