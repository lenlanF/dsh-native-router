import {channelPackIsolationReason,channelPackNodeRuntimeReason} from './channel-pack-isolation.mjs';
import {UpstreamError} from './failure.mjs';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {publicAccountName,upstreamCheckedInToday,credentialPublicIdentity,publicMaskedPhone} from './account-facts.mjs';
import {sourceAccountFacts} from './source-account-facts.mjs';
import {readZcodePublicProfile} from './channels/zcode-profile.mjs';
import {installSourceAccountSelection} from './source-account-selection.mjs';
import {ownCredentialRef} from './credential-ref.mjs';
import {startRaccoonAuthorizeFlow} from './channels/raccoon-authorize.mjs';
import {readRaccoonLoginTask,triggerRaccoonFreeDaily} from './channels/raccoon-rewards.mjs';
import {readLoomyFreeTasks,claimLoomyFreeTasks,loomyDailyQuota,loomyDailyReceipt,loomyDailyConfirmation} from './channels/loomy-rewards.mjs';// The bundled MIT derivative runs INSIDE the DSH Cordis host. No external
// OpenAI gateway, agent-resume daemon or independent check-in scheduler.
export const SOURCE_PACK_PROVIDERS=Object.freeze([
  'codearts','buddy','workbuddy','lobsterai','qoder','qodercn','trae',
  'cline','loomy','raccoon','minimax','zcode','gemini',
]);
export const SOURCE_DAILY_SIGNIN_PROVIDERS=Object.freeze([
  'codearts','buddy','lobsterai','qoder','qodercn','trae','loomy','raccoon','minimax','zcode',
]);
// Excluded: WorkBuddy/Cline/Gemini lack a verified daily source claim.
// Raccoon is eligible: its server credits +daily_grant after free web GETs,
// while its once-per-account login POST must use a durable owner receipt.
// The runtime is prebundled into one self-contained ESM file. The DSH plugin
// manager does not preserve nested node_modules from npm bundleDependencies.
const loadPinnedPack=()=>import('../vendor/channel-pack/pack-runtime.mjs');
const OFF=new Set(['0','off','false','no']);
const disabled=(env,key)=>OFF.has(String(env[key]??'').trim().toLowerCase());
function safetyReason(env){
 if(env.DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE!=='1')
   return '隔离挂载须显式设置 DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE=1';
 if(!disabled(env,'DSH_OPENAI_GATEWAY_ENABLED'))
   return '须设置 DSH_OPENAI_GATEWAY_ENABLED=0，禁止上游启动 8326 网关';
 // The upstream pack enables its own agent/error loop-resume by DEFAULT.
 // It must not compete with this plugin's or the installed failover listener.
 if(!disabled(env,'DSH_REASONING_LOOP_AUTO_RESUME'))
   return '须设置 DSH_REASONING_LOOP_AUTO_RESUME=0，禁止上游默认启用第二套 Agent 自动续跑';
 return '';
}
export function createEmbeddedChannelPack({ctx,getConfig,env=process.env,
 loadPack=loadPinnedPack,modelTimeoutMs=20000,
 raccoonTaskVerifier=null,raccoonDailyTrigger=null,raccoonFetchImpl=fetch,
 loomyFetchImpl=fetch}={}){
  const raccoonLoginFlows=new Set();
  let state='disabled',reason='',errorStage='',errorKind='',disposed=false,activeScope=null,injectedCallback=null;
   let privateSourcePool=null,privateSourceCheckins=null,privateSourceCatalog=null,loadedPack=null;
    let sourcePhase='',modelAdapterStates={},privateSourceRpcReady=false;
    let modelEligibility=()=>false;
   let sourceErrorType='',sourceErrorLocation='';
   let skippedProviders=new Set();
   // The bundled derivative owns a dedicated Cordis service and never binds to
   // any already-installed plugin's accountPool. Test injected packs keep the
   // strict legacy accountPool gate to avoid touching unknown implementations.
   const sourcePoolService=loadPack===loadPinnedPack?'nativeRouterSourceAccountPool':'accountPool';
   const sourcePool=scope=>nativeOwned?(activeScope===scope?privateSourcePool:null):scope?.get?.(sourcePoolService,false);
   // DSH-native source routes are separate from the original host Provider.
   // Every channel remains eligible for its own login even when the host
   // plugin already registered a public provider with the same name.
   const nativeOwned=loadPack===loadPinnedPack;
   const sourceAllowed=id=>SOURCE_PACK_PROVIDERS.includes(id)
      &&(nativeOwned||!skippedProviders.has(id));
   const sourceAdapter=id=>nativeOwned?'native-router-source-'+id:id;
  // Exact-account native-router ownership is already an explicit user choice:
  // the bundled pack receives its OWN private account pool. Guard all sources
  // with request-local AsyncLocalStorage and deny any source that cannot prove
  // it consumed exactly the requested credential. No second process or env flag.
  // Test-injected ORIGINAL packs retain their opt-in isolation fence.
  const MULTIACCOUNT_REVIEWED=Object.freeze([...SOURCE_PACK_PROVIDERS]);
  const multiAccountOptIn=loadPack===loadPinnedPack
    ||(env.DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT==='1'
      &&loadPack!==loadPinnedPack);
  let selectionGuard=null;
  const providerStreams=new Set();
  function status(){return {state,reason,errorStage,errorKind,sourcePhase,
     sourceErrorType,sourceErrorLocation,
     rpcReady:state==='mounted'&&privateSourceRpcReady,
     modelAdapterReady:SOURCE_PACK_PROVIDERS.filter(id=>modelAdapterStates[id]==='ready'),     // Publish ownership of actual private registrations, not all supported source names.
     ownedProviderIds:state==='mounted'?SOURCE_PACK_PROVIDERS.filter(id=>nativeOwned?modelAdapterStates[id]==='ready':sourceAllowed(id)).map(sourceAdapter):[],

     modelAdapterUnready:SOURCE_PACK_PROVIDERS.filter(id=>modelAdapterStates[id]&&modelAdapterStates[id]!=='ready'),
     modelAdapterUnreadyReasons:Object.fromEntries(Object.entries(modelAdapterStates)
       .filter(([id,value])=>SOURCE_PACK_PROVIDERS.includes(id)&&value!=='ready')),
     supportedChannelCount:SOURCE_PACK_PROVIDERS.length,
     channelCount:state==='mounted'&&privateSourceRpcReady?SOURCE_PACK_PROVIDERS.filter(id=>sourceAllowed(id)).length:0,
     channels:state==='mounted'&&privateSourceRpcReady?SOURCE_PACK_PROVIDERS.filter(id=>sourceAllowed(id)):[],
     skippedProviders:[...skippedProviders],independentLogin:nativeOwned,
     experimentalMultiAccountProviders:selectionGuard&&multiAccountOptIn?MULTIACCOUNT_REVIEWED:[],
     exactAccountGate:selectionGuard?'ready':multiAccountOptIn?'unavailable':'disabled'}} function attach(){
  if(disposed||['waiting_host_services','loading','mounted'].includes(state))return status();
  if(getConfig()?.embeddedPack?.enabled!==true){state='disabled';reason='';return status()}
   // The bundled native derivative never starts an extra gateway, loop-resume
   // listener or source check-in scheduler, so it requires no environment flags.
   // Keep the old strict E:\Temp safety fence for test-injected replacement packs.
   const denied=loadPack===loadPinnedPack?channelPackNodeRuntimeReason()
     :safetyReason(env)||channelPackIsolationReason(env);
   if(denied){state='blocked';reason=denied;return status()}
  if(typeof ctx?.inject!=='function'){state='blocked';reason='当前 DSH 宿主不支持按需服务注入';return status()}
  state='waiting_host_services';reason='';errorStage='';errorKind='';
  sourcePhase='';modelAdapterStates={};privateSourceRpcReady=false;
  sourceErrorType='';sourceErrorLocation='';
  try{
    const onInjected=scope=>{
    let phase='service_injection';
    if(disposed)return;
     const profileDenied=loadPack===loadPinnedPack?'':channelPackIsolationReason(env,scope);
     if(profileDenied){state='blocked';reason=profileDenied;return}
       if(sourcePool(scope)){
        state='blocked';reason='本渠道授权服务已存在，拒绝覆盖其他账号池';return;
       }
    state='loading';phase='host_provider_inventory';
      scope.effect?.(()=>()=>{
       selectionGuard?.restore();selectionGuard=null;
        activeScope=null;privateSourcePool=null;privateSourceCheckins=null;privateSourceCatalog=null;loadedPack=null;       sourcePhase='';modelAdapterStates={};privateSourceRpcReady=false;
       if(!disposed&&state!=='failed'){state='host_disposed';reason='上游渠道包所属 Host 作用域已释放'}
      });
     void Promise.resolve().then(async()=>{
      // The source bundle silently tolerates duplicate llm adapters and
      // may otherwise report "mounted" while owning only some providers.
      // Refuse any overlapping source provider before importing the bundle.
      const llm=scope.llm??scope.get?.('llm');
      if(typeof llm?.listProviders!=='function'){
       if(loadPack===loadPinnedPack){
        state='blocked';reason='宿主缺少 llm.listProviders，无法排除渠道注册冲突';return null;
       }
      }else{
       const registered=await llm.listProviders();
       if(!Array.isArray(registered)){
        state='blocked';reason='宿主 Provider 目录格式不正确，拒绝重复注册';return null;
       }
       const ids=registered.map(row=>typeof row==='string'?row:row?.id??row?.provider)
        .filter(id=>typeof id==='string');
       if(ids.length!==registered.length){
        state='blocked';reason='宿主 Provider 信息不完整，拒绝覆盖现有渠道';return null;
       }
        const duplicate=ids.find(id=>SOURCE_PACK_PROVIDERS.includes(id));
        if(duplicate){
         if(loadPack!==loadPinnedPack){
          state='blocked';reason='宿主已注册 '+duplicate+' 渠道，拒绝未经验证的来源包重复接管';return null;
         }
         // Bundled derivative skips existing providers at the registration boundary;
         // keep independent login for remaining non-conflicting channels.
         skippedProviders=new Set(ids.filter(id=>SOURCE_PACK_PROVIDERS.includes(id)));
        }
      }
      if(disposed||state==='host_disposed')return null;
      phase='import_standalone_runtime';
      return loadPack();
     }).then(pack=>{
      if(pack===null)return;
     if(disposed||state==='host_disposed')return;
     if(scope.fiber?.uid===null){state='host_disposed';reason='上游渠道包 Host 作用域已停止';return}
     if(typeof pack?.apply!=='function')throw Error('上游渠道包缺少 apply 入口');
     loadedPack=pack;
       if(sourcePool(scope))throw Error('目标渠道账号池已注册，拒绝覆盖');
       // Recheck test-injected packs just before apply; the DSH-native bundle
       // uses an isolated private state namespace with no auxiliary listener.
       const changed=loadPack===loadPinnedPack?'':safetyReason(env)||channelPackIsolationReason(env,scope);
       if(changed){state='blocked';reason=changed;return}
       phase='register_owned_adapter';
       // Keep our own pool strictly scoped to this injected Host scope.
       // Do NOT register arbitrary extra services in the global DSH registry.
       const options={disableOpencode:true};
        options.nativeRouterRaccoonLogin=async()=>{
          if(disposed||scope!==mountedScope())throw Error('Raccoon authorization unavailable');
          const flow=await startRaccoonAuthorizeFlow();
          if(disposed){flow.close();throw Error('Raccoon authorization stopped')}
          raccoonLoginFlows.add(flow);
          void flow.result.finally(()=>raccoonLoginFlows.delete(flow)).catch(()=>{});
          return flow;
        };
        if(nativeOwned){
          options.nativeRouterModelEligibility=id=>modelEligibility(id);
         options.nativeRouterRpcReady=ready=>{
           privateSourceRpcReady=ready===true;
         };
         options.nativeRouterPhase=value=>{
           if(['account_pool','model_adapters','rpc_routes','complete'].includes(value))
             sourcePhase=value;
         };
         options.nativeRouterModelReady=value=>{
           if(!value||typeof value!=='object'||Array.isArray(value))return;
           const allowed=new Set(['ready','disposed','alias_occupied','llm_unavailable',
             'adapter_incompatible','adapter_registration_failed']);
           modelAdapterStates=Object.fromEntries(
             Object.entries(value).filter(([id,status])=>
               SOURCE_PACK_PROVIDERS.includes(id)&&allowed.has(status)));
         };
       }
        // DSH model listing may strip upstream-specific signed rates.
        // Keep a private, read-only direct CodeArts adapter accessor.
        options.nativeRouterSourceCatalogReady=catalog=>{
          if(!catalog||typeof catalog.codearts!=='function')
            throw Error('Private CodeArts catalog accessor unavailable');
          privateSourceCatalog={codearts:catalog.codearts,
            codeartsOneShot:typeof catalog.codeartsOneShot==='function'?catalog.codeartsOneShot:null,
            codeartsProfile:typeof catalog.codeartsProfile==='function'?catalog.codeartsProfile:null};
        };
        if(nativeOwned){         options.nativeRouterPoolReady=pool=>{
           if(typeof pool?.listAllAccounts!=='function'||typeof pool?.getAvailableAccount!=='function')
             throw Error('Native source pool contract unavailable');
           privateSourcePool=pool;
         };
         options.nativeRouterCheckinsReady=ops=>{
           if(typeof ops?.status!=='function'||typeof ops?.claim!=='function')
             throw Error('Native source check-in contract unavailable');
           privateSourceCheckins=ops;
         };
       }
       pack.apply(scope,options);
       activeScope=scope;
       if(nativeOwned&&!privateSourcePool)
         throw Error('Native source account pool did not reach ready state');
       // Scoped overlays affect only request-local AsyncLocalStorage contexts;
       // unscoped source and other host consumers retain the original methods.
       phase='pin_independent_accounts';
       if(multiAccountOptIn){
          const pool=sourcePool(scope);
         const credentials=scope.credentials??scope.get?.('credentials');
         try{selectionGuard=installSourceAccountSelection({pool,credentials,
           isAlive:()=>!disposed&&state==='mounted'&&activeScope===scope})}
         catch{selectionGuard=null;ctx.logger?.warn?.('native-router: exact-account DSH credential isolation unavailable; multiaccount disabled safely')}
       }
       state='mounted';reason='';errorStage='';errorKind='';
       if(nativeOwned&&SOURCE_PACK_PROVIDERS.every(id=>modelAdapterStates[id]!=='ready'))
         reason='自主登录服务已加载，但模型适配器全部不可用；可以先管理授权，模型推理暂不可使用';
    }).catch(error=>{
     if(disposed||state==='host_disposed')return;
     // Partial registration must not poison the next plugin reload.
     try{loadedPack?.rollbackNativeRouterSourceAdapters?.(scope)}catch{}
     privateSourcePool=null;privateSourceCheckins=null;privateSourceCatalog=null;privateSourceRpcReady=false;
     state='failed';errorStage=phase;
     const code=String(error?.code??'');
     const message=String(error?.message??'').slice(0,300);
     const type=String(error?.name??'');
     sourceErrorType=['TypeError','RangeError','ReferenceError','SyntaxError',
       'Error','AggregateError'].includes(type)?type:'Error';
     // Only a validated file basename and location; never expose user paths,
     // upstream messages, access tokens, account names or credential values.
     const stack=String(error?.stack??'');
     const location=stack.match(/(?:^|[\\/])(pack-runtime|embedded-pack)\.mjs:(\d{1,6}):(\d{1,4})/m);
     sourceErrorLocation=location?location[1]+':'+location[2]+':'+location[3]:'unknown';
     errorKind=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(code)?'missing_module':
       code==='DUPLICATE_ADAPTER'||/already registered|duplicate|already occupied|adapter alias/i.test(message)
         ?'model_adapter_collision':
       /registerAdapter|listProviders|providerInfo/i.test(message)?'llm_adapter_api_incompatible':
       /cannot provide|service .*registered|cannot set property|multiple fibers/i.test(message)
         ?'host_service_collision':
       /credential|inject|provide|service/i.test(message)?'missing_host_service':'runtime_incompatible';
     reason=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error?.code)
       ?'内置渠道包运行依赖缺失；请重新安装含完整依赖的插件发行包'
       :errorKind==='model_adapter_collision'
       ?'检测到自有模型路由残留或同名注册冲突：请完全重启 DSH Host；新版卸载会随 Cordis 作用域自动释放路由。原插件不受影响。'
       :errorKind==='host_service_collision'
       ?'检测到与宿主已有服务注册冲突，内置来源注册已回滚，不影响原插件。'
       :errorKind==='llm_adapter_api_incompatible'
       ?'DSH LLM 适配器接口不兼容，来源加载已停止，原模型路由未被替换。'
       :errorKind==='missing_host_service'
       ?'未获取到来源包所需宿主服务；已阻止继续注册，原账号不变。'
       :'内置渠道包注册失败，已撤销本轮新增的自有模型路由；详情以安全阶段码为准。';
     ctx.logger?.warn?.('dsh-native-router: source registration failed stage='+errorStage+
       ' phase='+sourcePhase+' category='+errorKind+' type='+sourceErrorType+
       ' location='+sourceErrorLocation+' (no credentials logged)');
     // A partially applied source may have registered effects/services before
     // failure. Dispose only its exact injected child, never the host plugin.
     const badChild=injectedCallback;
     injectedCallback=null;
     if(badChild&&typeof ctx?.registry?.delete==='function')
       try{ctx.registry.delete(badChild)}catch{}
    });
    };
    injectedCallback=onInjected;
    // Connection must already exist for the independent OAuth RPC to work.
    // Prior releases mistakenly considered login mounted before this service.
    ctx.inject(['credentials','commands','llm','connection'],onInjected);
  }catch{
   state='failed';reason='DSH 宿主注入渠道包失败';ctx.logger?.warn?.('dsh-native-router: channel pack scope unavailable');
  }
  return status();
 }
  // Explicit, read-only facade: never copy credentials, never probe logins
  // and never treat a listed account as authenticated or usable for routing.
  async function listAccounts(){
   if(disposed||state!=='mounted'||!activeScope)return {state,accounts:[]};
   const scope=activeScope;
   try{
     const pool=sourcePool(scope);
    if(typeof pool?.listAllAccounts!=='function')return {state:'unavailable',accounts:[]};
    const rows=await pool.listAllAccounts();
    if(disposed||state!=='mounted'||activeScope!==scope)return {state:'disposed',accounts:[]};
    if(!Array.isArray(rows))throw Error('Invalid upstream account pool');
     const accounts=rows.filter(row=>row&&sourceAllowed(row.provider)
       &&typeof row.id==='string'&&row.id.length>0&&row.id.length<=100).slice(0,200).map(row=>{
        // Private source AccountPool can expose the owner's accountName or
        // username while holding a generated nickname (e.g. '账号1'). Keep
        // these sanitized public fields, but the roster is NOT auth proof.
        const rawName=publicAccountName(row);
       const marker=String(row.credentialRef??'');
       // Distinguish login provenance. Migrated plugin credentials are not
       // user-performed autonomous logins merely because they live in our pool.
       const authorizationSource=marker.startsWith('NATIVE_ROUTER_PRIVATE_PACK_')
         ||row.id.startsWith('nr_')?'adopted':
         marker.startsWith('NATIVE_ROUTER_SOURCE_')?'autonomous':'unclassified';
        return {id:row.id.replace(/[\u0000-\u001f]/g,'').slice(0,100),
          providerId:row.provider,nickname:rawName.slice(0,80),
         enabled:row.enabled===true,refreshable:row.refreshable===true,
         authorizationSource,connectionState:'not_checked'};
     });
     return {state:'ready',accounts};   }catch{return {state:'error',accounts:[]}}
  }

   // Standalone source login and check-in use the plugin-owned sourcePool service.
   // Startup never reads or mutates the host's registered AccountPool.
  const modifying=new Set();
  function mountedScope(){return !disposed&&state==='mounted'?activeScope:null}
  async function changeAccountEnabled({providerId,accountId,enabled}={}){
    if(!sourceAllowed(providerId)||typeof accountId!=='string'      ||accountId.length===0||accountId.length>100||!/^[a-zA-Z0-9_-]+$/.test(accountId)
      ||typeof enabled!=='boolean')return {state:'invalid',changed:false};
    const scope=mountedScope();
    if(!scope)return {state:'unavailable',changed:false};
    const pool=sourcePool(scope);
    if(typeof pool?.listAllAccounts!=='function'||typeof pool?.updateAccount!=='function')
      return {state:'unavailable',changed:false};
    if(modifying.has(accountId))return {state:'busy',changed:false};
    modifying.add(accountId);
    try{
      const accounts=await pool.listAllAccounts();
      if(!Array.isArray(accounts))return {state:'error',changed:false};
      const matches=accounts.filter(row=>row?.id===accountId&&row?.provider===providerId);
      // Reject a stale, renamed, ambiguous, or cross-provider account.
      if(matches.length!==1||accounts.filter(row=>row?.id===accountId).length!==1)
        return {state:'not_found',changed:false};
      if(scope!==mountedScope())return {state:'unavailable',changed:false};
      if((matches[0].enabled===true)===enabled)return {state:'unchanged',changed:false,enabled};
      await pool.updateAccount(accountId,{enabled});
      if(scope!==mountedScope())return {state:'unavailable',changed:false};
      const refreshed=await pool.listAllAccounts();
      const matched=Array.isArray(refreshed)?refreshed.filter(row=>row?.id===accountId&&row?.provider===providerId):[];
      if(matched.length!==1||(matched[0].enabled===true)!==enabled)
        return {state:'unconfirmed',changed:false};
      return {state:'updated',changed:true,enabled};
    }catch{
      return {state:'error',changed:false};
    }finally{modifying.delete(accountId)}
  }
  // Destructive source-only logout: upstream pool.removeAccount() attempts to
  // remove its stored credential. Refuse while any native source reference for
  // this provider remains: a model chain may still require it.
  async function removeSourceAccount({providerId,accountId}={}){
    if(!sourceAllowed(providerId)||typeof accountId!=='string'      ||accountId.length<1||accountId.length>100||!/^[a-zA-Z0-9_-]+$/.test(accountId))
      return {state:'invalid',removed:false};
    const scope=mountedScope();
    if(!scope)return {state:'unavailable',removed:false};
    const pool=sourcePool(scope);
    if(typeof pool?.removeAccount!=='function'||typeof pool?.listAllAccounts!=='function')
      return {state:'unavailable',removed:false};
    if(modifying.has(accountId))return {state:'busy',removed:false};
    modifying.add(accountId);
    try{
      const nativeId=sourceAccountOpaqueId(providerId,accountId);
      const referenced=()=>getConfig()?.accounts?.some(row=>row.providerId===providerId&&row.id===nativeId);
      if(referenced())return {state:'referenced',removed:false};
      const rows=await pool.listAllAccounts();
      const matches=Array.isArray(rows)?rows.filter(row=>row?.id===accountId&&row?.provider===providerId):[];
      if(matches.length!==1||rows.filter(row=>row?.id===accountId).length!==1)
        return {state:'not_found',removed:false};
      if(scope!==mountedScope())return {state:'unavailable',removed:false};
      if(referenced())return {state:'referenced',removed:false};
      await pool.removeAccount(accountId);
      if(scope!==mountedScope())return {state:'unavailable',removed:false};
      const updated=await pool.listAllAccounts();
      if(!Array.isArray(updated)||updated.some(row=>row?.id===accountId))
        return {state:'unconfirmed',removed:false};
      return {state:'removed',removed:true};
    }catch{return {state:'error',removed:false}}
    finally{modifying.delete(accountId)}
  }
   const modelRequests=new Map();
  async function listModels(providerId){
    if(!sourceAllowed(providerId))       return {state:'invalid',providerId:'',models:[]};
    const scope=mountedScope();
    if(!scope)return {state:'unavailable',providerId,models:[]};
    const llm=scope.llm??scope.get?.('llm');
    if(typeof llm?.listModels!=='function'&&!(providerId==='codearts'&&privateSourceCatalog))
       return {state:'unavailable',providerId,models:[]};
     const existing=modelRequests.get(providerId);
     if(existing?.scope===scope)return structuredClone(await existing.promise);
     const entry={scope,promise:(async()=>{
    let timer;
    try{
      // Never automatically fetch; bound the settings request even if the
      // upstream llm service fails to settle. The underlying service owns cancellation.
      const timeoutMarker=Symbol('timeout');
      const rows=await Promise.race([
        Promise.resolve().then(async()=>{
           if(providerId==='codearts'&&typeof privateSourceCatalog?.codearts==='function'){
             try{const raw=await privateSourceCatalog.codearts();
               if(Array.isArray(raw))return raw;
             }catch{} // Fall back to DSH model list without trusted rates.
           }
           return llm.listModels(sourceAdapter(providerId));
         }),        new Promise(resolve=>{timer=setTimeout(()=>resolve(timeoutMarker),modelTimeoutMs)}),
      ]);
      if(rows===timeoutMarker)return {state:'timeout',providerId,models:[]};
      if(scope!==mountedScope())return {state:'unavailable',providerId,models:[]};
      if(!Array.isArray(rows))return {state:'error',providerId,models:[]};
       const models=[],seen=new Map();
       const positive=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>0;
       for(const row of rows){
         if(row&&typeof row==='object'&&row.provider
           &&row.provider!==providerId&&row.provider!==sourceAdapter(providerId))continue;
         const id=typeof row==='string'?row:row?.id;
         if(typeof id!=='string'||!id.trim()||id.length>160||/[\u0000-\u001f]/.test(id))continue;
         const negative=row?.isFree===false||row?.free===false||row?.pricingConflict===true;
         const positivePrice=positive(row?.costMultiplier)||[row?.pricing,row?.price,row?.cost].some(p=>p&&typeof p==='object'&&['input','output','prompt','completion','inputCost','outputCost'].some(k=>positive(p[k])));
         const free=row?.isFree===true||row?.free===true||row?.upstreamFreeLabel===true;
         const previous=seen.get(id);
         if(previous){
           if(negative||positivePrice||previous.isFree===false&&free){
             delete previous.upstreamFreeLabel;previous.pricingConflict=true;previous.isFree=false;
             delete previous.costMultiplier;delete previous.priceSource;delete previous.pricing;
           }
           continue;
         }
         if(models.length>=256)continue;
         const name=typeof row?.name==='string'&&row.name.length<=120
           &&!/[\u0000-\u001f]/.test(row.name)?row.name:id;
         const model={id,name,
           ...(providerId==='codearts'&&row?.catalogSource==='codearts-signed-official-model-catalog'?{catalogSource:row.catalogSource}:{}),
           ...(negative||positivePrice?{isFree:false}:free?{upstreamFreeLabel:true}:{}),
           ...(row?.pricingConflict===true||free&&(negative||positivePrice)?{pricingConflict:true}:{}),
           ...(row?.priceSource==='codearts-official-credit-ratio'
             &&Number.isSafeInteger(row.catalogObservedAt)
             &&row.catalogObservedAt<=Date.now()+30000
             &&row.catalogObservedAt>Date.now()-15*60*1000
             &&typeof row.costMultiplier==='number'
             &&Number.isFinite(row.costMultiplier)&&row.costMultiplier>=0&&row.costMultiplier<=100
             ?{costMultiplier:row.costMultiplier,priceSource:row.priceSource}:{}),
           ...(row?.pricing&&typeof row.pricing==='object'
             &&['number','string'].includes(typeof row.pricing.input)
             &&['number','string'].includes(typeof row.pricing.output)
             ?{pricing:{input:row.pricing.input,output:row.pricing.output}}:{})};
         seen.set(id,model);models.push(model);
       }
      return {state:'ready',providerId,models};
    }catch{return {state:'error',providerId,models:[]}}
     finally{clearTimeout(timer)}
     })()};
     modelRequests.set(providerId,entry);
     try{return structuredClone(await entry.promise)}
     finally{if(modelRequests.get(providerId)===entry)modelRequests.delete(providerId)}
   }
  // The pinned source adapter has no public forceAccountId parameter.
  // Single-account requests preserve the Alpha.8 behavior. Experimental
  // multiaccount requests are permitted ONLY for reviewed channel paths,
  // after an isolated-profile flag and request-local credential guard.
   async function streamNative({providerId,sourceAccountId,model,messages,tools,signal,maxTokens,reasoningEffort,singleShotPriceProof}={}){    if(!sourceAllowed(providerId)||typeof sourceAccountId!=='string'      ||!sourceAccountId||sourceAccountId.length>100||typeof model!=='string'||!model.trim()
      ||model.length>160||!Array.isArray(messages)||!messages.length)
      throw Error('Invalid isolated source model request');
    if(providerId==='zcode')throw Object.assign(Error('ZCode private Start Plan is official-client-only'),{code:'OFFICIAL_CLIENT_ONLY'});
    const scope=mountedScope();
    if(!scope)throw Error('Isolated source pack not mounted');
    if(signal?.aborted)throw Error('Source model request aborted');
     const pool=sourcePool(scope);
    const llm=scope.llm??scope.get?.('llm');
    if(typeof pool?.listAllAccounts!=='function'||typeof pool?.getAvailableAccount!=='function'
      ||typeof llm?.stream!=='function')throw Error('Upstream source credential selection service unavailable');
    const rows=await pool.listAllAccounts();
    if(scope!==mountedScope()||signal?.aborted)throw Error('Source pack disposed before generation');
    if(!Array.isArray(rows))throw Error('Source account pool is unavailable');
    const matching=rows.filter(row=>row?.provider===providerId);
    const candidates=matching.filter(row=>row?.enabled===true);
    const selected=candidates.filter(row=>row?.id===sourceAccountId);
    if(selected.length!==1||rows.filter(row=>row?.id===sourceAccountId).length!==1)
      throw Error('Source account ownership is not unambiguous');
    const multi=candidates.length>1;
    if(multi&&(!multiAccountOptIn||!selectionGuard||!MULTIACCOUNT_REVIEWED.includes(providerId)))
      throw Error('Source multi-account selection is not verified for this channel');
    const allIds=matching.map(row=>row.id);
    if(allIds.length!==new Set(allIds).size)
      throw Error('Source account pool has ambiguous duplicate IDs');
    const exclude=multi?new Set(allIds.filter(id=>id!==sourceAccountId)):undefined;
    // Account availability is always resolved by the original upstream pool.
    // The guard only narrows the source candidate set and blocks any fallback.
    const reset=selected[0]?.modelRateLimits?.[model];
    if(typeof reset==='number'&&Number.isFinite(reset)&&reset>Date.now())
      throw new UpstreamError('Exact source account model is cooling down',{code:'RATE_LIMIT',status:429,retryAfterMs:Math.min(86400000,reset-Date.now())});
    const available=await pool.getAvailableAccount(providerId,model,exclude);
    if(available?.entry?.id!==sourceAccountId||scope!==mountedScope()||signal?.aborted)
      throw Error('Upstream source account is not currently available for this model');
    if(nativeOwned&&modelAdapterStates[providerId]!=='ready')
      throw Error('Independent source inference is unavailable; source login remains accessible');
     const request={provider:sourceAdapter(providerId),model,messages,tools:Array.isArray(tools)?tools:[],signal,
       ...(Number.isInteger(maxTokens)&&maxTokens>0?{maxTokens}:{}),
       ...(providerId==='loomy'&&reasoningEffort==='none'?{reasoningEffort:'none'}:{})};    if(scope!==mountedScope()||signal?.aborted)throw Error('Source pack disposed before native request');
    if(singleShotPriceProof===true){
      // Paid test must use ONE selected source account and a private adapter
      // enforcing ONE actual outbound POST. DSH LLM normalization may strip
      // custom options; do not route this mode through the general model stream.
      if(providerId!=='codearts'||!nativeOwned||multi||candidates.length!==1
        ||typeof privateSourceCatalog?.codeartsOneShot!=='function')
        throw Error('Single-post CodeArts proof requires isolated unique account');
      const stream=privateSourceCatalog.codeartsOneShot({
        model,messages,tools:request.tools,signal,maxTokens,reasoningEffort:'off'});
      if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
        throw Error('CodeArts one-post stream unavailable');
      return stream;
    }
    if(!multi){
      const stream=llm.stream(request);
      if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
        throw Error('Upstream source returned no native DSH event stream');
      return stream;
    }
    const guarded=selectionGuard;
    return (async function*(){
      // Upstream adapters may hold process-wide mutable account preferences;
      // serialize same-provider experimental requests until DSH host verified.
      if(providerStreams.has(providerId))throw Error('Source provider already has an in-flight pinned request');
      providerStreams.add(providerId);
      try{
        if(scope!==mountedScope()||signal?.aborted)
          throw Error('Source pack disposed before account pinning');
        const current=await pool.listAllAccounts();
        const matches=Array.isArray(current)?current.filter(row=>row?.provider===providerId):[];
        const exact=matches.filter(row=>row?.id===sourceAccountId&&row?.enabled===true);
        if(exact.length!==1||matches.length!==allIds.length
          ||matches.some(row=>!allIds.includes(row.id)||!matching.find(prev=>prev.id===row.id&&prev.enabled===row.enabled)))
          throw Error('Source account roster changed before pinned generation');
        const credRef=exact[0].credentialRef;
        if(typeof credRef!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credRef))
          throw Error('Invalid selected source credential reference');
        yield* guarded.streamFor({providerId,accountId:sourceAccountId,credentialRef:credRef,
          model,signal,allProviderAccountIds:allIds,createStream:()=>llm.stream(request)});
      }finally{providerStreams.delete(providerId)}
    })();
  }
  // Verify this once-per-account reward independently: the pinned upstream
  // status maps a failed /tasks read to pending=false, which is NOT evidence
  // that the task completed. Only a successful, authenticated official /tasks
  // response can finalize an ambiguous owner receipt.
  async function withOwnedSourceCredential(scope,providerId,sourceAccountId,sourceAccount,action){
    try{
      const pool=sourcePool(scope),credentials=scope.credentials??scope.get?.('credentials',false);
      if(typeof pool?.listAllAccounts!=='function'||
        typeof credentials?.resolve!=='function')return {state:'unavailable'};
      const roster=await pool.listAllAccounts();
      if(scope!==mountedScope()||!Array.isArray(roster))
        return {state:'unavailable'};
      const records=roster.filter(x=>x?.provider===providerId
        &&x?.id===sourceAccountId&&x?.enabled===true);
      if(records.length!==1||roster.filter(x=>x?.id===sourceAccountId).length!==1)
        return {state:'unavailable'};
      const item=records[0];
      if(sourceAccount&&item.credentialRef!==sourceAccount.credentialRef)
        return {state:'unavailable'};
      const ref=ownCredentialRef(item.credentialRef);
      const resolved=await credentials.resolve(ref);
      if(scope!==mountedScope()||typeof resolved?.value!=='string'
        ||resolved.value.length>65536)return {state:'unavailable'};
      const credential=JSON.parse(resolved.value);
      if(scope!==mountedScope())return {state:'unavailable'};
      return await action(credential);
    }catch{return {state:'unavailable'}}
  }
  async function verifiedRaccoonTask(scope,sourceAccountId,sourceAccount,
    {timeoutMs=9500}={}){
    const trusted=result=>['pending','completed'].includes(result?.state)?
      {state:result.state}:{state:'unavailable'};
    if(typeof raccoonTaskVerifier==='function'){
      try{return trusted(await raccoonTaskVerifier({sourceAccountId}))}
      catch{return {state:'unavailable'}}
    }
    return trusted(await withOwnedSourceCredential(scope,'raccoon',sourceAccountId,sourceAccount,
      credential=>readRaccoonLoginTask({credential,fetchImpl:raccoonFetchImpl,timeoutMs})));
  }
  async function triggerRaccoonDaily(scope,sourceAccountId,sourceAccount){
    if(typeof raccoonDailyTrigger==='function'){
      try{return await raccoonDailyTrigger({sourceAccountId})}
      catch{return {state:'unavailable'}}
    }
    return withOwnedSourceCredential(scope,'raccoon',sourceAccountId,sourceAccount,
      credential=>triggerRaccoonFreeDaily({credential,fetchImpl:raccoonFetchImpl}));
  }
  async function readLoomyActivities(sourceAccountId){
    const scope=mountedScope();
    if(!scope||!sourceAllowed('loomy'))return {state:'unavailable',tasks:[]};
    const result=await withOwnedSourceCredential(scope,'loomy',sourceAccountId,null,
      credential=>readLoomyFreeTasks({credential,fetchImpl:loomyFetchImpl}));
    return result?.state==='available'?result:{state:'unavailable',tasks:[]};
  }
  async function claimLoomyActivities({sourceAccountId,beforeClaim,onOutcome,
    onObserved,previousReceipt}={}){
    const scope=mountedScope();
    if(!scope||!sourceAllowed('loomy'))return {state:'unavailable'};
    return withOwnedSourceCredential(scope,'loomy',sourceAccountId,null,
      credential=>claimLoomyFreeTasks({credential,fetchImpl:loomyFetchImpl,
        beforeClaim:(offer,meta)=>scope===mountedScope()&&beforeClaim?.(offer,meta),
        onOutcome:(offer,state,meta)=>scope===mountedScope()&&onOutcome?.(offer,state,meta),
        onObserved:(offer,state,meta)=>scope===mountedScope()&&onObserved?.(offer,state,meta),
        previousReceipt:offer=>scope===mountedScope()?previousReceipt?.(offer):null}));
  }
  async function checkinAccount({providerId,sourceAccountId,
    beforeOneTimeClaim,onOneTimeOutcome}={}){
    if(!SOURCE_DAILY_SIGNIN_PROVIDERS.includes(providerId)||!sourceAllowed(providerId)      ||typeof sourceAccountId!=='string'||!sourceAccountId||sourceAccountId.length>100)
      return {state:'unsupported',message:'渠道没有经核验的每日签到服务'};
    const scope=mountedScope();
    if(!scope)return {state:'unavailable',message:'上游来源服务尚未装载'};
    const pool=sourcePool(scope);
    const ops=nativeOwned?privateSourceCheckins:scope.get?.('nativeRouterSourceCheckins',false);
    if(typeof pool?.listAllAccounts!=='function'||typeof ops?.status!=='function'
      ||typeof ops?.claim!=='function')
      return {state:'unavailable',message:'来源单账号签到服务尚未连接 DSH'};
    const rows=await pool.listAllAccounts();
    if(scope!==mountedScope())return {state:'unavailable'};
    const matches=rows.filter(r=>r?.provider===providerId&&r?.id===sourceAccountId&&r.enabled===true);
    if(matches.length!==1||rows.filter(r=>r?.id===sourceAccountId).length!==1)
      return {state:'unavailable',message:'未找到唯一启用的来源账号'};
    const exactStatus=reply=>{
      if(reply?.ok!==true||!Array.isArray(reply.value?.accounts))return null;
      const match=reply.value.accounts.filter(row=>row?.accountId===sourceAccountId);
      return match.length===1?match[0].status:null;
    };
    const before=exactStatus(await ops.status(providerId,sourceAccountId));
    if(scope!==mountedScope())return {state:'unavailable'};
     const today=new Intl.DateTimeFormat('en-CA',{
       timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
       .format(new Date());
    if(providerId==='raccoon'){
      // The pinned official Raccoon source pack implements TWO free tasks:
      // a once-per-account desktop login grant (POST), then an account's
      // daily web activity (GET requests confirmed by daily_grant bill).
      // Its generic claim method prioritizes the login bonus, so a single
      // invocation cannot satisfy the daily task. A durable owner receipt
      // must exist BEFORE any one-shot login POST.
      const statusValid=status=>status?.active===true
        &&typeof status.todayCheckedIn==='boolean'
        &&typeof status.loginRewardPending==='boolean';
      if(!statusValid(before))return {state:'failed',
        message:'小浣熊官方账单或任务资格不明确，未执行领取'};
      const read=async()=>exactStatus(await ops.status(providerId,sourceAccountId));
      const invoke=async()=>{
        const result=await ops.claim(providerId,sourceAccountId);
        if(scope!==mountedScope())return null;
        if(result?.ok!==true||!Array.isArray(result.value?.results))return null;
        const matches=result.value.results.filter(row=>row?.accountId===sourceAccountId);
        return matches.length===1?matches[0]?.outcome??null:null;
      };
      let current=before,loginConfirmed=false;
      // The bundled source's loginRewardPending=false is NOT authoritative
      // when its separate task GET failed. Verify via exact account/credential
      // before any claim that could accidentally submit the one-time POST.
      const proof=await verifiedRaccoonTask(scope,sourceAccountId,matches[0]);
      if(scope!==mountedScope())return {state:'unavailable'};
      // A failed one-time reward eligibility read must never allow its POST,
      // but must not prevent a separately confirmed daily GET entitlement.
      const loginUnknown=proof.state==='unavailable';
      if(loginUnknown&&current.todayCheckedIn===true)return {
        confirmed:true,loginRewardState:'unavailable',
        message:'今日积分已到账；登录奖励资格查询不可用，未发送一次性领取请求'};

      if(proof.state==='pending'){
        // A missing approval callback is NOT consent to claim. If the
        // official service still says pending after a previous uncertain
        // receipt, do not repeat the one-time POST on restart.
        let approved=false;
        try{approved=typeof beforeOneTimeClaim==='function'
          &&await beforeOneTimeClaim({kind:'raccoon_login'})===true}
        catch{}
        if(!approved)return current.todayCheckedIn===true?{
          confirmed:true,loginRewardState:'pending_confirmation',
          message:'小浣熊今日免费积分已发放；登录奖励回执待核实，不重复提交'
        }:{state:'pending_confirmation',loginRewardState:'pending_confirmation',
          message:'小浣熊一次性登录奖励回执待核实，未重复提交'};
        const outcome=await invoke();
        // Any unknown transport/acceptance result remains pending. The
        // claim receipt protects against blindly resending this POST.
        const after=await read();
        const afterProof=await verifiedRaccoonTask(scope,sourceAccountId,matches[0]);
        if(scope!==mountedScope())return {state:'unavailable'};
        // Only the independent official /tasks response can settle a
        // one-time reward. The vendor parser masks task-read errors.
        loginConfirmed=afterProof.state==='completed'&&
          ['claimed','already-claimed','already'].includes(outcome?.kind);
        try{await onOneTimeOutcome?.('raccoon_login',
          loginConfirmed?'confirmed':'pending_confirmation',
          loginConfirmed&&Number.isFinite(outcome?.credit)?{credit:outcome.credit}:{})}
        catch{}
        if(!loginConfirmed)return {
          state:'pending_confirmation',accepted:true,
          loginRewardState:'pending_confirmation',
          message:'小浣熊登录积分已尝试领取，但官方未确认，不重发'};
        current=after;
      }
      if(current.todayCheckedIn===true)return {confirmed:true,
        ...(loginConfirmed?{loginRewardState:'confirmed'}:{}),
        message:'小浣熊官方账单已确认今日免费积分'+
          (loginConfirmed?'；桌面登录奖励也已确认':'')};
      if(current.dailyGranted!==false||current.webTriggered!==true)
        return {state:'failed',message:'小浣熊每日免费积分状态未知，未触发网页活动'};
      // Only the GET-based daily process remains. Its outcome must be
      // verified by a fresh official bill, never by response success alone.
      const daily=await triggerRaccoonDaily(scope,sourceAccountId,matches[0]);
      if(scope!==mountedScope())return {state:'unavailable'};
      const verified=await read();
      if(scope!==mountedScope())return {state:'unavailable'};
      if(verified?.todayCheckedIn===true)return {confirmed:true,
        ...(loginConfirmed?{loginRewardState:'confirmed'}:loginUnknown?{loginRewardState:'unavailable'}:{}),
        ...(Number.isFinite(verified.todayCredit)&&verified.todayCredit>0
          ?{activityRewardAmount:verified.todayCredit,activityRewardUnit:'积分'}:{}),
        message:'小浣熊每日免费积分已由官方账单确认'};
      return daily?.state!=='triggered'?
        {state:'failed',message:'小浣熊免费办公 GET 未触发成功；官方账单未确认到账'}:
        {state:'pending_confirmation',accepted:true,
          message:'小浣熊免费办公 GET 已触发，但官方账单尚未证明到账'};
    }
     if(upstreamCheckedInToday(before,today)===true)
       return {confirmed:true,message:'来源服务已确认今日签到'};
      // Match the pinned official provider contracts, not a generic field.
      // TRAE explicitly reports an enabled, unchecked daily task; its
      // upstream parser rejects missing booleans. LobsterAI uses claimable.
      const usesClaimable=['codearts','loomy','lobsterai','zcode'].includes(providerId);
      const eligible=providerId==='zcode'
        ?before?.active===true&&before?.claimable===true
          &&Number.isInteger(before.planCount)&&before.planCount>0
         :['trae','buddy'].includes(providerId)
          ?before?.active===true&&before?.todayCheckedIn===false
            &&before?.available!==false&&before?.claimable!==false
          :usesClaimable
            ?before?.active===true&&before?.claimable===true&&before?.available!==false
            :before?.active!==false&&before?.available===true&&before?.claimable!==false;
      if(before?.active===false)
        return {state:'no_task',claimPosted:false,
          message:'官方确认活动未开放或账号不适用，未发送领取请求'};
      if(!eligible){
        // Only an authoritative negative is no-task; unknown remains failed.
        if(providerId==='zcode'&&before?.active===true
          &&before?.claimable===false&&before?.planCount===0)
          return {state:'no_task',claimPosted:false,
            message:'官方当前没有可领取的 Start Plan；没有提交领取请求'};
        if(['codearts','loomy','lobsterai'].includes(providerId)&&before?.active===true
          &&before?.claimable===false&&before?.todayCheckedIn===false)
          return {state:'no_task',claimPosted:false,
            message:'官方确认本账号当前没有可领取的每日任务'};
         return {state:'failed',diagnosticCode:before?.diagnosticCode??(before?'ELIGIBILITY_UNKNOWN':'STATUS_UNAVAILABLE'),message:'官方尚未确认本账号有可领取计划，未发送领取请求'};
      }
      const claim=await ops.claim(providerId,sourceAccountId);    if(scope!==mountedScope())return {state:'unavailable'};
    const outcomes=claim?.ok===true&&Array.isArray(claim.value?.results)
      ?claim.value.results.filter(row=>row?.accountId===sourceAccountId):[];
     if(outcomes.length===0)return {state:'failed',diagnosticCode:'CLAIM_RECEIPT_MISSING',message:'上游未提供指定账号的签到回执'};
    // ZCode may demand the app's security challenge (vendor code 3007).
    // That is NOT a submitted or accepted plan. Never retry the POST until
    // the exact account completes its own authorized verification.
    if(outcomes.some(row=>row?.outcome?.kind==='captcha'))
      return {state:'client_required',message:'ZCode 官方要求在客户端完成验证码；未证明赠送到账'};
    if(outcomes.some(row=>row?.outcome?.kind==='failed'))
       return {state:'failed',diagnosticCode:outcomes.find(row=>row?.outcome?.kind==='failed')?.outcome?.diagnosticCode??'CLAIM_REJECTED',message:'上游签到未成功，等待下次人工或定时重试'};
    if(outcomes.every(row=>['inactive','ineligible'].includes(row?.outcome?.kind)))
      // This result followed a real claim POST, unlike a read-only empty card.
      // It MUST count against the bounded automatic submission attempts.
      return {state:'no_task',claimPosted:true,
        message:'来源活动当前无可领取的赠送计划；本次领取请求已经提交'};
    if(outcomes.some(row=>!['claimed','done','already','already-claimed'].includes(row?.outcome?.kind)))
       return {state:'failed',diagnosticCode:'CLAIM_STATUS_UNKNOWN',message:'上游领取状态未知，不能冒称已受理'};
    // Claim response is NOT success: some upstream APIs report a successful
    // request without actually checking in. A fresh same-day status is required.
    const after=exactStatus(await ops.status(providerId,sourceAccountId));
    if(scope!==mountedScope())return {state:'unavailable'};
     if(upstreamCheckedInToday(after,today)===true)
       return {confirmed:true,message:'上游状态回查确认今日签到'};
    // Loomy first-login is an idempotent daily quota initializer, not a
    // permanent points grant. Its authoritative current request plus fresh
    // wallet readback can prove initialization even if the wallet omits date.
     if(providerId==='loomy'){
       const receipt=loomyDailyReceipt(outcomes.length===1?outcomes[0]?.outcome?.dailyInitialization:null);
       const dayNow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
       const diagnosticCode=loomyDailyConfirmation(receipt,after,today,dayNow);
       if(!diagnosticCode)return {confirmed:true,dailyQuotaInitialized:true,message:'官方每日额度初始化回执与钱包回查一致；非永久积分新增'};
       return {state:'pending_confirmation',accepted:true,diagnosticCode,message:'每日额度回查尚未确认',
         ...(receipt&&dayNow===today?{dailyInitialization:receipt,dailyInitializationDay:today}:{})};
     }
    return {state:'pending_confirmation',accepted:true,
      message:'签到操作已执行，但上游今日签到状态仍未确认'};
  }
   // Deliberately private in-process handoff to the owner-controlled migration
 // service. Never expose this object via status, HTTP or user settings.
 function ownedAdoptionContext(){
  const scope=mountedScope();
  if(!scope||sourcePoolService!=='nativeRouterSourceAccountPool')return null;
  const pool=sourcePool(scope);
  const credentials=scope.credentials??scope.get?.('credentials',false);
  if(!pool||!credentials)return null;
  return {pool,credentials};
 }
   // Account-scoped read-only identity, check-in and balance bridge.
   // Reuse the same upstream implementations as the standalone channels;
   // never confuse "no credit plan" with authentication failure.
   async function readSourceStatuses(providerId,accountId,{includeActivities=true}={}){
     if(!SOURCE_PACK_PROVIDERS.includes(providerId)||!sourceAllowed(providerId))
       return {state:'unsupported',accounts:[]};
     const scope=mountedScope();
     if(!scope)return {state:'unavailable',accounts:[]};
     const ops=nativeOwned?privateSourceCheckins:scope.get?.('nativeRouterSourceCheckins',false);
     if(!ops||typeof ops.status!=='function')return {state:'unavailable',accounts:[]};
     const invoke=async(method)=>{
       if(typeof ops[method]!=='function')return null;
       let timer;
       try{
         const timeout=Symbol('timeout');
         const reply=await Promise.race([
            Promise.resolve().then(()=>ops[method](providerId,accountId)),
           new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),
              providerId==='zcode'?18000:8000);timer.unref?.()}),
         ]);
         return reply===timeout||scope!==mountedScope()||reply?.ok!==true
           ||!Array.isArray(reply.value?.accounts)?null:reply.value.accounts.slice(0,200);
       }catch{return null}
       finally{clearTimeout(timer)}
     };
     const [identities,statuses,balances]=await Promise.all([
       invoke('identity'),invoke('status'),invoke('balances')]);
     if(scope!==mountedScope()||(!identities&&!statuses&&!balances))
       return {state:'unavailable',accounts:[]};
     const safeId=value=>typeof value==='string'&&value.length>0
       &&value.length<=100&&/^[a-zA-Z0-9_-]+$/.test(value);
     const lookup=rows=>new Map((rows??[]).filter(row=>safeId(row?.accountId??row?.id))
       .map(row=>[row.accountId??row.id,row]));
     const statusMap=lookup(statuses),balanceMap=lookup(balances),identityMap=lookup(identities);
      const allIds=new Set([...statusMap.keys(),...balanceMap.keys(),...identityMap.keys()].filter(id=>accountId===undefined||id===accountId));
      // The first migration may copy public identity to the owned account
      // record. Normal operation MUST query OUR channel pack against the
      // provider API; it must not scrape either the original plugin's saved
      // profile or infer a login from the credential payload.
      if(scope!==mountedScope())return {state:'unavailable',accounts:[]};      if(scope!==mountedScope())return {state:'unavailable',accounts:[]};
      // Avoid 10+ sequential 9.5-second task reads at startup. Use bounded
      // account-level GET concurrency with shorter read-only timeouts; unknown
      // results stay unknown rather than marking any reward claimed.
      const raccoonProofs=new Map();
      if(includeActivities&&providerId==='raccoon'){
        const ids=[...allIds];let index=0;
        await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
          while(index<ids.length&&scope===mountedScope()){
            const accountId=ids[index++];
            raccoonProofs.set(accountId,await verifiedRaccoonTask(scope,accountId,
              undefined,{timeoutMs:3500}));
          }
        }));
      }
      const loomyProofs=new Map();
      if(includeActivities&&providerId==='loomy'){
        const ids=[...allIds];let index=0;
        await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
          while(index<ids.length&&scope===mountedScope()){
            const accountId=ids[index++];
            loomyProofs.set(accountId,await readLoomyActivities(accountId));
          }
        }));
      }
      const accounts=[];
     for(const accountId of allIds){
        const statusRow=statusMap.get(accountId),balanceRow=balanceMap.get(accountId);
        const exact=statusRow?.status&&typeof statusRow.status==='object'
          &&!Array.isArray(statusRow.status)?statusRow.status:null;
        const facts=sourceAccountFacts({providerId,identity:identityMap.get(accountId),
          statusRow,balanceRow,observedAt:Date.now()});
        // Explicit public fields already supplied at login may be retained in
        // our own exact-account credential. Only use them after live auth;
        // do not infer identities from opaque IDs or consult the original app.
        const ownedIdentity=facts.authVerified===true&&!facts.nickname
          &&['codearts','loomy','zcode'].includes(providerId)
          ?await withOwnedSourceCredential(scope,providerId,accountId,null,
             async credential=>{
               const identity=credentialPublicIdentity(credential);
               if(identity.accountName)return identity;
               const result=providerId==='codearts'&&privateSourceCatalog?.codeartsProfile?await privateSourceCatalog.codeartsProfile(credential):
                 providerId==='zcode'?await readZcodePublicProfile({credential}):null;
               const accountName=publicAccountName(result);
               return accountName?{...identity,accountName}:identity;
             }):null;
        if(scope!==mountedScope())return {state:'unavailable',accounts:[]};
        if(!facts.nickname&&ownedIdentity?.accountName)facts.nickname=ownedIdentity.accountName;
        const loginProof=providerId==='raccoon'?
          raccoonProofs.get(accountId)??{state:'unavailable'}:null;
        const loomyProof=providerId==='loomy'?loomyProofs.get(accountId):null;
        if(scope!==mountedScope())return {state:'unavailable',accounts:[]};
        // CodeArts status is drawn from its official CREDIT-package sign-in
        // campaign; its numeric amount is points, not an account balance or
        // a ZCode plan count. For other providers require an explicit signed
        // reward unit, never guess Token/积分 from a plan's quantity.
        const amount=exact?.amount??exact?.rewardAmount??exact?.todayCredit;
        const numeric=(typeof amount==='number'||typeof amount==='string'
          &&amount.trim())&&Number.isFinite(Number(amount))&&Number(amount)>=0?
          Number(amount):null;
        const rawUnit=typeof exact?.rewardUnit==='string'?exact.rewardUnit.trim():
          typeof exact?.unit==='string'?exact.unit.trim():'';
        const unit=providerId==='codearts'&&exact?.active===true?'积分':
          ['积分','Token','token','元','余额'].includes(rawUnit)?rawUnit:'';
        const freeReward=numeric!==null&&unit&&facts.authVerified===true?{
          activityRewardAmount:numeric,activityRewardUnit:unit}:{};
        const rawEnd=exact?.endAt??exact?.expiresAt;
        const end=typeof rawEnd==='number'&&Number.isFinite(rawEnd)&&rawEnd>0?
          rawEnd<1e11?rawEnd*1000:rawEnd:
          typeof rawEnd==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(rawEnd)?
            Date.parse(rawEnd):null;
        const rawPhone=identityMap.get(accountId)?.phone??exact?.phone;
        const phone=typeof rawPhone==='string'&&/^\d{11}$/.test(rawPhone)
          ?rawPhone.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2'):publicMaskedPhone(ownedIdentity);
        const today=new Intl.DateTimeFormat('en-CA',{
          timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
          .format(new Date());
        // Raccoon daily_grant is the rare source that exposes an official
        // positive per-day wallet transaction in its account status. A plan
        // amount or generic checked-in flag is NOT evidence of credited points.
        const creditedDaily=providerId==='raccoon'&&facts.authVerified===true
          &&upstreamCheckedInToday(exact,today)===true
          &&typeof exact?.todayCredit==='number'&&Number.isFinite(exact.todayCredit)
          &&exact.todayCredit>0;
        accounts.push({accountId,...facts,nickname:facts.nickname??'',          ...(phone?{maskedPhone:phone}:{}),
           todayCheckedIn:upstreamCheckedInToday(exact,today),
           ...(providerId==='loomy'&&facts.authVerified===true&&exact?.active===true&&loomyDailyQuota(exact.dailyQuotaEvidence)
             ?{dailyQuotaEvidence:loomyDailyQuota(exact.dailyQuotaEvidence),
               dailyCycleDate:typeof exact.dailyCycleDate==='string'?exact.dailyCycleDate.slice(0,10):''}:{}),
           ...(typeof exact?.claimable==='boolean'?{claimable:exact.claimable}:{}),
           ...(exact?.noClaimablePlans===true?{noClaimablePlans:true}:{}),
           ...freeReward,
           ...(creditedDaily?{
             activityRewardProof:'official_daily_grant_bill',
             activityRewardVerifiedAt:Date.now()}:{}),
           ...(providerId==='loomy'&&loomyProof?.state==='available'
             ?{benefits:loomyProof.tasks}:{}),
           ...(providerId==='raccoon'&&loginProof&&loginProof.state!=='unavailable'
             ?{loginRewardPending:loginProof.state==='pending',
               loginRewardTaskVerified:true}:{}),
           ...(providerId==='raccoon'&&Number.isFinite(Number(exact?.todayCredit))
             &&Number(exact.todayCredit)>0?{
               activityRewardAmount:Number(exact.todayCredit),activityRewardUnit:'积分'}:{}),
           ...(Number.isFinite(end)&&end>0?{activityExpiresAt:end}:{}),
           active:typeof exact?.active==='boolean'?exact.active:null});     }     return {state:'ready',accounts,checkedAt:Date.now()};
   } function dispose(){    if(disposed)return;
    disposed=true;
    for(const flow of raccoonLoginFlows)flow.close();raccoonLoginFlows.clear();
    selectionGuard?.restore();selectionGuard=null;
     activeScope=null;privateSourcePool=null;privateSourceCheckins=null;privateSourceCatalog=null;loadedPack=null;    sourcePhase='';modelAdapterStates={};privateSourceRpcReady=false;
    sourceErrorType='';sourceErrorLocation='';state='disposed';reason='';
    // Cordis inject() allocates a child Fiber. Explicitly remove our callback
    // so its registered adapters, accountPool, timers and effects are disposed
    // when this plugin stops (even if the parent Cordis Context remains alive).
     const callback=injectedCallback;injectedCallback=null;
     if(callback&&typeof ctx?.registry?.delete==='function'){
       try{ctx.registry.delete(callback)}
       catch{ctx.logger?.warn?.('native-router: source Cordis child scope cleanup failed')}
     }
   }
   return {attach,status,listAccounts,listModels,changeAccountEnabled,removeSourceAccount,
      streamNative,checkinAccount,readSourceStatuses,readLoomyActivities,claimLoomyActivities,
      ownedAdoptionContext,dispose,
     setModelEligibility:fn=>{modelEligibility=typeof fn==='function'?fn:()=>false}};}
