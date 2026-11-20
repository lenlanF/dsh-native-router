[CmdletBinding()]
param(
  [string]$Version='1.0.0-rc.21',  [string]$NodePath='E:\Temp\dsh-native-router-isolated-alpha11-node-runtime\package\bin\node.exe')
$ErrorActionPreference='Stop'
$project=([IO.DirectoryInfo](Resolve-Path (Join-Path $PSScriptRoot '..')).Path).FullName
$archive=Join-Path $project ('dsh-native-router-'+$Version+'.tgz')
if(!(Test-Path -LiteralPath $archive -PathType Leaf)){throw 'Audited local .tgz is required first'}
$realDshNode=Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$actualNode=[IO.Path]::GetFullPath($NodePath)
if(!(Test-Path -LiteralPath $NodePath -PathType Leaf)-or
 -not ($actualNode.StartsWith('E:\Temp\',[StringComparison]::OrdinalIgnoreCase) -or
       $actualNode.Equals($realDshNode,[StringComparison]::OrdinalIgnoreCase))){
 throw 'Only isolated E:\Temp Node or the DSH-managed Node runtime may be used'}
$nodeVersion=& $NodePath -p 'process.versions.node'
if($LASTEXITCODE -ne 0 -or [Version]$nodeVersion -lt [Version]'22.10.0'){
 throw 'Node runtime is too old to import the embedded DSH source channels'}
$env:TEMP='E:\Temp'
$env:TMP='E:\Temp'
$env:npm_config_cache='E:\Temp\npm-cache'
$root=Join-Path 'E:\Temp' ('dsh-native-router-isolated-packed-'+[guid]::NewGuid().ToString('N'))
New-Item -Path $root -ItemType Directory -Force|Out-Null
$test=@'
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Server as NetServer} from 'node:net';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime} from '@deepseek-ai/dsh-llm';
import {WebServer} from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import * as router from 'dsh-native-router';

assert.ok(process.env.DSH_HOME?.startsWith('E:\\Temp\\dsh-native-router-isolated-packed-'));
assert.equal(router.name,'dsh-native-router');
assert.equal(typeof router.apply,'function');
assert.equal(typeof router.registerNativeChannelDriver,'function');
const listen=NetServer.prototype.listen,ports=[];
NetServer.prototype.listen=function(...args){ports.push(args);return listen.apply(this,args)};
const ctx=new Context(),llm=new LlmRuntime(ctx);
let storedBrowserCookie;
ctx.provide('settings',{});
ctx.provide('agents',{get:()=>undefined});
ctx.provide('credentials',{
 async resolve(){return undefined},async describe(){return undefined},
 async set(){throw Error('FAKE_CREDENTIAL_WRITE_FORBIDDEN')},
 async unset(){throw Error('FAKE_CREDENTIAL_DELETE_FORBIDDEN')},
 async modifyRecord(_key,update){storedBrowserCookie=await update(storedBrowserCookie);return storedBrowserCookie},
});
ctx.provide('commands',{register(){return()=>{}}});
// Existing Host channels own the original auth Service names.
const preservedAuthServices=new Map(
 ['codeartsAuth','buddyAuth','workbuddyAuth','lobsteraiAuth',
  'qoderAuth','qodercnAuth','traeAuth','clineAuth','loomyAuth',
  'raccoonAuth','minimaxAuth','zcodeAuth','geminiAuth']
 .map(name=>[name,{ownedBy:'original-source-plugin'}]));
for(const [name,original] of preservedAuthServices)ctx.provide(name,original);
const assertOriginalAuthServices=()=>{
 for(const [name,original] of preservedAuthServices)
  assert.equal(ctx.get(name),original,'Original Host auth Service replaced: '+name);
};
const ws=ctx.plugin(WebServer,{host:'127.0.0.1',port:0});
await ws;
const conn=ctx.plugin(Connection,{trustedHosts:[]});
await conn;
const connection=ctx.get('connection',false);
const server=ctx.get('webServer',false);
const base='http://127.0.0.1:'+server.port;
const response=await fetch(connection.authenticatedUrl(base+'/connect'),{redirect:'manual'});
assert.equal(response.status,302);
const cookie=response.headers.get('set-cookie')?.split(';',1)[0];
assert.ok(cookie?.startsWith('dsh-auth-'));
// Authenticate a real read-only source login RPC through DSH Connection.
// Never create or modify an account in the integration smoke test.
const loginRpcUrl=base+'/api/dsh-native-router/channel-pack';
const accountListBody=JSON.stringify({type:'client-request',
 rpcId:'source-readonly-smoke',method:'native-router-channel-pack',
 payload:{method:'account.list',payload:{provider:'loomy'}}});
const querySourceAccounts=()=>fetch(loginRpcUrl,{method:'POST',
 headers:{cookie,'content-type':'application/json'},body:accountListBody});
