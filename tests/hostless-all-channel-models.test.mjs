import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_PACK_PROVIDERS} from '../src/embedded-pack.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createSourceChannelDriver} from '../src/source-channel-driver.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {runtimeOwnership} from '../src/account-runtime-ownership.mjs';

test('all 13 owned channels finish an actual DSH router turn without any original provider, desktop process, or borrowed pool',async()=>{
 const privateCalls=[],borrowedCalls=[];
 const sourceAccounts=SOURCE_PACK_PROVIDERS.map(providerId=>({
   id:'isolated-'+providerId,providerId,enabled:true,nickname:''
 }));
 const privatePack={
  status:()=>({state:'mounted',channels:[...SOURCE_PACK_PROVIDERS],
   modelAdapterReady:[...SOURCE_PACK_PROVIDERS]}),
  listAccounts:async()=>{
   privateCalls.push('owned:list');
   return {state:'ready',accounts:sourceAccounts};
  },
  readSourceStatuses:async providerId=>{
   privateCalls.push('owned:status:'+providerId);
   return {state:'ready',accounts:[{accountId:'isolated-'+providerId,
    authVerified:true,nickname:'upstream-'+providerId}]};
  },
  listModels:async providerId=>{
   privateCalls.push('owned:models:'+providerId);
   return {state:'ready',models:[{id:'test-chat'}]};
  },
  streamNative:async ({providerId,sourceAccountId})=>{
   privateCalls.push('owned:inference:'+providerId);
   assert.equal(sourceAccountId,'isolated-'+providerId);
   return (async function*(){
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:'autonomous '+providerId};
    yield {type:'block-end',index:0,block:{type:'text',text:'autonomous '+providerId}};
    yield {type:'finish',reason:{kind:'stop'}};
   })();
  },
 };
 // Poisoned original Host: if a model attempts to borrow any old service,
 // this test fails instead of silently treating original-plugin success as ours.
 const original={
  get listAccounts(){borrowedCalls.push('original:list');throw Error('original plugin absent')},
  get streamNative(){borrowedCalls.push('original:stream');throw Error('original plugin absent')},
 };
 const drivers=new Map(),providers=[],accounts=[];
 for(const providerId of SOURCE_PACK_PROVIDERS){
  const owner='own_'+providerId,sourceAccountId='isolated-'+providerId;
  const id=sourceAccountOpaqueId(providerId,sourceAccountId);
  drivers.set(owner,createSourceChannelDriver({
   providerId,accountProviderId:owner,embeddedPack:privatePack}));
  providers.push({id:owner,protocol:'native-channel',name:providerId,
    models:['test-chat'],enabled:true,supportsTools:true});
  accounts.push({id,providerId:owner,credentialRef:'driver:'+owner+':'+id,
    enabled:true,weight:1});
  assert.equal(runtimeOwnership(accounts.at(-1)),'owned');
 }
 const cfg=normalizeConfig({providers,accounts,embeddedPack:{enabled:true}});
 const configStore={get:()=>structuredClone(cfg)};
 const adapter=createNativeRouterAdapter({configStore,channelDrivers:drivers});
 for(const providerId of SOURCE_PACK_PROVIDERS){
  const account=accounts.find(x=>x.providerId==='own_'+providerId);
  assert.equal((await drivers.get(account.providerId).refresh({account})).state,'online');
  const events=[];
  for await(const event of adapter.stream({
   model:'direct:own_'+providerId+':test-chat',
   messages:[{role:'user',content:[{type:'text',text:'ping'}]}]
  }))events.push(event);
  assert(events.some(x=>x.type==='text-delta'&&x.text==='autonomous '+providerId),
   'must use own channel for '+providerId);
  assert.deepEqual(events.at(-1),{type:'finish',reason:{kind:'stop'}});
 }
 assert.equal(privateCalls.filter(x=>x.startsWith('owned:inference:')).length,13);
 assert.deepEqual(borrowedCalls,[],'never reach original plugin or desktop');
 assert.equal(adapter.getStatus().metrics.successfulTurns,13);
 void original; // Keep poisoned external source local; never supply it to owned adapters.
});
