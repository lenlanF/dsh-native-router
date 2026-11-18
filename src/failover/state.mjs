// Per-agent serialized failover state. Pure data structures, no Cordis imports.

export function createStateStore() {
  const states = new Map();

  function stateFor(agent) {
    let state = states.get(agent);
    if (state === undefined) {
      state = {
        agent,
        intent: undefined,
        running: undefined,
        stopping: false,
        switches: 0,
        // Only retries authored by THIS plugin may be rejected when stale;
        // DSH or another plugin can also create a legitimate retry message.
        ownedRetryIds: new Set(),
      };
      states.set(agent, state);
    }
    return state;
  }

  return {
    stateFor,
    get: (agent) => states.get(agent),
    delete: (agent) => states.delete(agent),
    values: () => states.values(),
    clear: () => states.clear(),
    size: () => states.size,
  };
}

/** Record one failover intent; duplicates of the same failed step are ignored. */
export function recordIntent(state, payload, failure) {
  if (state.stopping || state.intent !== undefined) return false;
  if (payload.signal?.aborted) return false;
  const key = `${payload.turn}:${payload.step}`;
  if (state.intent?.key === key) return false;
  state.intent = {
    key,
    turn: payload.turn,
    step: payload.step,
    provider: payload.provider,
    failure: Object.freeze({ code: failure.code, status: failure.status, message: failure.message }),
    queuedMessageId: undefined,
    stale: false,
  };
  return true;
}

export function clearIntent(state) {
  state.intent = undefined;
}

/** Competing human input wins: our automatic continuation must not overwrite it. */
export function noteIncoming(state, message) {
  if (state.intent === undefined) return false;
  const source = message?.source;
  if(source?.kind==='retry'&&state.ownedRetryIds?.has(message?.id))return false;
  clearIntent(state);
  return true;
}

/** Coalesce Agent notifications without losing idle signals received during a driver.
 * In real DSH AgentLoop, agent/error fires while status is still running and
 * agent/status=idle may fire before the first microtask's finally() settles.
 * Dropping that second signal can permanently strand the failure intent.
 */
export function requestDrive(state,drive,onError){
  if(state.stopping)return;
  if(state.running!==undefined){
    state.rerunPending=true;
    return;
  }
  const run=Promise.resolve().then(()=>drive(state)).catch(()=>{
    // Fail closed. Never let an unexpected driver rejection escape into DSH's
    // event loop or enqueue an uncontrolled second model/tool execution.
    clearIntent(state);
    state.driverFailed=true;
    try{onError?.()}catch{} // even an unexpected logger exception must not escape DSH
  }).finally(()=>{
    if(state.running!==run)return;
    state.running=undefined;
    if(state.rerunPending){
      state.rerunPending=false;
      if(!state.stopping&&state.intent!==undefined)requestDrive(state,drive,onError);
    }
  });
  state.running=run;
}