const unauthSource=await fetch(loginRpcUrl,{method:'POST',
 headers:{'content-type':'application/json'},body:accountListBody});
assert.equal(unauthSource.status,401,'Source login RPC must reject anonymous requests');
let loaded=false;
try{
 const fiber=ctx.plugin(router);
 await fiber;
 const available=llm.listProviders().map(x=>x.id);
 assert.ok(available.includes('native-router'));
 assert.equal(available.filter(x=>x==='native-router').length,1);
 const unauthorized=await fetch(base+'/api/plugins/dsh-native-router/status');
 assert.equal(unauthorized.status,401);
 const status=await fetch(base+'/api/plugins/dsh-native-router/status',{headers:{cookie}});
 assert.equal(status.status,200);
 const data=await status.json();
 assert.equal(data.ok,true);
 assert.equal(data.sessionReuse.enabled,false);
 assert.equal(data.embeddedPack.state,'disabled');
 assert.equal(data.credentialService.available,true,'Credentials must be available through the actual DSH Host service');
 assert.equal(ports.length,1,'Only DSH WebServer may open a listener');
 assert.equal(existsSync(join(process.env.DSH_HOME,'plugins','dsh-native-router','config.json')),false,
  'Fresh installation must not write DSH configuration before explicit user changes');
 // The source pack must also activate from the EXACT published tarball when
 // host WorkBuddy/Loomy already own their public provider names. No real auth,
 // remote traffic or external runtime process is permitted in this acceptance.
 const originalAdapter={
  providerInfo:id=>({id,name:'Original '+id}),
  providerRetryPolicy:()=>undefined,
  listModels:async()=>[],
  async *stream(){},
 };
 const releaseOriginal=llm.registerAdapter(['workbuddy','loomy'],originalAdapter);
 const {createEmbeddedChannelPack}=await import(
   new URL('./node_modules/dsh-native-router/src/embedded-pack.mjs',import.meta.url));
 const ownedSource=createEmbeddedChannelPack({ctx,getConfig:()=>({embeddedPack:{enabled:true}})});
 try{
  ownedSource.attach();
  for(let i=0;i<40&&!['mounted','failed','blocked','host_disposed'].includes(ownedSource.status().state);i++)
   await new Promise(resolve=>setTimeout(resolve,75));
  const sourceStatus=ownedSource.status();
  assert.equal(sourceStatus.state,'mounted',
   'Self-contained native channels cannot mount in actual DSH: '+sourceStatus.reason);
  assertOriginalAuthServices();
  assert.equal(sourceStatus.channelCount,13);
  assert.equal(sourceStatus.rpcReady,true,
    'Account login RPC must be registered, not merely the model adapters');
  assert.equal(sourceStatus.modelAdapterReady.length,13);
  const sourceLogin=await querySourceAccounts();
  assert.equal(sourceLogin.status,200,'Authenticated source login RPC must exist');
  const sourceReply=await sourceLogin.json();
  assert.equal(sourceReply.type,'server-response');
  assert.equal(sourceReply.result?.ok,true);
  assert.deepEqual(sourceReply.result.value.accounts,[]);
  const after=llm.listProviders().map(row=>row.id);
  assert.ok(after.includes('workbuddy')&&after.includes('loomy'));
  assert.equal(after.filter(id=>id.startsWith('native-router-source-')).length,13);
  assert.ok(after.includes('native-router-source-workbuddy'));
  assert.ok(after.includes('native-router-source-loomy'));
  assert.equal(ports.length,1,'No source pack extra web server listener');
 }finally{
   ownedSource.dispose();
   await new Promise(resolve=>setTimeout(resolve,250));
   const leftover=llm.listProviders().map(row=>row.id)
     .filter(id=>id.startsWith('native-router-source-'));
   assert.deepEqual(leftover,[],
     'Unloaded plugin must release ONLY its 13 independent model routes');
   // Recreate its injection scope under the very same DSH runtime; no cold
   // process restart, no original WorkBuddy/Loomy removal.
   const again=createEmbeddedChannelPack({ctx,getConfig:()=>({embeddedPack:{enabled:true}})});
   try{
     again.attach();
     for(let i=0;i<40&&!['mounted','failed','blocked','host_disposed'].includes(again.status().state);i++)
       await new Promise(resolve=>setTimeout(resolve,75));
     assert.equal(again.status().state,'mounted',
       'DSH repeat mount must not hit register_owned_adapter: '+again.status().reason);
     assert.equal(llm.listProviders().filter(row=>row.id.startsWith('native-router-source-')).length,13);
   }finally{
     again.dispose();
     await new Promise(resolve=>setTimeout(resolve,250));
     // A preexisting source alias from another Cordis scope must not prevent
     // the independent account authorization page from mounting.
     const occupied=llm.registerAdapter(['native-router-source-loomy'],originalAdapter);
     const degraded=createEmbeddedChannelPack({ctx,getConfig:()=>({embeddedPack:{enabled:true}})});
     try{
       degraded.attach();
       for(let i=0;i<40&&!['mounted','failed','blocked','host_disposed'].includes(degraded.status().state);i++)
         await new Promise(resolve=>setTimeout(resolve,75));
       const degradedStatus=degraded.status();
       assert.equal(degradedStatus.state,'mounted','Alias conflict must not disable independent login');
       assert.equal(degradedStatus.rpcReady,true);
       assert.equal(degradedStatus.channelCount,13);
       assert.equal(degradedStatus.modelAdapterReady.length,12);
       assert.equal(degradedStatus.modelAdapterUnreadyReasons.loomy,'alias_occupied');
       const reply=await querySourceAccounts();
       assert.equal(reply.status,200,'Source login RPC must survive a model alias collision');
       assert.equal((await reply.json()).result?.ok,true);
     }finally{
       degraded.dispose();
       await new Promise(resolve=>setTimeout(resolve,250));
       assert.ok(llm.listProviders().some(row=>row.id==='native-router-source-loomy'),
         'Existing alias registered outside the plugin must not be removed');
       occupied();
       releaseOriginal();
     }
   }
   assert.equal(llm.listProviders().filter(row=>row.id.startsWith('native-router-source-')).length,0);
 }
 loaded=true;
}finally{
 ctx.registry.delete(router);
 await new Promise(resolve=>setTimeout(resolve,90));
 assert.ok(!llm.listProviders().some(x=>x.id==='native-router'),'native adapter must unload');
 assert.equal((await fetch(base+'/api/plugins/dsh-native-router/status',{headers:{cookie}})).status,404);
 ctx.registry.delete(Connection);
 ctx.registry.delete(WebServer);
}
assertOriginalAuthServices();
assert.ok(loaded);
console.log(JSON.stringify({result:'PASS',packagedModuleImported:true,
 nativeProviderRegisteredAndUnloaded:true,authenticatedOwnerStatus:200,
 anonymousStatus:401,afterUnload:404,
 sourcePackDefaultDisabled:true,sourceMountWithHostCollisions:true,
 sourceLoginRpcAuthenticated:true,sourceLoginReadOnlyAccountsValidated:true,
 sourceLoginSurvivesAliasConflict:true,thirteenIndependentAdapters:true,
 credentialsServiceReady:true,configNotWritten:true,
 onlyDshWebServerListener:true,realAccounts:0,networkCloudCalls:0,
 independentProcesses:0}));
