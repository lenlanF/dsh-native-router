import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEmbeddedChannelPack,SOURCE_PACK_PROVIDERS} from '../src/embedded-pack.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {channelPackNodeRuntimeReason} from '../src/channel-pack-isolation.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const isolatedHome=mkdtempSync('E:\\Temp\\dsh-native-router-isolated-');
process.once('exit',()=>rmSync(isolatedHome,{recursive:true,force:true}));
const isolatedEnv={DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1',DSH_OPENAI_GATEWAY_ENABLED:'0',
 DSH_REASONING_LOOP_AUTO_RESUME:'0',DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE:'1',
 DSH_HOME:isolatedHome,DSH_CHANNEL_PACK_STATE_DIR:isolatedHome};
const enabled=()=>({embeddedPack:{enabled:true}});
test('real pinned source pack ESM import is refused on incompatible Node runtimes before loading its embedded Undici',()=>{
  const available=()=>{};
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'22.5.0',markAsUncloneable:undefined}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'22.9.0',markAsUncloneable:available}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'21.16.0',markAsUncloneable:available}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'24.1.0',markAsUncloneable:null}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'malformed',markAsUncloneable:available}),/无法确认/);
  assert.equal(channelPackNodeRuntimeReason({nodeVersion:'22.10.0',markAsUncloneable:available}),'');
  assert.equal(channelPackNodeRuntimeReason({nodeVersion:'22.16.0',markAsUncloneable:available}),'');
  assert.equal(channelPackNodeRuntimeReason({nodeVersion:'24.1.0',markAsUncloneable:available}),'');
});
test('pinned MIT channel pack is a verified upstream distribution snapshot, including WASM',()=>{
 const receipt=JSON.parse(readFileSync(join(root,'vendor','channel-pack','SOURCE_RECEIPT.json'),'utf8'));
 assert.equal(receipt.sourceCommit,'6daa5bc344feac44763af25c674e8882c292a728');
 assert.equal(receipt.sourceLicense,'MIT');
 assert.equal(receipt.referenceFiles.length,4);
 for(const item of receipt.referenceFiles){
   const bytes=readFileSync(join(root,'vendor','channel-pack',item.file));
   const source=item.file.endsWith('.wasm')?bytes:Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
   assert.equal(source.length,item.bytes,'canonical source size '+item.file);
   assert.equal(createHash('sha256').update(source).digest('hex'),item.sha256,
    'canonical source SHA '+item.file);
 }
 assert.deepEqual(SOURCE_PACK_PROVIDERS,[
  'codearts','buddy','workbuddy','lobsterai','qoder','qodercn',
  'trae','cline','loomy','raccoon','minimax','zcode','gemini']);
});
test('pack reuse is disabled by default and never calls loader or inject',async()=>{
 let called=0;
 const ctx={inject(){throw Error('not allowed')}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:()=>normalizeConfig({}),
  loadPack:()=>{called++;throw Error('not allowed')}});
 assert.equal(bridge.attach().state,'disabled');
 await tick();assert.equal(called,0);
});
test('experimental mount requires three explicit permissions, including disabled upstream auto-resume',async()=>{
 let called=0;
 const ctx={inject(){called++}};
 for(const env of [{},{DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1'},
  {DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1',DSH_OPENAI_GATEWAY_ENABLED:'0'},
  {...isolatedEnv,DSH_REASONING_LOOP_AUTO_RESUME:'1'},
  {...isolatedEnv,DSH_OPENAI_GATEWAY_ENABLED:'on'}]){
  const bridge=createEmbeddedChannelPack({ctx,env,getConfig:enabled,
   loadPack:()=>{throw Error('not allowed')}});
  assert.equal(bridge.attach().state,'blocked');
 }
 await tick();assert.equal(called,0);
});
test('rejects nonisolated or mismatched profile BEFORE source code import, even if three old safety switches are enabled',async()=>{
 let imports=0,injections=0;
 const ctx={inject(){injections++}};
 const attempts=[
  {...isolatedEnv,DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE:'0'},
  {...isolatedEnv,DSH_HOME:'C:\\Users\\Public\\.dsh'},
  {...isolatedEnv,DSH_HOME:'E:\\Temp'},
  {...isolatedEnv,DSH_CHANNEL_PACK_STATE_DIR:'E:\\Temp'},
  {...isolatedEnv,DSH_CHANNEL_PACK_STATE_DIR:'E:\\Temp\\nonexistent-source-profile'},
 ];
 for(const env of attempts){
  const b=createEmbeddedChannelPack({ctx,env,getConfig:enabled,loadPack:()=>{imports++;return {apply(){}}}});
  assert.equal(b.attach().state,'blocked');
  assert.match(b.status().reason,/Profile|状态目录|隔离目录/);
 }
 await tick();
 assert.equal(imports,0);assert.equal(injections,0);
});
test('different actual host profile is denied and source pack never imported',async()=>{
 let imports=0;
 const ctx={inject(_names,cb){cb({get:key=>key==='profileContext'?{home:'C:\\Users\\Public\\.dsh'}:undefined})}};
 const b=createEmbeddedChannelPack({ctx,env:isolatedEnv,getConfig:enabled,
  loadPack:()=>{imports++;return {apply(){}}}});
 assert.equal(b.attach().state,'blocked');
 await tick();assert.equal(imports,0);
 assert.match(b.status().reason,/profileContext/);
});
test('isolation safety is checked AGAIN immediately before async source apply',async()=>{
 let release,applied=0;
 const env={...isolatedEnv};
 const ctx={inject(_names,cb){cb({get:()=>undefined})}};
 const b=createEmbeddedChannelPack({ctx,env,getConfig:enabled,
  loadPack:()=>new Promise(resolve=>{release=resolve})});
 assert.equal(b.attach().state,'loading');
 await tick();
 env.DSH_CHANNEL_PACK_STATE_DIR='C:\\Users\\Public\\.dsh';
 release({apply(){applied++}});
 await tick();await tick();
 assert.equal(b.status().state,'blocked');
 assert.equal(applied,0);
});
test('host provider collisions deny bundled pack before it is even imported',async()=>{
 let imports=0;
 for(const row of [
  ['workbuddy','native-router'],
  [{provider:'qoder'},{id:'other'}],
  [{id:'loomy'}],
 ]){
  const scope={llm:{listProviders:async()=>row},get:()=>undefined};
  const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
   env:isolatedEnv,getConfig:enabled,loadPack:async()=>{imports++;return {apply(){}}}});
  assert.equal(bridge.attach().state,'loading');
  await tick();await tick();
  assert.equal(bridge.status().state,'blocked');
  assert.match(bridge.status().reason,/已注册/);
 }
 assert.equal(imports,0);
});
test('incomplete host provider registry is blocked rather than risking partial takeover',async()=>{
 let imports=0;
 const scope={llm:{listProviders:async()=>[{unexpected:'not-a-provider'}]},get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
  env:isolatedEnv,getConfig:enabled,loadPack:async()=>{imports++;return {apply(){}}}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'blocked');
 assert.equal(imports,0);
});
test('unoccupied host provider names permit isolated source mount',async()=>{
 let imports=0,applies=0;
 const scope={llm:{listProviders:async()=>['native-router','local-custom']},get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
  env:isolatedEnv,getConfig:enabled,loadPack:async()=>{imports++;return {apply(){applies++}}}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.equal(imports,1);assert.equal(applies,1);
 bridge.dispose();
});
test('approved mount reuses upstream apply inside DSH scope only once',async()=>{
 let called=0,load=0,received,receivedOptions;
 const scope={get:()=>undefined};
 const ctx={inject(names,cb){called++;assert.deepEqual(names,['credentials','commands','llm']);cb(scope)}};
 const bridge=createEmbeddedChannelPack({ctx,env:isolatedEnv,getConfig:enabled,
  loadPack:async()=>{load++;return {apply(x,o){received=x;receivedOptions=o}}}});
 assert.equal(bridge.attach().state,'loading');
 assert.equal(bridge.attach().state,'loading');
 await tick();await tick();
 assert.equal(called,1);assert.equal(load,1);
 assert.equal(received,scope);assert.equal(receivedOptions.disableOpencode,true);
 assert.equal(bridge.status().state,'mounted');
 assert.equal(bridge.attach().state,'mounted');
 bridge.dispose();assert.equal(bridge.status().state,'disposed');
});
test('upstream accountPool blocks duplicate mount without importing any bundle',async()=>{
 let imported=0;
 const ctx={inject(names,cb){cb({get:key=>key==='accountPool'?{}:undefined})}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,
  env:isolatedEnv,loadPack:()=>{imported++;return {apply(){}}}});
 assert.equal(bridge.attach().state,'blocked');
 await tick();assert.equal(imported,0);
});
test('upstream failure never leaks raw secret-bearing error to status',async()=>{
 const ctx={inject(names,cb){cb({get:()=>undefined})},logger:{warn() {}}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>{throw Error('Authorization Bearer SECRET_AND_LOCAL_PATH')}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'failed');
 assert.doesNotMatch(JSON.stringify(bridge.status()),/SECRET_AND_LOCAL_PATH/);
});
test('dispose before lazy load completes must not mount after host shutdown',async()=>{
 let complete;let applied=0;
 const ctx={inject(names,cb){cb({get:()=>undefined})}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:()=>new Promise(resolve=>{complete=resolve})});
 bridge.attach();await tick();bridge.dispose();
 complete({apply(){applied++}});await tick();await tick();
 assert.equal(applied,0);assert.equal(bridge.status().state,'disposed');
});
test('host injection scope disposal before async import prevents late mount',async()=>{
 let complete,cleanup,applied=0;
 const scope={get:()=>undefined,effect(cb){cleanup=cb()}};
 const bridge=createEmbeddedChannelPack({ctx:{inject(names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  loadPack:()=>new Promise(resolve=>{complete=resolve})});
 bridge.attach();await tick();cleanup();
 complete({apply(){applied++}});await tick();await tick();
 assert.equal(applied,0);assert.equal(bridge.status().state,'host_disposed');
});
test('synchronous injection failure is observable without taking down native router',()=>{
 const bridge=createEmbeddedChannelPack({ctx:{inject(){throw Error('secret path')}} ,getConfig:enabled,env:isolatedEnv,
  loadPack:()=>{throw Error('unreachable')}});
 assert.equal(bridge.attach().state,'failed');
 assert.doesNotMatch(JSON.stringify(bridge.status()),/secret path/);
});
test('disabled embedded facade never enumerates private account pool',async()=>{
 const bridge=createEmbeddedChannelPack({ctx:{inject(){throw Error('should not inject')}},getConfig:()=>normalizeConfig({})});
 assert.deepEqual(await bridge.listAccounts(),{state:'disabled',accounts:[]});
});
test('embedded facade maps only safe account metadata, never raw credential references',async()=>{
 const upstreamRows=[
  {id:'workbuddy-01',provider:'workbuddy',nickname:'My WorkBuddy',enabled:true,refreshable:true,
   credentialRef:'USER_TOKEN_REF',accessToken:'TOP_SECRET',refreshToken:'VERY_SECRET'},
  {id:'loomy-02',provider:'loomy',nickname:'Loomy',enabled:false,refreshable:false,
   token:'ANOTHER_SECRET'},
  {id:'unknown-03',provider:'not_a_pack_channel',nickname:'skip',credentialRef:'leak'},
 ];
 let poolCalls=0,scopePool;
 const pool={async listAllAccounts(){poolCalls++;return upstreamRows}};
 const scope={get:key=>key==='accountPool'?scopePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){scopePool=pool}})});
 assert.equal(bridge.attach().state,'loading');
 await tick();await tick();
 const snapshot=await bridge.listAccounts();
 assert.equal(snapshot.state,'ready');
 assert.equal(snapshot.accounts.length,2);
 assert.equal(poolCalls,1);
 assert.deepEqual(snapshot.accounts[0],{
  id:'workbuddy-01',providerId:'workbuddy',nickname:'My WorkBuddy',enabled:true,refreshable:true,connectionState:'not_checked'});
 assert.equal(snapshot.accounts[1].enabled,false);
 const asText=JSON.stringify(snapshot);
 assert.doesNotMatch(asText,/TOKEN_REF|TOP_SECRET|VERY_SECRET|ANOTHER_SECRET|credentialRef|accessToken|token/);
 bridge.dispose();
 assert.equal((await bridge.listAccounts()).accounts.length,0);
 assert.equal(poolCalls,1);
});
test('unavailable upstream pool and failed metadata read never mutate accounts or expose errors',async()=>{
 const scope={get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){}})});
 bridge.attach();await tick();await tick();
 assert.deepEqual(await bridge.listAccounts(),{state:'unavailable',accounts:[]});
 scope.get=()=>({listAllAccounts:async()=>{throw Error('SECRET_UPSTREAM_CREDENTIALS')}});
 assert.deepEqual(await bridge.listAccounts(),{state:'error',accounts:[]});
});
test('upstream model catalogue uses the selected provider only and never publishes credentials or cross-provider models',async()=>{
 const queried=[],scope={llm:{async listModels(provider){
  queried.push(provider);
  return [{id:'model-alpha',name:'Alpha',provider,token:'SECRET_TOKEN',isFree:true},
   {id:'model-alpha',name:'duplicate',provider},
   {id:'wrong',name:'Cross-channel',provider:'different'},
   {id:'with\nnewline',provider},
   {id:'model-beta',name:'Beta',provider,isFree:false},
   {id:'SECRET?\nunsafe',provider}];
 }},get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>({apply(){}})});
 assert.deepEqual(await bridge.listModels('loomy'),{state:'unavailable',providerId:'loomy',models:[]});
 assert.deepEqual(queried,[]);
 bridge.attach();await tick();await tick();
 const reply=await bridge.listModels('loomy');
 assert.deepEqual(queried,['loomy']);
 assert.equal(reply.state,'ready');
 assert.deepEqual(reply.models,[{id:'model-alpha',name:'Alpha',upstreamFreeLabel:true},
   {id:'model-beta',name:'Beta'}]);
 assert.doesNotMatch(JSON.stringify(reply),/SECRET_TOKEN|wrong|Cross-channel/);
 assert.equal((await bridge.listModels('untrusted')).state,'invalid');
 assert.deepEqual(queried,['loomy']);
 bridge.dispose();
 assert.equal((await bridge.listModels('loomy')).state,'unavailable');
});
test('upstream account enable toggle verifies exact provider and uses source pool update, no credentials copied',async()=>{
 const accounts=[{id:'loomy-a1',provider:'loomy',nickname:'sample',enabled:false,
  credentialRef:'SECRET_REF'}];
 const updates=[];
 const pool={listAllAccounts:async()=>accounts.map(row=>({...row})),
   updateAccount:async(id,patch)=>{updates.push({id,patch});accounts[0].enabled=patch.enabled}};
 let livePool;
 const scope={get:key=>key==='accountPool'?livePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){livePool=pool}})});
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:true})).state,'unavailable');
 bridge.attach();await tick();await tick();
 const mismatch=await bridge.changeAccountEnabled({providerId:'workbuddy',accountId:'loomy-a1',enabled:true});
 assert.equal(mismatch.state,'not_found');
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:'true'})).state,'invalid');
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:true})).state,'updated');
 assert.deepEqual(updates,[{id:'loomy-a1',patch:{enabled:true}}]);
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:true})).state,'unchanged');
 assert.equal(updates.length,1);
 const preview=await bridge.listAccounts();
 assert.equal(preview.accounts[0].enabled,true);
 assert.doesNotMatch(JSON.stringify(preview),/SECRET_REF/);
 bridge.dispose();
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:false})).state,'unavailable');
 assert.equal(updates.length,1);
});
test('source account update must confirm the observed state and reject duplicates',async()=>{
 const rows=[{id:'qoder-a',provider:'qoder',enabled:false}];
 let updates=0,livePool;
 const pool={listAllAccounts:async()=>rows.map(row=>({...row})),updateAccount:async()=>{updates++}};
 const scope={get:key=>key==='accountPool'?livePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 const unconfirmed=await bridge.changeAccountEnabled({providerId:'qoder',accountId:'qoder-a',enabled:true});
 assert.equal(unconfirmed.state,'unconfirmed');
 assert.equal(unconfirmed.changed,false);
 rows.push({...rows[0],provider:'loomy'});
 assert.equal((await bridge.changeAccountEnabled({providerId:'qoder',accountId:'qoder-a',enabled:true})).state,'not_found');
 assert.equal(updates,1);
});
test('catalog lookup timeout releases the UI and duplicate requests cannot flood the same upstream channel',async()=>{
 let finish,called=0;
 const upstream=new Promise(resolve=>{finish=resolve});
 const scope={get:()=>undefined,llm:{async listModels(){called++;return upstream}}};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  modelTimeoutMs:12,loadPack:async()=>({apply(){}})});
 bridge.attach();await tick();await tick();
 const first=bridge.listModels('loomy');
 await tick();
 assert.equal((await bridge.listModels('loomy')).state,'busy');
 assert.equal((await first).state,'timeout');
 assert.equal(called,1);
 finish([{id:'model-late'}]);
 bridge.dispose();
 assert.equal((await bridge.listModels('loomy')).state,'unavailable');
});

