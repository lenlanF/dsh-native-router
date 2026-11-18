import {classifyFailure} from './failure.mjs';
import {createAccountPool} from './accounts.mjs';

export class RoutingError extends Error {
  constructor(code,message){super(message);this.name='RoutingError';this.code=code}
}
export function createRoutingEngine({getConfig,request,pool=createAccountPool(),onEvent=()=>{}}) {
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
    let lastError, tried=0, eligibleFound=false;
    for(let tierIndex=0;tierIndex<maxTier;tierIndex++) {
      const tier=tiers[tierIndex],provider=config.providers.find(p=>p.id===tier.providerId);
      const accounts=pool.eligible(config,tier,{sessionId,needTools});
      if(accounts.length)eligibleFound=true;
      for(const account of accounts){
        if(signal?.aborted)throw new RoutingError('CANCELLED','DSH request cancelled');
        tried++;
        try{
          const output=await request({provider,account,model:tier.model,signal,options});
          pool.success(sessionId,account);
          onEvent({kind:'success',routeId:route.id,providerId:provider.id,model:tier.model,accountId:account.id,attempts:tried,usage:output?.usage??null});
          return output;
        }catch(error){
          lastError=error;
          const reason=classifyFailure(error,signal);
          if(reason.code==='QUOTA')reason.cooldownMs=route.exhaustionCooldownMs;
          onEvent({kind:'failure',routeId,providerId:provider.id,model:tier.model,accountId:account.id,code:reason.code});
          if(!reason.retryable)throw error;
          pool.mark(account,tier.model,reason);
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
