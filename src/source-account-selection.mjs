import {AsyncLocalStorage} from 'node:async_hooks';

// Ephemeral request-local account gate for the pinned upstream pack.
// This is an EXPERIMENTAL isolated-profile adapter. It never writes source
// account enabled flags or copies provider secrets into the native config.
export function installSourceAccountSelection({pool,credentials,isAlive=()=>true}={}){
  if(typeof pool?.getAvailableAccount!=='function'
    ||typeof pool?.listAccountsByProvider!=='function'
    ||typeof pool?.listAllAccounts!=='function'
    ||typeof credentials?.resolve!=='function')
    throw Error('Source account guard prerequisites unavailable');
  const storage=new AsyncLocalStorage(),originals=[];
  let disposed=false,activeStreams=0,restored=false;
  function context(){
    const current=storage.getStore();
    if(!current)return null;
    if(disposed||!isAlive()||current.signal?.aborted)
      throw Error('Isolated source account selection is no longer active');
    return current;
  }
  function installMethod(object,key,factory){
    const original=object[key];
    if(typeof original!=='function')return;
    const hooked=factory(original);
    object[key]=hooked;
    if(object[key]!==hooked)throw Error('Source account guard could not wrap '+key);
    originals.push({object,key,original,hooked});
  }
  function restoreFinal(){
    if(restored||activeStreams>0)return;
    restored=true;
    for(const item of [...originals].reverse())
      if(item.object[item.key]===item.hooked)item.object[item.key]=item.original;
    storage.disable();
  }
  function restore(){disposed=true;restoreFinal()}
  try{
    installMethod(pool,'getAvailableAccount',old=>async function(provider,model='',exclude){
      const selected=context();
      if(!selected)return old.call(this,provider,model,exclude);
      if(provider!==selected.providerId||typeof model!=='string')
        throw Error('Source attempted cross-provider account selection');
      const rows=pool.listAccountsByProvider(provider);
      if(rows.length!==1||rows[0].id!==selected.accountId||exclude?.has?.(selected.accountId))
        throw Error('Selected source account is no longer eligible');
      const excludes=new Set(Array.isArray(exclude)?exclude:exclude instanceof Set?[...exclude]:[]);
      const all=selected.allProviderAccountIds;
      for(const id of all)if(id!==selected.accountId)excludes.add(id);
      const result=await old.call(this,provider,model,excludes);
      if(result?.entry?.id!==selected.accountId)
        throw Error('Upstream refused the specifically selected source account');
      selected.selected=true;
      return result;
    });
    installMethod(pool,'listAccountsByProvider',old=>function(provider,...args){
      const selected=context();
      const rows=old.call(this,provider,...args);
      if(!selected)return rows;
      if(provider!==selected.providerId||!Array.isArray(rows))
        throw Error('Source tried to list a different provider while pinned');
      return rows.filter(row=>row?.id===selected.accountId);
    });
    if(typeof pool.listAccounts==='function')
      installMethod(pool,'listAccounts',old=>async function(provider,...args){
        const selected=context();
        const rows=await old.call(this,provider,...args);
        if(!selected)return rows;
        if(provider!==selected.providerId||!Array.isArray(rows))
          throw Error('Source attempted cross-provider account listing');
        return rows.filter(row=>row?.id===selected.accountId);
      });
    installMethod(pool,'listAllAccounts',old=>async function(...args){
      const selected=context();
      const rows=await old.call(this,...args);
      return selected?rows.filter(row=>row?.provider===selected.providerId&&row?.id===selected.accountId):rows;
    });
    installMethod(credentials,'resolve',old=>async function(ref,...args){
      const selected=context();
      if(selected&&(typeof ref!=='string'||ref!==selected.credentialRef))
        throw Error('Source attempted another credential reference');
      const result=await old.call(this,ref,...args);
      // Only a non-empty upstream credential payload proves a real lookup.
      if(selected){
        if(typeof result?.value!=='string'||!result.value.trim())
          throw Error('Selected source credential lookup was empty');
        selected.resolved=true;
      }
      return result;
    });
    for(const action of ['set','unset']){
      if(typeof credentials[action]!=='function')continue;
      installMethod(credentials,action,old=>async function(ref,...args){
        const selected=context();
        if(selected&&ref!==selected.credentialRef)
          throw Error('Source attempted to modify another credential');
        return old.call(this,ref,...args);
      });
    }
  }catch(error){restore();throw error}
  async function* streamFor({providerId,accountId,credentialRef,model,signal,createStream,allProviderAccountIds}={}){
    if(disposed||!isAlive()||!providerId||!accountId||!credentialRef||!Array.isArray(allProviderAccountIds)
      ||allProviderAccountIds.filter(id=>id===accountId).length!==1
      ||typeof createStream!=='function')
      throw Error('Source exact-account stream prerequisites failed');
    const selected={providerId,accountId,credentialRef,model,signal,
      allProviderAccountIds:Object.freeze([...allProviderAccountIds]),selected:false,resolved:false};
    activeStreams++;
    let iterator=null;
    try{
      const source=storage.run(selected,createStream);
      if(!source||typeof source[Symbol.asyncIterator]!=='function')
        throw Error('Upstream returned no source stream');
      iterator=storage.run(selected,()=>source[Symbol.asyncIterator]());
      while(true){
        if(disposed||!isAlive()||signal?.aborted)
          throw Error('Source exact-account stream was stopped');
        const next=await storage.run(selected,()=>iterator.next());
        if(disposed||!isAlive()||signal?.aborted)
          throw Error('Source exact-account stream was stopped');
        if(next.done)break;
        if(!selected.selected||!selected.resolved)
          throw Error('Source request did not prove the requested account was used');
        yield next.value;
      }
      if(!selected.selected||!selected.resolved)
        throw Error('Source never confirmed selected credential');
    }finally{
      try{
        if(typeof iterator?.return==='function')
          await storage.run(selected,()=>iterator.return());
      }finally{
        activeStreams--;
        if(disposed)restoreFinal();
      }
    }
  }
  return {streamFor,restore};
}
