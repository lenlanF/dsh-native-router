// Public Qoder SDK catalog contract (Global and CN), no inference.
// https://docs.qoder.com/cli/sdk/references-typescript
// https://docs.qoder.cn/cli/sdk/references-typescript
// The caller must provide a separately owner-authorized PAT, SDK of the
// matching realm, an isolated cwd, and the expected official account subject.
// Never convert browser/job tokens to PATs or silently use a local login.
// Directory facts are informational until the same authorized inference
// route is implemented and verified.
const idPattern=/^[a-zA-Z0-9_.:@-]{1,120}$/;
const rate=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000?v:null;
export const QODER_SDK_REALMS=Object.freeze({
 qoder:'@qoder-ai/qoder-agent-sdk',
 qodercn:'@qodercn-ai/qodercn-agent-sdk'
});
export function normalizeQoderSdkModels(raw){
 if(!Array.isArray(raw)||raw.length>2048)return [];
 const groups=new Map();
 for(const row of raw){
  const id=row?.value;
  if(typeof id!=='string'||!idPattern.test(id)||['auto','default'].includes(id.toLowerCase()))continue;
  if(!groups.has(id))groups.set(id,[]);
  groups.get(id).push(row);
 }
 const models=[];
 for(const [id,peers] of groups){
  const first=peers.find(x=>x.isEnabled===true);
  if(!first)continue;
  const rates=peers.map(x=>rate(x.priceFactor));
  const flags=peers.map(x=>x.isFree);
  const promos=peers.map(x=>x.promotion);
  const promotion=promos.some(x=>x!=null);
  const conflict=peers.some(x=>x.isEnabled!==true)||new Set(rates.filter(x=>x!==null)).size>1||
   flags.includes(true)&&flags.includes(false)||peers.some((x,i)=>x.isFree===true&&rates[i]>0);
  const incomplete=rates.some(x=>x===null);
  const multiplier=!conflict&&!incomplete?rates[0]:null;
  // A promotional zero is a bounded discount, not permanent zero pricing.
  // Require every official row to explicitly mark the model enabled and free,
  // with a numerical zero and no promotion. Do not infer from display names.
  const zeroRateVerified=!conflict&&!incomplete&&!promotion&&multiplier===0&&flags.every(x=>x===true);
  const name=typeof first.displayName==='string'&&first.displayName.trim()&&first.displayName.length<=120&&!/[\u0000-\u001f]/.test(first.displayName)?first.displayName:id;
  models.push({id,name,zeroRateVerified,promotion,
   ...(multiplier!==null?{costMultiplier:multiplier}:{}),
   ...(conflict?{pricingConflict:true}:incomplete?{pricingIncomplete:true}:{})});
  if(models.length>=256)break;
 }
 return models;
}
const empty=state=>({state,models:[]});
const subject=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=256?x:null;
function matchesAccount(account,expected){
 return subject(account?.userId)===expected.userId&&
   (subject(account?.organization)??'')===expected.organization&&
   (account?.apiProvider===undefined||account.apiProvider==='firstParty')&&
   !account?.apiKeySource;
}
export async function readQoderSdkCatalog({realm,sdk,pat,expectedAccount,cwd,signal,timeoutMs=20000}={}){
 if(!Object.hasOwn(QODER_SDK_REALMS,realm)||typeof sdk?.query!=='function'||typeof sdk?.accessToken!=='function'||
  typeof pat!=='string'||!pat.trim()||pat.length>16384||/[\r\n\u0000]/.test(pat)||
  !subject(expectedAccount?.userId)||typeof expectedAccount.organization!=='string'||
  expectedAccount.organization!==''&&!subject(expectedAccount.organization)||
  typeof cwd!=='string'||!cwd||signal?.aborted)return empty('unavailable');
 const controller=new AbortController();
 const cancel=()=>controller.abort();
 const timeout=setTimeout(cancel,Math.max(100,Math.min(60000,Number.isFinite(timeoutMs)?timeoutMs:20000)));
 const waitAbort=new Promise(resolve=>controller.signal.addEventListener('abort',()=>resolve(empty('unavailable')),{once:true}));
 signal?.addEventListener('abort',cancel,{once:true});
 let finishInput;
 // The async input is held open until cleanup, and NEVER yields a user message.
 // No model prompt, no tools, no local settings, no retained session.
 const inputDone=new Promise(resolve=>{finishInput=resolve});
 async function* noMessages(){await inputDone}
 try{
  const task=(async()=>{
   const q=sdk.query({prompt:noMessages(),options:{auth:sdk.accessToken(pat),cwd,
    abortController:controller,settingSources:[],persistSession:false,tools:[],
    allowedTools:[],skills:[],strictMcpConfig:true,mcpServers:{},stderr:()=>{}}});
   if(typeof q?.initializationResult!=='function'||typeof q.accountInfo!=='function'||
      typeof q.getAvailableModels!=='function')return empty('unavailable');
   await q.initializationResult();
   if(controller.signal.aborted||!matchesAccount(await q.accountInfo(),expectedAccount))return empty('identity_unconfirmed');
   if(controller.signal.aborted)return empty('unavailable');
   const rows=await q.getAvailableModels({fetchStrategy:'live'});
   if(controller.signal.aborted||!matchesAccount(await q.accountInfo(),expectedAccount))return empty('identity_unconfirmed');
   const models=normalizeQoderSdkModels(rows);
   return models.length?{state:'ready',realm,models}:empty('unavailable');
  })().catch(()=>empty('unavailable'));
  return await Promise.race([task,waitAbort]);
 }finally{
  clearTimeout(timeout);signal?.removeEventListener('abort',cancel);cancel();finishInput();
 }
}
