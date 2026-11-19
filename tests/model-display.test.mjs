import test from 'node:test';
import assert from 'node:assert/strict';
import {conciseChannelName,conciseModelName,createCatalog} from '../src/catalog.mjs';

test('chat picker labels show only channel model and sourced multiplier',()=>{
 assert.equal(conciseChannelName('workbuddy-global','workbuddy-global · DSH 已注册'),
   'WorkBuddy Global');
 assert.equal(conciseModelName('workbuddy-global','workbuddy-global · DSH 已注册',
   'hy4-flash','Hy4 flash · x0.00'),
   'WorkBuddy Global · Hy4 flash · x0.00');
 assert.equal(conciseModelName('own_loomy','Loomy · 自有授权','spark-x2.6','Spark x1.62'),
   'Loomy · Spark · x1.62');
 assert.equal(conciseModelName('own_zcode','ZCode · 自有授权','glm','GLM-5'),
   'ZCode · GLM-5 · x?');
});
test('native chat model visibility tracks actual authentication changes without waiting for catalog TTL',async()=>{
 const {createNativeRouterAdapter}=await import('../src/adapter.mjs');
 const {normalizeConfig}=await import('../src/config.mjs');
 const {sourceAccountOpaqueId}=await import('../src/source-account-ref.mjs');
 const id=sourceAccountOpaqueId('codearts','oauth-01');
 const cfg=normalizeConfig({providers:[{id:'own_codearts',protocol:'native-channel',
   name:'华为云 CodeArts',models:['test-model'],enabled:true}],
   accounts:[{id,providerId:'own_codearts',enabled:true,
     credentialRef:'driver:own_codearts:'+id}]});
 let auth=false;
 const drivers=new Map([['own_codearts',{isSourceBridge:true,
   get runtimeReady(){return true},
   async generate(){return {text:'ok',finishReason:'stop'}}}]]);
 const router=createNativeRouterAdapter({
   configStore:{get:()=>structuredClone(cfg)},channelDrivers:drivers,
   hostProviderInventory:{status:()=>({hostProviders:[]})}});
 router.setAccountVerificationResolver(()=>auth);
 const names=async()=>(await router.listModels()).filter(row=>
   row.id==='direct:own_codearts:test-model');
 assert.equal((await names()).length,0,'unverified OAuth must not advertise model');
 auth=true;
 assert.equal((await names()).length,1,'verified OAuth activates model immediately');
 auth=false;
 assert.equal((await names()).length,0,'expired authorization evicts cached model immediately');
});
test('dynamic original host model and owned source use compact labels without changing model identity',async()=>{
 const originals={
   status:()=>({hostProviders:[{providerId:'workbuddy-global'}]}),
 };
 const source={
   get runtimeReady(){return true},
   isSourceBridge:true,
   async listModels(){return [{id:'glm5'}]},
   async generate(){return {text:'x',finishReason:'stop'}}
 };
 const cfg={providers:[
   {id:'workbuddy-global',name:'WorkBuddy Global · DSH 已注册',
     protocol:'dsh-host',models:['hy4'],enabled:true},
   {id:'own_loomy',name:'Loomy · 自有授权',
     protocol:'native-channel',models:['glm5'],enabled:true}
 ],accounts:[{id:'sp_aaaa',providerId:'own_loomy',enabled:true}] ,routes:[]};
 const autoFreePool={refresh:async()=>{},effectiveConfig:()=>cfg,
   snapshot:()=>({catalog:[
     {providerId:'workbuddy-global',model:'hy4',name:'Hy4 flash · x0.00'},
     {providerId:'own_loomy',model:'glm5',name:'GLM 5 · x1.62'}
   ]})};
 const catalog=createCatalog({getConfig:()=>cfg,autoFreePool,hostProviderInventory:originals,
   channelDrivers:new Map([['own_loomy',source]])});
 const listed=await catalog.list();
 const host=listed.find(row=>row.id==='direct:workbuddy-global:hy4');
 const own=listed.find(row=>row.id==='direct:own_loomy:glm5');
 assert.equal(host.name,'WorkBuddy Global · Hy4 flash · x0.00');
 assert.equal(own.name,'Loomy · GLM 5 · x1.62');
 assert.deepEqual(listed.filter(row=>row.id===own.id).length,1);
 assert.equal(listed.some(row=>/已注册|自有授权|Free now/.test(row.name)),false);
});
