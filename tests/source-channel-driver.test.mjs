import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceChannelDriver,collectSourceDshStream} from '../src/source-channel-driver.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

const textStream=(text='source reply')=>(async function*(){
 yield {type:'block-start',index:0,blockType:'text'};
 yield {type:'text-delta',index:0,text};
 yield {type:'block-end',index:0,block:{type:'text',text}};
 yield {type:'usage',usage:{inputTokens:4,outputTokens:2,totalTokens:6}};
 yield {type:'finish',reason:{kind:'stop'}};
})();
function mockSource(rows){
 const calls=[];
 const state={rows:rows.map(x=>({...x}))};
 const embeddedPack={
  status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:state.rows}),
  listModels:async providerId=>({state:'ready',providerId,models:[{id:'qoder-chat'}]}),
  async streamNative(request){calls.push(request);return textStream()},
 };
 return {embeddedPack,calls,state};
}
test('opt-in source discovery returns stable opaque references; import copies NO credentials',async()=>{
 const rig=mockSource([{id:'user-with-token-path',providerId:'qoder',nickname:'Source Qoder',
  enabled:true,credentialRef:'NO_LEAK'}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const candidates=await driver.discover();
 assert.equal(candidates.length,1);
 assert.match(candidates[0].id,/^sp_[a-f0-9]{24}$/);
 assert.doesNotMatch(JSON.stringify(candidates),/NO_LEAK|user-with-token-path/);
 await assert.rejects(()=>driver.importCandidate({candidateId:candidates[0].id}),/consent/);
 const account=await driver.importCandidate({candidateId:candidates[0].id,consent:true});
 assert.deepEqual(account,{id:candidates[0].id,credentialRef:'driver:qoder:'+candidates[0].id});
 assert.deepEqual(await driver.listModels({account:{...account,providerId:'qoder'}}),[{id:'qoder-chat'}]);
 const other=createSourceChannelDriver({providerId:'loomy',embeddedPack:rig.embeddedPack});
 await assert.rejects(()=>other.importCandidate({candidateId:candidates[0].id,consent:true}),/no longer exists/);
});
test('single enabled source account streams through existing DSH LLM with host tool metadata only',async()=>{
 const rig=mockSource([{id:'qoder-a',providerId:'qoder',enabled:true,connectionState:'not_checked'}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const source=(await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true}));
 const account={...source,providerId:'qoder'};
 const output=await driver.generate({account,model:'qoder-chat',options:{
  system:'Allowed context',messages:[{role:'user',content:[{type:'text',text:'hello'}]}],
  tools:[{name:'read_file',description:'Read an authorized file',parameters:{type:'object',properties:{path:{type:'string'}}}}],
  maxTokens:256,
 }});
 assert.deepEqual(output,{text:'source reply',reasoning:'',toolCalls:[],finishReason:'stop',
  usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}});
 assert.equal(rig.calls.length,1);
 assert.equal(rig.calls[0].providerId,'qoder');
 assert.equal(rig.calls[0].sourceAccountId,'qoder-a');
 assert.equal(rig.calls[0].model,'qoder-chat');
 assert.equal(rig.calls[0].messages[0].role,'system');
 assert.equal(rig.calls[0].messages[1].role,'user');
 assert.deepEqual(rig.calls[0].tools,[{name:'read_file',description:'Read an authorized file',
  parameters:{type:'object',properties:{path:{type:'string'}}}}]);
 assert.doesNotMatch(JSON.stringify(rig.calls[0]),/NO_LEAK|credentialRef|accessToken/);
});
test('source bridge refuses ambiguous multiple enabled accounts and disabled/stale references',async()=>{
 const rig=mockSource([{id:'q-a',providerId:'qoder',enabled:true},
  {id:'q-b',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const acc=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const account={...acc,providerId:'qoder'};
 await assert.rejects(()=>driver.generate({account,model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),/multiple enabled/);
 assert.equal(rig.calls.length,0);
 rig.state.rows[0].enabled=false;rig.state.rows[1].enabled=false;
 await assert.rejects(()=>driver.generate({account,model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),/disabled/);
 rig.state.rows.splice(0);
 await assert.rejects(()=>driver.listModels({account}),/stale/);
 assert.equal(rig.calls.length,0);
});
test('native DSH tool-call reconstruction strictly enforces advertised tools',async()=>{
 const stream=async function*(){
  yield {type:'block-start',index:1,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:1,id:'t1',name:'read_file',argumentsDelta:'{"path":'};
  yield {type:'tool-call-delta',index:1,id:'t1',argumentsDelta:'"README.md"}'};
  yield {type:'block-end',index:1,block:{type:'tool-call',id:'t1',name:'read_file',arguments:'{"path":"README.md"}'}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
 };
 const offered=[{name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}}}}];
 const result=await collectSourceDshStream(stream(),{tools:offered});
 assert.deepEqual(result.toolCalls,[{id:'t1',name:'read_file',arguments:'{"path":"README.md"}'}]);
 assert.equal(result.finishReason,'tool_calls');
 await assert.rejects(()=>collectSourceDshStream(stream(),{tools:[]}),/Unadvertised tool call/);
});
test('incomplete, failed, invalid and oversized upstream DSH streams never release a partial answer',async()=>{
 async function* partial(){yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'partial'};yield {type:'block-end',index:0};}
 async function* failed(){yield {type:'finish',reason:{kind:'error',failure:{message:'SECRET_REMOTE'}}};}
 async function* oversized(){yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'x'.repeat(16*1024*1024+1)};}
 await assert.rejects(()=>collectSourceDshStream(partial()),/before complete finish/);
 await assert.rejects(()=>collectSourceDshStream(failed()),/did not complete successfully/);
 await assert.rejects(()=>collectSourceDshStream(oversized()),/exceeded size/);
});
test('source channel through native-router chain delivers DSH stream with no separate proxy',async()=>{
 const rig=mockSource([{id:'qoder-a',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const approved=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const cfg=normalizeConfig({providers:[{id:'qoder',name:'Qoder Source',protocol:'native-channel',models:['qoder-chat'],
    enabled:true,supportsTools:true}],accounts:[{id:approved.id,providerId:'qoder',
    credentialRef:approved.credentialRef,enabled:true}],routes:[{id:'source',name:'Source chain',
    tiers:[{providerId:'qoder',model:'qoder-chat'}],enabled:true,mode:'priority'}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map([['qoder',driver]])});
 const output=[];
 for await(const event of adapter.stream({model:'chain:source',sessionId:'isolated-1',
  messages:[{role:'user',content:[{type:'text',text:'test'}]}]}))output.push(event);
 assert.equal(output.some(x=>x.type==='text-delta'&&x.text==='source reply'),true);
 assert.equal(output.at(-1).type,'finish');
 assert.equal(output.at(-1).reason.kind,'stop');
 assert.equal(rig.calls.length,1);
});
test('account console discovery / consent import stays disabled, then routes through approved source reference',async()=>{
 const rig=mockSource([{id:'qoder-primary',providerId:'qoder',nickname:'Primary',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 let state=normalizeConfig({embeddedPack:{enabled:true},providers:[{id:'qoder',
  name:'Qoder',protocol:'native-channel',enabled:true,models:['qoder-chat']}]});
 let invalidations=0;
 const store={get:()=>structuredClone(state),replace:input=>{
  state=normalizeConfig(input);return structuredClone(state);
 }};
 const center=createAccountCenter({configStore:store,drivers:new Map([['qoder',driver]]),
  adapter:{invalidateCatalog(){invalidations++}}});
 const discovered=await center.discover('qoder');
 assert.equal(discovered.candidates.length,1);
 assert.equal(discovered.imported,0);
 assert.equal(store.get().accounts.length,0);
 const imported=await center.importCandidate('qoder',discovered.candidates[0].id);
 assert.equal(imported.enabled,true);
 assert.equal(store.get().accounts[0].enabled,true);
 assert.equal(store.get().accounts[0].autoCheckin,false);
 assert.match(store.get().accounts[0].credentialRef,/^driver:qoder:sp_[a-f0-9]{24}$/);
 assert.doesNotMatch(JSON.stringify(store.get()),/qoder-primary|SECRET/);
 await assert.rejects(()=>center.importCandidate('qoder',discovered.candidates[0].id));
 assert.equal(store.get().accounts[0].enabled,true);
 assert.ok(invalidations>=1);
 const configured=store.get();
 state=normalizeConfig({...configured,routes:[{id:'sourceRoute',name:'Source',
  mode:'priority',enabled:true,tiers:[{providerId:'qoder',model:'qoder-chat'}]}]});
 const adapter=createNativeRouterAdapter({configStore:store,channelDrivers:new Map([['qoder',driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'chain:sourceRoute',
  messages:[{role:'user',content:[{type:'text',text:'Hello'}]}]}))events.push(event);
 assert.equal(events.some(x=>x.type==='text-delta'&&x.text==='source reply'),true);
 assert.equal(rig.calls.length,1);
});
test('source stream status 429 triggers existing native-router fallback without leaking partial output or credentials',async()=>{
 const rig=mockSource([{id:'qoder-primary',providerId:'qoder',enabled:true}]);
 let started=0;
 rig.embeddedPack.streamNative=async()=>{started++;return (async function*(){
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'discard this partial output'};
  yield {type:'block-end',index:0};
  yield {type:'finish',reason:{kind:'error',failure:{status:429,message:'Bearer SECRET_ACCESS'}}};
 })()};
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const approved=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const nextDriver={generate:async()=>({text:'fallback-success',reasoning:'',toolCalls:[],finishReason:'stop'})};
 const config=normalizeConfig({providers:[
  {id:'qoder',protocol:'native-channel',models:['qoder-chat']},
  {id:'other',protocol:'native-channel',models:['backup-model']}
 ],accounts:[
  {id:approved.id,providerId:'qoder',credentialRef:approved.credentialRef},
  {id:'backup',providerId:'other',credentialRef:'driver:other:backup'}
 ],routes:[{id:'fall',name:'fall',mode:'priority',tiers:[
  {providerId:'qoder',model:'qoder-chat'},
  {providerId:'other',model:'backup-model'}
 ],maxSwitches:2}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},
  channelDrivers:new Map([['qoder',driver],['other',nextDriver]])});
 const events=[];
 for await(const event of adapter.stream({model:'chain:fall',
  messages:[{role:'user',content:[{type:'text',text:'Question'}]}]}))events.push(event);
 assert.equal(started,1);
 assert.equal(events.some(x=>x.type==='text-delta'&&x.text==='fallback-success'),true);
 assert.doesNotMatch(JSON.stringify(events),/discard this partial output|SECRET_ACCESS/);
 const metrics=adapter.getStatus().metrics;
 assert.equal(metrics.failedAttempts,1);
 assert.equal(metrics.successfulTurns,1);
});
test('raw upstream native error messages are hidden while bounded HTTP codes are preserved',async()=>{
 const rig=mockSource([{id:'qoder-a',providerId:'qoder',enabled:true}]);
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const ref=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 rig.embeddedPack.streamNative=async()=>{throw Object.assign(Error('Bearer SECRET_JWT  at C:\\private\\tokens'),{status:429})};
 await assert.rejects(()=>driver.generate({account:{...ref,providerId:'qoder'},
  model:'qoder-chat',options:{messages:[{role:'user',content:[]}]}}),error=>
    error.status===429&&!/SECRET_JWT|private/.test(error.message));
});
test('source channels disappear from model catalog and account controls whenever isolated mount is unavailable',async()=>{
 let ready=false;
 const rig=mockSource([{id:'qoder-01',providerId:'qoder',enabled:true}]);
 rig.embeddedPack.status=()=>({state:ready?'mounted':'blocked'});
 const driver=createSourceChannelDriver({providerId:'qoder',embeddedPack:rig.embeddedPack});
 const ref=await driver.importCandidate({candidateId:(await driver.discover())[0].id,consent:true});
 const config=normalizeConfig({providers:[{id:'qoder',protocol:'native-channel',models:['qoder-chat']}],
  accounts:[{id:ref.id,providerId:'qoder',credentialRef:ref.credentialRef}],
  routes:[{id:'source',name:'source',tiers:[{providerId:'qoder',model:'qoder-chat'}]}]});
 const {createCatalog}=await import('../src/catalog.mjs');
 const {describeChannels}=await import('../src/channels.mjs');
 const map=new Map([['qoder',driver]]);
 const catalog=createCatalog({getConfig:()=>config,channelDrivers:map,ttlMs:600000});
 assert.equal((await catalog.list()).length,0);
 assert.equal(describeChannels(config,map).find(x=>x.id==='qoder').adapterReady,false);
 assert.equal(describeChannels(config,map).find(x=>x.id==='qoder').discoveryAvailable,false);
 ready=true;
 assert.equal((await catalog.list()).length,2,'mount state must immediately invalidate cached empty catalog');
 assert.equal(describeChannels(config,map).find(x=>x.id==='qoder').adapterReady,true);
 ready=false;
 assert.equal((await catalog.list()).length,0,'unmount must hide the source chain immediately');
});
test('registered experimental source drivers are lifetime-bound and never displace baseline WorkBuddy driver',async()=>{
 const {applyWith}=await import('../src/index.mjs');
 const {getNativeChannelDrivers}=await import('../src/driver-registry.mjs');
 const before=[...getNativeChannelDrivers().keys()].sort();
 const configured=normalizeConfig({embeddedPack:{enabled:true}});
 const store={get:()=>configured,replace:()=>configured};
 const ctx={
  llm:{registerAdapter:()=>()=>{},registerModelDiscovery:()=>()=>{},registerConfigurableProviders:()=>()=>{}},
  on:()=>()=>{},effect(){},logger:{info(){},warn(){}},
 };
 const history={blocked:false,error:null,all:()=>[],append:()=>{throw Error('No check-in execution authorized')}};
 const dispose=applyWith(ctx,{configStore:store,checkinStore:history,env:{}});
 try{
  const drivers=getNativeChannelDrivers();
  assert.equal(drivers.get('qoder')?.isSourceBridge,true);
  assert.equal(drivers.get('qoder')?.runtimeReady,false);
  assert.equal(typeof drivers.get('workbuddy')?.generate,'function');
  assert.equal(drivers.get('workbuddy')?.isSourceBridge,undefined);
  assert.equal(drivers.get('codearts')?.isSourceBridge,undefined);
 }finally{dispose()}
 assert.deepEqual([...getNativeChannelDrivers().keys()].sort(),before);
});


test('experimental two-account source chain switches on 429 without publishing partial response',async()=>{
 const rows=[
  {id:'lob-a',providerId:'lobsterai',nickname:'A',enabled:true},
  {id:'lob-b',providerId:'lobsterai',nickname:'B',enabled:true},
 ];
 const calls=[];
 const embeddedPack={
  status:()=>({state:'mounted',experimentalMultiAccountProviders:['lobsterai']}),
  listAccounts:async()=>({state:'ready',accounts:rows}),
  listModels:async()=>({state:'ready',models:[{id:'lobster-chat'}]}),
  streamNative:async req=>{
   calls.push(req.sourceAccountId);
   if(calls.length===1)return (async function*(){
     yield {type:'block-start',index:0,blockType:'text'};
     yield {type:'text-delta',index:0,text:'SECRET_PARTIAL_FROM_FAILED_ACCOUNT'};
     yield {type:'block-end',index:0};
     yield {type:'finish',reason:{kind:'error',
       failure:{status:429,message:'Bearer SECRET_SOURCE_ACCESS'}}};
   })();
   return textStream('fallback-source-account-'+req.sourceAccountId);
  },
 };
 const driver=createSourceChannelDriver({providerId:'lobsterai',embeddedPack});
 const imported=await Promise.all(rows.map(async row=>
  driver.importCandidate({candidateId:sourceAccountOpaqueId('lobsterai',row.id),consent:true})));
 const config=normalizeConfig({providers:[
  {id:'lobsterai',protocol:'native-channel',models:['lobster-chat'],supportsTools:true}
 ],accounts:imported.map(row=>({...row,providerId:'lobsterai',enabled:true})),
 routes:[{id:'multi',mode:'priority',name:'Multi-account',
   tiers:[{providerId:'lobsterai',model:'lobster-chat'}],maxSwitches:2}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},
  channelDrivers:new Map([['lobsterai',driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'chain:multi',sessionId:'source-multi-test',
   messages:[{role:'user',content:[{type:'text',text:'Hello'}]}]}))events.push(event);
 assert.equal(calls.length,2);
 assert.notEqual(calls[0],calls[1]);
 assert.equal(events.some(evt=>evt.type==='text-delta'
   &&evt.text==='fallback-source-account-'+calls[1]),true);
 assert.doesNotMatch(JSON.stringify(events),/SECRET_PARTIAL|SECRET_SOURCE_ACCESS/);
 const result=adapter.getStatus();
 assert.equal(result.metrics.failedAttempts,1);
 assert.equal(result.metrics.successfulTurns,1);
});
