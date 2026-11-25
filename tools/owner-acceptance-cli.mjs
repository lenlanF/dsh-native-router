// Explicitly authorized headless client for the existing DSH Connection.
// Login link is supplied by the owner via stdin; never discover or persist
// desktop secrets, add an unauthenticated listener, or follow redirects.
import {pathToFileURL} from 'node:url';

const requestIdPattern=/^[a-f0-9]{32}$/;
const providerPattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const states=new Set(['idle','running','complete','cancelled','failed','observed','online','expired','limited','error','pending','client_required','verified','skipped','unavailable','ready','unknown','available','cached','not_returned','not_supported','not_checked','active','not_subscribed','no_cycle','empty']);
const modeSet=new Set(['inventory','catalog','free-models','channel-activity','all-channel-activity','autofree-audit','host-route']);
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000?n:0;
const state=x=>states.has(x)?x:'unknown';
function safeReport(raw){
 if(!raw||typeof raw!=='object')throw Error('Invalid DSH acceptance response');
 const out={state:state(raw.state)};
 if(requestIdPattern.test(raw.requestId??''))out.requestId=raw.requestId;
 if(modeSet.has(raw.mode))out.mode=raw.mode;
 if(providerPattern.test(raw.channel??''))out.channel=raw.channel;
 for(const key of ['startedAt','completedAt'])if(Number.isSafeInteger(raw[key])&&raw[key]>0)out[key]=raw[key];
 if(Number.isSafeInteger(raw.accountCount))out.accountCount=count(raw.accountCount);
 if(Array.isArray(raw.accounts))out.accounts=raw.accounts.slice(0,16).filter(x=>x&&providerPattern.test(x.providerId??'')).map(x=>{
  const item={slot:count(x.slot),providerId:x.providerId,state:state(x.state)};
  if(x.scope==='provider')item.scope='provider';
  if(['MISSING_FINISH','MAX_TOKENS','TOOL_CALLS','NO_TEXT','UNEXPECTED_FINISH'].includes(x.hostPhase))item.hostPhase=x.hostPhase;
  for(const k of ['connection','modelState','balanceState','membershipState','usageState','catalogState'])if(x[k]!==undefined)item[k]=state(x[k]);
  for(const k of ['hasProfile','hasBalance','hasBalanceUnit','hasRollingQuota','hasMembershipQuota','quotaObserved','zcodeStatusObserved','zcodeBalanceObserved','zcodeGiftConfirmed','zcodeGiftRoutable','loomyGiftConfirmed','dailyQuotaObserved'])if(typeof x[k]==='boolean')item[k]=x[k];
  for(const k of ['quotaWindowCount','freeCandidates','advertisedCount','knownRateCount','zeroRateCount','zcodePlanBuckets','zcodeFlashBuckets','zcodePreviewStartPlans'])if(Number.isSafeInteger(x[k]))item[k]=count(x[k]);
  if(typeof x.lowestMultiplier==='number'&&Number.isFinite(x.lowestMultiplier)&&x.lowestMultiplier>=0&&x.lowestMultiplier<=100)item.lowestMultiplier=x.lowestMultiplier;
  if(['CATALOG','DRIVER_PRECHECK','ENTITLEMENT_READ','STREAM_OPEN','STREAM_READ','STREAM_FIRST_EVENT','STREAM_REASONING','STREAM_TEXT','STREAM_FINISH'].includes(x.phase))item.phase=x.phase;
  if(typeof x.code==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(x.code))item.code=x.code;
  return item;
 });
 if(raw.activity&&typeof raw.activity==='object')out.activity=Object.fromEntries(
   ['attempted','confirmedSignins','newlyCreditedRewards','pendingAccounts','failedAccounts','noTaskAccounts','clientRequiredAccounts'].map(k=>[k,count(raw.activity[k])]));
 if(Array.isArray(raw.catalog))out.catalog=raw.catalog.slice(0,32).filter(x=>x&&providerPattern.test(x.providerId??'')).map(x=>({providerId:x.providerId,state:state(x.state),modelCount:count(x.modelCount),freeCount:count(x.freeCount)}));
 if(Number.isSafeInteger(raw.channelCount))out.channelCount=count(raw.channelCount);
 if(Array.isArray(raw.activityChannels))out.activityChannels=raw.activityChannels.slice(0,32)
   .filter(x=>x&&providerPattern.test(x.providerId??'')).map(x=>({
     providerId:x.providerId,state:state(x.state),
     ...Object.fromEntries(['attempted','confirmedSignins','newlyCreditedRewards','pendingAccounts','failedAccounts','noTaskAccounts','clientRequiredAccounts'].map(k=>[k,count(x[k])])),
     ...(typeof x.code==='string'&&/^[A-Z][A-Z0-9_]{0,47}$/.test(x.code)?{code:x.code}:{})}));
 if(raw.autoFree&&typeof raw.autoFree==='object')out.autoFree={state:state(raw.autoFree.state),catalogCount:count(raw.autoFree.catalogCount),routeCount:count(raw.autoFree.routeCount),manualCount:count(raw.autoFree.manualCount),errors:count(raw.autoFree.errors),providers:(Array.isArray(raw.autoFree.providers)?raw.autoFree.providers:[]).slice(0,128).filter(x=>providerPattern.test(x?.providerId??'')).map(x=>({providerId:x.providerId,routeCount:count(x.routeCount),accountCount:count(x.accountCount)}))};
 if(out.autoFree&&Array.isArray(raw.autoFree.issues)&&raw.autoFree.issues.length)out.autoFree.issues=raw.autoFree.issues.filter(x=>providerPattern.test(x?.providerId??'')&&['HOST_CATALOG_UNAVAILABLE','ACCOUNT_CATALOG_UNAVAILABLE','SOURCE_ACCOUNT_SCOPE_UNVERIFIED','SOURCE_CATALOG_UNAVAILABLE','SOURCE_ROSTER_UNAVAILABLE','SCAN_UNAVAILABLE'].includes(x.code)).slice(0,128).map(x=>({providerId:x.providerId,code:x.code,count:count(x.count)}));
 return out;
}
function checkedLoginLink(value){
 if(typeof value!=='string'||value.length>4096)throw Error('A valid official loopback DSH login link is required');
 let url;
 try{url=new URL(value.trim())}catch{throw Error('A valid official loopback DSH login link is required')}
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','[::1]','localhost'].includes(url.hostname)||
   !url.port||url.username||url.password||url.hash||!['/','/connect'].includes(url.pathname)||
   [...url.searchParams.keys()].some(k=>k!=='token')||url.searchParams.getAll('token').length!==1||
   !url.searchParams.get('token'))throw Error('Only an explicit official loopback DSH login link is accepted');
 return url;
}
export async function requestOwnerAcceptance({loginLink,action='status',mode,channel,requestId,
 fetchImpl=fetch,consent=false}={}){
 if(!['status','start','cancel'].includes(action))throw Error('Unsupported acceptance action');
 if(action==='start'&&(!modeSet.has(mode)||consent!==true||
   channel!==undefined&&!providerPattern.test(channel)||
     ['channel-activity','host-route'].includes(mode)&&!channel||['all-channel-activity','autofree-audit'].includes(mode)&&channel!==undefined))throw Error('Explicit mode, consent and required channel are necessary');
 if(action!=='status'&&!requestIdPattern.test(requestId??''))throw Error('Valid request ID required');
 const url=checkedLoginLink(loginLink);
 let login;
 try{login=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(8000)})}
 catch{throw Error('DSH login exchange unavailable')}
 if(![200,302,303].includes(login.status))throw Error('DSH rejected the official login link');
 const cookies=(login.headers.getSetCookie?.()??[]).map(s=>s.split(';',1)[0])
  .filter(s=>/^dsh-auth-[A-Za-z0-9_.-]+=[^;\r\n\x00]+$/.test(s));
 if(cookies.length!==1)throw Error('DSH did not issue a valid owner session');
 const cookie=cookies[0];
 const headers={cookie,...(action==='status'?{}:{'content-type':'application/json'})};
 const request=action==='status'?{method:'GET'}:{method:'POST',body:JSON.stringify(
  action==='start'?{action,requestId,mode,consent:true,...(channel?{channel}:{})}:{action,requestId})};
 let response;
 try{response=await fetchImpl(url.origin+'/api/plugins/dsh-native-router/acceptance',
  {...request,headers,redirect:'manual',signal:AbortSignal.timeout(15000)})}
 catch{throw Error('Acceptance transport unavailable; do not retry with a new request ID')}
 if(![200,202].includes(response.status))throw Error('DSH acceptance refused (HTTP '+response.status+')');
 let data;try{data=await response.json()}catch{throw Error('Invalid DSH acceptance response')}
 if(data?.ok!==true)throw Error('DSH acceptance rejected');
 const result=safeReport(data.result);
 if(action!=='status'&&result.requestId!==requestId)throw Error('Acceptance request identity mismatch');
 return result;
}
async function cli(){
 const args=process.argv.slice(2),action=args[0]??'status';
 const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
 let input='';
 for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw Error('Invalid login link input')}
 const result=await requestOwnerAcceptance({loginLink:input,action,mode:option('--mode'),channel:option('--channel'),
  requestId:option('--request-id'),consent:args.includes('--consent')});
 console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 cli().catch(()=>{console.error('Owner acceptance could not complete; check the official login grant, request ID and mode. No private authentication data is printed.');process.exitCode=1});
}
