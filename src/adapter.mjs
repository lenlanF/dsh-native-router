import {createRoutingEngine} from './router.mjs';
import {createCatalog,directModelDecode} from './catalog.mjs';
import {createAccountPool} from './accounts.mjs';
import {requestOpenAI} from './provider/openai.mjs';
import {requestAnthropic} from './provider/anthropic.mjs';
import {validateModelCalls} from './provider/openai.mjs';
import {UpstreamError} from './failure.mjs';
import {toDshEvents} from './protocol.mjs';
import {RoutingError} from './router.mjs';
import {toSourceMessages,collectSourceDshStream} from './source-channel-driver.mjs';
import {visibleTools} from './host-tools.mjs';
import {createAutoFreePool} from './auto-free.mjs';

export const PROVIDER='native-router';
export function createNativeRouterAdapter({configStore,fetchImpl=fetch,env=process.env,vault,logger,channelDrivers=new Map(),hostProviderInventory,ownedPack}={}){
  if(!configStore?.get)throw new Error('ConfigStore required');
  const autoFreePool=createAutoFreePool({hostProviderInventory,ownedPack,
    getConfig:()=>configStore.get()});
   let verifiedAccount=()=>true;
   const getConfig=()=>{
     const cfg=autoFreePool.effectiveConfig(configStore.get());
     cfg.accounts=cfg.accounts.filter(a=>{
       const p=cfg.providers.find(provider=>provider.id===a.providerId);
       return p?.protocol!=='native-channel'||verifiedAccount(a)===true;
     });
     return cfg;
   };
  let freeCursor=0;
  const pool=createAccountPool();
  const counters={successfulTurns:0,failedAttempts:0,inputTokens:0,outputTokens:0};
  const history=[];
  const driverFor=id=>channelDrivers instanceof Map?channelDrivers.get(id):channelDrivers?.[id];
  const transport=async arg=>{
    if(arg.provider.protocol==='dsh-host'){
      if(typeof hostProviderInventory?.streamHost!=='function')
        throw new UpstreamError('Original DSH provider is not connected',{code:'PROVIDER_NOT_READY'});
      try{
        const native=await hostProviderInventory.streamHost({providerId:arg.provider.id,model:arg.model,
          messages:toSourceMessages(arg.options,arg.provider.id,arg.model),
          tools:visibleTools(arg.options.tools),signal:arg.signal,
          maxTokens:arg.options.maxTokens});
        return await collectSourceDshStream(native,{tools:arg.options.tools,signal:arg.signal});
      }catch(error){
        if(error instanceof UpstreamError)throw error;
        if(arg.signal?.aborted)throw new UpstreamError('Host request cancelled',{code:'CANCELLED'});
        throw new UpstreamError('Original DSH plugin request failed',{
          code:'UPSTREAM',status:Number.isInteger(error?.status)?error.status:0});
      }
    }
    if(arg.provider.protocol==='native-channel'){
      const driver=driverFor(arg.provider.id);
      if(typeof driver?.generate!=='function')throw new UpstreamError('Native provider driver unavailable',{code:'PROVIDER_NOT_READY'});
      const result=await driver.generate({provider:arg.provider,account:arg.account,model:arg.model,
        options:arg.options,signal:arg.signal});
      if(!result||typeof result!=='object'||!['stop','tool_calls','length'].includes(result.finishReason))
        throw new UpstreamError('Native provider returned invalid completed response',{code:'TOOL_PROTOCOL'});
      return validateModelCalls(result,arg.options.tools);
    }
    return (arg.provider.protocol==='anthropic-messages'?requestAnthropic:requestOpenAI)(arg,{fetchImpl,env,vault});
  };
  const engine=createRoutingEngine({getConfig,request:transport,pool,onEvent:evt=>{
    if(evt.kind==='failure'){counters.failedAttempts++;logger?.warn?.('native-router: '+evt.code+' from '+evt.providerId+'/'+evt.model)}
    if(evt.kind==='success'){
      counters.successfulTurns++;
      counters.inputTokens+=Number.isFinite(evt.usage?.prompt_tokens)?evt.usage.prompt_tokens:0;
      counters.outputTokens+=Number.isFinite(evt.usage?.completion_tokens)?evt.usage.completion_tokens:0;
    }
    const {usage,...safe}=evt;
    history.push({at:Date.now(),...safe});if(history.length>50)history.shift();
  }});
  const catalog=createCatalog({getConfig,fetchImpl,credentialOptions:{env,vault},
    channelDrivers,hostProviderInventory,autoFreePool});
  async function routeForModel(model){
    if(typeof model!=='string')throw new RoutingError('ERR_ROUTE_NOT_FOUND','Invalid DSH model');
    if(model==='autofree'){
      await autoFreePool.refresh();
       const current=getConfig();
       const items=autoFreePool.tiers().filter(tier=>{
         const p=current.providers.find(x=>x.id===tier.providerId);
         return p?.protocol==='dsh-host'||current.accounts.some(a=>
           a.providerId===tier.providerId&&a.enabled);
       });
      if(!items.length)throw new RoutingError('ERR_FREE_EXHAUSTED',
        'No upstream-confirmed free models are currently available; unknown pricing is excluded');
      const shift=freeCursor++%items.length;
      const ordered=[...items.slice(shift),...items.slice(0,shift)].slice(0,50);
      return {id:'autofree',name:'AutoFree',mode:'free',enabled:true,tiers:ordered,
        maxSwitches:ordered.length-1,exhaustionCooldownMs:21600000};
    }
    if(model.startsWith('chain:'))return model.slice(6);
    const direct=directModelDecode(model);
    if(direct){
      const published=await catalog.list();
      if(!published.some(row=>row.id===model))throw new RoutingError('ERR_ROUTE_NOT_FOUND','Direct model was not advertised by this provider');
      const config=getConfig(),provider=config.providers.find(p=>p.id===direct.providerId&&p.enabled);
      if(!provider)throw new RoutingError('ERR_ROUTE_NOT_FOUND','Provider not configured');
      return {id:model,name:model,mode:'pinned',enabled:true,tiers:[{providerId:direct.providerId,model:direct.model,free:false,accountIds:[]}],maxSwitches:0};
    }
    throw new RoutingError('ERR_ROUTE_NOT_FOUND','Unknown model: '+model);
  }
  async function* stream(options={}){
    if(options.signal?.aborted){
      yield {type:'finish',reason:{kind:'aborted',failure:{message:'Request cancelled'}}};return;
    }
    const id=await routeForModel(options.model);
    const output=await engine.execute(id,{signal:options.signal,sessionId:options.sessionId??options.agentId??'',needTools:Array.isArray(options.tools)&&options.tools.length>0,...options});
    yield* toDshEvents(output);
  }
  return {
    providerInfo(){return {id:PROVIDER,name:'聚合路由'}},
    providerRetryPolicy(){return undefined},
    imageRequestPricing(){return undefined},
    imageRequestTarget(){return undefined},
    async listModels(){return catalog.list()},
    async resolveModel(provider,model){const rows=await catalog.list();const found=rows.find(x=>x.id===model);
      return {provider:provider??PROVIDER,id:model,name:found?.name??model,inputModalities:['text']}},
    async prepareCall(provider,model){return {model:await this.resolveModel(provider,model),stream}},
    stream,
     invalidateCatalog(){catalog.invalidate();autoFreePool.invalidate()},
     setAccountVerificationResolver:fn=>{
       verifiedAccount=typeof fn==='function'?fn:()=>false;
       catalog.invalidate();
     },
    autoFreeSnapshot(){return autoFreePool.snapshot()},
    async refreshAutoFree(){await autoFreePool.refresh({force:true});catalog.invalidate();
      return autoFreePool.snapshot()},
    getStatus(){const cfg=configStore.get();return {routes:cfg.routes.length,
      providers:getConfig().providers.length,accounts:getConfig().accounts.length,
      autoFree:{count:autoFreePool.snapshot().models.length,scannedAt:autoFreePool.snapshot().scannedAt},
      accountCooldowns:pool.status().exhausted,metrics:{...counters},recentRoutes:history.slice(-20)}},
  };
}
