// DSH host-level failover, merged with native-router.
import {normalizeRules,normalizeMode,qualifies,canSwitch,allowsSelection,firstUsableSelection,
  nextUsableSelection,markExhausted,normalizeExhausted,isExhausted,appendSwitchLog,DEFAULT_COOLDOWN_MS,
  sameSelection} from './failover/rules.mjs';
import {createStateStore,recordIntent,clearIntent,noteIncoming,requestDrive} from './failover/state.mjs';
import {randomUUID} from 'node:crypto';
import {allowsHostModel} from './host-model-selection.mjs';
// Equivalent to DSH createUserMessage for a zero-content retry intent:
// deepFreeze(structuredClone({...input,id:randomUUID(),role:'user'})).
// No runtime import of @deepseek-ai/dsh-llm (absent in unpack-only profiles).
export function createOwnedRetryMessage(input){
 const message=structuredClone({...input,id:randomUUID(),role:'user'});
 if(message.source&&typeof message.source==='object')Object.freeze(message.source);
 if(Array.isArray(message.content))Object.freeze(message.content);
 return Object.freeze(message);
}


export function attachHostFailover(ctx,{configStore,now=()=>Date.now(),createUserMessage}={}){
 const states=createStateStore(),config=()=>configStore.get().hostFailover;
  const cfg=config();
  const permittedRules=next=>({...next,priority:(next.priority??[])
    .filter(row=>allowsHostModel(configStore.get(),row.provider,row.model))});
  let rules=normalizeRules({...permittedRules(cfg),enabled:cfg.enabled}),mode=normalizeMode(cfg.mode);
  function refreshRules(){const next=config();rules=normalizeRules({...permittedRules(next),enabled:next.enabled});mode=normalizeMode(next.mode)}
 let spent=normalizeExhausted(cfg.exhaustedRoutes??{},now(),cfg.exhaustionCooldownMs);
 const disposers=[];
 const log=(level,msg)=>ctx.logger?.[level]?.('native-router failover: '+msg);
 const selected=agent=>{try{return agent?.model?.current?.()}catch{return undefined}};
 const cooldown=()=>config().exhaustionCooldownMs??DEFAULT_COOLDOWN_MS;
 const available=()=>firstUsableSelection(rules,{exhausted:spent,now:now(),cooldownMs:cooldown(),mode});
 function persistExhausted(){
   try{const full=configStore.get();configStore.replace({...full,hostFailover:{...full.hostFailover,exhaustedRoutes:spent}})}
   catch(error){log('warn','exhausted-route persistence failed: '+String(error?.message??error))}
 }
  function persistSwitch(from,to,code){
    try{const full=configStore.get();const hf=full.hostFailover;
      const switchLog=appendSwitchLog(hf.switchLog??[],{from,to,code,at:now(),reason:'auto'},hf.switchLogLimit??20);
      configStore.replace({...full,hostFailover:{...hf,switchLog}});
    }catch(error){log('warn','switch log persistence failed: '+String(error?.message??error))}
  }
  const on=(event,fn)=>{const remove=ctx.on?.(event,fn);if(typeof remove==='function')disposers.push(remove)};
  // Live owner policy is stronger than a candidate chosen before awaiting
  // model availability / retry-message creation. In particular toggling to
  // free-only must NEVER enqueue a previously selected paid candidate.
  function stillPermitted(target){
    refreshRules();
    // 'off' disables per-step enforcement, NOT the owner's configured
    // priority allowlist for an automatically chosen backup target.
    return allowsHostModel(configStore.get(),target.provider,target.model)
      &&rules.priority.some(item=>sameSelection(item,target))
      &&(mode==='off'||allowsSelection(target,rules,mode));
  }
  async function drive(state){
    const {agent,intent}=state;
    const current=()=>!state.stopping&&state.intent===intent&&!intent?.stale
      &&agent.status!=='running'&&config().enabled
      &&(!ctx.agents?.get||ctx.agents.get(agent.id)===agent);
    refreshRules();
    if(!current()||intent.queuedMessageId)return; // Never enqueue a second retry while the first is pending.
    if(!canSwitch(state,rules,now())){clearIntent(state);return}
    let next=nextUsableSelection(selected(agent),rules,{exhausted:spent,now:now(),cooldownMs:cooldown(),mode});
    if(!next){clearIntent(state);return}
    const factory=createUserMessage??createOwnedRetryMessage;
    if(!current())return;
    for(let count=0;next&&count<rules.priority.length;count++){
      let message;
      try{
        if(ctx.llm?.resolveCallConfig)await ctx.llm.resolveCallConfig({provider:next.provider,model:next.model});
        if(!current())return; // Human input / newer Agent step wins over async model validation.
        if(!stillPermitted(next)){clearIntent(state);return}
        if(typeof agent.model?.select!=='function'||typeof agent.followup!=='function')
          throw Error('DSH agent selection API missing');
        message=await factory({content:[],source:{kind:'retry'}});
        if(!current())return;
        if(!stillPermitted(next)){clearIntent(state);return}
        if(typeof message?.id!=='string'||!message.id)
          throw Error('DSH retry message needs a stable ID');
      }catch(error){
        if(!current())return;
        log('warn','unusable target '+next.provider+'/'+next.model+': '+String(error?.message??error));
        spent=markExhausted(spent,next,now());persistExhausted();
        next=nextUsableSelection(next,rules,{exhausted:spent,now:now(),cooldownMs:cooldown(),mode});
        continue;
      }
      const previous=selected(agent);
      try{
        agent.model.select({provider:next.provider,model:next.model,
          ...(next.reasoningEffort?{reasoningEffort:next.reasoningEffort}:{})});
      }catch(error){
        log('warn','cannot select '+next.provider+'/'+next.model+': '+String(error?.message??error));
        spent=markExhausted(spent,next,now());persistExhausted();
        next=nextUsableSelection(next,rules,{exhausted:spent,now:now(),cooldownMs:cooldown(),mode});
        continue;
      }
      // model.select() may synchronously invoke another plugin/owner callback
      // that edits the backup list or enables free-only mode. Check once more
      // after this reentrant boundary, before enqueueing a retry which could
      // otherwise invoke an undesired paid model or replay completed tools.
      if(!current()||!stillPermitted(next)){
        clearIntent(state);
        if(agent.status!=='running'){
          try{if(previous?.provider&&previous.model)agent.model.select(previous)}catch{}
        }
        return;
      }
      // Publish intent before followup because an Agent may process followup synchronously.
      state.intent={...intent,queuedMessageId:message.id};
      state.ownedRetryIds.add(message.id);
      if(state.ownedRetryIds.size>64)
        state.ownedRetryIds.delete(state.ownedRetryIds.values().next().value);
      try{
        agent.followup(message);
      }catch(error){
        // A followup API exception may be raised after enqueuing: NEVER submit
        // another retry to a different model (would replay committed tools).
        clearIntent(state);
        try{if(previous?.provider&&previous.model)agent.model.select(previous)}catch{}
        log('warn','DSH followup failed, automatic replay halted: '+String(error?.message??error));
        return;
      }
      state.switches++;state.lastSwitchAt=now();
       persistSwitch(previous,next,intent.failure.code);
       log('info','switched to '+next.provider+'/'+next.model+' ('+intent.failure.code+')');
      return;
    }
    if(current())clearIntent(state);
  }
  on('agent/request-error',async(payload,next)=>{
    const downstream=typeof next==='function'?await next():undefined;
    refreshRules();
   if(!config().enabled||downstream?.kind==='retry'||payload.signal?.aborted)return downstream;
   if(!qualifies(payload.failure,rules))return downstream;
   if(['QUOTA','ACCOUNT_QUOTA'].includes(payload.failure?.code)){
     const failed=payload.provider?{provider:payload.provider,model:payload.model??selected(payload.agent)?.model}:selected(payload.agent);
     if(failed?.provider&&failed.model){spent=markExhausted(spent,failed,now());persistExhausted()}
   }
   recordIntent(states.stateFor(payload.agent),payload,payload.failure);
   return downstream;
 });
  const schedule=agent=>{const st=states.stateFor(agent);if(st.intent)requestDrive(st,drive,
    ()=>log('warn','automatic model continuation halted after internal scheduling error'))};
 on('agent/error',({agent})=>schedule(agent));
 on('agent/status',({agent,status})=>{if(status==='idle')schedule(agent)});
  // Synchronous inbox notification happens BEFORE a waking Agent prepares
  // its step. This is the only safe point to select a pinned/free route:
  // agent/pre-step receives a *captured* modelSelection that cannot be changed
  // for the already-prepared request (DSH AgentLoop public contract).
  function enforceBeforePreparation(agent){
    refreshRules();
    if(!config().enabled||mode==='off'||agent?.status==='running')return;
    const current=selected(agent);
    if(allowsSelection(current,rules,mode)
      &&!isExhausted(spent,current,now(),cooldown()))return;
    const target=available();
    if(!target){log('warn','no permitted available model before Agent step');return}
    try{
      agent.model.select({provider:target.provider,model:target.model,
        ...(target.reasoningEffort?{reasoningEffort:target.reasoningEffort}:{})});
    }catch(error){log('warn','cannot preselect permitted model: '+String(error?.message??error))}
  }
  on('agent/created',({agent})=>enforceBeforePreparation(agent));
  on('agent/inbox/inserted',({agent,message})=>{
    const st=states.get(agent);
    if(st)noteIncoming(st,message);
    // A newly inserted message may start a turn synchronously after this emit.
    enforceBeforePreparation(agent);
  });
  on('agent/disposed',({agent})=>{const st=states.get(agent);
    if(st){st.stopping=true;clearIntent(st)}
    states.delete(agent)});
  on('agent/pre-step',async({agent,messages=[],modelSelection},next)=>{
    refreshRules();
    if(!config().enabled)return typeof next==='function'?next():{kind:'enter',messages};
    // Use the DSH-captured route, not model.current(), which may now name
    // a different future step. Selecting a model here is already too late.
    const captured=modelSelection??selected(agent);
    if(mode==='free'&&!available())return {kind:'reject'};
    if(mode!=='off'&&(!allowsSelection(captured,rules,mode)
      ||isExhausted(spent,captured,now(),cooldown()))){
      log('warn','DSH step rejected: prepared route is disallowed; no model or tools were invoked');
      return {kind:'reject'};
    }
    const state=states.get(agent),reserved=state?.intent?.queuedMessageId;
    const ownedRetry=messages.find(msg=>state?.ownedRetryIds?.has(msg.id));
    // A legitimate DSH retry emitted by another caller is NOT ours to block.
    // An orphaned message that WE enqueued is rejected after new human input.
    if(ownedRetry&&(!reserved||ownedRetry.id!==reserved))return {kind:'reject'};
    const decision=typeof next==='function'?await next():{kind:'enter',messages};
    if(state&&reserved&&(ownedRetry||decision?.kind==='enter'))clearIntent(state);
    return decision;
  });
 const dispose=()=>{for(const st of states.values()){st.stopping=true;clearIntent(st)}for(const fn of disposers.reverse())fn();states.clear()};
 return {dispose,states,status:()=>({enabled:config().enabled,mode,exhaustedRoutes:{...spent}})};
}