test('native source facade validates exact source account before invoking host DSH llm stream',async()=>{
 const rows=[{id:'q-a',provider:'qoder',enabled:true,credentialRef:'SECRET_REF'}];
 let livePool,invocations=0,seen;
 const scope={get:key=>key==='accountPool'?livePool:undefined,llm:{
  async listProviders(){return ['native-router']},
  stream(input){invocations++;seen=input;return (async function*(){
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text:'hi'};
   yield {type:'block-end',index:0};
   yield {type:'finish',reason:{kind:'stop'}};
  })()}
 }};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},env:isolatedEnv,getConfig:enabled,
   loadPack:async()=>({apply(){livePool={listAllAccounts:async()=>rows.map(x=>({...x})),
     getAvailableAccount:async()=>({entry:rows[0],credential:'NEVER_EXPOSE_SECRET'})}}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 const request={providerId:'qoder',sourceAccountId:'q-a',model:'qoder-chat',messages:[{role:'user',content:[]}],tools:[]};
 for await(const event of await bridge.streamNative(request))assert.ok(event.type);
 assert.equal(invocations,1);
 assert.deepEqual(seen.tools,[]);
  assert.equal(seen.provider,'qoder');assert.equal(seen.model,'qoder-chat');
  assert.doesNotMatch(JSON.stringify(seen),/NEVER_EXPOSE_SECRET|SECRET_REF/);
  await assert.rejects(()=>bridge.streamNative({...request,sourceAccountId:'q-b'}),/not unambiguous/);
  const available=livePool.getAvailableAccount;
  livePool.getAvailableAccount=async()=>null;
  await assert.rejects(()=>bridge.streamNative(request),/not currently available/);
  assert.equal(invocations,1);
  livePool.getAvailableAccount=available;
 rows.push({id:'q-b',provider:'qoder',enabled:true});
  await assert.rejects(()=>bridge.streamNative(request),/not verified/);
 assert.equal(invocations,1);
 bridge.dispose();
 await assert.rejects(()=>bridge.streamNative(request),/not mounted/);
});
test('isolated upstream logout refuses source accounts referenced by native configuration and verifies removal',async()=>{
 const rows=[{id:'q-a',provider:'qoder',enabled:true,credentialRef:'SECRET_SOURCE'}];
  const exactRef=sourceAccountOpaqueId('qoder','q-a');
  const otherRef=sourceAccountOpaqueId('qoder','q-other');
  let livePool,deleted=0,config={embeddedPack:{enabled:true},accounts:[
   {id:exactRef,providerId:'qoder',credentialRef:'driver:qoder:'+exactRef},
  ]};
 const pool={listAllAccounts:async()=>rows.map(x=>({...x})),
  removeAccount:async id=>{deleted++;rows.splice(rows.findIndex(row=>row.id===id),1)}};
 const scope={get:key=>key==='accountPool'?livePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},env:isolatedEnv,
  getConfig:()=>config,loadPack:async()=>({apply(){livePool=pool}})});
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'unavailable');
 bridge.attach();await tick();await tick();
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'referenced');
 assert.equal(deleted,0);
  // Another source account under this provider must not block deletion of q-a.
  config={embeddedPack:{enabled:true},accounts:[
    {id:otherRef,providerId:'qoder',credentialRef:'driver:qoder:'+otherRef},
  ]};
 assert.equal((await bridge.removeSourceAccount({providerId:'loomy',accountId:'q-a'})).state,'not_found');
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'removed');
 assert.equal(deleted,1);
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'not_found');
 bridge.dispose();
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'unavailable');
});


