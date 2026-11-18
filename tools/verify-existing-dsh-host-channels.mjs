import assert from 'node:assert/strict';
import {Server as NetServer} from 'node:net';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime} from '@deepseek-ai/dsh-llm';
import {WebServer} from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import {applyWith} from '../src/index.mjs';
import {normalizeConfig} from '../src/config.mjs';

assert.ok(process.env.DSH_HOME?.startsWith('E:\\Temp\\dsh-native-router-isolated-'),
 'Actual installed-channel borrow test must use disposable E:\\Temp DSH profile');
const listeners=[];
const orig=NetServer.prototype.listen;
NetServer.prototype.listen=function(...args){listeners.push(args);return orig.apply(this,args)};
const ctx=new Context();
const llm=new LlmRuntime(ctx);
let issued=0,readCredential=0,writeCredential=0,probe=0,changed=false;
const enrolled={id:'offline-external-qoder-account',provider:'qoder',
 enabled:true,nickname:'Already Signed In Other DSH Plugin',
 credentialRef:'SECRET_EXTERNAL_SOURCE_REF',refreshable:true};
const original=JSON.stringify(enrolled);
const pool={
 async listAllAccounts(){return [{...enrolled}]},
 async getAvailableAccount(provider,model){
  assert.equal(provider,'qoder');
  assert.equal(model,'already-installed-model');
  return {entry:{...enrolled}};
 },
};
ctx.provide('accountPool',pool);
ctx.provide('credentials',{
 async resolve(){readCredential++;return undefined},
 async describe(){return undefined},
 async set(){writeCredential++;throw Error('CREDENTIAL_WRITE_PROHIBITED')},
 async unset(){writeCredential++;throw Error('CREDENTIAL_UNSET_PROHIBITED')},
 async modifyRecord(_key,update){return await update(undefined)}
});
ctx.provide('commands',{register(){return()=>{}}});
const serverFiber=ctx.plugin(WebServer,{host:'127.0.0.1',port:0});
await serverFiber;
const connectionFiber=ctx.plugin(Connection,{trustedHosts:[]});
await connectionFiber;
const server=ctx.get('webServer',false);
const connection=ctx.get('connection',false);
const base='http://127.0.0.1:'+server.port;
const browser=await fetch(connection.authenticatedUrl(base+'/connect'),{redirect:'manual'});
assert.equal(browser.status,302);
const cookie=browser.headers.get('set-cookie')?.split(';',1)[0];
assert.ok(cookie?.startsWith('dsh-auth-'));
const request=(path,init={})=>fetch(base+'/api/plugins/dsh-native-router'+path,{
 ...init,headers:{cookie,...init.headers}});
const existing={
  providerInfo(){return {id:'qoder',name:'Existing DSH installed Qoder source'}},
  providerRetryPolicy(){return undefined},
  imageRequestPricing(){return undefined},
  imageRequestTarget(){return undefined},
 async listModels(){return [{provider:'qoder',id:'already-installed-model',name:'Fake Authorized Host Model'}]},
 async resolveModel(provider,model){return {provider,id:model,name:model,inputModalities:['text']}},
 async prepareCall(provider,model){return {model:await this.resolveModel(provider,model),
  stream:options=>this.stream(options)}},
 async* stream(options){
  issued++;
  assert.equal(options.provider,'qoder');
  assert.equal(options.model,'already-installed-model');
  assert.equal(JSON.stringify(enrolled),original,'Original DSH channel account must remain unchanged');
  assert.equal(options.messages[0].role,'user');
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'ORIGINAL_DSH_PROVIDER_EXISTING_AUTH_REUSED'};
  yield {type:'block-end',index:0};
  yield {type:'finish',reason:{kind:'stop'}};
 },
};
const detachExisting=llm.registerAdapter(['qoder'],existing);
let cfg=normalizeConfig({
 embeddedPack:{enabled:true},sessionReuse:{enabled:true},
});
const store={path:process.env.DSH_HOME+'\\plugins\\dsh-native-router\\config.json',
 get:()=>structuredClone(cfg),replace:x=>(cfg=normalizeConfig(x),structuredClone(cfg))};
const env={...process.env,USERPROFILE:process.env.DSH_HOME+'\\synthetic-user',
 LOCALAPPDATA:process.env.DSH_HOME+'\\synthetic-user\\AppData\\Local',
 APPDATA:process.env.DSH_HOME+'\\synthetic-user\\AppData\\Roaming'};
