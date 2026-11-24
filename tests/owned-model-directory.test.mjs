import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedModelDirectory} from '../src/owned-model-directory.mjs';
import {filterHostRoutes} from '../src/host-model-selection.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';

test('private directory exposes all four native member routes only after official auth; uses own driver not host registry',async()=>{
 const ids=['own_mimo_desktop','own_meoo_web','own_qwenwork','own_aws_quick'];
 const config={providers:ids.map(id=>({id,name:id,enabled:true,protocol:'native-channel'})),
  accounts:ids.map(id=>({id:'account-'+id,providerId:id,enabled:true}))};
 const local=config.accounts.map(a=>({...a,runtimeMode:'owned',connectionState:'online'}));
 local[3].connectionState='not_checked';
 const calls=[],hostCalls=[];
 const directory=createOwnedModelDirectory({configStore:{get:()=>config},
  accountCenter:{list:()=>({accounts:local}),listTestModels:async(id,options)=>{
    calls.push(id);assert.equal(options.officialOnly,true);return {state:'ready',models:[{id:'live-model-'+id,name:'official model',free:false}]}}},
  hostProviderInventory:{status:()=>({hostProviders:[{providerId:'external'},...ids.map(providerId=>({providerId}))]}),
    listHostModels:async id=>{hostCalls.push(id);return {state:'ready',providerId:id,models:[{id:'host-model'}]}}}});
 assert.deepEqual(directory.providers().map(p=>p.providerId),['external',...ids.slice(0,3)]);
 for(const id of ids.slice(0,3)){
  const result=await directory.listModels(id);
  assert.equal(result.state,'ready');assert.equal(result.models[0].id,'live-model-account-'+id);
 }
 assert.equal((await directory.listModels(ids[3])).state,'unavailable');
 assert.equal(calls.length,3);assert.deepEqual(hostCalls,[]);
 local[3].connectionState='online';
 assert.equal((await directory.listModels(ids[3])).state,'ready');
 local[0].connectionState='expired';
 assert.ok(!directory.providers().some(p=>p.providerId===ids[0]));
 assert.equal((await directory.listModels(ids[0])).state,'unavailable');
 assert.equal((await directory.listModels('external')).state,'ready');
 assert.deepEqual(hostCalls,['external']);
});

test('private source aliases use verified canonical IDs, hide ignored identities, and never query an unverified pack',async()=>{
 const id=sourceAccountOpaqueId('qodercn','real-member');
 const config={providers:[],accounts:[],sessionReuse:{ignoredIds:[]}};
 const rows=[{id,providerId:'qodercn',sourceAccount:true,enabled:true,connectionState:'not_checked'}];
 let called=0;
 const directory=createOwnedModelDirectory({configStore:{get:()=>config},accountCenter:{list:()=>({accounts:[]})},
  checkinCenter:{sourceSnapshot:()=>rows},embeddedPack:{listModels:async providerId=>{
   called++;assert.equal(providerId,'qodercn');return {state:'ready',models:[{id:'real-model'}]}}}});
 assert.deepEqual(directory.providers(),[]);
 assert.equal((await directory.listModels('own_qodercn')).state,'unavailable');
 assert.equal(called,0);
 rows[0].connectionState='online';
 assert.equal(directory.providers()[0].providerId,'own_qodercn');
 assert.equal((await directory.listModels('own_qodercn')).models[0].id,'real-model');
 config.sessionReuse.ignoredIds=[id];
 assert.deepEqual(directory.providers(),[]);
 assert.equal((await directory.listModels('own_qodercn')).state,'unavailable');
 assert.equal(called,1);
});
test('directory does not publish old account catalog after authorization changes mid-request',async()=>{
 const config={providers:[{id:'own_meoo_web',protocol:'native-channel',enabled:true}],accounts:[{id:'member',providerId:'own_meoo_web',enabled:true}]};
 const live={...config.accounts[0],runtimeMode:'owned',connectionState:'online'};
 const directory=createOwnedModelDirectory({configStore:{get:()=>config},accountCenter:{
  list:()=>({accounts:[live]}),listTestModels:async()=>{live.connectionState='expired';return {state:'ready',models:[{id:'late-model'}]}}}});
 assert.deepEqual(await directory.listModels('own_meoo_web'),{state:'unavailable',providerId:'own_meoo_web',models:[]});
});
test('native owner model selection also filters explicit chain tiers',()=>{
 const cfg={providers:[{id:'own_qwenwork',protocol:'native-channel'}],hostModelSelection:{own_qwenwork:['free']},
  routes:[{id:'chain',tiers:[{providerId:'own_qwenwork',model:'paid'},{providerId:'own_qwenwork',model:'free'}]}]};
 assert.deepEqual(filterHostRoutes(cfg).routes[0].tiers,[{providerId:'own_qwenwork',model:'free'}]);
});