test('isolated multiaccount beta pins the selected upstream credential without changing enabled flags',async()=>{
 const rows=[
  {id:'lob-a',provider:'lobsterai',enabled:true,credentialRef:'LOBSTER_A'},
  {id:'lob-b',provider:'lobsterai',enabled:true,credentialRef:'LOBSTER_B'},
 ];
 const resolutions=[],calls=[],credentials={
  async resolve(ref){resolutions.push(ref);return {value:JSON.stringify({selected:ref})}},
  async set(){throw Error('unexpected credential write')},
  async unset(){throw Error('unexpected credential deletion')},
 };
 let pool;
 pool={
  listAllAccounts:async()=>rows.map(row=>({...row})),
  listAccountsByProvider:id=>rows.filter(row=>row.provider===id),
  async getAvailableAccount(provider,model,exclude){
   const entry=rows.find(row=>row.provider===provider&&row.enabled&&!exclude?.has(row.id));
   if(!entry)return null;
   const credential=await credentials.resolve(entry.credentialRef);
   return {entry,credential:JSON.parse(credential.value)};
  },
 };
 const baseGet=pool.getAvailableAccount,baseResolve=credentials.resolve;
  let livePool;
  const scope={credentials,get:key=>key==='accountPool'?livePool:key==='credentials'?credentials:undefined,
  llm:{listProviders:async()=>['native-router'],
   stream(input){calls.push(input);return (async function*(){
    const matched=await pool.getAvailableAccount(input.provider,input.model);
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:matched.credential.selected};
    yield {type:'block-end',index:0};
    yield {type:'finish',reason:{kind:'stop'}};
   })()},
  }};
 const env={...isolatedEnv,DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1'};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
   env,getConfig:enabled,loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.deepEqual(bridge.status().experimentalMultiAccountProviders.includes('lobsterai'),true);
 try{
  const request={providerId:'lobsterai',sourceAccountId:'lob-b',model:'lobster-chat',
   messages:[{role:'user',content:[{type:'text',text:'hi'}]}],tools:[]};
  const events=[];
  for await(const event of await bridge.streamNative(request))events.push(event);
  assert.equal(events.find(event=>event.type==='text-delta').text,'LOBSTER_B');
  assert.equal(calls.length,1);
  assert.equal(rows.filter(row=>row.enabled).length,2);
  assert.equal(resolutions.at(-1),'LOBSTER_B');
  const outside=await pool.getAvailableAccount('lobsterai','lobster-chat');
  assert.equal(outside.entry.id,'lob-a');
  await assert.rejects(()=>bridge.streamNative({...request,providerId:'qoder'}),/not unambiguous/);
 }finally{
  bridge.dispose();
  assert.equal(pool.getAvailableAccount,baseGet);
  assert.equal(credentials.resolve,baseResolve);
 }
});
test('all-source multiaccount guard refuses a Qoder request when upstream tries a different account',async()=>{
 const rows=[
  {id:'q-a',provider:'qoder',enabled:true,credentialRef:'QODER_A'},
  {id:'q-b',provider:'qoder',enabled:true,credentialRef:'QODER_B'},
 ];
 let called=0;
 const credentials={resolve:async()=>({value:'{}'})};
 const pool={listAllAccounts:async()=>rows,listAccountsByProvider:p=>rows.filter(a=>a.provider===p),
  getAvailableAccount:async()=>({entry:rows[0],credential:{}})};
  let livePool;
  const scope={credentials,get:k=>k==='accountPool'?livePool:undefined,llm:{
  listProviders:async()=>['native-router'],stream:()=>{called++;throw Error('never called')},
 }};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},getConfig:enabled,
  env:{...isolatedEnv,DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1'},
   loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 await assert.rejects(()=>bridge.streamNative({providerId:'qoder',sourceAccountId:'q-b',
  model:'q-chat',messages:[{role:'user',content:[]}]}),/not currently available/);
 assert.equal(called,0);
 bridge.dispose();
});
test('experimental source account gate fails closed when host cannot expose a credential service',async()=>{
 const rows=[
  {id:'lob-a',provider:'lobsterai',enabled:true},
  {id:'lob-b',provider:'lobsterai',enabled:true},
 ];
 const pool={listAllAccounts:async()=>rows,listAccountsByProvider:p=>rows.filter(a=>a.provider===p),
  getAvailableAccount:async()=>({entry:rows[0],credential:{}})};
  let livePool;
  const scope={get:k=>k==='accountPool'?livePool:undefined,llm:{
  listProviders:async()=>['native-router'],stream:()=>{throw Error('must not stream')},
 }};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},getConfig:enabled,
  env:{...isolatedEnv,DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1'},
   loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted','legacy single-source mode stays available');
 assert.deepEqual(bridge.status().experimentalMultiAccountProviders,[]);
 await assert.rejects(()=>bridge.streamNative({providerId:'lobsterai',sourceAccountId:'lob-a',
  model:'lobster-chat',messages:[{role:'user',content:[]}]}),/not verified/);
 bridge.dispose();
});

