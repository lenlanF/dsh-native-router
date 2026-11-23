import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';

const AUTO_SCAN_MS=90*1000;
const MAX_SCAN_RESULTS=50;
const CHANNEL_NAMES=Object.freeze({
 workbuddy:'WorkBuddy / CodeBuddy Desktop',
 codearts:'CodeArts',
 buddy:'CodeBuddy',qoder:'Qoder',qodercn:'Qoder CN',trae:'TRAE',
 lobsterai:'LobsterAI',cline:'Cline',loomy:'Loomy',raccoon:'Raccoon',
 minimax:'MiniMax',zcode:'ZCode',gemini:'Gemini',
});
const safeId=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const sourceIds=new Set(SOURCE_PACK_PROVIDERS);

/**
 * Reuse an already-authorized desktop app or the *current DSH plugin's own*
 * source accounts. No browser authorization, no token migration, no writes
 * to an original desktop client and no login request on discovery.
 * Reusing an existing login is opt-in and is scoped to its original provider.
 * Explicit opt-in config.sessionReuse.enabled is required before any scan.
 * Only WorkBuddy's reviewed, read-only desktop session driver qualifies as
 * local-app reuse. Other channels reuse preexisting source-pack account refs.
 * A machine/device ID is NOT a user login and cannot qualify on its own.
 */
