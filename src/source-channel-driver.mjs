// Isolated DSH-native channel-pack driver. Reuses the upstream DSH llm service;
// no duplicate OAuth, model protocol, sign-in, or credential implementation.
import {randomUUID} from 'node:crypto';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {UpstreamError,safeDshFailureFacts} from './failure.mjs';
import {visibleTools} from './host-tools.mjs';
import {flattenContent} from './protocol.mjs';
import {validateModelCalls} from './provider/openai.mjs';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {publicAccountName} from './account-facts.mjs';
import {freeEvidence} from './auto-free.mjs';
import {staleGiftWallet} from './gift-wallet.mjs';

const MAX_OUTPUT_BYTES=16*1024*1024;
const MAX_TOOL_CALLS=8;
const ref=sourceAccountOpaqueId;
const unable=(message,code='PROVIDER_NOT_READY')=>new UpstreamError(message,{code});
const validSource=providerId=>SOURCE_PACK_PROVIDERS.includes(providerId);
function requireSourceBinding(providerId,account,accountProviderId=providerId){
 const expected=String(account?.credentialRef??'');
 if(account?.providerId!==accountProviderId||!new RegExp('^driver:'+accountProviderId+':sp_[a-f0-9]{24}$').test(expected)
   ||expected.slice(('driver:'+accountProviderId+':').length)!==account.id)
  throw unable('Channel-pack account reference does not match its provider','CREDENTIAL');
 return expected.slice(('driver:'+accountProviderId+':').length);
}
export function toSourceMessages(options,providerId,model){
 const messages=[];
 const system=flattenContent(options?.system);
 if(system)messages.push({id:randomUUID(),role:'system',source:{kind:'system'},content:[{type:'text',text:system}]});
 for(const row of options?.messages??[]){
  if(!row||typeof row!=='object'||!['system','developer','user','assistant','tool'].includes(row.role))
   throw unable('Unsupported DSH conversation message','TOOL_PROTOCOL');
  messages.push({...row,id:typeof row.id==='string'&&row.id?row.id:randomUUID(),
   role:row.role==='developer'?'system':row.role,
   source:row.source??(row.role==='user'?{kind:'user'}:
    row.role==='tool'?{kind:'tool',callId:row.toolCallId??''}:
    row.role==='system'||row.role==='developer'?{kind:'system'}:{kind:'model',provider:providerId,model})});
 }
 if(!messages.length)throw unable('No DSH conversation message to send','TOOL_PROTOCOL');
 return messages;
}
function capText(value){
 if(typeof value!=='string')throw unable('Invalid native model stream text','TOOL_PROTOCOL');
 return value;
}