test('source bridge cleanup deletes its own Cordis inject child once and blocks later apply',async()=>{
 const scope={llm:{listProviders:async()=>['native-router']},get:()=>undefined};
 let callback,deleted=0,applied=0,load=0;
 const ctx={
  inject(deps,fn){assert.deepEqual(deps,['credentials','commands','llm']);callback=fn;fn(scope)},
  registry:{delete(fn){assert.equal(fn,callback);deleted++;return {removed:true}}},
 };
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>{load++;return {apply(){applied++}}}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.equal(load,1);assert.equal(applied,1);
 bridge.dispose();
 bridge.dispose();
 assert.equal(deleted,1,'Cordis child injection is removed exactly once');
 assert.equal(bridge.status().state,'disposed');
 assert.equal(bridge.attach().state,'disposed');
});
test('disposing source bridge before asynchronous pack import is resolved prevents startup effects',async()=>{
 let release,removed=0,applied=0;
 const scope={get:()=>undefined,llm:{listProviders:async()=>[]}};
 const ctx={
  inject(_deps,fn){fn(scope)},
  registry:{delete(){removed++}},
 };
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:()=>new Promise(resolve=>{release=resolve})});
 bridge.attach();await tick();
 bridge.dispose();
 release({apply(){applied++}});
 await tick();await tick();
 assert.equal(applied,0);
 assert.equal(removed,1);
 assert.equal(bridge.status().state,'disposed');
});
test('real Cordis optional service getters are safe without reading strict missing services',async()=>{
 const reads=[];
 const scope={
  llm:{listProviders:async()=>['native-router']},
  get(name,strict=true){
   reads.push([name,strict]);
   if((name==='profileContext'||name==='accountPool')&&strict)
    throw Error('Cordis strict absent service: '+name);
   return undefined;
  },
  get profileContext(){throw Error('Never read strict Cordis property getter')},
 };
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,fn){fn(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.equal(reads.some(([name,strict])=>name==='profileContext'&&strict===false),true);
 assert.equal(reads.some(([name,strict])=>name==='accountPool'&&strict===false),true);
 bridge.dispose();
});
