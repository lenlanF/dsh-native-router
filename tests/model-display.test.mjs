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