// Complete the upstream DSH stream into ONE atomic response. The native router
// does not expose partial output before routing/failover has committed to a tier.
// Never execute tools: only return DSH-host-authorized tool calls after validation.
export async function collectSourceDshStream(stream,{tools=[],signal,onProgress,onActivity}={}){
 if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
  throw unable('DSH source adapter did not return an async stream','TOOL_PROTOCOL');
 let text='',reasoning='',usage=null,finish=null,total=0;
 const calls=new Map(),blocks=new Map(),closed=new Set();
 function charge(value){
  total+=Buffer.byteLength(value,'utf8');
  if(total>MAX_OUTPUT_BYTES)throw unable('Native model output exceeded size limit','RESPONSE_SIZE');
 }
  const iterator=stream[Symbol.asyncIterator]();
   let ended=false,lastProgress='';
  const readNext=async()=>{
   if(!signal)return iterator.next();
   if(signal.aborted)throw unable('Native model request was cancelled','CANCELLED');
   let onAbort;
   try{
    const cancelled=new Promise((_,reject)=>{
     onAbort=()=>reject(unable('Native model request was cancelled','CANCELLED'));
     signal.addEventListener('abort',onAbort,{once:true});
     if(signal.aborted)onAbort();
    });
    return await Promise.race([Promise.resolve().then(()=>{
     if(signal.aborted)throw unable('Native model request was cancelled','CANCELLED');
     return iterator.next();
    }),cancelled]);
   }finally{if(onAbort)signal.removeEventListener('abort',onAbort)}
  };
  try{for(;;){
   const next=await readNext();
   if(signal?.aborted)throw unable('Native model request was cancelled','CANCELLED');
   if(next.done){ended=true;break}
   onActivity?.();
   const item=next.value;
  if(!item||typeof item!=='object')throw unable('Invalid DSH model event','TOOL_PROTOCOL');
  if(finish!==null)throw unable('Native model events continued after finish','TOOL_PROTOCOL');
  switch(item.type){
   case 'block-start':
    if(!Number.isInteger(item.index)||item.index<0||item.index>128||blocks.has(item.index))
     throw unable('Malformed native block start','TOOL_PROTOCOL');
    if(!['text','reasoning','tool-call'].includes(item.blockType))
     throw unable('Unsupported native output block','TOOL_PROTOCOL');
    blocks.set(item.index,{kind:item.blockType,received:false});
    break;
   case 'text-delta':
   case 'reasoning-delta':{
    const type=item.type==='text-delta'?'text':'reasoning';
    const block=blocks.get(item.index);
    if(!block||block.kind!==type||closed.has(item.index))
     throw unable('Mismatched native text event','TOOL_PROTOCOL');
    const delta=capText(item.text);charge(delta);block.received=true;
    if(type==='text')text+=delta;else reasoning+=delta;
    break;
   }
   case 'tool-call-delta':{
    const block=blocks.get(item.index);
    if(!block||block.kind!=='tool-call'||closed.has(item.index))
     throw unable('Mismatched native tool event','TOOL_PROTOCOL');
    if(!calls.has(item.index)){
     if(calls.size>=MAX_TOOL_CALLS)throw unable('Too many native tool calls','TOOL_PROTOCOL');
     calls.set(item.index,{id:'',name:'',arguments:''});
    }
    const call=calls.get(item.index);
    if(typeof item.id==='string'&&item.id){if(call.id&&call.id!==item.id)throw unable('Tool ID changed within stream','TOOL_PROTOCOL');call.id=item.id}
    if(typeof item.name==='string'&&item.name){if(call.name&&call.name!==item.name)throw unable('Tool name changed within stream','TOOL_PROTOCOL');call.name=item.name}
    const part=capText(item.argumentsDelta??'');charge(part);
    call.arguments+=part;block.received=true;
    break;
   }
   case 'block-end':{
    const block=blocks.get(item.index);
    if(!block||closed.has(item.index))throw unable('Unexpected native block end','TOOL_PROTOCOL');
    if(item.block?.type&&item.block.type!==block.kind)
     throw unable('Native block type mismatch','TOOL_PROTOCOL');
    if(!block.received){
     if(block.kind==='text'||block.kind==='reasoning'){
      const whole=capText(item.block?.text??'');charge(whole);
      if(block.kind==='text')text+=whole;else reasoning+=whole;
     }else{
      const call=item.block??{};
      if(calls.size>=MAX_TOOL_CALLS)throw unable('Too many native tool calls','TOOL_PROTOCOL');
      calls.set(item.index,{id:call.id,name:call.name,arguments:call.arguments});
     }
    }
    closed.add(item.index);break;
   }
   case 'usage':
    if(item.usage&&typeof item.usage==='object')usage=item.usage;
    break;
   case 'finish':
    if(!item.reason||!['stop','tool-calls','max-tokens'].includes(item.reason.kind)){
      const facts=safeDshFailureFacts(item.reason?.failure);
      const failure=new UpstreamError('Native DSH source did not complete successfully',{
        status:facts.status,
        code:item.reason?.kind==='aborted'?'CANCELLED':
          facts.code==='UPSTREAM'?'STREAM':facts.code,
        retryAfterMs:facts.retryAfterMs,
      });
      failure.safeStreamPhase='UPSTREAM_FINISH_ERROR';
      throw failure;
     }
     finish=item.reason.kind;    break;
   default:throw unable('Unsupported native model event type','TOOL_PROTOCOL');
  }
   // Only bounded phase names leave the collector, never response content.
   const progress=finish!==null?'STREAM_FINISH':text.length?'STREAM_TEXT':reasoning.length?'STREAM_REASONING':'STREAM_FIRST_EVENT';
   if(progress!==lastProgress){lastProgress=progress;onProgress?.(progress)}
  }}finally{
   // Cancellation must not wait on an upstream iterator whose next/return
   // is stuck. Request cleanup once; ignore late errors, never emit partial text.
   if(!ended)try{Promise.resolve(iterator.return?.()).catch(()=>{})}catch{}
  }
  if(finish===null||closed.size!==blocks.size){
   const error=unable('Native model stream ended before complete finish','TRUNCATED');
   error.safeStreamPhase=finish===null?'MISSING_NATIVE_FINISH':'UNCLOSED_NATIVE_BLOCK';
   throw error;
   }
  const toolCalls=[...calls].sort((a,b)=>a[0]-b[0]).map(([,x])=>x); if(finish==='tool-calls'&&!toolCalls.length)
  throw unable('Native model declared tool calls but emitted none','TOOL_PROTOCOL');
 if(!text.trim()&&!reasoning.trim()&&!toolCalls.length)
  throw unable('Native model yielded an empty response','EMPTY');
 const output={text,reasoning,toolCalls,finishReason:toolCalls.length?'tool_calls':
  finish==='max-tokens'?'length':'stop'};
 if(usage)output.usage={prompt_tokens:usage.inputTokens,completion_tokens:usage.outputTokens,
  total_tokens:usage.totalTokens};
 return validateModelCalls(output,tools);
}
// The legacy ZCode source adapter targets the official-client-only Start Plan endpoint.
export function createSourceChannelDriver({providerId,embeddedPack,accountProviderId=providerId,streamIdleTimeoutMs=120000}={}){
 if(!validSource(providerId)||!embeddedPack
   ||![providerId,'own_'+providerId].includes(accountProviderId))
   throw Error('Unknown embedded source provider');
 const snapshot=async()=>{
  const result=await embeddedPack.listAccounts();
  if(result?.state!=='ready')throw unable('Isolated upstream channel account pool is not available');
  return result.accounts.filter(row=>row.providerId===providerId);
 };
 async function resolve(account){
  const accountRef=requireSourceBinding(providerId,account,accountProviderId);
  const rows=await snapshot();
  const matched=rows.filter(row=>ref(providerId,row.id)===accountRef);
  if(matched.length!==1)throw unable('Upstream account reference is stale or ambiguous','CREDENTIAL');
  return matched[0];
  }
  const liveFacts=new Map(),inferenceProof=new Map(),activeStreams=new Set(),rateUntil=new Map(),walletRevision=new Map();
  const invalidateWallet=account=>{const id=account.id;walletRevision.set(id,(walletRevision.get(id)??0)+1);const row=liveFacts.get(id);if(row)liveFacts.set(id,staleGiftWallet(row))};
  const forgetAuth=account=>{if(!account?.id)return;inferenceProof.delete(account.id);const row=liveFacts.get(account.id);if(row)liveFacts.set(account.id,{...staleGiftWallet(row),authVerified:false,profileState:'cached'})};
  const idleMs=Number.isFinite(streamIdleTimeoutMs)?Math.max(10,Math.min(120000,streamIdleTimeoutMs)):120000;
  async function readLiveFacts(account,{includeActivities=true,signal}={}){
    if(signal?.aborted)return {state:'unavailable',authVerified:false};
    const selected=await resolve(account);
    if(!selected.enabled)return {state:'disabled',authVerified:false};
    if(typeof embeddedPack.readSourceStatuses!=='function')
      return {state:'unavailable',authVerified:false};
    // Every request is served by THIS plugin's isolated account pool and
    // official-channel APIs. Original plugin metadata is never consulted.
    const revision=walletRevision.get(account.id)??0;
    const remote=await embeddedPack.readSourceStatuses(providerId,selected.id,{includeActivities});
    if(signal?.aborted)return {state:'unavailable',authVerified:false};
    const matched=(remote?.state==='ready'&&Array.isArray(remote.accounts)
      ?remote.accounts:[]).filter(row=>row?.accountId===selected.id);
    if(matched.length!==1)return {state:'unavailable',authVerified:false};
    const {accountId,...facts}=matched[0];
    // The owned private pack's exact authorized account roster may know the
    // member name even when its *status* endpoint omits a nickname. rc94
    // discarded that identity and rendered '账号名待获取' despite a verified
    // self-owned login. Never use an unverified/placeholder roster label.
    const verifiedName=facts.authVerified===true
      ?publicAccountName(facts,selected):'';
    const result={...facts,
      ...(verifiedName?{nickname:verifiedName}:{}),state:'ready',
      checkedAt:remote.checkedAt??Date.now()};
    if(revision!==(walletRevision.get(account.id)??0))return staleGiftWallet(result);
    if(includeActivities)liveFacts.set(account.id,result);
    return result;
  }
  return {
   // The embedded official reads have their own deadlines; the outer caller
   // must allow them to settle (including the bounded follow-up gift read).
   accountReadTimeoutMs:providerId==='zcode'?23000:providerId==='loomy'?25000:providerId==='raccoon'?15000:12000,
   catalogReadTimeoutMs:providerId==='zcode'||providerId==='loomy'?28000:15000,
   isSourceBridge:true,
   get runtimeReady(){const status=embeddedPack.status?.();return status?.state==='mounted'
     &&(!Array.isArray(status.channels)||status.channels.includes(providerId))},
   ...(providerId==='zcode'?{modelAccessRestricted:'OFFICIAL_CLIENT_ONLY'}:{}),
   authMethod:accountProviderId.startsWith('own_')?
     '本插件自有凭据 · 直接查询渠道官方服务':'渠道账号引用 · 尚未独立接管',
   accountSnapshot(account){
     return {...(liveFacts.get(account?.id)??{}),
       modelInferenceVerifiedAt:inferenceProof.get(account?.id)?.at??null};
   },
   async refreshAccountStatus({account,signal}={}){
     let result;try{result=await readLiveFacts(account,{signal})}catch{result={state:'unavailable',authVerified:false}}
     if(account&&result?.authVerified!==true)forgetAuth(account);
     return result;
   },
   async discover(){
     const rows=await snapshot();
     return rows.filter(row=>typeof row.id==='string')
       .map(row=>({id:ref(providerId,row.id),
         label:row.nickname||providerId+' · 名称待获取',
         source:'isolated-channel-pack'}));
   },
   async importCandidate({candidateId,consent}={}){
     if(consent!==true)throw unable('Explicit account import consent is required','CREDENTIAL');
     const rows=await snapshot();
     const matched=rows.filter(row=>ref(providerId,row.id)===candidateId);
     if(matched.length!==1)throw unable('Source account no longer exists','CREDENTIAL');
     return {id:candidateId,credentialRef:'driver:'+accountProviderId+':'+candidateId};
   },
   async listModels({account,signal}={}){
     const selected=await resolve(account);
     if(!selected.enabled)throw unable('Source account disabled','CREDENTIAL');
     const result=await embeddedPack.listModels(providerId,{sourceAccountId:selected.id,signal});
      if(result.state!=='ready')throw unable('Source provider model list is unavailable');
      // Keep the account and its official model directory inspectable. The
      // legacy private adapter does not establish third-party inference rights.
      if(providerId==='zcode')return result.models.filter(row=>row&&typeof row.id==='string').map(row=>({
        id:row.id,...(typeof row.name==='string'?{name:row.name}:{}),isFree:false,
        accessRestriction:'OFFICIAL_CLIENT_ONLY'}));
      // Loomy official points/records reports a separate daily gifted pool.
      // Gift availability is informational; the upstream billing contract
      // does not guarantee a per-request maximum or prevent paid spillover.
      let giftedLoomy=false;
      if(providerId==='loomy'&&accountProviderId==='own_loomy'
        &&result.models?.some(row=>row?.id==='spark-x2.6')){
        const facts=await readLiveFacts(account,{includeActivities:false,signal}).catch(()=>null);
        giftedLoomy=facts?.authVerified===true&&facts.balanceState==='available'
          &&Number.isFinite(facts.loomyDailyGift)&&facts.loomyDailyGift>=2000;
      }
      // Preserve vetted zero-price/free facts from this plugin's isolated
     // source pack: dropping them prevented safe real free-model testing.
     return result.models.filter(row=>row&&typeof row.id==='string')
       .map(row=>({id:row.id,
          ...(typeof row.name==='string'?{name:row.name}:{}),
          ...(providerId==='codearts'&&row.catalogSource==='codearts-signed-official-model-catalog'
             ?{catalogSource:row.catalogSource}:{}),
           ...(row.isFree===false||row.free===false?{isFree:false}:row.upstreamFreeLabel===true||row.isFree===true||row.free===true?{upstreamFreeLabel:true}:{}),
           ...(row.pricingConflict===true?{pricingConflict:true}:{}),
          ...(providerId==='codearts'&&row.priceSource==='codearts-official-credit-ratio'
            &&typeof row.costMultiplier==='number'&&Number.isFinite(row.costMultiplier)
            &&row.costMultiplier>=0&&row.costMultiplier<=100
            ?{costMultiplier:row.costMultiplier,priceSource:row.priceSource}:{}),
          ...(providerId==='loomy'&&row.priceSource==='loomy-official-model-name-ratio'&&Number.isFinite(row.costMultiplier)&&row.costMultiplier>=0&&row.costMultiplier<=100?{costMultiplier:row.costMultiplier,priceSource:row.priceSource}:{}),
          ...(row.pricing?{pricing:{...row.pricing}}:{}),
          ...(giftedLoomy&&row.id==='spark-x2.6'?{giftAllowance:'loomy-daily-gift',giftRouteState:'cost_bound_unverified'}:{})}));
   },
   // Historical inference is evidence of a past request, not current auth.
   // Online state requires the current official provider account API.
   async refresh({account}={}){
     try{
       const selected=await resolve(account);
       if(!selected.enabled){forgetAuth(account);return {state:'expired',message:'本插件独立账号池已停用'}};
       const info=embeddedPack.status?.()??{state:'unavailable'};
       if(info.state!=='mounted')
         return {state:'error',message:'本插件内置渠道包未就绪，无法使用独立模型'};
       if(info.modelAdapterUnready?.includes(providerId))
         return {state:'error',message:'独立模型 Provider 尚未正确注册，不能作为可用模型'};
       if(Array.isArray(info.modelAdapterReady)&&!info.modelAdapterReady.includes(providerId))
         return {state:'pending',message:'独立账号已保存，等待本插件模型适配器就绪'};
       const remote=await readLiveFacts(account);
       if(remote.authVerified!==true)forgetAuth(account);
       if(remote.authVerified===true)
         return {state:'online',message:inferenceProof.has(account.id)?
           '本插件使用自有账号已完成真实模型推理':
           '本插件凭据通过渠道官方接口鉴权；模型推理尚待单独验证'};
       return {state:'pending',
         message:'已建立独立账号，但渠道官方尚未返回可信鉴权结果；不能显示可用'};
     }catch{
       forgetAuth(account);return {state:'error',message:'本插件独立账号不可读取或授权引用已失效'};
     }
   },

  async generate({account,model,options={},signal}={}){
   const phase=value=>{try{options.onVerificationPhase?.(value)}catch{}};
   phase('DRIVER_PRECHECK');
   if(providerId==='zcode')throw unable('Legacy ZCode Start Plan endpoint is restricted to the official client','OFFICIAL_CLIENT_ONLY');
   const selected=await resolve(account);
   if(!selected.enabled)throw unable('Source account is disabled','CREDENTIAL');
    const rows=await snapshot();
    // Preserve refusal by default; only an isolated instrumented source
    // facade may explicitly advertise a reviewed experimental channel.
    if(rows.filter(row=>row.enabled).length>1
      &&!embeddedPack.status?.().experimentalMultiAccountProviders?.includes(providerId))
      throw unable('Source provider has multiple enabled accounts; exact account selection is not verified');
     // For a free-only route, the gift must remain valid at the moment of
     // inference, not just when AutoFree first built the model catalog.
     // Preserve paid access on ordinary, explicitly paid user routes.
     const smoke=options.freeOnly===true||typeof options.sessionId==='string'&&(
       options.sessionId.startsWith('native-router-test-')
       ||options.sessionId==='native-router-smoke-host'
        ||options.sessionId==='native-router-bounded-cost');
      if(smoke&&providerId==='loomy'){
       phase('ENTITLEMENT_READ');
       const catalog=await embeddedPack.listModels(providerId,{sourceAccountId:selected.id,signal}).catch(()=>null);
       const peers=catalog?.state==='ready'?catalog.models.filter(row=>row.id===model):[];
       if(!peers.length||peers.some(row=>row.priceSource!=='loomy-official-model-name-ratio'||row.costMultiplier!==0)||!freeEvidence(peers[0],accountProviderId,peers))
         throw unable('Official zero rate not verified; gift balance alone cannot guarantee free use','COST_NOT_CONFIRMED_FREE');
       const facts=await readLiveFacts(account,{includeActivities:false,signal}).catch(()=>null);
       if(facts?.authVerified!==true)throw unable('Official account status not verified','CREDENTIAL');
     }
      if(options.singleLowCostProof===true){
        if(providerId!=='codearts'||accountProviderId!=='codearts'
          ||!Number.isFinite(options.approvedRate)||options.approvedRate<0
          ||options.approvedRate>0.1)
          throw unable('Nonzero proof missing an approved exact rate','COST_NOT_VERIFIED');
        // A new official model list immediately before sending must show
        // the exact same account-specific minimum and price, never a fallback.
        const checked=await embeddedPack.listModels('codearts');
        if(checked?.state!=='ready'||!Array.isArray(checked.models))
          throw unable('Official CodeArts catalog unavailable','COST_NOT_VERIFIED');
        const verified=checked.models.filter(row=>
          row.catalogSource==='codearts-signed-official-model-catalog'
          &&row.priceSource==='codearts-official-credit-ratio'
          &&typeof row.costMultiplier==='number'&&Number.isFinite(row.costMultiplier)
          &&row.costMultiplier>=0&&row.costMultiplier<=100)
          .sort((a,b)=>a.costMultiplier-b.costMultiplier||a.id.localeCompare(b.id));
        if(!verified.length||verified[0].id!==model
          ||verified[0].costMultiplier!==options.approvedRate)
          throw unable('Lowest CodeArts model or price changed','COST_NOT_VERIFIED');
        const facts=await readLiveFacts(account);
        if(facts?.authVerified!==true||facts.balanceState!=='available'
          ||!Number.isFinite(facts.balance)||facts.balance<=0)
          throw unable('Official CodeArts account balance unavailable','COST_NOT_VERIFIED');
      }
     const request={providerId,sourceAccountId:selected.id,model,
       messages:toSourceMessages(options,providerId,model),tools:visibleTools(options.tools),
       signal,...(Number.isInteger(options.maxTokens)&&options.maxTokens>0?{maxTokens:options.maxTokens}:{}),
       ...(smoke&&providerId==='loomy'&&model==='spark-x2.6'?{reasoningEffort:'none'}:{}),
        ...(providerId==='codearts'&&options.singleLowCostProof===true
          ?{reasoningEffort:'off',singleShotPriceProof:true}:{})};
     // One exact account must not amplify concurrent upstream calls. Respect
     // upstream rate windows in both normal routing and direct model tests.
     const streamKey=account.id,limitKey=streamKey+'\u0000'+model;
     for(const [key,until] of rateUntil)if(until<=Date.now())rateUntil.delete(key);
     const remaining=(rateUntil.get(limitKey)??0)-Date.now();
     if(remaining>0)throw new UpstreamError('Source model is cooling down',{code:'RATE_LIMIT',status:429,retryAfterMs:remaining});
     if(providerId==='loomy'&&activeStreams.has(streamKey))throw unable('Source account already has an active stream','SOURCE_BUSY');
     if(providerId==='loomy')activeStreams.add(streamKey);
     const controller=new AbortController();
     let timer,timedOut=false,onAbort,openingStarted=false;
     const stop=()=>controller.abort();
     const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;stop()},idleMs)};
     if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
     request.signal=controller.signal;
     try{
       if(controller.signal.aborted)throw unable('Source request cancelled','CANCELLED');
       arm();phase('STREAM_OPEN');
       const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(unable('Source stream stopped','CANCELLED'));controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort()});
       const opening=Promise.resolve().then(async()=>{
         if(controller.signal.aborted)throw unable('Source request cancelled','CANCELLED');
         openingStarted=true;invalidateWallet(account);
         const value=await embeddedPack.streamNative(request);
         if(controller.signal.aborted)try{Promise.resolve(value?.[Symbol.asyncIterator]?.()?.return?.()).catch(()=>{})}catch{}
         return value;
       });
       const native=await Promise.race([opening,cancelled]);
       controller.signal.removeEventListener('abort',onAbort);
       phase('STREAM_READ');arm();
       const output=await collectSourceDshStream(native,{tools:options.tools,signal:controller.signal,onProgress:phase,onActivity:arm});
       if(embeddedPack.status?.().state!=='mounted')
         throw unable('Isolated DSH source was disposed before completion');
       if(output.finishReason==='stop'&&typeof output.text==='string'&&output.text.trim())
         inferenceProof.set(account.id,{at:Date.now(),model});     return output;
   }catch(error){
    // The pack can fail before emitting the first event. Keep only vetted
    // machine failure facts for failover. Never expose arbitrary upstream
    // Error.message, even when the upstream happens to use UpstreamError.
    if(signal?.aborted){if(openingStarted)rateUntil.set(limitKey,Math.max(rateUntil.get(limitKey)??0,Date.now()+60000));throw unable('Isolated source request cancelled','CANCELLED')}
     const failure=new UpstreamError('Isolated DSH native source request failed',
       timedOut?{code:'TIMEOUT',status:408}:safeDshFailureFacts(error));
     if(['AUTH','CREDENTIAL','MISSING_CREDENTIAL'].includes(failure.code)||[401,403].includes(failure.status))forgetAuth(account);
     if(failure.code==='RATE_LIMIT'||failure.code==='TIMEOUT'||failure.status===429){
       const wait=failure.retryAfterMs||60000;
       rateUntil.set(limitKey,Math.max(rateUntil.get(limitKey)??0,Date.now()+wait));
     }
     if(['UPSTREAM_FINISH_ERROR','MISSING_NATIVE_FINISH','UNCLOSED_NATIVE_BLOCK']
       .includes(error?.safeStreamPhase))failure.safeStreamPhase=error.safeStreamPhase;
      throw failure;
    }finally{if(openingStarted)invalidateWallet(account);clearTimeout(timer);signal?.removeEventListener('abort',stop);if(onAbort)controller.signal.removeEventListener('abort',onAbort);activeStreams.delete(streamKey)}  },
 };
}
