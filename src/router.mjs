import {classifyFailure} from './failure.mjs';
import {createAccountPool} from './accounts.mjs';

export class RoutingError extends Error {
  constructor(code,message){super(message);this.name='RoutingError';this.code=code}
}
export function createRoutingEngine({getConfig,request,pool=createAccountPool(),onEvent=()=>{},onAttemptOutcome=()=>{}}) {
  if(typeof request!=='function')throw new Error('Routing transport is required');
  async function execute(routeId,{sessionId,needTools=false,signal,...options}={}) {
    const config=getConfig();
    const route=typeof routeId==='object' && routeId?.enabled ? routeId : config.routes.find(r=>r.id===routeId&&r.enabled);
    if(!route)throw new RoutingError('ERR_ROUTE_NOT_FOUND','DSH router chain is not available: '+routeId);
    if(signal?.aborted)throw new RoutingError('CANCELLED','DSH request cancelled');
    const tiers=route.mode==='free'?route.tiers.filter(t=>t.free===true)
      : route.mode==='pinned'?route.tiers.slice(0,1):route.tiers;
    if(!tiers.length)throw new RoutingError('ERR_FREE_EXHAUSTED','This route has no explicitly free model tiers');
    const maxTier=route.mode==='pinned'?1:Math.min(tiers.length,route.maxSwitches+1);
    // Route/credential changes are live owner decisions, not a snapshot
    // permission that lasts for the entire failed-provider fallback chain.
    // Every new attempt must be checked against the current authoritative
    // config. A completed but revoked account may not release DSH tool calls.
    function permitted(provider,account,tier){
      if(!provider||!account)return false;
      const live=getConfig(),active=live.providers.find(p=>p.id===provider.id);
      if(!active?.enabled||active.protocol!==provider.protocol||
        (needTools&&!active.supportsTools))return false;
      // AutoFree is a dynamic, object-valued route. Unlike a named route it
      // has no persisted tier list to re-read; lock its fee policy to the
      // exact owner declaration at selection time. Any in-flight change
      // fails closed before sending another request or releasing tool calls.
      if(route.mode==='free'&&typeof route.freePolicySignature==='string'
        &&route.freePolicySignature!==JSON.stringify(live.freePool??{}))return false;
      if(typeof routeId==='string'){
        const current=live.routes.find(row=>row.id===route.id&&row.enabled);
        if(!current||current.mode!==route.mode||!current.tiers.some(row=>
          row.providerId===tier.providerId&&row.model===tier.model&&
          (route.mode!=='free'||row.free)&&(!row.accountIds?.length||row.accountIds.includes(account.id))))return false;
      }
      if(tier.accountBindings&&tier.accountBindings[account.id]!==account.credentialRef)return false;
      if(provider.protocol==='dsh-host')return account.id==='__host_'+provider.id;
      return live.accounts.some(row=>row.id===account.id&&row.providerId===account.providerId
        &&row.credentialRef===account.credentialRef&&row.enabled===true);
    }
    let lastError, tried=0, eligibleFound=false;
    for(let tierIndex=0;tierIndex<maxTier;tierIndex++) {
      const tier=tiers[tierIndex],provider=config.providers.find(p=>p.id===tier.providerId);
      const accounts=pool.eligible(config,tier,{sessionId,needTools});
      if(accounts.length)eligibleFound=true;
      for(const account of accounts){
        if(signal?.aborted)throw new RoutingError('CANCELLED','DSH request cancelled');
        if(!permitted(provider,account,tier)||!pool.isReady(account,tier.model))continue;
        tried++;
        try{
           const output=await request({provider,account,model:tier.model,signal,
             options:{...options,sessionId,freeOnly:route.mode==='free',autoFreeSelection:['autofree','autofree-owned'].includes(route.id)&&route.mode==='free',officialFreeOnly:route.id==='autofree-owned'&&route.mode==='free'}});
           if(!permitted(provider,account,tier))            throw new RoutingError('ERR_ACCOUNT_CHANGED',
              'Owner revoked Provider or credential during model execution');
          pool.success(sessionId,account);
          try{onAttemptOutcome({provider,account,model:tier.model,output,signal})}catch{}
          onEvent({kind:'success',routeId:route.id,providerId:provider.id,model:tier.model,accountId:account.id,attempts:tried,usage:output?.usage??null},sessionId);
          return output;
        }catch(error){
          lastError=error;
          const reason=classifyFailure(error,signal);
          try{onAttemptOutcome({provider,account,model:tier.model,failure:reason,signal})}catch{}
          if(reason.code==='QUOTA')reason.cooldownMs=route.exhaustionCooldownMs;
          onEvent({kind:'failure',routeId:route.id,providerId:provider.id,model:tier.model,accountId:account.id,code:reason.code},sessionId);
          if(!reason.retryable)throw error;
          pool.mark(account,tier.model,reason);
          // All accounts of a non-ready Provider share the same failed
          // backend. Probe once per cooldown instead of blindly retrying
          // every sibling, and move directly to the next healthy Provider.
          if(reason.scope==='provider')break;
        }
      }
    }
    if(!eligibleFound){
      throw new RoutingError(needTools?'ERR_NO_TOOL_CAPABLE_ROUTE':route.mode==='free'?'ERR_FREE_EXHAUSTED':'ERR_ALL_ROUTES_UNAVAILABLE',
        needTools?'No eligible tool-capable route':'No configured model/account is currently eligible');
    }
    throw lastError ?? new RoutingError('ERR_ALL_ROUTES_UNAVAILABLE','No route was available');
  }
  return {execute,pool};
}