export function createSessionReuse({configStore,drivers,embeddedPack,adapter,
 logger,installedInventory,intervalMs=AUTO_SCAN_MS}={}){
 if(!configStore?.get||!configStore?.replace)throw Error('ConfigStore is required');
 let timer=null,startupRetry=null,disposed=false,pending=null,lastScanAt=null,lastResult=[],lastPrivateCount=0;
 const driverFor=id=>drivers instanceof Map?drivers.get(id):drivers?.[id];
 const approved=()=>configStore.get().sessionReuse?.enabled===true;
 const validRef=(providerId,id,ref)=>{
  const expected='driver:'+providerId+':'+id;
  return safeId(id)&&typeof ref==='string'&&ref===expected&&ref.length<200;
 };
 function snapshot(){
  const cfg=configStore.get();
   const origin=embeddedPack?.status?.();
   const hostProviders=Array.isArray(origin?.hostProviders)?origin.hostProviders:[];
   return {enabled:cfg.sessionReuse?.enabled===true,lastScanAt,
     reusableSource:origin?.borrowedExistingDsh?'external-dsh-provider':
       origin?.state==='mounted'?'own-source-pack':'unavailable',
     hostProviders:hostProviders.map(row=>({...row})),

   autoLinked:(cfg.sessionReuse?.linkedIds??[]).filter(id=>cfg.accounts.some(a=>a.id===id)).length,
    detectedPrivate:lastPrivateCount,
   ignored:(cfg.sessionReuse?.ignoredIds??[]).length,
      // 'available' only describes presence of an adapter. A mounted private
      // source driver DOES NOT prove that a user logged into this channel.
      // Keep the auth signal separate so the UI cannot mistake readiness for
      // account verification or credit eligibility.
      channels:[{providerId:'workbuddy',
        method:'desktop-readonly / existing-dsh-source-account',
        available:typeof driverFor('workbuddy')?.discover==='function',
        accountDetected:lastResult.some(x=>x.providerId==='workbuddy'
          &&x.state==='requires_independent_adoption'),loginVerified:false},
        ...SOURCE_PACK_PROVIDERS.filter(id=>id!=='workbuddy')
          .map(providerId=>({providerId,method:'existing-dsh-source-account',
            available:driverFor(providerId)?.runtimeReady===true
              ||driverFor(providerId)?.sourceReady===true,
            accountDetected:lastResult.some(x=>x.providerId===providerId
              &&x.state==='requires_independent_adoption'),loginVerified:false}))],
   results:lastResult.map(x=>({...x}))};
 }
  async function scan({importReferences=false}={}){
    if(disposed||!approved())return {...snapshot(),skipped:'disabled'};
    if(pending)return pending;  pending=(async()=>{
    const discovered=[],unverified=[];
   // WorkBuddy's proven desktop auth format is validated inside the existing
   // driver, which re-reads the original file for every authenticated request.
   const wb=driverFor('workbuddy');
   if(typeof wb?.discover==='function'){
    const found=await wb.discover().catch(()=>[]);
    for(const item of found.slice(0,MAX_SCAN_RESULTS)){
     if(safeId(item?.id)&&item.id.startsWith('wb_')&&item.reusable!==false)
      discovered.push({providerId:'workbuddy',id:item.id,method:'desktop-readonly'});
    }
   }
   // Same-DSH native pack already owns authentication. We link its account
   // reference only; do not copy its credential record or start an OAuth flow.
   if(embeddedPack?.status?.().state==='mounted'){
    const listing=await embeddedPack.listAccounts().catch(()=>({state:'unavailable'}));
    if(listing?.state==='ready'&&Array.isArray(listing.accounts)){
       const enabled=listing.accounts.filter(row=>row?.enabled===true
         &&sourceIds.has(row.providerId)
         &&(driverFor(row.providerId)?.isSourceBridge===true
           ||driverFor(row.providerId)?.supportsSourceRefs===true));
     const counts=new Map();
     for(const row of enabled)counts.set(row.providerId,(counts.get(row.providerId)??0)+1);
      for(const [providerId,count] of counts){
        if(count>1)unverified.push({providerId,
          method:'existing-dsh-source-account',state:'multiple_accounts_unverified'});
      }
      for(const row of enabled.slice(0,MAX_SCAN_RESULTS)){
       if(counts.get(row.providerId)!==1)continue; // Multi-account selection requires real adapter acceptance.
      if(typeof row.id!=='string'||!row.id)continue;
      discovered.push({providerId:row.providerId,
       id:sourceAccountOpaqueId(row.providerId,row.id),method:'existing-dsh-source-account'});
     }
    }
   }
    const privateScan=await installedInventory?.scan?.().catch(()=>null);
    const privateRows=privateScan?.accounts??[];
    lastPrivateCount=privateRows.length;
    // These are real plugin-local authorization files or accounts, but not
    // portable DSH AccountPool entries and not automatically imported.
    const results=[...unverified,...privateRows.map(row=>({
      providerId:row.providerId,id:row.accountId,method:row.source,
      state:'private_authorization_unverified',
    }))];
    if(!importReferences){
      // Discovery is not an independent takeover: never auto-register a
      // host-dependent proxy account via the settings-page scan.
      lastScanAt=Date.now();
      lastResult=[...results,...discovered.slice(0,MAX_SCAN_RESULTS).map(row=>({
        ...row,state:'requires_independent_adoption'
      }))].slice(-MAX_SCAN_RESULTS);
      return {...snapshot(),attempted:discovered.length,linked:0,
        needsOneTimeMigration:discovered.length};
    }
    for(const candidate of discovered.slice(0,MAX_SCAN_RESULTS)){    if(disposed||!approved())break;
    const {providerId,id,method}=candidate;
    let cfg=configStore.get();
    if(cfg.sessionReuse.ignoredIds.includes(id)){
     results.push({providerId,id,method,state:'ignored'});continue;
    }
    const existing=cfg.accounts.find(x=>x.id===id);
    if(existing){
     results.push({providerId,id,method,state:'already_configured'});continue;
    }
    if(cfg.providers.some(x=>x.id===providerId&&(!x.enabled||x.protocol!=='native-channel'))){
     results.push({providerId,id,method,state:'provider_disabled'});continue;
    }
    const driver=driverFor(providerId);
    if(typeof driver?.importCandidate!=='function')continue;
    let imported;
    try{imported=await driver.importCandidate({candidateId:id,consent:true})}
    catch{
     results.push({providerId,id,method,state:'source_changed'});continue;
    }
    if(!validRef(providerId,id,imported?.credentialRef)||imported.id!==id){
     results.push({providerId,id,method,state:'invalid_reference'});continue;
    }
    if(disposed||!approved())break;
    cfg=configStore.get();
    if(cfg.accounts.some(x=>x.id===id||x.credentialRef===imported.credentialRef)
      ||cfg.sessionReuse.ignoredIds.includes(id))continue;
    const provider=cfg.providers.find(x=>x.id===providerId);
    if(provider&&(!provider.enabled||provider.protocol!=='native-channel'))continue;
    const next={
     ...cfg,
     providers:provider?cfg.providers:[...cfg.providers,{
       id:providerId,name:CHANNEL_NAMES[providerId]??providerId,
       protocol:'native-channel',enabled:true,models:[],supportsTools:true,
     }],
      accounts:[...cfg.accounts,{id,providerId,credentialRef:imported.credentialRef,
        enabled:true,autoCheckin:method==='existing-dsh-source-account',weight:1}],
      sessionReuse:{...cfg.sessionReuse,
        linkedIds:[...new Set([...cfg.sessionReuse.linkedIds,id])].slice(-200),
        linkedOrigins:{...cfg.sessionReuse.linkedOrigins,
          [id]:method==='desktop-readonly'?'desktop-readonly':
            embeddedPack?.status?.().borrowedExistingDsh?'external-dsh-provider':'own-source-pack'}},
     };
    try{
     configStore.replace(next);
     adapter?.invalidateCatalog?.();
     results.push({providerId,id,method,state:'linked_unverified'});
    }catch{
     // WorkBuddy's own metadata manifest can be reconciled on a later scan.
     results.push({providerId,id,method,state:'config_unavailable'});
    }
   }
   lastScanAt=Date.now();
   lastResult=results.slice(-MAX_SCAN_RESULTS);
   logger?.info?.('native-router: existing-session reuse linked '
     +results.filter(x=>x.state==='linked_unverified').length+' account references (login not repeated)');
   return {...snapshot(),attempted:discovered.length,
    linked:results.filter(x=>x.state==='linked_unverified').length};
  })().finally(()=>{pending=null});
  return pending;
 }
  function start(){
    // Deliberately no automatic scan. Existing-plugin discovery is ONLY an
    // explicitly requested, transitional action; adopted accounts run solely
    // from this plugin's private credentials. A periodic scan would keep the
    // previous plugin a hidden runtime dependency, and may revive stale links.
    return stop;
   } function stop(){disposed=true;if(timer){clearInterval(timer);timer=null}if(startupRetry){clearTimeout(startupRetry);startupRetry=null}}
 return {scan,snapshot,start,stop};
}
