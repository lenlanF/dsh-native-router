import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';

/**
 * DSH-host provider reuse; does not install source pack, copy credentials or
 * change the other Cordis plugin's AccountPool / provider lifecycle.
 * Only registered native channels with a unique enabled source account qualify.
 */
const IDs=new Set(SOURCE_PACK_PROVIDERS);
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=100&&!/[\u0000-\u001f]/.test(x);
function providerName(row){return typeof row==='string'?row:row?.id??row?.provider}
export function createExistingDshChannelFacade({ctx,excludedHost,timeoutMs=15000}={}){
 let disposed=false;
 function locate(){
   if(disposed||['mounted','loading','waiting_host_services'].includes(excludedHost?.status?.().state))return null;
  const pool=ctx?.get?.('accountPool',false),llm=ctx?.llm??ctx?.get?.('llm',false);
  if(typeof pool?.listAllAccounts!=='function'
    ||typeof pool?.getAvailableAccount!=='function'
    ||typeof llm?.listProviders!=='function'||typeof llm?.stream!=='function')return null;
  let providers;
  try{providers=llm.listProviders()}catch{return null}
  if(!Array.isArray(providers))return null;
  const ids=providers.map(providerName).filter(p=>IDs.has(p));
  if(!ids.length)return null;
  return {pool,llm,providers:new Set(ids)};
 }
 const active=(providerId)=>{
  const services=locate();
  return services&&services.providers.has(providerId)?services:null;
 };
 const status=()=>{
  const services=locate();
  return services?{
   state:'mounted',hostOwned:false,borrowedExistingDsh:true,
   channels:[...services.providers],channelCount:services.providers.size,
   experimentalMultiAccountProviders:[],
  }:{state:disposed?'disposed':'unavailable',borrowedExistingDsh:false,
   channels:[],experimentalMultiAccountProviders:[]};
 };
 async function roster(services){
  const rows=await services.pool.listAllAccounts();
  if(!Array.isArray(rows))throw Error('Existing DSH source roster is malformed');
  if(disposed||locate()?.pool!==services.pool)throw Error('Existing DSH account pool changed');
  return rows;
 }
 async function listAccounts(){
  const services=locate();
  if(!services)return {state:'unavailable',accounts:[]};
  try{
   const rows=await roster(services),accounts=[];
   for(const row of rows){
    if(accounts.length>=200)break;
    if(!row||!services.providers.has(row.provider)||!safeId(row.id))continue;
    accounts.push({
      id:row.id,providerId:row.provider,enabled:row.enabled===true,
      nickname:typeof row.nickname==='string'?row.nickname.slice(0,80):'',
      refreshable:row.refreshable===true,connectionState:'not_checked',
    });
   }
   return {state:'ready',accounts};
  }catch{return {state:'unavailable',accounts:[]}}
 }
 async function listModels(providerId){
  const services=active(providerId);
  if(!services||typeof services.llm.listModels!=='function')
   return {state:'unavailable',providerId,models:[]};
  let timer;
  try{
   const timeout=Symbol('timeout');
   const rows=await Promise.race([
    Promise.resolve().then(()=>services.llm.listModels(providerId)),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),timeoutMs);timer.unref?.()}),
   ]);
   if(rows===timeout||!Array.isArray(rows)||active(providerId)?.pool!==services.pool)
    return {state:'unavailable',providerId,models:[]};
   const models=[],seen=new Set();
   for(const row of rows){
    if(models.length>=256)break;
    if(row?.provider&&row.provider!==providerId)continue;
    const id=typeof row==='string'?row:row?.id;
    if(!safeId(id)||id.length>160||seen.has(id))continue;
    seen.add(id);models.push({id,name:typeof row?.name==='string'?row.name:id});
   }
   return {state:'ready',providerId,models};
  }catch{return {state:'unavailable',providerId,models:[]}}
  finally{clearTimeout(timer)}
 }
 async function streamNative({providerId,sourceAccountId,model,messages,tools,signal,maxTokens}={}){
  const services=active(providerId);
  if(!services||!safeId(sourceAccountId)||!safeId(model)||!Array.isArray(messages)
    ||!messages.length||signal?.aborted)throw Error('Existing DSH source is not ready');
  // Do not borrow a provider if the selected source account is ambiguous,
  // disabled or another plugin's provider selection can choose a different
  // login. Selection is verified against ORIGINAL AccountPool before the call.
  const rows=await roster(services);
  const matching=rows.filter(row=>row?.provider===providerId);
  const enabled=matching.filter(row=>row.enabled===true);
  if(enabled.length!==1||enabled[0].id!==sourceAccountId
   ||rows.filter(row=>row?.id===sourceAccountId).length!==1)
   throw Error('Existing DSH multi-account selection has not been verified');
  const chosen=await services.pool.getAvailableAccount(providerId,model);
  if(chosen?.entry?.id!==sourceAccountId||active(providerId)?.pool!==services.pool||signal?.aborted)
   throw Error('Existing DSH source did not select requested logged-in account');
  const request={provider:providerId,model,messages,tools:Array.isArray(tools)?tools:[],signal,
   ...(Number.isInteger(maxTokens)&&maxTokens>0?{maxTokens}:{})};
   return (async function*(){
    if(disposed||signal?.aborted||active(providerId)?.pool!==services.pool)
     throw Error('Existing DSH source unmounted before stream');
    // Other installed DSH plugins can change their login in parallel.
    // Re-read that ORIGINAL pool immediately before the stream is created.
    const current=await roster(services);
    const currentEnabled=current.filter(row=>row?.provider===providerId&&row.enabled===true);
    if(currentEnabled.length!==1||currentEnabled[0]?.id!==sourceAccountId
       ||current.filter(row=>row?.id===sourceAccountId).length!==1)
     throw Error('Existing DSH source login changed before request; refusing stale credentials');
    if(disposed||signal?.aborted||active(providerId)?.pool!==services.pool)
     throw Error('Existing DSH source unmounted before stream');
    const started=services.llm.stream(request);
   if(!started||typeof started[Symbol.asyncIterator]!=='function')
    throw Error('Existing DSH provider stream is unavailable');
   for await(const event of started){
    if(disposed||signal?.aborted||active(providerId)?.pool!==services.pool)
     throw Error('Existing DSH provider unloaded during stream');
    yield event;
   }
  })();
 }
 function dispose(){disposed=true}
 return {status,listAccounts,listModels,streamNative,dispose};
}
/**
 * Existing DSH channels have priority when registered in the Host; in-process
 * own source pack is used only when no active Host-owned source was available.
 * The caller never registers or replaces any original provider/accountPool.
 */
export function createPreferredSourceFacade({own,existing}={}){
 const choose=()=>own?.status?.().state==='mounted'?own:
   existing?.status?.().state==='mounted'?existing:own;
 return {
  status:()=>choose()?.status?.()??{state:'unavailable'},
  listAccounts:(...args)=>choose()?.listAccounts?.(...args)??Promise.resolve({state:'unavailable',accounts:[]}),
  listModels:(...args)=>choose()?.listModels?.(...args)??Promise.resolve({state:'unavailable',models:[]}),
  streamNative:(...args)=>choose()?.streamNative?.(...args)??Promise.reject(Error('DSH source unavailable')),
 };
}
