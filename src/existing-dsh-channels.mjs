import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';

/**
 * DSH-host provider reuse; does not install source pack, copy credentials or
 * change the other Cordis plugin's AccountPool / provider lifecycle.
 * Only registered native channels with a unique enabled source account qualify.
 */
const IDs=new Set(SOURCE_PACK_PROVIDERS);
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=100&&!/[\u0000-\u001f]/.test(x);
const safeModel=x=>typeof x==='string'&&!!x.trim()&&x.length<=160&&!/[\u0000-\u001f]/.test(x);
function providerName(row){return typeof row==='string'?row:row?.id??row?.provider}
export function createExistingDshChannelFacade({ctx,excludedHost,timeoutMs=15000}={}){
 let disposed=false;
 // Provider discovery is deliberately separate from authenticated account discovery.
 // DSH plugins such as dsh-connect-workbuddy own their own login/session pool
 // and register workbuddy + workbuddy-global without an AccountPool service.
 function hostProviders(){
  const llm=ctx?.llm??ctx?.get?.('llm',false);
  if(disposed||typeof llm?.listProviders!=='function')return [];
  try{
   const registered=llm.listProviders();
   if(!Array.isArray(registered))return [];
   return [...new Set(registered.map(providerName).filter(safeId)
     .filter(id=>id!=='native-router'&&!id.startsWith('native-router-source-')))].slice(0,80).map(providerId=>({
       providerId,
       family:providerId==='workbuddy'||providerId==='workbuddy-global'
         ?'workbuddy-native-plugin-route':IDs.has(providerId)?'native-channel-route':'dsh-provider-route',
        accountAccess:providerId==='workbuddy'||providerId==='workbuddy-global'
          ?'plugin-managed-or-unknown':IDs.has(providerId)?'pool-required':'plugin-managed-or-unknown',
       loginVerified:false,
     }));
  }catch{return []}
 }
 function locate(){
   if(disposed)return null; // The owned pack uses a distinct accountPool; read-only legacy inventory may coexist.
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
   hostProviders:hostProviders(),experimentalMultiAccountProviders:[],
  }:{state:disposed?'disposed':'unavailable',borrowedExistingDsh:false,
   channels:[],hostProviders:hostProviders(),experimentalMultiAccountProviders:[]};
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
 // Host plugins may own independent login/session stores (e.g. WorkBuddy).
 // Query original DSH model directories only after an owner requests it.
  // Migration inventory: never include credential references in public JSON.
 async function portableAccounts(){
  const services=locate();
  if(!services)return {state:'unavailable',accounts:[]};
  try{
   const rows=await roster(services),accounts=[];
   for(const row of rows){
    if(accounts.length>=100)break;
    if(!row||!services.providers.has(row.provider)||!safeId(row.id)||row.enabled!==true
      ||rows.filter(other=>other?.id===row.id).length!==1)continue;
    accounts.push({providerId:row.provider,accountId:row.id,
     label:typeof row.nickname==='string'?row.nickname.slice(0,64):row.id,
     portable:typeof row.credentialRef==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.credentialRef)});
   }
   return {state:'ready',accounts};
  }catch{return {state:'unavailable',accounts:[]}}
 }
 // PRIVATE metadata: never pass this result through the Connection response.
 async function portableCredentialSource(providerId,sourceAccountId){
  if(!IDs.has(providerId)||!safeId(sourceAccountId))return null;
  const services=active(providerId);
  if(!services)return null;
  const rows=await roster(services);
  const matching=rows.filter(row=>row?.provider===providerId&&row?.id===sourceAccountId
   &&row.enabled===true&&typeof row.credentialRef==='string'
   &&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.credentialRef));
  if(matching.length!==1||rows.filter(row=>row?.id===sourceAccountId).length!==1)return null;
  const row=matching[0];
  return {providerId,sourceAccountId,credentialRef:row.credentialRef,
   nickname:typeof row.nickname==='string'?row.nickname.slice(0,64):sourceAccountId,
   refreshable:row.refreshable===true};
 }
async function listHostModels(providerId){
  const llm=ctx?.llm??ctx?.get?.('llm',false);
  if(disposed||!safeId(providerId)||providerId==='native-router'
    ||!hostProviders().some(p=>p.providerId===providerId)
    ||typeof llm?.listModels!=='function')
    return {state:'unavailable',providerId,models:[]};
  let timer;
  try{
   const timeout=Symbol('timeout');
   const rows=await Promise.race([
    Promise.resolve().then(()=>llm.listModels(providerId)),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),Math.min(timeoutMs,10000));timer.unref?.()}),
   ]);
   if(rows===timeout||!Array.isArray(rows)||disposed
     ||!hostProviders().some(p=>p.providerId===providerId))
    return {state:'unavailable',providerId,models:[]};
   const models=[],seen=new Set();
   for(const row of rows){
    if(models.length>=500)break;
    if(row?.provider&&row.provider!==providerId)continue;
    const id=typeof row==='string'?row:row?.id;
    if(typeof id!=='string'||!id.trim()||id.length>160||/[\u0000-\u001f]/.test(id)||seen.has(id))continue;
    seen.add(id);models.push({id,name:typeof row?.name==='string'?row.name.slice(0,120):id,
     ...(row?.isFree===true||row?.free===true?{isFree:true}:{}),
     ...(row?.pricing&&typeof row.pricing==='object'
        &&['number','string'].includes(typeof row.pricing.input)
        &&['number','string'].includes(typeof row.pricing.output)
        ?{pricing:{input:row.pricing.input,output:row.pricing.output}}:{})});
   }
   return {state:'ready',providerId,models,loginVerified:false};
  }catch{return {state:'unavailable',providerId,models:[]}}
  finally{clearTimeout(timer)}
 }
 // Delegate only to the original DSH provider. Its plugin retains login,
 // account selection and credential storage; native-router never reads tokens.
 async function streamHost({providerId,model,messages,tools,signal,maxTokens}={}){
  const llm=ctx?.llm??ctx?.get?.('llm',false);
  if(disposed||!safeId(providerId)||providerId==='native-router'||!safeModel(model)
    ||!Array.isArray(messages)||!messages.length||signal?.aborted
    ||typeof llm?.stream!=='function'||!hostProviders().some(p=>p.providerId===providerId))
   throw Error('Original DSH provider is unavailable');
  const request={provider:providerId,model,messages,tools:Array.isArray(tools)?tools:[],signal,
   ...(Number.isInteger(maxTokens)&&maxTokens>0?{maxTokens}:{})};
  return (async function*(){
   if(disposed||signal?.aborted||!hostProviders().some(p=>p.providerId===providerId))
    throw Error('Original DSH provider changed before request');
   const started=llm.stream(request);
   if(!started||typeof started[Symbol.asyncIterator]!=='function')
    throw Error('Original DSH provider did not return a stream');
   for await(const event of started){
    if(disposed||signal?.aborted||!hostProviders().some(p=>p.providerId===providerId))
     throw Error('Original DSH provider unloaded during request');
    yield event;
   }
  })();
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
  return {status,listAccounts,listModels,listHostModels,portableAccounts,portableCredentialSource,streamHost,streamNative,dispose};
}
/**
 * A provider is not a credential identity. Merge only the SAME provider and
 * SAME opaque source account id. Keep both original and private login paths,
 * and retry the other path only before any stream event is emitted.
 * Never copy credentials, toggle an original plugin or infer identities from nicknames.
 */
