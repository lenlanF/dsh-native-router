import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAutoFreePool} from '../src/auto-free.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createRoutingEngine} from '../src/router.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {registerRouterRoutes} from '../src/routes.mjs';
import {EventEmitter} from 'node:events';

function accountFixture({enabled=true,origin='own-source-pack'}={}){
 const id=sourceAccountOpaqueId('codearts','qr-user-01');
 const config=normalizeConfig({
  providers:[{id:'codearts',name:'CodeArts',protocol:'native-channel',enabled,models:[]}],
  accounts:[{id,providerId:'codearts',credentialRef:'driver:codearts:'+id,enabled}],
  sessionReuse:{linkedIds:[id],linkedOrigins:{[id]:origin}},
  embeddedPack:{enabled:true},freePool:{models:[{providerId:'codearts',model:'free-choice',free:true}]},
 });
 const ownedPack={status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
  listAccounts:async()=>({state:'ready',accounts:[
   {providerId:'codearts',id:'qr-user-01',enabled:true,authorizationSource:'autonomous'}]}),
  listModels:async provider=>{assert.equal(provider,'codearts');return {state:'ready',
   models:[{id:'free-choice',isFree:true},{id:'unknown',name:'Paid?'}]}}};
 const pool=createAutoFreePool({getConfig:()=>config,ownedPack});
 return {id,config,pool,ownedPack};
}
test('CodeArts independent QR account shares one physical identity across AutoFree, catalog and actual router tiers',async()=>{
 const {id,config,pool}=accountFixture();
 const result=await pool.refresh();
 assert.equal(result.models.length,1);
 assert.equal(result.models[0].providerId,'codearts','source must use existing self-owned CodeArts Provider ID');
 assert.ok(result.catalog.every(x=>x.providerId==='codearts'));
 const dynamic=pool.effectiveConfig();
 assert.equal(dynamic.accounts.length,1,'never shadow a user-owned OAuth account');
 assert.equal(dynamic.accounts[0].id,id);
 assert.equal(dynamic.providers.length,1);
 assert.deepEqual(pool.tiers()[0].accountIds,[id]);
 const catalog=await createCatalog({getConfig:()=>config,autoFreePool:pool,
  channelDrivers:new Map([['codearts',{generate:async()=>{},listModels:async()=>[]}]]),
  ttlMs:30000}).list();
 assert.ok(catalog.some(x=>x.id==='direct:codearts:free-choice'));
 const attempts=[];
 const router=createRoutingEngine({getConfig:()=>dynamic,
  request:async({provider,account,model})=>{
   attempts.push([provider.id,account.id,model]);return {text:'OK',finishReason:'stop',toolCalls:[]};
  }});
 const output=await router.execute({id:'autofree',mode:'free',enabled:true,
  tiers:pool.tiers(),maxSwitches:0},{sessionId:'qr-1'});
 assert.equal(output.text,'OK');
 assert.deepEqual(attempts,[['codearts',id,'free-choice']]);
});
test('CodeArts private QR login unblocks actual direct model routing only while verified',async()=>{
 const {id,config,ownedPack}=accountFixture();
 let verified=false;
 const invoked=[];
 const driver={isSourceBridge:true,get runtimeReady(){return true},
  async listModels(){return [{id:'fresh-source-model'}]},
  async generate({account,model}){
   invoked.push([account.id,account.providerId,model]);
   return {text:'verified private CodeArts reply',finishReason:'stop',toolCalls:[]};
  }};
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},ownedPack,
  channelDrivers:new Map([['codearts',driver]])});
 adapter.setAccountVerificationResolver(a=>a.id===id&&verified);
 const direct='direct:codearts:free-choice';
 assert.equal((await adapter.listModels()).some(x=>x.id===direct),false);
 verified=true;
 assert.equal((await adapter.listModels()).some(x=>x.id===direct),true);
 const output=[];
 for await(const event of adapter.stream({model:direct,sessionId:'qr-own-1',
  messages:[{role:'user',content:[{type:'text',text:'ping'}]}]}))output.push(event);
 assert.equal(output.find(x=>x.type==='text-delta')?.text,'verified private CodeArts reply');
 assert.deepEqual(invoked,[[id,'codearts','free-choice']],
  'an owned QR login cannot silently switch to old DSH plugin credentials');
 verified=false;
 assert.equal((await adapter.listModels()).some(x=>x.id===direct),false);
 await assert.rejects(async()=>{
  for await(const _ of adapter.stream({model:direct,
   messages:[{role:'user',content:[{type:'text',text:'ping'}]}]})){}
 },/not advertised/);
 assert.equal(invoked.length,1,'expired QR account must not generate another request');
});
test('autonomously discovered private member with fresh source auth routes through AutoFree without a duplicate persisted account',async()=>{
 const id=sourceAccountOpaqueId('loomy','member-standalone-001');
 let sourceOnline=false,blocked=false;
 const config=()=>normalizeConfig({embeddedPack:{enabled:true},
  sessionReuse:{ignoredIds:blocked?[id]:[]}});
 const ownedPack={status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'loomy',id:'member-standalone-001',enabled:true}]}),
  listModels:async()=>({state:'ready',models:[{id:'private-free',isFree:true}]})};
 const attempts=[];
 const driver={isSourceBridge:true,get runtimeReady(){return true},
  generate:async({provider,account,model})=>{
   attempts.push([provider.id,account.id,model]);
   return {text:'private-model-OK',finishReason:'stop',toolCalls:[]};
  }};
 const adapter=createNativeRouterAdapter({configStore:{get:config},ownedPack,
  channelDrivers:new Map([['own_loomy',driver]])});
 const {privateSourceAccountRoutable}=await import('../src/source-model-eligibility.mjs');
 adapter.setAccountVerificationResolver(account=>privateSourceAccountRoutable(account,null,
  sourceOnline&&account.id===id));
 const choose=async()=>{
  const output=[];
  for await(const row of adapter.stream({model:'autofree',sessionId:'auto-1',
   messages:[{role:'user',content:[{type:'text',text:'ping'}]}]}))output.push(row);
  return output;
 };
 await assert.rejects(choose, /No upstream-confirmed free models|No configured model\/account/,
  'source-pack directory alone must never authorize inference');
 assert.deepEqual(attempts,[]);
 sourceOnline=true;
 const success=await choose();
 assert.equal(success.find(x=>x.type==='text-delta')?.text,'private-model-OK');
 assert.deepEqual(attempts,[['own_loomy',id,'private-free']]);
 assert.equal(config().accounts.length,0,'AutoFree must not persist another shadow credential');
 sourceOnline=false;
 await assert.rejects(choose,/No upstream-confirmed free models|No configured model\/account/);
 assert.equal(attempts.length,1,'auth expiry must block another request');
 sourceOnline=true;blocked=true;
 await assert.rejects(choose,/No upstream-confirmed free models|No configured model\/account/);
 assert.equal(attempts.length,1,'manual account removal must win over the old source session');
});
test('a historical EXTERNAL DSH CodeArts ref never impersonates the private QR source',async()=>{
 const {pool}=accountFixture({origin:'external-dsh-provider'});
 await pool.refresh();
 assert.equal(pool.snapshot().models[0].providerId,'own_codearts');
 assert.deepEqual(pool.tiers(),[],'a shadow with a reused opaque ID must not become an accidental private model route');
});
test('plugin version is served from the installed package rather than hardcoded old UI text',async()=>{
 const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
 const routes=new Map();
 const dispose=registerRouterRoutes({get:name=>name==='webServer'?{
  register:({path,handler})=>{routes.set(path,handler);return ()=>routes.delete(path)}}:null},
 {configStore:{get:()=>normalizeConfig({})},adapter:{getStatus:()=>({providers:0,accounts:0,routes:0})},
  accountCenter:{list:()=>({accounts:[],channels:[]})}});
 const handler=routes.get('/plugins/dsh-native-router/status');
 const req=new EventEmitter();req.method='GET';req.socket={remoteAddress:'127.0.0.1'};req.headers={};
 let response;
 await handler(req,{statusCode:200,setHeader(){},end(x){response=JSON.parse(x)}});
 assert.equal(response.version,version);
 dispose();
 const ui=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 assert.match(ui,/status\?\.version/);
 assert.doesNotMatch(ui,/className:'dnr-version'},'1\.0\.0-rc\.25'/);
});
