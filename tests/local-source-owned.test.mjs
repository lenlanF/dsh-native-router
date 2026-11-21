import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAndSourceDriver} from '../src/channels/local-source.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

const providerId='codearts';
const id=sourceAccountOpaqueId(providerId,'qr-private-01');
const account={id,providerId,credentialRef:'driver:codearts:'+id,enabled:true};
const textStream=text=>(async function*(){
 yield {type:'block-start',index:0,blockType:'text'};
 yield {type:'text-delta',index:0,text};
 yield {type:'block-end',index:0,block:{type:'text',text}};
 yield {type:'finish',reason:{kind:'stop'}};
})();
function pack(kind,{mounted=true,verified=true}={}){
 const calls={list:0,status:0,models:0,stream:0};
 const data={
  status:()=>({state:mounted?'mounted':'unavailable',
    channels:mounted?['codearts']:[],modelAdapterReady:mounted?['codearts']:[]}),
  async listAccounts(){calls.list++;return {state:mounted?'ready':'unavailable',
    accounts:mounted?[{id:'qr-private-01',providerId,enabled:true,
      nickname:'QR signed-in owner'}]:[]}},
  async readSourceStatuses(){calls.status++;return {state:'ready',
    accounts:[{accountId:'qr-private-01',authVerified:verified,
      nickname:'QR signed-in owner'}]}},
  async listModels(){calls.models++;return {state:'ready',models:[{id:kind+'-model',isFree:true}]}},
  async streamNative(request){
   calls.stream++;
   assert.equal(request.providerId,'codearts');
   assert.equal(request.sourceAccountId,'qr-private-01');
   return textStream(kind==='own'?'OWN_REPLY':'EXTERNAL_REPLY');
  },
 };
 return {data,calls};
}
const local={listModels:async()=>[{id:'env-model'}],
 generate:async()=>({text:'LOCAL',finishReason:'stop',toolCalls:[]})};
function fixture(origin='own-source-pack',mounted=true,verified=true){
 const own=pack('own',{mounted,verified}),external=pack('external');
 const driver=createLocalAndSourceDriver({
  providerId,local,sourcePack:external.data,ownedPack:own.data,getAccountOrigin:()=>origin,
 });
 return {driver,own,external};
}
function centerFor(driver,origin='own-source-pack'){
 let config=normalizeConfig({
  providers:[{id:providerId,name:'CodeArts',protocol:'native-channel',enabled:true,
   models:['own-model','external-model']}],
  accounts:[account],sessionReuse:{enabled:true,linkedIds:[id],
   linkedOrigins:{[id]:origin}},
 });
 const configStore={get:()=>structuredClone(config),replace:next=>{config=normalizeConfig(next)}};
 return createAccountCenter({configStore,drivers:new Map([[providerId,driver]])});
}
test('CodeArts QR self-owned sp_ account refreshes via private pack and completes true model turn',async()=>{
 const {driver,own,external}=fixture();
 assert.equal(driver.isPrivateSourceBound(account),true);
 assert.equal((await driver.refresh({account})).state,'online');
 assert.equal((await driver.refreshAccountStatus({account})).authVerified,true);
 assert.equal(driver.accountSnapshot(account).nickname,'QR signed-in owner');
 assert.deepEqual(await driver.listModels({account}),[{id:'own-model',upstreamFreeLabel:true}]);
 assert.equal((await driver.generate({account,model:'own-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'Hello'}]}]}})).text,'OWN_REPLY');
 assert.equal(external.calls.list,0,'private QR credentials must NEVER fall back to original DSH provider');
 assert.equal(external.calls.status,0);
 assert.equal(external.calls.models,0);
 assert.equal(external.calls.stream,0);
 assert.ok(own.calls.status>=2,'real private status probe must run');
 const center=centerFor(driver);
 assert.equal(center.list().accounts[0].runtimeMode,'owned');
 assert.equal(center.list().accounts[0].modelTestAvailable,true);
 assert.equal((await center.verify(id)).state,'online');
 assert.equal((await center.verifyModel(id,{modelId:'own-model'})).state,'verified');
 assert.equal(external.calls.stream,0);
 center.stop();
});
test('a freshly verified private CodeArts QR account becomes directly routable before the background sign-in cache refreshes',async()=>{
 const {driver,external}=fixture();
 const cfg=normalizeConfig({providers:[{id:'codearts',protocol:'native-channel',
   name:'CodeArts',models:['own-model'],enabled:true}],accounts:[account],
   sessionReuse:{enabled:true,linkedIds:[id],linkedOrigins:{[id]:'own-source-pack'}}});
 const store={get:()=>structuredClone(cfg),replace:()=>{throw Error('read-only fixture')}};
 const center=createAccountCenter({configStore:store,
   drivers:new Map([['codearts',driver]])});
 const adapter=createNativeRouterAdapter({configStore:store,
   channelDrivers:new Map([['codearts',driver]])});
 // Same gate as the runtime: checkinSource can be empty on startup, but
 // the independent channel's own real verification must make it routable.
 adapter.setAccountVerificationResolver(a=>{
   const row=center.list().accounts.find(x=>x.id===a.id&&x.providerId===a.providerId);
   return row?.runtimeMode==='owned'&&row.connectionState==='online';
 });
 assert.equal((await adapter.listModels()).some(row=>row.id==='direct:codearts:own-model'),false);
 assert.equal((await center.verify(id)).state,'online');
 adapter.invalidateCatalog();
 assert.equal((await adapter.listModels()).some(row=>row.id==='direct:codearts:own-model'),true);
 assert.equal(external.calls.stream,0);
 center.stop();
});
test('a QR account with private source unmounted fails closed and NEVER changes to old host credentials',async()=>{
 const {driver,external}=fixture('own-source-pack',false);
 assert.equal(driver.isPrivateSourceBound(account),false);
 assert.equal((await driver.refresh({account})).state,'error');
 await assert.rejects(()=>driver.generate({account,model:'own-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'Hi'}]}]}}),/unavailable|stale|not available/);
 assert.equal(external.calls.list,0);
 assert.equal(external.calls.stream,0);
 const center=centerFor(driver);
 assert.equal(center.list().accounts[0].modelTestAvailable,false);
 center.stop();
});
test('legacy external CodeArts sp_ reference remains linked and cannot claim private ownership',async()=>{
 const {driver,own}=fixture('external-dsh-provider');
 assert.equal(driver.isPrivateSourceBound(account),false);
 assert.equal((await driver.refresh({account})).state,'pending');
 const center=centerFor(driver,'external-dsh-provider');
 assert.equal(center.list().accounts[0].runtimeMode,'linked');
 assert.equal(center.list().accounts[0].modelTestAvailable,false);
 await assert.rejects(()=>center.verifyModel(id,{modelId:'external-model'}),/仅独立接管/);
 assert.equal(own.calls.list,0,'external login must not be silently treated as private');
 center.stop();
});