process.exit(0);
'@
try{
 [IO.File]::WriteAllText((Join-Path $root 'package.json'),'{"name":"dsh-native-router-packed-acceptance","private":true,"type":"module"}',[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $root 'packed-smoke.mjs'),$test,[Text.UTF8Encoding]::new($false))
 $dependencies=@(
  $archive,
  '@deepseek-ai/cordis@4.1.0',
  '@deepseek-ai/dsh-llm@0.2.2-rc.3',
  '@deepseek-ai/dsh-error@0.2.2-rc.3',
  '@deepseek-ai/dsh-scope@0.2.2-rc.3',
  '@deepseek-ai/dsh-credentials@0.2.2-rc.3',
  '@deepseek-ai/dsh-host-webserver@0.2.2-rc.3',
  '@deepseek-ai/dsh-client-connection@0.2.2-rc.3',
  '@deepseek-ai/schemastery@3.19.0',
  '@deepseek-ai/dsh-invariants@0.1.0-rc.6'
 )
 Push-Location $root
 try{
   # The system npm wrapper runs under Node 22.5 and only *installs* the
   # package; the actual plugin runs under the checked portable Node 22.16.
   # Silence the expected engine warning and verify the real exit code.
   $beforeErrorAction=$ErrorActionPreference
   $ErrorActionPreference='Continue'
   try{$o=& npm.cmd install --loglevel=error --ignore-scripts --legacy-peer-deps --no-audit --no-fund @dependencies 2>&1
    $installCode=$LASTEXITCODE}
   finally{$ErrorActionPreference=$beforeErrorAction}
   if($installCode -ne 0){
   $tail=($o|Select-Object -Last 15|Out-String)
   throw ('Packed plugin isolated install failed: '+$tail)
  }
  $o|Select-Object -Last 5|ForEach-Object{$_}
  $env:DSH_HOME=$root
  $env:DSH_CHANNEL_PACK_STATE_DIR=$root
  $env:DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT='0'
  Remove-Item Env:DSH_OPENAI_GATEWAY_ENABLED,Env:DSH_REASONING_LOOP_AUTO_RESUME -ErrorAction SilentlyContinue
  & $NodePath (Join-Path $root 'packed-smoke.mjs')
  if($LASTEXITCODE -ne 0){throw 'Published tarball failed real Cordis plugin lifecycle smoke test'}
 }finally{Pop-Location}
}finally{
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
