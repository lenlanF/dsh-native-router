import assert from 'node:assert/strict';
import {Server as NetServer} from 'node:net';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime} from '@deepseek-ai/dsh-llm';
import {WebServer} from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import {applyWith,registerNativeChannelDriver} from '../src/index.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {channelPackIsolationReason} from '../src/channel-pack-isolation.mjs';

// Development-only acceptance: actual Cordis/DSH LLM/WebServer/source-pack
// components, entirely fake local model and credential services. No cloud I/O.
assert.equal(channelPackIsolationReason(process.env),'','isolated E:\\Temp DSH profile required');
// Prove the packaged native derivative starts without any gateway/daemon env switches.
for(const key of ['DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE','DSH_OPENAI_GATEWAY_ENABLED',
 'DSH_REASONING_LOOP_AUTO_RESUME'])
 assert.equal(process.env[key],undefined,'No external runtime flag may be required: '+key);

const listenerCalls=[];
const nativeListen=NetServer.prototype.listen;
NetServer.prototype.listen=function(...args){listenerCalls.push(args);return nativeListen.apply(this,args)};
const ctx=new Context(),llm=new LlmRuntime(ctx);
const stats={credentialReads:0,credentialWrites:0,authCredentialWrites:0,
 modelCalls:0,toolCalls:0,fallbackAccounts:[]};
let testBrowserRecord;
ctx.provide('credentials',{
 async resolve(){stats.credentialReads++;return undefined},
 async describe(){return undefined},
 async set(){stats.credentialWrites++;throw Error('TEST_CREDENTIAL_WRITE_DENIED')},
 async unset(){stats.credentialWrites++;throw Error('TEST_CREDENTIAL_DELETE_DENIED')},
 async modifyRecord(_key,update){
  const next=await update(testBrowserRecord);
  if(next){testBrowserRecord=next;stats.authCredentialWrites++}
  return testBrowserRecord;
 },
});
ctx.provide('commands',{register(){return ()=>{}}});
const serverFiber=ctx.plugin(WebServer,{host:'127.0.0.1',port:0});
await serverFiber;
const connectionFiber=ctx.plugin(Connection,{trustedHosts:[]});
await connectionFiber;
const connection=ctx.get('connection',false);
assert.equal(typeof connection?.fetch?.register,'function');
const server=ctx.get('webServer',false);
assert.equal(server.host,'127.0.0.1');
assert.ok(Number.isInteger(server.port)&&server.port>0);
const base='http://127.0.0.1:'+server.port;
const entry=await fetch(connection.authenticatedUrl(base+'/connect'),{redirect:'manual'});
assert.equal(entry.status,302,'local synthetic operator can create a browser cookie');
const cookie=entry.headers.get('set-cookie')?.split(';',1)[0];
assert.ok(cookie&&cookie.startsWith('dsh-auth-'),'expected an HttpOnly operator cookie');
const apiPath='/api/plugins/dsh-native-router';
const authorized=(path,init={})=>fetch(base+apiPath+path,{
 ...init,headers:{cookie,...init.headers},
});
// All automatic desktop-session discovery is fenced into an E:\\Temp fake home.
const fakeLocal=join(process.env.DSH_HOME,'synthetic','AppData','Local');
const fakeRoaming=join(process.env.DSH_HOME,'synthetic','AppData','Roaming');
const fakeHome=join(process.env.DSH_HOME,'synthetic');
const fakeDesktopFile=join(fakeLocal,'CodeBuddyExtension','Data','Public','auth','workbuddy-desktop.info');
mkdirSync(join(fakeLocal,'CodeBuddyExtension','Data','Public','auth'),{recursive:true});
const fakeDesktopJwt='head.'+Buffer.from(JSON.stringify({sub:'synthetic-non-production-user',
  exp:Math.round(Date.now()/1000)+86400*100})).toString('base64url')+'.signature';
writeFileSync(fakeDesktopFile,JSON.stringify({auth:{
 accessToken:fakeDesktopJwt,refreshToken:'',expiresAt:Date.now()+86400*100*1000,
 uin:'synthetic-uid-789',nickname:'synthetic-desktop-account'}}),'utf8');
