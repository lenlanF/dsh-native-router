export class CredentialError extends Error { constructor(message){super(message);this.name='CredentialError';this.code='CREDENTIAL'} }
export async function resolveCredential(account, { env=process.env, vault } = {}) {
  if (account.credentialRef.startsWith('env:')) {
    const value=env[account.credentialRef.slice(4)];
    if (typeof value !== 'string' || !value.trim()) throw new CredentialError('Missing credential environment variable for account: '+account.id);
    return value.trim();
  }
  if (account.credentialRef.startsWith('host:')) {
    if (!vault || typeof vault.resolve !== 'function') throw new CredentialError('DSH credential service unavailable for account: '+account.id);
    let value;try{value=await vault.resolve(account.credentialRef.slice(5))}
    catch{throw new CredentialError('DSH credential lookup failed for account: '+account.id)}
    const token=typeof value==='string'?value:value?.value;
    if (typeof token !== 'string' || !token.trim()) throw new CredentialError('Credential unavailable for account: '+account.id);
    return token.trim();
  }
  throw new Error('Unsupported credential reference');
}
export function createAccountPool({now=()=>Date.now()}={}) {
  const exhausted=new Map(), stickiness=new Map(), cursor=new Map();
  const key=(id,model)=>id+'\u0000'+model;
  function mark(account, model, reason) {
    const cooldown=reason.cooldownMs || 30000;
    exhausted.set(key(account.id,reason.code==='AUTH'||reason.code==='CREDENTIAL'
      ||reason.scope==='provider'?'*':model),{until:now()+cooldown,code:reason.code});
    // Session stickiness is revoked after a failed account attempt.
    for(const [sid,id] of stickiness)if(id===account.id)stickiness.delete(sid);
  }
  function isReady(account,model){return (exhausted.get(key(account.id,model))?.until ?? 0)<=now() && (exhausted.get(key(account.id,'*'))?.until ?? 0)<=now()}
  function eligible(config,tier,{sessionId,needTools=false}={}) {
    const provider=config.providers.find(p=>p.id===tier.providerId);
    if(!provider?.enabled || (needTools&&!provider.supportsTools))return [];
    // Host-managed providers use the ORIGINAL plugin's own account selection.
    // No duplicate token, imported secret or synthetic persisted account exists.
    if(provider.protocol==='dsh-host'){
      // The host still owns its real login. This virtual identity only tracks
      // per-Provider/model failures and MUST honor the same cooldown as an
      // independently owned account. Otherwise a failed Host is retried on
      // every AutoFree turn, or every model after a 401, despite being marked.
      const host={id:'__host_'+provider.id,providerId:provider.id,enabled:true,weight:1};
      return !tier.accountIds?.length&&isReady(host,tier.model)?[host]:[];
    }
    const allowed=tier.accountIds?.length?new Set(tier.accountIds):null;
    const accounts=config.accounts.filter(a=>a.enabled&&a.providerId===tier.providerId&&(!allowed||allowed.has(a.id))&&isReady(a,tier.model));
    if(!accounts.length)return [];
    const previous=stickiness.get(sessionId);
    const preferred=accounts.find(a=>a.id===previous);
    const rest=accounts.filter(a=>a.id!==previous).sort((a,b)=>a.id.localeCompare(b.id));
    const ring=rest.flatMap(a=>Array(Math.min(100,Math.max(1,a.weight))).fill(a));
    const ticketKey=tier.providerId+'\\u0000'+tier.model;
    const offset=ring.length?(cursor.get(ticketKey)??0)%ring.length:0;
    cursor.set(ticketKey,(cursor.get(ticketKey)??0)+1);
    // First candidate is weighted; remaining candidates are distinct fallbacks.
    const first=ring[offset];
    const ordered=first?[first,...rest.filter(a=>a.id!==first.id)]:[];
    return preferred?[preferred,...ordered]:ordered;
  }
  return {
    mark,eligible,isReady,
    success(sessionId,account){if(sessionId)stickiness.set(sessionId,account.id)},
    status(){return {exhausted:[...exhausted].map(([key,v])=>({accountId:key.split('\u0000')[0],model:key.split('\u0000')[1],...v}))}},
    clear(){exhausted.clear();stickiness.clear();cursor.clear()},
  };
}
