// Isolated DSH-native channel-pack driver. Reuses the upstream DSH llm service;
// no duplicate OAuth, model protocol, sign-in, or credential implementation.
import {randomUUID} from 'node:crypto';
import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {UpstreamError,safeDshFailureFacts} from './failure.mjs';
import {visibleTools} from './host-tools.mjs';
import {flattenContent} from './protocol.mjs';
import {validateModelCalls} from './provider/openai.mjs';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';

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
export async function collectSourceDshStream(stream,{tools=[],signal}={}){
 if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
  throw unable('DSH source adapter did not return an async stream','TOOL_PROTOCOL');
 let text='',reasoning='',usage=null,finish=null,total=0;
 const calls=new Map(),blocks=new Map(),closed=new Set();
 function charge(value){
  total+=Buffer.byteLength(value,'utf8');
  if(total>MAX_OUTPUT_BYTES)throw unable('Native model output exceeded size limit','RESPONSE_SIZE');
 }
 for await(const item of stream){
  if(signal?.aborted)throw unable('Native model request was cancelled','CANCELLED');
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
     throw new UpstreamError('Native DSH source did not complete successfully',{
       status:facts.status,
       code:item.reason?.kind==='aborted'?'CANCELLED':
         facts.code==='UPSTREAM'?'STREAM':facts.code,
       retryAfterMs:facts.retryAfterMs,
     });
    }
    finish=item.reason.kind;
    break;
   default:throw unable('Unsupported native model event type','TOOL_PROTOCOL');
  }
 }
 if(finish===null||closed.size!==blocks.size)
  throw unable('Native model stream ended before complete finish','TRUNCATED');
 const toolCalls=[...calls].sort((a,b)=>a[0]-b[0]).map(([,x])=>x);
 if(finish==='tool-calls'&&!toolCalls.length)
  throw unable('Native model declared tool calls but emitted none','TOOL_PROTOCOL');
 if(!text.trim()&&!reasoning.trim()&&!toolCalls.length)
  throw unable('Native model yielded an empty response','EMPTY');
 const output={text,reasoning,toolCalls,finishReason:toolCalls.length?'tool_calls':
  finish==='max-tokens'?'length':'stop'};
 if(usage)output.usage={prompt_tokens:usage.inputTokens,completion_tokens:usage.outputTokens,
  total_tokens:usage.totalTokens};
 return validateModelCalls(output,tools);
}
export function createSourceChannelDriver({providerId,embeddedPack,accountProviderId=providerId}={}){
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
  const liveFacts=new Map(),inferenceProof=new Map();
  async function readLiveFacts(account){
    const selected=await resolve(account);
    if(!selected.enabled)return {state:'disabled',authVerified:false};
    if(typeof embeddedPack.readSourceStatuses!=='function')
      return {state:'unavailable',authVerified:false};
    // Every request is served by THIS plugin's isolated account pool and
    // official-channel APIs. Original plugin metadata is never consulted.
    const remote=await embeddedPack.readSourceStatuses(providerId);
    const matched=(remote?.state==='ready'&&Array.isArray(remote.accounts)
      ?remote.accounts:[]).filter(row=>row?.accountId===selected.id);
    if(matched.length!==1)return {state:'unavailable',authVerified:false};
    const {accountId,...facts}=matched[0];
    const result={...facts,state:'ready',
      checkedAt:remote.checkedAt??Date.now()};
    liveFacts.set(account.id,result);
    return result;
  }
  return {
   isSourceBridge:true,
   get runtimeReady(){const status=embeddedPack.status?.();return status?.state==='mounted'
     &&(!Array.isArray(status.channels)||status.channels.includes(providerId))},
   authMethod:accountProviderId.startsWith('own_')?
     '本插件自有凭据 · 直接查询渠道官方服务':'渠道账号引用 · 尚未独立接管',
   accountSnapshot(account){
     return {...(liveFacts.get(account?.id)??{}),
       modelInferenceVerifiedAt:inferenceProof.get(account?.id)?.at??null};
   },
   async refreshAccountStatus({account}={}){
     try{return await readLiveFacts(account)}
     catch{return {state:'unavailable',authVerified:false}}
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
   async listModels({account}={}){
     await resolve(account);
     const result=await embeddedPack.listModels(providerId);
      if(result.state!=='ready')throw unable('Source provider model list is unavailable');
      // ZCode Start Plan has a separate official JWT-backed gifted quota.
      // A positive authenticated balance alone is NOT a free model: only
      // the known GLM-5.3 Flash route and a sufficiently funded gift bucket
      // may be offered. Never label ZCode Coding Plan or other models free.
      let giftedStartPlan=false;
      if(providerId==='zcode'&&accountProviderId==='own_zcode'
        &&result.models?.some(row=>row?.id==='glm-5.3-flash')){
        const facts=await readLiveFacts(account).catch(()=>null);
        giftedStartPlan=facts?.authVerified===true
          &&facts.balanceState==='available'
          &&Number.isFinite(facts.giftedBalance)&&facts.giftedBalance>=1024;
      }
      // Loomy official points/records reports a separate daily gifted pool.
      // The owned channel pack selects this before permanent purchased points.
      // Allow only Spark X2.6 and only with a substantial verified gift buffer.
      let giftedLoomy=false;
      if(providerId==='loomy'&&accountProviderId==='own_loomy'
        &&result.models?.some(row=>row?.id==='spark-x2.6')){
        const facts=await readLiveFacts(account).catch(()=>null);
        giftedLoomy=facts?.authVerified===true&&facts.balanceState==='available'
          &&Number.isFinite(facts.loomyDailyGift)&&facts.loomyDailyGift>=2000;
      }
      // Preserve vetted zero-price/free facts from this plugin's isolated
     // source pack: dropping them prevented safe real free-model testing.
     return result.models.filter(row=>row&&typeof row.id==='string')
       .map(row=>({id:row.id,
         ...(typeof row.name==='string'?{name:row.name}:{}),
         ...(row.upstreamFreeLabel===true||row.isFree===true||row.free===true
           ?{upstreamFreeLabel:true}:{}),
          ...(row.pricing?{pricing:{...row.pricing}}:{}),
           ...(giftedStartPlan&&row.id==='glm-5.3-flash'
             ?{freeAllowance:'zcode-start-plan-gift'}:{}),
           ...(giftedLoomy&&row.id==='spark-x2.6'
             ?{freeAllowance:'loomy-daily-gift'}:{})}));
   },
   // Model directory merely indicates advertised candidates. Account-level
   // proof requires official provider API, or an actual successful inference.
   async refresh({account}={}){
     try{
       const selected=await resolve(account);
       if(!selected.enabled)return {state:'expired',message:'本插件独立账号池已停用'};
       const info=embeddedPack.status?.()??{state:'unavailable'};
       if(info.state!=='mounted')
         return {state:'error',message:'本插件内置渠道包未就绪，无法使用独立模型'};
       if(info.modelAdapterUnready?.includes(providerId))
         return {state:'error',message:'独立模型 Provider 尚未正确注册，不能作为可用模型'};
       if(Array.isArray(info.modelAdapterReady)&&!info.modelAdapterReady.includes(providerId))
         return {state:'pending',message:'独立账号已保存，等待本插件模型适配器就绪'};
       const remote=await readLiveFacts(account);
       if(remote.authVerified===true||inferenceProof.has(account.id))
         return {state:'online',message:inferenceProof.has(account.id)?
           '本插件使用自有账号已完成真实模型推理':
           '本插件凭据通过渠道官方接口鉴权；模型推理尚待单独验证'};
       return {state:'pending',
         message:'已建立独立账号，但渠道官方尚未返回可信鉴权结果；不能显示可用'};
     }catch{
       return {state:'error',message:'本插件独立账号不可读取或授权引用已失效'};
     }
   },

  async generate({account,model,options={},signal}={}){
   const selected=await resolve(account);
   if(!selected.enabled)throw unable('Source account is disabled','CREDENTIAL');
    const rows=await snapshot();
    // Preserve refusal by default; only an isolated instrumented source
    // facade may explicitly advertise a reviewed experimental channel.
    if(rows.filter(row=>row.enabled).length>1
      &&!embeddedPack.status?.().experimentalMultiAccountProviders?.includes(providerId))
      throw unable('Source provider has multiple enabled accounts; exact account selection is not verified');
   const request={providerId,sourceAccountId:selected.id,model,
    messages:toSourceMessages(options,providerId,model),tools:visibleTools(options.tools),
    signal,...(Number.isInteger(options.maxTokens)&&options.maxTokens>0?{maxTokens:options.maxTokens}:{})};
   try{
    const native=await embeddedPack.streamNative(request);
    const output=await collectSourceDshStream(native,{tools:options.tools,signal});
    if(embeddedPack.status?.().state!=='mounted')throw unable('Isolated DSH source was disposed before completion');
     inferenceProof.set(account.id,{at:Date.now(),model});
     return output;
   }catch(error){
    // The pack can fail before emitting the first event. Keep only vetted
    // machine failure facts for failover. Never expose arbitrary upstream
    // Error.message, even when the upstream happens to use UpstreamError.
    if(signal?.aborted)throw unable('Isolated source request cancelled','CANCELLED');
    throw new UpstreamError('Isolated DSH native source request failed',
      safeDshFailureFacts(error));
   }
  },
 };
}
