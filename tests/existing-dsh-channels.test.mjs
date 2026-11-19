import test from 'node:test';
import assert from 'node:assert/strict';
import {createExistingDshChannelFacade,createPreferredSourceFacade} from '../src/existing-dsh-channels.mjs';
import {createSourceChannelDriver} from '../src/source-channel-driver.mjs';
import {createLocalAndSourceDriver} from '../src/channels/local-source.mjs';
import {createSessionReuse} from '../src/session-reuse.mjs';
import {normalizeConfig} from '../src/config.mjs';

function textStream(msg='EXTERNAL_DSH_REUSED_MODEL'){
 return (async function*(){
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:msg};
  yield {type:'block-end',index:0};
  yield {type:'finish',reason:{kind:'stop'}};
 })();
}
function rig({rows=[{id:'already-qoder',provider:'qoder',enabled:true,
 credentialRef:'SECRET_DO_NOT_COPY',nickname:'已有登录的 Qoder'}],
 availableId,providers=['qoder'],ownState='disabled'}={}){
 const data={rows:rows.map(r=>({...r})),calls:[],availableId,providers:[...providers],
  modelCalls:0};
 const pool={
  async listAllAccounts(){return data.rows.map(r=>({...r}))},
  async getAvailableAccount(provider,model){
   data.calls.push({kind:'getAvailableAccount',provider,model});
   return {entry:data.rows.find(r=>r.id===(data.availableId??
    data.rows.find(row=>row.provider===provider&&row.enabled)?.id))};
  },
 };
 const llm={
  listProviders:()=>data.providers.map(id=>({id})),
  async listModels(provider){return [{id:'test-native-model',provider}]},
  stream({provider,model,messages,tools}){
   data.modelCalls++;data.calls.push({kind:'llm.stream',provider,model,messageCount:messages.length,tools:tools.length});
   return textStream();
  },
 };
 const ctx={get:key=>key==='accountPool'?pool:key==='llm'?llm:undefined,llm};
 const own={status:()=>({state:ownState}),listAccounts:async()=>({state:'unavailable'})};
 const existing=createExistingDshChannelFacade({ctx,excludedHost:own});
 const preferred=createPreferredSourceFacade({own,existing});
 return {data,pool,llm,ctx,own,existing,preferred};
}
const makeSourceAccount=id=>({id,providerId:'qoder',credentialRef:'driver:qoder:'+id,enabled:true});
test('existing installed DSH provider is recognized without enabling, registering or mutating its own adapter',async()=>{
 const h=rig(),found=await h.existing.listAccounts();
 assert.equal(h.existing.status().state,'mounted');
 assert.equal(h.existing.status().borrowedExistingDsh,true);
 assert.equal(found.state,'ready');
 assert.deepEqual(found.accounts.map(x=>x.providerId),['qoder']);
 assert.doesNotMatch(JSON.stringify(h.existing.status())+JSON.stringify(found),/SECRET_DO_NOT_COPY/);
 assert.deepEqual(await h.existing.listModels('qoder'),{
  state:'ready',providerId:'qoder',models:[{id:'test-native-model',name:'test-native-model'}]});
 assert.deepEqual(h.data.calls,[],'listing login metadata must never trigger model inference or credential access');
 assert.equal(h.data.modelCalls,0);
 h.existing.dispose();assert.equal((await h.existing.listAccounts()).state,'unavailable');
});
test('owned login is not hidden by active external channel and survives original plugin stop',async()=>{
 let external=true;const calls=[];
 const own={status:()=>({state:'mounted',channels:['codearts']}),
  listAccounts:async()=>({state:'ready',accounts:[
   {providerId:'codearts',id:'same-account',nickname:'私有 CodeArts',enabled:true},
   {providerId:'codearts',id:'own-only',enabled:true}]}),
  listModels:async()=>({state:'ready',models:[{id:'ca-model'}]}),
  streamNative:async()=>{calls.push('owned');return textStream('OWNED')}};
 const old={status:()=>({state:external?'mounted':'unavailable'}),
  listAccounts:async()=>({state:'ready',accounts:[
   {providerId:'codearts',id:'same-account',nickname:'外部 CodeArts',enabled:true},
   {providerId:'codearts',id:'external-only',enabled:true}]}),
  listModels:async()=>({state:'ready',models:[{id:'ca-model'},{id:'other-model'}]}),
  streamNative:async()=>{calls.push('reused');return textStream('REUSED')}};
 const facade=createPreferredSourceFacade({own,existing:old});
 let result=await facade.listAccounts();
 assert.deepEqual(result.accounts.map(x=>x.id),['same-account','own-only','external-only']);
 assert.deepEqual(result.accounts[0].sources,['owned','reused']);
 assert.equal(result.accounts[0].nickname,'私有 CodeArts');
 assert.equal((await facade.listModels('codearts')).models.length,2);
 const events=[];
 for await(const x of await facade.streamNative({providerId:'codearts',sourceAccountId:'same-account'}))events.push(x);
 assert.match(JSON.stringify(events),/OWNED/);
 assert.deepEqual(calls,['owned']);
 external=false;
 result=await facade.listAccounts();
 assert.deepEqual(result.accounts.map(x=>x.id),['same-account','own-only']);
 assert.equal((await facade.listModels('codearts')).models.length,1);
});
test('same verified account can use backup if primary fails before output but not after partial stream',async()=>{
 let unavailable=true,backupCalls=0;
 const own={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'zcode',id:'same',enabled:true}]}),
  streamNative:async()=>{
   if(unavailable)throw Error('Primary unavailable');
   return (async function*(){yield {type:'text-delta',text:'partial'};throw Error('Partial failure')})();
  }};
 const other={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'zcode',id:'same',enabled:true}]}),
  streamNative:async()=>{backupCalls++;return textStream('BACKUP')}};
 const facade=createPreferredSourceFacade({own,existing:other}),out=[];
 for await(const x of await facade.streamNative({providerId:'zcode',sourceAccountId:'same'}))out.push(x);
 assert.match(JSON.stringify(out),/BACKUP/);assert.equal(backupCalls,1);
 unavailable=false;
 await assert.rejects(async()=>{
  for await(const event of await facade.streamNative({providerId:'zcode',sourceAccountId:'same'}))void event
 },/Partial failure/);
 assert.equal(backupCalls,1);
 await assert.rejects(facade.streamNative({providerId:'zcode',sourceAccountId:'other'}),/not present/);
});
test('verified source wins, then automatic rank change switches primary without changing login stores',async()=>{
 const output=[];
 const source=(kind)=>({
   status:()=>({state:'mounted'}),
   listAccounts:async()=>({state:'ready',accounts:[{providerId:'loomy',id:'same',enabled:true}]}),
   streamNative:async()=>{output.push(kind);return textStream(kind)}
 });
 const facade=createPreferredSourceFacade({own:source('owned'),existing:source('reused')});
 let states={owned:'not_checked',reused:'online'};
 facade.setHealthResolver(({kind})=>states[kind]);
 for await(const x of await facade.streamNative({providerId:'loomy',sourceAccountId:'same'}))void x;
 assert.equal(output.at(-1),'reused','recently verified original must be preferred');
 states={owned:'online',reused:'expired'};
 for await(const x of await facade.streamNative({providerId:'loomy',sourceAccountId:'same'}))void x;
 assert.equal(output.at(-1),'owned','verified autonomous account takes over after original expires');
 states={owned:'expired',reused:'online'};
 for await(const x of await facade.streamNative({providerId:'loomy',sourceAccountId:'same'}))void x;
 assert.equal(output.at(-1),'reused','restored original can resume automatically');
});
test('directly reuse an existing logged-in DSH provider via its original llm adapter; model output is complete and tool-safe',async()=>{
 const h=rig(),driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 const choices=await driver.discover();
 assert.equal(choices.length,1);assert.match(choices[0].id,/^sp_[a-f0-9]{24}$/);
 const imported=await driver.importCandidate({candidateId:choices[0].id,consent:true});
 const account=makeSourceAccount(imported.id);
 const output=await driver.generate({account,model:'test-native-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'Hi existing DSH login'}]}]}});
 assert.equal(output.text,'EXTERNAL_DSH_REUSED_MODEL');
 assert.equal(h.data.modelCalls,1);
 assert.equal(h.data.calls.find(x=>x.kind==='llm.stream').provider,'qoder');
 assert.ok(!h.data.calls.some(x=>JSON.stringify(x).includes('SECRET_DO_NOT_COPY')));
});
test('existing DSH multi-account provider is not claimed safe without verified exact-account routing',async()=>{
 const h=rig({rows:[{id:'a',provider:'qoder',enabled:true},{id:'b',provider:'qoder',enabled:true}]});
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 const candidate=(await driver.discover())[0];
 const account=makeSourceAccount(candidate.id);
 await assert.rejects(()=>driver.generate({account,model:'test-native-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'no'}]}]}}),/multiple enabled/);
 assert.equal(h.data.modelCalls,0);
});
test('account pool availability check prevents accidental reuse of the wrong logged-in user',async()=>{
 const h=rig({availableId:'other-account'});
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 const account=makeSourceAccount((await driver.discover())[0].id);
 await assert.rejects(()=>driver.generate({account,model:'test-native-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'wrong'}]}]}}),
   /Isolated DSH native source request failed|not select requested/);
 assert.equal(h.data.modelCalls,0);
});
test('missing providers never fake a host login; an independent own source pool may coexist with a real original pool',async()=>{
 for(const options of [{providers:[]},{providers:['strange-model']}]){
  const h=rig(options);
  assert.equal(h.existing.status().state,'unavailable');
  assert.equal((await h.existing.listAccounts()).state,'unavailable');
  assert.equal(h.data.modelCalls,0);
 }
 for(const ownState of ['loading','mounted','waiting_host_services']){
  const h=rig({ownState});
  assert.equal(h.existing.status().state,'mounted');
  const rows=await h.existing.listAccounts();
  assert.equal(rows.state,'ready');
  assert.doesNotMatch(JSON.stringify(rows),/SECRET_DO_NOT_COPY/);
  assert.equal(h.data.modelCalls,0);
 }
});
test('installed DSH provider unload mid-stream cancels output and exposes no partial tool call',async()=>{
 const h=rig();
 h.llm.stream=()=> (async function*(){
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'partial'};
  h.data.providers.splice(0);
  yield {type:'block-end',index:0};
  yield {type:'finish',reason:{kind:'stop'}};
 })();
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 const account=makeSourceAccount((await driver.discover())[0].id);
 await assert.rejects(()=>driver.generate({account,model:'test-native-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'Hi'}]}]}}),
   /Isolated DSH native source request failed|not mounted/);
});
test('hybrid WorkBuddy preserves old desktop login and can also reuse another installed DSH WorkBuddy session',async()=>{
 const h=rig({rows:[{id:'existing-wb',provider:'workbuddy',enabled:true,credentialRef:'SECRET'}],
  providers:['workbuddy']});
 const local={
  async discover(){return [{id:'wb_'+'a'.repeat(20),label:'existing desktop',reusable:true}]},
  async importCandidate({candidateId}){return {id:candidateId,credentialRef:'driver:workbuddy:'+candidateId}},
  async listModels(){return [{id:'local-desktop-model'}]},
  async generate(){return {text:'LOCAL_MODEL',toolCalls:[],finishReason:'stop'}},
  async logout(){return {revokedUpstream:false}},
 };
 const driver=createLocalAndSourceDriver({providerId:'workbuddy',local,sourcePack:h.preferred});
 const candidates=await driver.discover();
 assert.equal(candidates.length,2);
 const remote=candidates.find(x=>x.id.startsWith('sp_'));
 assert.ok(remote);
 const imported=await driver.importCandidate({candidateId:remote.id,consent:true});
 const output=await driver.generate({account:{...imported,providerId:'workbuddy'},
  model:'test-native-model',options:{messages:[{role:'user',content:[{type:'text',text:'hello'}]}]}});
 assert.equal(output.text,'EXTERNAL_DSH_REUSED_MODEL');
 const desktop=await driver.generate({account:{id:'wb_'+'a'.repeat(20),
  providerId:'workbuddy',credentialRef:'driver:workbuddy:wb_'+'a'.repeat(20)},
  model:'local-desktop-model'});
 assert.equal(desktop.text,'LOCAL_MODEL');
 const logout=await driver.logout({account:{...imported,providerId:'workbuddy'}});
 assert.equal(logout.revokedUpstream,false);
});
test('automatic reuse finds preinstalled DSH channel login in no-copy mode with built-in source-pack disabled',async()=>{
 const h=rig({rows:[{id:'host-only-qoder',provider:'qoder',enabled:true,credentialRef:'KEEP_IN_OTHER_PLUGIN'}]});
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 let cfg=normalizeConfig({sessionReuse:{enabled:true},embeddedPack:{enabled:false}});
 const store={get:()=>structuredClone(cfg),replace:next=>cfg=normalizeConfig(next)};
 const bridge=createSessionReuse({configStore:store,drivers:new Map([['qoder',driver]]),
  embeddedPack:h.preferred,intervalMs:1000});
 try{
  const result=await bridge.scan();
  assert.equal(result.linked,1);
  assert.equal(cfg.providers[0].id,'qoder');
  assert.equal(cfg.accounts[0].enabled,true);
  assert.equal(cfg.accounts[0].autoCheckin,true);
  assert.doesNotMatch(JSON.stringify(cfg),/host-only-qoder|KEEP_IN_OTHER_PLUGIN/);
  assert.equal(h.data.modelCalls,0,'discovery must not call any model');
 }finally{bridge.stop()}
});
test('existing DSH login revoked between account selection and stream dispatch is rejected before calling provider',async()=>{
 const h=rig();
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 const account=makeSourceAccount((await driver.discover())[0].id);
 const originalPool=h.data.rows[0];
 h.pool.getAvailableAccount=async()=>{originalPool.enabled=false;
  return {entry:{id:originalPool.id,enabled:true}}};
 await assert.rejects(()=>driver.generate({account,model:'test-native-model',
  options:{messages:[{role:'user',content:[{type:'text',text:'Hi'}]}]}}),
  /Isolated DSH native source request failed/);
 assert.equal(h.data.modelCalls,0);
});
test('availability on reuse panel advertises only the actual already-installed DSH provider',async()=>{
 const h=rig();
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:h.preferred});
 const notInstalled=createSourceChannelDriver({providerId:'trae',embeddedPack:h.preferred});
 assert.equal(driver.runtimeReady,true);
 assert.equal(notInstalled.runtimeReady,false);
 let cfg=normalizeConfig({sessionReuse:{enabled:true}});
 const store={get:()=>structuredClone(cfg),replace:next=>cfg=normalizeConfig(next)};
 const bridge=createSessionReuse({configStore:store,
  drivers:new Map([['qoder',driver],['trae',notInstalled]]),embeddedPack:h.preferred});
 const screen=bridge.snapshot();
 assert.equal(screen.reusableSource,'external-dsh-provider');
 assert.equal(screen.channels.find(x=>x.providerId==='qoder').available,true);
 assert.equal(screen.channels.find(x=>x.providerId==='trae').available,false);
 bridge.stop();
});