export function createPreferredSourceFacade({own,existing}={}){
  let healthFor=()=>null;
  const confidence=state=>state==='online'?100:
    state==='recently_verified'?40:state==='expired'||state==='disabled'?-50:0;
  const mounted=facade=>facade?.status?.().state==='mounted';
  const candidates=()=>[['owned',own],['reused',existing]].filter(([,item])=>mounted(item));
  const accountKey=row=>row.providerId+'\u0000'+row.id;
  const accountValid=row=>row&&typeof row.providerId==='string'&&row.providerId
    &&typeof row.id==='string'&&row.id&&row.enabled===true;
  async function inventory(){
    const active=candidates();
    const results=await Promise.all(active.map(async ([kind,facade])=>{
      try{return {kind,facade,result:await facade.listAccounts()}}
      catch{return {kind,facade,result:{state:'unavailable',accounts:[]}}}
    }));
    return results.filter(row=>row.result?.state==='ready'
      &&Array.isArray(row.result.accounts));
  }
  return {
    setHealthResolver:resolve=>{healthFor=typeof resolve==='function'?resolve:()=>null;},
    status:()=>{
      const primary=mounted(own)?own:mounted(existing)?existing:own??existing;
      return {...(primary?.status?.()??{state:'unavailable'}),
        hostProviders:existing?.status?.().hostProviders??[]};
    },
    async listAccounts(){
      const sources=await inventory(),grouped=new Map();
      for(const {kind,result} of sources){
        for(const row of result.accounts.slice(0,200)){
          if(!accountValid(row))continue;
          const key=accountKey(row);
          if(!grouped.has(key))grouped.set(key,{...row,sources:[]});
          const previous=grouped.get(key);
          if(!previous.nickname&&row.nickname)previous.nickname=row.nickname;
          if(!previous.sources.includes(kind))previous.sources.push(kind);
        }
      }
      return {state:sources.length?'ready':'unavailable',
        accounts:[...grouped.values()].slice(0,200)};
    },
    async listModels(providerId){
      const active=candidates(),models=[],seen=new Set();
      let ready=false;
      for(const [,facade] of active){
        let result;
        try{result=await facade.listModels?.(providerId)}catch{continue}
        if(result?.state!=='ready'||!Array.isArray(result.models))continue;
        ready=true;
        for(const model of result.models){
          const id=typeof model==='string'?model:model?.id;
          if(typeof id!=='string'||!id.trim()||seen.has(id))continue;
          seen.add(id);
          models.push(typeof model==='string'?{id,name:id}:model);
          if(models.length===256)break;
        }
      }
      return {state:ready?'ready':'unavailable',providerId,models};
    },
    async streamNative(request){
      const {providerId,sourceAccountId,signal}=request??{};
      if(typeof providerId!=='string'||!providerId||typeof sourceAccountId!=='string'
        ||!sourceAccountId||signal?.aborted)
        throw Error('Source account identity is required');
      const rows=await inventory(),active=[];
      for(const row of rows){
        const matching=row.result.accounts.filter(account=>
          accountValid(account)&&account.providerId===providerId&&account.id===sourceAccountId);
        if(matching.length!==1)continue;
        active.push(row);
      }
       if(!active.length)throw Error('Requested source account not present in available login sources');
       active.sort((a,b)=>{
         const read=row=>{try{return confidence(healthFor({kind:row.kind,providerId,sourceAccountId}))}
           catch{return 0}};
         return read(b)-read(a);
       });      return (async function*(){
        let lastError;
        for(let i=0;i<active.length;i++){
          if(signal?.aborted)throw Error('Source request cancelled');
          let emitted=false;
          try{
            const stream=await active[i].facade.streamNative(request);
            if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
              throw Error('Source stream unavailable');
            for await(const event of stream){
              emitted=true;
              yield event;
            }
            return;
          }catch(error){
            lastError=error;
            // A partial output can contain a tool call; replay could duplicate side effects.
            if(emitted||signal?.aborted||i===active.length-1)throw error;
          }
        }
        throw lastError??Error('All identical-account source paths unavailable');
      })();
    },
  };
}