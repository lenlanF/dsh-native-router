import {createConfigStore} from './config.mjs';
import {createNativeRouterAdapter,PROVIDER} from './adapter.mjs';
import {attachHostFailover} from './host-failover.mjs';
import {registerAuthenticatedRouterRoutes} from './connection-routes.mjs';
import {createAccountCenter} from './account-center.mjs';
import {createAccountVerificationStore} from './account-verification-store.mjs';
import {createSessionReuse} from './session-reuse.mjs';
import {createAccountAdoption} from './account-adoption.mjs';
import {createInstalledPluginInventory} from './installed-plugin-inventory.mjs';
import {createPrivateOwnedDriver,PRIVATE_PROVIDERS} from './channels/private-owned.mjs';
import {createMimoDesktopDriver,MIMO_DESKTOP_ID} from './channels/mimo-desktop.mjs';
import {createDoubaoDriver} from './channels/doubao.mjs';
import {createPrivateOwnedAdoption} from './private-owned-adoption.mjs';
import {createPrivatePackAdoption} from './private-pack-adoption.mjs';
import {createWorkbuddyVaultAdoption} from './workbuddy-vault-adoption.mjs';
import {createExistingDshChannelFacade,createPreferredSourceFacade} from './existing-dsh-channels.mjs';
import {createCheckinCenter,createCheckinStore} from './checkins.mjs';
import {getNativeChannelDrivers,onNativeChannelDriverChange,registerNativeChannelDriver} from './driver-registry.mjs';
import {createWorkBuddyDriver} from './channels/workbuddy.mjs';
import {createCodeArtsDriver} from './channels/codearts.mjs';
import {createLocalAndSourceDriver} from './channels/local-source.mjs';
import {createEmbeddedChannelPack,SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
import {createSourceChannelDriver} from './source-channel-driver.mjs';
import {sourceModelEligible,privateSourceAccountRoutable} from './source-model-eligibility.mjs';
import {createHostCredentialBridge} from './credentials-bridge.mjs';
import {scheduleOwnerLiveSmoke} from './owner-live-smoke.mjs';
import {join,dirname} from 'node:path';
export {registerNativeChannelDriver,getNativeChannelDrivers} from './driver-registry.mjs';

export const name='dsh-native-router';
export const inject=['llm','settings','agents'];
export function applyWith(ctx,{configStore,adapter,createUserMessage,channelDrivers,fetchImpl,env,vault,checkinStore}={}){
 if(!ctx?.llm?.registerAdapter)throw new Error('DSH llm.registerAdapter is required');
 const ownStore=configStore??createConfigStore();
 const drivers=channelDrivers??getNativeChannelDrivers();
  const credentialsBridge=createHostCredentialBridge({ctx,provided:vault});
   const ownedVault=credentialsBridge.vault;
   const builtInCleanup=[];
   if(!channelDrivers)for(const providerId of Object.keys(PRIVATE_PROVIDERS)){
     const ownId=PRIVATE_PROVIDERS[providerId].ownedId;
     if(!drivers.has(ownId))builtInCleanup.push(registerNativeChannelDriver(ownId,
       createPrivateOwnedDriver({providerId,vault:ownedVault,fetchImpl})));
   }
   // One-time consent imports a Desktop membership session into our own vault.
   // No commercial MiMo API-Key or dependency on an upstream DSH plugin.
   if(!channelDrivers&&!drivers.has(MIMO_DESKTOP_ID))
     builtInCleanup.push(registerNativeChannelDriver(MIMO_DESKTOP_ID,
       createMimoDesktopDriver({vault:ownedVault})));
   if(!channelDrivers&&!drivers.has('own_doubao'))
     builtInCleanup.push(registerNativeChannelDriver('own_doubao',
       createDoubaoDriver({vault:ownedVault,fetchImpl,logger:ctx.logger,
        getAccounts:()=>ownStore.get().accounts})));
   if(!channelDrivers)for(const region of ['cn','global']){
     const owner='own_workbuddy-'+region;
     if(!drivers.has(owner))builtInCleanup.push(registerNativeChannelDriver(owner,
       createWorkBuddyDriver({env,fetchImpl,ownedRegion:region,ownedVault})));
   }
   const embeddedPack=createEmbeddedChannelPack({ctx,getConfig:()=>ownStore.get(),env:env??process.env});
   const existingHostSource=createExistingDshChannelFacade({ctx,excludedHost:embeddedPack});
   const sourceFacade=createPreferredSourceFacade({own:embeddedPack,existing:existingHostSource});
   // Both account namespaces (existing local desktop login and existing DSH
   // installed channel-provider session) share the same channel identity.
   // Never replace a driver installed by another Cordis plugin.
   if(!channelDrivers&&!drivers.has('workbuddy')){
     const local=createWorkBuddyDriver({env,fetchImpl,
       manifestPath:join(dirname(ownStore.path??join(process.cwd(),'dsh-native-router-config.json')),'workbuddy-sources.json')});
     builtInCleanup.push(registerNativeChannelDriver('workbuddy',
       createLocalAndSourceDriver({providerId:'workbuddy',local,sourcePack:sourceFacade,
         ownedPack:embeddedPack,getAccountOrigin:account=>ownStore.get().sessionReuse?.linkedOrigins?.[account.id]})));
   }
   if(!channelDrivers&&!drivers.has('codearts')){
     const local=createCodeArtsDriver({env,fetchImpl});
     builtInCleanup.push(registerNativeChannelDriver('codearts',
       createLocalAndSourceDriver({providerId:'codearts',local,sourcePack:sourceFacade,
         ownedPack:embeddedPack,getAccountOrigin:account=>ownStore.get().sessionReuse?.linkedOrigins?.[account.id]})));
   }
   // If DSH already owns native providers, reuse their existing accountPool
   // and adapters instead of trying to install a duplicate channel pack.
   if(!channelDrivers){
     for(const providerId of SOURCE_PACK_PROVIDERS){
        if(!drivers.has(providerId))
          builtInCleanup.push(registerNativeChannelDriver(providerId,
            createSourceChannelDriver({providerId,embeddedPack:sourceFacade})));
        // Separate self-owned channel identity: never overwrite the original
        // DSH Provider and its login while the migration is pending.
        const ownedId='own_'+providerId;
        if(!drivers.has(ownedId))builtInCleanup.push(registerNativeChannelDriver(ownedId,
          createSourceChannelDriver({providerId,accountProviderId:ownedId,
            embeddedPack})));

     }
   }
  const ownAdapter=adapter??createNativeRouterAdapter({configStore:ownStore,logger:ctx.logger,
   vault:ownedVault,fetchImpl,env,channelDrivers:drivers,
    hostProviderInventory:existingHostSource,ownedPack:embeddedPack});
   const verificationStore=createAccountVerificationStore({
     path:ownStore.path?join(dirname(ownStore.path),'account-verification.json'):undefined});
   const installedInventory=createInstalledPluginInventory();
    const accountCenter=createAccountCenter({configStore:ownStore,adapter:ownAdapter,
      drivers,fetchImpl,env,vault:ownedVault,getSourceStatus:()=>sourceFacade.status(),
      verificationStore});  const sessionReuse=createSessionReuse({configStore:ownStore,drivers,
     embeddedPack:sourceFacade,adapter:ownAdapter,logger:ctx.logger,installedInventory});
  const workbuddyVaultAdoption=createWorkbuddyVaultAdoption({
      inventory:installedInventory,configStore:ownStore,vault:ownedVault,
      adapter:ownAdapter,drivers});
   const privatePackAdoption=createPrivatePackAdoption({
     inventory:installedInventory,configStore:ownStore,ownedPack:embeddedPack,
     adapter:ownAdapter});
   const privateOwnedAdoption=createPrivateOwnedAdoption({
     inventory:installedInventory,configStore:ownStore,vault:ownedVault,adapter:ownAdapter});
   const accountAdoption=createAccountAdoption({configStore:ownStore,
     originalSource:existingHostSource,ownedPack:embeddedPack,adapter:ownAdapter,
      installedInventory,privateOwnedAdoption,privatePackAdoption,workbuddyVaultAdoption});
   const checkinCenter=createCheckinCenter({configStore:ownStore,accountCenter,
    store:checkinStore??createCheckinStore({path:ownStore.path?join(dirname(ownStore.path),'checkins.json'):undefined}),
     sourcePack:embeddedPack,logger:ctx.logger,verificationStore});
   const sourceHealth=()=>checkinCenter.sourceSnapshot?.()??[];
   const sourceVerified=(providerId,id)=>sourceHealth().some(a=>
     a.id===id&&a.providerId===providerId&&a.connectionState==='online'&&a.enabled);
   // A verified private QR account is eligible even while the separate
   // daily-sign-in status cache has not refreshed after a DSH restart.
   embeddedPack.setModelEligibility?.(providerId=>sourceModelEligible(providerId,{
     accounts:accountCenter.list().accounts,sourceRows:sourceHealth(),
     ignoredIds:ownStore.get().sessionReuse?.ignoredIds??[]}));
   ownAdapter.setAccountVerificationResolver?.(account=>{
     if(typeof account?.id!=='string'||typeof account.providerId!=='string')return false;
     const local=accountCenter.list().accounts.find(row=>row.id===account.id
       &&row.providerId===account.providerId);
     const sourceId=account.providerId.startsWith('own_')?
       account.providerId.slice(4):account.providerId;
     if(account.id.startsWith('sp_')&&SOURCE_PACK_PROVIDERS.includes(sourceId)){
       // Private QR accounts should become routable immediately after this
       // plugin verifies their own remote identity. Source check-in status
       // refresh is asynchronous and must not remain an extra hidden gate.
       return privateSourceAccountRoutable(account,local,
         sourceVerified(sourceId,account.id));
     }
     return local?.connectionState==='online';
   });
   sourceFacade.setHealthResolver?.(({kind,providerId,sourceAccountId})=>{
     const id=sourceAccountOpaqueId(providerId,sourceAccountId);
     if(kind==='owned')return sourceVerified(providerId,id)?'online':'not_checked';
     return accountCenter.list().accounts.find(a=>a.id===id
       &&a.providerId===providerId)?.connectionState??null;
   });
   const cleanups=[...builtInCleanup,credentialsBridge.dispose];
 try{
   const release=ctx.llm.registerAdapter([PROVIDER],ownAdapter);
   if(typeof release==='function')cleanups.push(release);
   const directory=ctx.llm.registerConfigurableProviders?.([{
     provider:PROVIDER,displayName:'聚合路由',settingsNs:name,settingsPath:[],declared:false,
    }]);
    if(typeof directory==='function')cleanups.push(directory);
   const discovery=ctx.llm.registerModelDiscovery?.(name,async request=>{
     if(request?.provider&&request.provider!==PROVIDER)return [];
     return ownAdapter.listModels();
   });
   if(typeof discovery==='function')cleanups.push(discovery);
   const failover=attachHostFailover(ctx,{configStore:ownStore,createUserMessage});
   cleanups.push(failover.dispose);
    cleanups.push(checkinCenter.start());
     cleanups.push(sessionReuse.start());
      cleanups.push(accountCenter.start());
       cleanups.push(scheduleOwnerLiveSmoke({configStore:ownStore,accountCenter,
         adapter:ownAdapter,llm:ctx.llm,env:env??process.env,logger:ctx.logger}));
    // The source drivers reuse this single lifetime-bound channel-pack facade.
    cleanups.push(existingHostSource.dispose);
    cleanups.push(embeddedPack.dispose);
   embeddedPack.attach();
   if(!channelDrivers)cleanups.push(onNativeChannelDriverChange(()=>ownAdapter.invalidateCatalog?.()));
    if(typeof ctx.inject==='function'){
      // DSH Connection owns authenticated /api routes and their Peer admission.
      // No direct localhost WebServer registration: localhost is not identity.
      const mountSecureRoutes=connectionCtx=>{
        connectionCtx.effect?.(()=>registerAuthenticatedRouterRoutes(connectionCtx,
           {configStore:ownStore,adapter:ownAdapter,accountCenter,checkinCenter,embeddedPack,sessionReuse,
            accountAdoption,hostProviderInventory:existingHostSource,credentialsBridge}));
      };
      ctx.inject(['connection'],mountSecureRoutes);
      if(typeof ctx.registry?.delete==='function')
        cleanups.push(()=>ctx.registry.delete(mountSecureRoutes));
    }
   ctx.logger?.info?.('dsh-native-router: native provider, account console and check-in center ready');
 }catch(error){
   for(const dispose of cleanups.reverse())try{dispose()}catch{}
   throw error;
 }
 let disposed=false;
 const dispose=()=>{
   if(disposed)return;disposed=true;
   for(const fn of cleanups.reverse())try{fn()}catch{}
 };
 ctx.effect?.(()=>dispose);
 return dispose;
}
export function apply(ctx){return applyWith(ctx,{})}