const fakeDesktopSha=createHash('sha256').update(readFileSync(fakeDesktopFile)).digest('hex');
const clientEnv={...process.env,USERPROFILE:fakeHome,LOCALAPPDATA:fakeLocal,APPDATA:fakeRoaming};
let config=normalizeConfig({
  embeddedPack:{enabled:true},sessionReuse:{enabled:true},
 providers:[{id:'fixture',name:'Offline Fixture',protocol:'native-channel',
    models:['fake-text','fake-tools','fake-fallback'],supportsTools:true}],
  accounts:[
   {id:'fake-only',providerId:'fixture',credentialRef:'driver:fixture:no-real-account'},
   {id:'fake-second',providerId:'fixture',credentialRef:'driver:fixture:no-real-account-2'},
  ],
  routes:[
   {id:'synthetic-text',name:'synthetic-text',mode:'priority',tiers:[{providerId:'fixture',model:'fake-text'}]},
   {id:'synthetic-tools',name:'synthetic-tools',mode:'priority',tiers:[{providerId:'fixture',model:'fake-tools'}]},
   {id:'synthetic-fallback',name:'synthetic-fallback',mode:'priority',maxSwitches:2,
    tiers:[{providerId:'fixture',model:'fake-fallback'}]},
  ],
});
const store={path:join(process.env.DSH_HOME,'plugins','dsh-native-router','config.json'),
 get:()=>structuredClone(config),replace:value=>{
   config=normalizeConfig(value);return structuredClone(config);
 }}; // Synthetic configuration stays only in process memory; never writes the real DSH profile.
