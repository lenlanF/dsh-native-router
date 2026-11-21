import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAutoFreePool} from '../src/auto-free.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createRoutingEngine} from '../src/router.mjs';
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
 return {id,config,pool};
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
