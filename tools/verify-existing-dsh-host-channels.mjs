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
  async listModels(){return [
   {provider:'qoder',id:'already-installed-model',name:'Fake Authorized Host Model'},
   {provider:'qoder',id:'unselected-expensive-model',name:'Not allowed in aggregator'}]},
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
 providers:[{id:'qoder',name:'Original Qoder host adapter',protocol:'dsh-host',
   enabled:true,models:['already-installed-model','unselected-expensive-model'],
   supportsTools:true}],
 hostModelSelection:{qoder:['already-installed-model']},
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
    if(['mounted','failed','blocked'].includes(state.embeddedPack?.state))break;
  }
  await new Promise(resolve=>setTimeout(resolve,35));
 }
 assert.equal(state?.embeddedPack?.state,'mounted',
   'Bundled source must mount an independent pool beside an already installed provider: '+JSON.stringify({state:state?.embeddedPack?.state,stage:state?.embeddedPack?.errorStage,kind:state?.embeddedPack?.errorKind}));
 assert.equal(state.embeddedPack.independentLogin,true);
 assert.ok(state.embeddedPack.modelAdapterReady.includes('qoder'),
   'Separate private native source qoder alias must be ready');
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
 assert.equal(scanned.autoLinked,0,
  'Discovery must never import another plugin login without explicit owner adoption');
 assert.equal(scanned.linked,0,
  'Read-only scan never writes the configured accounts');
 assert.equal(scanned.attempted,1,
  'The original already-signed-in channel is discovered');
 assert.equal(scanned.needsOneTimeMigration,1);
 assert.equal(scanned.channels.find(x=>x.providerId==='qoder').available,true);
 assert.equal(scanned.channels.find(x=>x.providerId==='qoder').accountDetected,true);
 assert.equal(scanned.channels.find(x=>x.providerId==='qoder').loginVerified,false,
  'The scanned account is not officially verified merely by listing it');
 assert.equal(scanned.channels.find(x=>x.providerId==='trae').available,true,
  'Mounted private provider adapter may be usable even without a session');
 assert.equal(scanned.channels.find(x=>x.providerId==='trae').accountDetected,false);
 assert.equal(scanned.channels.find(x=>x.providerId==='trae').loginVerified,false);
 assert.equal(cfg.accounts.length,0);
 assert.equal(cfg.providers.length,1);
 assert.equal(cfg.providers[0].id,'qoder');
 assert.equal(cfg.providers[0].protocol,'dsh-host');
 assert.doesNotMatch(JSON.stringify(cfg),/SECRET_EXTERNAL_SOURCE_REF|offline-external-qoder-account/);
 assert.equal(readCredential,0);
 assert.equal(writeCredential,0);
 assert.equal(JSON.stringify(enrolled),original);
 const enabled=llm.listProviders().map(x=>x.id);
 assert.ok(enabled.includes('native-router')&&enabled.includes('qoder'));
  const originalModels=await llm.listModels('qoder');
  assert.ok(originalModels.some(x=>x.id==='unselected-expensive-model'),
   'The standalone DSH provider retains its full source catalog');
  const found=await llm.listModels('native-router');
  assert.ok(found.some(x=>x.id==='direct:qoder:already-installed-model'),
   'Explicitly selected original Host model is discoverable through aggregator');
  assert.ok(!found.some(x=>x.id==='direct:qoder:unselected-expensive-model'),
   'Unselected expensive Host model must never be advertised by aggregator');
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
  existingInstalledHostProvider:'qoder',detectedExternalSourceAccounts:1,
  independentOwnedSourcePackMounted:true,readOnlyScanLinkedAccounts:0,
  hostModelAllowlistEffective:true,originalHostCatalogUnchanged:true,
  modelRequestsViaOriginalDSHProvider:issued,
  credentialReads:readCredential,credentialWrites:writeCredential,
  accountPoolUnchanged:JSON.stringify(enrolled)===original,
 noDuplicateProvider:true,noExtraProcess:true,webServerListenerCount:listeners.length,
 authenticatedOwnerLoginReuse:true,unauthenticatedScanDenied:true,unloadPreservedExistingProvider:true}));
process.exit(0);