const driver={generate:async({model,options,account})=>{
 stats.modelCalls++;
 if(model==='fake-fallback'){
  stats.fallbackAccounts.push(account.id);
  if(account.id==='fake-only')throw Object.assign(Error('OFFLINE_RATE_LIMIT_FIXTURE'),{status:429});
  return {text:'OFFLINE_FAILOVER_OK',reasoning:'',toolCalls:[],finishReason:'stop'};
 }
 if(model==='fake-tools'){
  stats.toolCalls++;
  assert.equal(options.tools?.length,1);
  return {text:'',reasoning:'',toolCalls:[{id:'fake_call',name:'todo_write',
    arguments:'{"tasks":["local-fixture-only"]}'}],finishReason:'tool_calls'};
 }
 return {text:'OFFLINE_DSH_REAL_RUNTIME_OK',reasoning:'',toolCalls:[],finishReason:'stop'};
}};
const disposeFakeDriver=registerNativeChannelDriver('fixture',driver);
const privateFetch=async(url,options)=>{
 const address=String(url);
 if(address==='https://copilot.tencent.com/v3/config')
  return new Response(JSON.stringify({code:0,data:{models:[
   {id:'synthetic-desktop-model',supportsToolCall:true}
  ]}}),{status:200,headers:{'content-type':'application/json'}});
 if(address==='https://copilot.tencent.com/v2/chat/completions'){
  assert.equal(options.headers.authorization,'Bearer '+fakeDesktopJwt,
    'Only the current synthetic desktop login should be used');
  return new Response('data: '+JSON.stringify({choices:[{
   delta:{content:'OFFLINE_REUSED_DESKTOP_LOGIN'},finish_reason:'stop',
  }]})+'\n\ndata: [DONE]\n\n',
   {status:200,headers:{'content-type':'text/event-stream'}});
 }
 throw Error('Network forbidden for isolated installed-client credential reuse: '+address);
};
const plugin=scope=>applyWith(scope,{configStore:store,env:clientEnv,fetchImpl:privateFetch});
let mounted=false;
try{
 const fiber=ctx.inject(['llm','webServer'],plugin);
 await fiber;
  const url=base+apiPath+'/status';
 let response,body;
 const deadline=Date.now()+9000;
 while(Date.now()<deadline){
   response=await authorized('/status');
  if(response.status===200){
   body=await response.json();
   if(body.embeddedPack?.state==='mounted')break;
   if(['failed','blocked','host_disposed'].includes(body.embeddedPack?.state))
    throw Error('Source pack mount rejected: '+JSON.stringify(body.embeddedPack));
  }
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 assert.equal(body?.embeddedPack?.state,'mounted');
  mounted=true;
  assert.equal(listenerCalls.length,1,'only the existing DSH WebServer may listen; no upstream 8326 sidecar');
 const providers=llm.listProviders();
 assert.equal(providers.length,14,'13 pinned source providers plus native-router');
 assert.equal(typeof ctx.get('nativeRouterSourceCheckins',false)?.status,'function',
   'actual source per-account check-in service must be discoverable by native router');
 assert.equal(typeof ctx.get('nativeRouterSourceCheckins',false)?.claim,'function');
  assert.ok(connection.fetchRoutes?.has('/api/dsh-native-router/channel-pack'));
  assert.ok(connection.fetchRoutes?.has(apiPath+'/config'));
 assert.equal(llm.listProviders().length,14);
 assert.equal(typeof ctx.get('accountPool',false)?.listAllAccounts,'function');
 assert.equal((await ctx.get('accountPool',false).listAllAccounts()).length,0);
 const resolved=await llm.resolveModelInfo('native-router','chain:synthetic-text');
 assert.equal(resolved.id,'chain:synthetic-text');

 const messages=[{role:'user',content:[{type:'text',text:'offline fixture'}]}];
 const textEvents=[];
 for await(const event of llm.stream({provider:'native-router',model:'chain:synthetic-text',messages}))
  textEvents.push(event);
 assert.equal(textEvents.find(event=>event.type==='text-delta')?.text,'OFFLINE_DSH_REAL_RUNTIME_OK');
 assert.equal(textEvents.at(-1)?.reason?.kind,'stop');

 const offered=[{name:'todo_write',description:'Offline tool; never execute',
  parameters:{type:'object',properties:{tasks:{type:'array',items:{type:'string'}}},
    required:['tasks']}}];
 const toolEvents=[];
 for await(const event of llm.stream({provider:'native-router',model:'chain:synthetic-tools',
  messages,tools:offered}))toolEvents.push(event);
 assert.equal(toolEvents.find(event=>event.type==='tool-call-delta')?.name,'todo_write');
 assert.equal(toolEvents.at(-1)?.reason?.kind,'tool-calls');
 const fallbackEvents=[];
 for await(const event of llm.stream({provider:'native-router',model:'chain:synthetic-fallback',messages}))
  fallbackEvents.push(event);
 assert.equal(fallbackEvents.find(event=>event.type==='text-delta')?.text,'OFFLINE_FAILOVER_OK');
 assert.equal(fallbackEvents.at(-1)?.reason?.kind,'stop');
 assert.deepEqual(stats.fallbackAccounts,['fake-only','fake-second']);
 assert.equal(JSON.stringify(fallbackEvents).includes('OFFLINE_RATE_LIMIT_FIXTURE'),false);
  const unauthorized=await fetch(url);
  assert.equal(unauthorized.status,401,'unauthenticated localhost must not read router state');
  const staleDirect=await fetch(base+'/plugins/dsh-native-router/config');
  assert.equal(staleDirect.status,404,'no unauthenticated direct WebServer admin route');
  const status=await authorized('/status');
  const configRead=await authorized('/config');
  const accounts=await authorized('/channels/accounts');
  const wrongOrigin=await authorized('/config',{
   method:'POST',headers:{origin:'http://malicious.example','content-type':'application/json'},
   body:'{"providers":[]}'});
  const validUpdate=await authorized('/config',{
  method:'POST',headers:{origin:base,'content-type':'application/json'},
  body:JSON.stringify(store.get()),
 });
 const saved=await validUpdate.json();
 assert.equal(validUpdate.status,200);
 assert.equal(saved.ok,true);
 assert.equal(saved.restartRequired,true);
 assert.deepEqual([status.status,configRead.status,accounts.status,wrongOrigin.status],[200,200,200,403]);
 const accountResult=await accounts.json();
 assert.equal(accountResult.embeddedAccounts.state,'ready');
 assert.deepEqual(accountResult.embeddedAccounts.accounts,[]);
 assert.equal(stats.credentialReads,0);
  assert.equal(stats.credentialWrites,0);
  assert.equal(stats.authCredentialWrites,1,'synthetic browser signing key is in memory only');
 assert.deepEqual([stats.modelCalls,stats.toolCalls],[4,1]);
 const pool=ctx.get('accountPool',false);
 await pool.addAccount({id:'alpha13-fake-source',provider:'lobsterai',enabled:false,
  credentialRef:'ALPHA13_FAKE_REF',nickname:'offline-only'});
  await pool.addAccount({id:'alpha14-buddy-a',provider:'buddy',enabled:true,
    credentialRef:'ALPHA14_BUDDY_FAKE_A',nickname:'offline-a'});
   await pool.addAccount({id:'alpha14-buddy-b',provider:'buddy',enabled:true,
     credentialRef:'ALPHA14_BUDDY_FAKE_B',nickname:'offline-b'});
   await pool.addAccount({id:'alpha16-qoder-synthetic',provider:'qoder',enabled:true,
     credentialRef:'ALPHA16_QODER_FAKE_REF',nickname:'already-logged-in-synthetic-source'});
  const checkinOps=ctx.get('nativeRouterSourceCheckins',false);
  const selectedStatus=await checkinOps.status('buddy','alpha14-buddy-b');
  assert.equal(selectedStatus.ok,true);
  assert.deepEqual(selectedStatus.value.accounts.map(x=>x.accountId),['alpha14-buddy-b']);
  const selectedClaim=await checkinOps.claim('buddy','alpha14-buddy-b');
  assert.equal(selectedClaim.ok,true);
  assert.deepEqual(selectedClaim.value.results.map(x=>x.accountId),['alpha14-buddy-b']);
  assert.equal(selectedClaim.value.results[0].outcome.kind,'failed',
    'missing fake credential cannot count as a successful claim');
  assert.equal(stats.credentialReads,2,'one status and one claim lookup, only for B');
   const checkinsResponse=await authorized('/checkins');
  assert.equal(checkinsResponse.status,200);
  const checkinsPage=await checkinsResponse.json();
  const sourceAccountB=checkinsPage.accounts.find(x=>x.providerId==='buddy'
    &&x.nickname==='offline-b');
  assert.ok(sourceAccountB,'source B should show in the unified DSH check-in page');
  assert.equal(sourceAccountB.sourceAccount,true);
  assert.equal(sourceAccountB.checkinSupported,true);
  assert.equal(sourceAccountB.checkinState,'not_run');
  assert.ok(checkinsPage.groups.some(g=>g.id==='buddy'&&g.accountCount===2));
   const manual=await authorized('/checkins/action',{
    method:'POST',headers:{origin:base,'content-type':'application/json'},
    body:JSON.stringify({action:'run',accountId:sourceAccountB.id}),
  });
  assert.equal(manual.status,200);
  const manualResult=await manual.json();
  assert.equal(manualResult.ok,true);
  assert.equal(manualResult.result.record.state,'pending_confirmation',
    'a real DSH service must not report sign-in success without server status confirmation');
  assert.equal(stats.credentialReads,3,'manual sign-in only checked source B, never A');
   const afterManual=await(await authorized('/checkins')).json();
  assert.equal(afterManual.accounts.find(x=>x.id===sourceAccountB.id).checkinState,
    'pending_confirmation');
  const unauthReuse=await fetch(base+apiPath+'/channels/reuse/scan',{
    method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(unauthReuse.status,401,
    'local untrusted process must never trigger installed-client credential discovery');
  const reuse=await authorized('/channels/reuse/scan',{
    method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'});
  assert.equal(reuse.status,200);
  const reused=await reuse.json();
  assert.equal(reused.ok,true);
  assert.ok(reused.autoLinked>=2,
    'both already signed-in synthetic desktop and DSH source account should attach without OAuth');
  const linked=store.get();
  assert.equal(linked.accounts.filter(x=>x.providerId==='workbuddy').length,1);
  assert.equal(linked.accounts.filter(x=>x.providerId==='qoder').length,1);
   assert.equal(linked.accounts.find(x=>x.providerId==='qoder').autoCheckin,true,
     'reusing an existing DSH source account must retain global source check-in eligibility');
  assert.equal(linked.sessionReuse.linkedIds.length,2);
  assert.equal(stats.credentialReads,3,
    'auto-reusing an existing source account reference must not read or copy its credential');
  assert.equal(createHash('sha256').update(readFileSync(fakeDesktopFile)).digest('hex'),
    fakeDesktopSha,'existing desktop login file must remain byte-for-byte unchanged');
  const pointer=join(process.env.DSH_HOME,'plugins','dsh-native-router','workbuddy-sources.json');
  assert.ok(existsSync(pointer),'only an opaque plugin-side desktop account pointer is stored');
  assert.doesNotMatch(readFileSync(pointer,'utf8')+JSON.stringify(linked),/signature|synthetic-non-production-user|accessToken|refreshToken/,
    'no original signed-in credentials may be duplicated in the native router config');
  // A preconfigured fake catalog model prevents touching the Qoder cloud while
  // exercising the REAL DSH LlmRuntime on the automatically reused desktop login.
  store.replace({...linked,providers:linked.providers.map(p=>
    p.id==='qoder'?{...p,models:['offline-qoder-model']}:p)});
  const reusedModel=await llm.resolveModelInfo('native-router','direct:workbuddy:synthetic-desktop-model');
  assert.equal(reusedModel.id,'direct:workbuddy:synthetic-desktop-model');
  const reusedEvents=[];
  for await(const event of llm.stream({provider:'native-router',
    model:'direct:workbuddy:synthetic-desktop-model',
    messages:[{role:'user',content:[{type:'text',text:'isolated existing login'}]}]}))
    reusedEvents.push(event);
  assert.equal(reusedEvents.find(e=>e.type==='text-delta')?.text,'OFFLINE_REUSED_DESKTOP_LOGIN');
  assert.equal(reusedEvents.at(-1)?.reason?.kind,'stop');
  assert.equal(stats.credentialWrites,0);
  assert.equal(createHash('sha256').update(readFileSync(fakeDesktopFile)).digest('hex'),
    fakeDesktopSha,'desktop session must remain unmodified after actual in-process model request');
  const privatePath=join(process.env.DSH_HOME,'plugins','dsh-native-router','source-channel-pack','channel-pack','state.json');
 assert.equal(existsSync(join(process.env.DSH_HOME,'channel-pack','state.json')),false,
  'must not create or overwrite the standalone channel-pack state');
 assert.equal(listenerCalls.length,1,'no extra listener started during model, HTTP or source account actions');
 }finally{
   ctx.registry.delete(plugin);
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(ctx.get('accountPool',false),undefined,'source accountPool must be released');
 assert.deepEqual(llm.listProviders(),[],'all model providers must be released');
  const response=await authorized('/status');
 assert.equal(response.status,404,'settings HTTP route must be unregistered');
   ctx.registry.delete(Connection);
   disposeFakeDriver();
  ctx.registry.delete(WebServer);
  await new Promise(resolve=>setTimeout(resolve,60));
}
assert.ok(mounted);
console.log(JSON.stringify({result:'PASS',
 runtime:'real Cordis, LlmRuntime, WebServer, Connection and native source pack',
 providers:14,offlineModelCalls:stats.modelCalls,syntheticToolCalls:stats.toolCalls,
 syntheticFallbackAccounts:stats.fallbackAccounts,
 credentialReads:stats.credentialReads,credentialWrites:stats.credentialWrites,
 syntheticBrowserAuthWrites:stats.authCredentialWrites,
 authenticatedStatus:200,unauthenticatedStatus:401,hostileOriginStatus:403,
 legacyDirectRouteStatus:404,afterUnload:404,accountPoolAfterUnload:'absent',
 onlyDshHostListener:listenerCalls.length===1,privateSourceState:true}));
process.exit(0);