const plugin=scope=>applyWith(scope,{configStore:store,env});
let loaded=false;
try{
 const fiber=ctx.inject(['llm','webServer'],plugin);
 await fiber;
 const deadline=Date.now()+9000;
 let state;
 while(Date.now()<deadline){
  const response=await request('/status');
  if(response.status===200){
   state=await response.json();
   if(state.embeddedPack?.state==='blocked')break;
  }
  await new Promise(resolve=>setTimeout(resolve,35));
 }
 assert.equal(state?.embeddedPack?.state,'blocked',
  'Source pack must not displace an already installed native accountPool or provider');
 assert.equal((await ctx.get('accountPool',false).listAllAccounts()).length,1);
 assert.ok(llm.listProviders().some(x=>x.id==='qoder'));
 assert.equal(listeners.length,1,'Exactly the DSH WebServer may listen');
 const anonymous=await fetch(base+'/api/plugins/dsh-native-router/channels/reuse/scan',{
  method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(anonymous.status,401);
 const scan=await request('/channels/reuse/scan',{method:'POST',headers:{origin:base,
  'content-type':'application/json'},body:'{}'});
 assert.equal(scan.status,200);
 const scanned=await scan.json();
   assert.equal(scanned.autoLinked,1,'One already-installed signed-in DSH source must be linked without OAuth');
   assert.equal(scanned.linked,0,'Startup automatic linking is idempotent on manual scan');
   assert.equal(scanned.channels.find(x=>x.providerId==='qoder').available,true);
   assert.equal(scanned.channels.find(x=>x.providerId==='trae').available,false,
     'An unrelated provider must not be described as authenticated or available');
 assert.equal(cfg.accounts.length,1);
 assert.equal(cfg.providers.length,1);
 assert.equal(cfg.providers[0].id,'qoder');
 assert.ok(cfg.accounts[0].id.startsWith('sp_'));
 assert.equal(cfg.accounts[0].autoCheckin,true);
 assert.doesNotMatch(JSON.stringify(cfg),/SECRET_EXTERNAL_SOURCE_REF|offline-external-qoder-account/);
 assert.equal(readCredential,0);
 assert.equal(writeCredential,0);
 assert.equal(JSON.stringify(enrolled),original);
 const enabled=llm.listProviders().map(x=>x.id);
 assert.ok(enabled.includes('native-router')&&enabled.includes('qoder'));
 const found=await llm.listModels('native-router');
 assert.ok(found.some(x=>x.id==='direct:qoder:already-installed-model'),
  'Existing original channel must be discoverable through native-router using no new login');
 const chunks=[];
 for await(const chunk of llm.stream({provider:'native-router',
  model:'direct:qoder:already-installed-model',
  messages:[{role:'user',content:[{type:'text',text:'Existing installed source test'}]}]}))
  chunks.push(chunk);
 assert.equal(chunks.find(x=>x.type==='text-delta')?.text,
  'ORIGINAL_DSH_PROVIDER_EXISTING_AUTH_REUSED');
 assert.equal(chunks.at(-1)?.reason?.kind,'stop');
 assert.equal(issued,1);
 assert.equal(readCredential,0);
 assert.equal(writeCredential,0);
 assert.equal(JSON.stringify(enrolled),original);
 loaded=true;
}finally{
 ctx.registry.delete(plugin);
 await new Promise(resolve=>setTimeout(resolve,75));
 assert.equal((await ctx.get('accountPool',false)?.listAllAccounts())?.length,1,
  'Unloading native router cannot remove another installed channel account pool');
 assert.ok(llm.listProviders().some(x=>x.id==='qoder'),
  'Unloading native router must not unregister another installed model provider');
 assert.ok(!llm.listProviders().some(x=>x.id==='native-router'));
 assert.equal((await request('/status')).status,404);
 if(typeof detachExisting==='function')detachExisting();
 ctx.registry.delete(Connection);
 ctx.registry.delete(WebServer);
}
assert.ok(loaded);
console.log(JSON.stringify({result:'PASS',runtime:'real Cordis, LlmRuntime, WebServer, Connection',
 existingInstalledHostProvider:'qoder',alreadyLoggedInSourceAccounts:1,
 nativeRouterAttachedWithoutOwnSourcePack:true,modelRequestsViaOriginalDSHProvider:issued,
 credentialReads:readCredential,credentialWrites:writeCredential,
 accountPoolUnchanged:JSON.stringify(enrolled)===original,
 noDuplicateProvider:true,noExtraProcess:true,webServerListenerCount:listeners.length,
 authenticatedOwnerLoginReuse:true,unauthenticatedScanDenied:true,unloadPreservedExistingProvider:true}));
process.exit(0);
