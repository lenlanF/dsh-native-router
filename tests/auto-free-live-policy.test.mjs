import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {UpstreamError} from '../src/failure.mjs';

test('host AutoFree rechecks current fee before sending and falls back when directory changes',async()=>{
 const cfg=normalizeConfig({});const reads=new Map(),sends=[];
 const host={status:()=>({hostProviders:[{providerId:'host-a'},{providerId:'host-b'}]}),
  async listHostModels(id){const n=(reads.get(id)??0)+1;reads.set(id,n);return {state:'ready',models:[{id:'flash',isFree:id==='host-b'||n===1}]}},
  async *streamHost({providerId}){sends.push(providerId);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'OK'};yield {type:'block-end',index:0};yield {type:'finish',reason:{kind:'stop'}}}};
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},hostProviderInventory:host});
 const events=[];for await(const event of adapter.stream({model:'autofree',messages:[{role:'user',content:'OK'}]}))events.push(event);
 assert.deepEqual(sends,['host-b']);assert.equal(reads.get('host-a'),2);assert.equal(reads.get('host-b'),2);
 assert.ok(events.some(e=>e.type==='finish'&&e.reason.kind==='stop'));
});

test('owned AutoFree audit passes cancellation signal to exact account catalog resolver',async()=>{
 const providerId='own_loomy',cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts:[{id:'a',providerId,credentialRef:'driver:'+providerId+':a',enabled:true}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map([[providerId,{generate:async()=>{throw Error('unexpected inference')}}]])});
 adapter.setAccountVerificationResolver(()=>true);
 let received=false;
 adapter.setOwnedAccountCatalogResolver(async(_a,options)=>{received=options?.signal instanceof AbortSignal;return {state:'ready',models:[{id:'safe',free:true}]}});
 await adapter.auditAutoFree({ownedOnly:true});assert.equal(received,true);
});

test('configured independent accounts enter AutoFree and a changed live fee falls back without paid inference',async()=>{
 const providers=['own_workbuddy-cn','own_lingxi'].map(id=>({id,protocol:'native-channel',enabled:true}));
 const accounts=providers.map((p,i)=>({id:'account-'+i,providerId:p.id,credentialRef:'driver:'+p.id+':account-'+i,enabled:true}));
 const cfg=normalizeConfig({providers,accounts});
 const attempted=[],reads=new Map();
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map(providers.map(p=>[p.id,{generate:async()=>{attempted.push(p.id);return {text:'OK',finishReason:'stop',toolCalls:[]}}}]))});
 adapter.setAccountVerificationResolver(()=>true);
 adapter.setOwnedAccountCatalogResolver(async a=>{
  const n=(reads.get(a.id)??0)+1;reads.set(a.id,n);
  return {state:'ready',models:[{id:'flash',free:a.providerId!=='own_lingxi'||n===1}]};
 });
 const events=[];
 for await(const e of adapter.stream({model:'autofree',sessionId:'live-free-check',messages:[{role:'user',content:[{type:'text',text:'ping'}]}]}))events.push(e);
 assert.deepEqual(attempted,['own_workbuddy-cn']);
 assert.ok(reads.get('account-1')>=2);
 assert.ok(events.length>0);
});
test('owned free routing rejects reasoning-only output and switches without exposing incomplete content',async()=>{
 const ids=['own_workbuddy-cn','own_workbuddy-global'];
 const cfg=normalizeConfig({providers:ids.map(id=>({id,protocol:'native-channel',enabled:true})),accounts:ids.map((providerId,i)=>({id:'a'+i,providerId,credentialRef:'driver:'+providerId+':a'+i,enabled:true}))});
 const calls=[];
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map(ids.map(id=>[id,{generate:async()=>{calls.push(id);return calls.length===1?{text:'',reasoning:'PRIVATE_INCOMPLETE',finishReason:'length',toolCalls:[]}:{text:'OK',finishReason:'stop',toolCalls:[]}}}]))});
 adapter.setAccountVerificationResolver(()=>true);
 adapter.setOwnedAccountCatalogResolver(async()=>({state:'ready',models:[{id:'flash',free:true}]}));
 const sid='native-router-proof-owned-'+'a'.repeat(32),close=adapter.beginOwnedFreeProof(sid),events=[];
 try{for await(const e of adapter.stream({model:'autofree-owned',sessionId:sid,messages:[{role:'user',content:'OK'}]}))events.push(e)}finally{
 const proof=close();assert.equal(proof.failedAttempts,1);assert.equal(proof.crossChannelSwitch,true);assert.equal(proof.completedProvider,calls[1]);
 }
 assert.equal(calls.length,2);assert.doesNotMatch(JSON.stringify(events),/PRIVATE_INCOMPLETE/);
 assert.ok(events.some(e=>e.type==='text-delta'&&e.text==='OK'));
});
test('owned Qoder directory conflict appearing at dispatch never sends the selected model',async()=>{
 const ids=['own_qoder','own_workbuddy-cn'],cfg=normalizeConfig({providers:ids.map(id=>({id,protocol:'native-channel',enabled:true})),accounts:ids.map((providerId,i)=>({id:'a'+i,providerId,credentialRef:'driver:'+providerId+':a'+i,enabled:true}))});
 const calls=[],reads=new Map();
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map(ids.map(id=>[id,{generate:async()=>{calls.push(id);return {text:'OK',finishReason:'stop',toolCalls:[]}}}]))});
 adapter.setAccountVerificationResolver(()=>true);
 adapter.setOwnedAccountCatalogResolver(async a=>{
  const n=(reads.get(a.id)??0)+1;reads.set(a.id,n);
  return {state:'ready',models:a.providerId==='own_qoder'&&n>1?[{id:'flash',free:true,costMultiplier:0},{id:'flash',free:false,costMultiplier:1}]:[{id:'flash',free:true}]};
 });
 for await(const _ of adapter.stream({model:'autofree-owned',messages:[{role:'user',content:'OK'}]})){}
 assert.ok(reads.get('a0')>=2);assert.deepEqual(calls,['own_workbuddy-cn']);
});
test('AutoFree audit uses the current eligible account tiers without generating or exposing bindings',async()=>{
 const providerId='own_workbuddy-cn';
 const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts:['live','unverified'].map(id=>({id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true}))});
 let generated=0;
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},channelDrivers:new Map([[providerId,{generate:async()=>{generated++;return {text:'OK',finishReason:'stop',toolCalls:[]}}}]])});
 adapter.setAccountVerificationResolver(a=>a.id==='live');
 adapter.setOwnedAccountCatalogResolver(async()=>({state:'ready',models:[{id:'safe',free:true},{id:'not-free',free:false}]}));
 assert.deepEqual(await adapter.auditAutoFree(),{state:'ready',catalogCount:2,routeCount:1,manualCount:0,errors:0,providers:[{providerId,routeCount:1,accountCount:1}]});
 assert.equal(generated,0);
});
const makePack=(models)=>({
 status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
 async listAccounts(){return {state:'ready',accounts:[
  {providerId:'loomy',id:'m-1',enabled:true},
  {providerId:'zcode',id:'z-1',enabled:true},
 ]}},
 async listModels(id){return {state:'ready',models:models[id]}},
});

test('AutoFree owner marking a model nonfree DURING failed upstream turn blocks that previously selected free fallback',async()=>{
 let cfg=normalizeConfig({embeddedPack:{enabled:true}});
 const pack=makePack({
  loomy:[{id:'known-free',isFree:true}],
  zcode:[{id:'now-paid',isFree:true}],
 });
 const calls=[];
 const down={isSourceBridge:true,runtimeReady:true,async generate(){
  calls.push('loomy');
  cfg=normalizeConfig({...cfg,freePool:{models:[{
   providerId:'own_zcode',model:'now-paid',free:false,
  }]}});
  throw new UpstreamError('down',{code:'PROVIDER_NOT_READY'});
 }};
 const alternate={isSourceBridge:true,runtimeReady:true,async generate(){
  calls.push('zcode');return {text:'CHARGED MODEL EXECUTED',finishReason:'stop',toolCalls:[]};
 }};
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},ownedPack:pack,
  channelDrivers:new Map([['own_loomy',down],['own_zcode',alternate]])});
 adapter.setAccountVerificationResolver(()=>true);
 const promise=(async()=>{
  const events=[];
  for await(const ev of adapter.stream({model:'autofree',sessionId:'free-change',
   messages:[{role:'user',content:[{type:'text',text:'ping'}]}]}))events.push(ev);
  return events;
 })();
 await assert.rejects(promise,()=>true);
 assert.deepEqual(calls,['loomy'],
  'a backup explicitly changed to paid cannot be called using a stale AutoFree tier');
 const pool=await adapter.refreshAutoFree();
 assert.equal(pool.models.some(x=>x.providerId==='own_zcode'&&x.model==='now-paid'),false,
  'subsequent AutoFree scan also must respect exact manual negative free override');
});

test('switching whole source from manually free to unknown price during an in-flight failure prevents a surprise paid fallback',async()=>{
 let cfg=normalizeConfig({embeddedPack:{enabled:true},
  freePool:{providerIds:['own_zcode']}});
 const pack=makePack({
  loomy:[{id:'known-free',isFree:true}],
  zcode:[{id:'unknown-price'}],
 });
 let charged=0;
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},ownedPack:pack,
  channelDrivers:new Map([
   ['own_loomy',{isSourceBridge:true,runtimeReady:true,async generate(){
     cfg=normalizeConfig({...cfg,freePool:{providerIds:[]}});
     throw new UpstreamError('down',{code:'PROVIDER_NOT_READY'});
   }}],
   ['own_zcode',{isSourceBridge:true,runtimeReady:true,async generate(){
     charged++;return {text:'it worked',finishReason:'stop',toolCalls:[]};
   }}],
  ])});
 adapter.setAccountVerificationResolver(()=>true);
 await assert.rejects(async()=>{
  for await(const _ of adapter.stream({model:'autofree',sessionId:'free-mark-change',
   messages:[{role:'user',content:[{type:'text',text:'ping'}]}]})){}
 },()=>true);
 assert.equal(charged,0,'clearing a free-channel override cannot continue using the stale free model');
});
test('AutoFree response and tool calls are rejected when owner marks the active model paid before completion',async()=>{
 let cfg=normalizeConfig({embeddedPack:{enabled:true}});
 let resolveStarted,finish;
 const started=new Promise(resolve=>{resolveStarted=resolve});
 const pending=new Promise(resolve=>{finish=resolve});
 const pack=makePack({loomy:[{id:'free-today',isFree:true}],zcode:[]});
 const live={isSourceBridge:true,runtimeReady:true,async generate(){
  resolveStarted();await pending;
  return {text:'unapproved model reply',finishReason:'tool_calls',toolCalls:[{
   id:'tool-1',name:'execute-command',arguments:'{}',
  }]};
 }};
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},ownedPack:pack,
  channelDrivers:new Map([['own_loomy',live]])});
 adapter.setAccountVerificationResolver(()=>true);
 const events=[];
 const request=(async()=>{
  for await(const event of adapter.stream({model:'autofree',sessionId:'revoke-paid',
   tools:[{name:'execute-command',parameters:{type:'object',properties:{}}}],
   messages:[{role:'user',content:[{type:'text',text:'run'}]}]}))events.push(event);
 })();
 await started;
 cfg=normalizeConfig({...cfg,freePool:{models:[{
  providerId:'own_loomy',model:'free-today',free:false,
 }]}});
 finish();
 await assert.rejects(request,error=>error?.code==='ERR_ACCOUNT_CHANGED');
 assert.equal(events.length,0,'no text or executable DSH tool event may escape the revoked free tier');
});


test('owned-only AutoFree audit neither reads nor replaces the external provider catalog',async()=>{
 const providerId='own_workbuddy-cn',id='one';let externalReads=0;
 const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts:[{id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true}]});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},hostProviderInventory:{status:()=>({hostProviders:[{providerId:'external-fixture'}]}),listHostModels:async()=>{externalReads++;return {state:'ready',models:[{id:'external',free:true}]}}}});
 adapter.setAccountVerificationResolver(()=>true);adapter.setOwnedAccountCatalogResolver(async()=>({state:'ready',models:[{id:'own-free',free:true}]}));
 const initial=await adapter.auditAutoFree();assert.equal(externalReads,1);assert.equal(initial.routeCount,2);
 const before=adapter.autoFreeSnapshot();const owned=await adapter.auditAutoFree({ownedOnly:true});
 assert.equal(externalReads,1);assert.equal(owned.catalogCount,1);assert.equal(owned.routeCount,1);assert.equal(owned.providers[0].providerId,providerId);
 assert.deepEqual(adapter.autoFreeSnapshot(),before);
});

test('owned direct route avoids other providers and pins only exact model-bearing accounts',async()=>{
 const providerId='own_workbuddy-cn',ids=['a','b'];let externalReads=0;const reads=[],calls=[];
 const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts:ids.map(id=>({id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true}))});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},hostProviderInventory:{status:()=>({hostProviders:[{providerId:'external-fixture'}]}),listHostModels:async()=>{externalReads++;throw Error('external must not be read')}},channelDrivers:new Map([[providerId,{generate:async({account})=>{calls.push(account.id);return {text:'OK',finishReason:'stop',toolCalls:[]}}}]])});
 adapter.setAccountVerificationResolver(()=>true);adapter.setOwnedAccountCatalogResolver(async a=>{reads.push(a.id);return {state:'ready',models:[{id:a.id==='b'?'selected':'other',free:true}]}});
 const selected='direct:'+providerId+':selected';await adapter.prepareCall('native-router',selected);assert.deepEqual(reads,[]);
 const events=[];for await(const e of adapter.stream({model:selected,messages:[{role:'user',content:'OK'}]}))events.push(e);
 assert.equal(externalReads,0);assert.deepEqual(reads.sort(),ids);assert.deepEqual(calls,['b']);assert.ok(events.some(e=>e.type==='finish'&&e.reason.kind==='stop'));
 await assert.rejects(async()=>{for await(const e of adapter.stream({model:'direct:'+providerId+':not-present',messages:[]})){}},{code:'ERR_ROUTE_NOT_FOUND'});assert.deepEqual(calls,['b']);
});

test('owned AutoFree actual stream switches channels on rate limits without touching external or manual-only routes',async()=>{
 const ids=['own_loomy','own_workbuddy-cn','own_workbuddy-global'];let external=0;const calls=[];
 const cfg=normalizeConfig({providers:ids.map(id=>({id,protocol:'native-channel',enabled:true})),accounts:ids.map((providerId,i)=>({id:'a'+i,providerId,credentialRef:'driver:'+providerId+':a'+i,enabled:true})),freePool:{models:[{providerId:'own_workbuddy-global',model:'manual',free:true}]}});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},hostProviderInventory:{status:()=>({hostProviders:[{providerId:'external'}]}),listHostModels:async()=>{external++;throw Error('not allowed')}},channelDrivers:new Map(ids.map(id=>[id,{generate:async({model})=>{calls.push([id,model]);if(id==='own_loomy')throw new UpstreamError('limited',{status:429,code:'RATE_LIMIT',retryAfterMs:180000});return {text:'OK',finishReason:'stop',toolCalls:[]}}}]))});
 adapter.setAccountVerificationResolver(()=>true);
 adapter.setOwnedAccountCatalogResolver(async a=>({state:'ready',models:a.providerId==='own_loomy'?[{id:'first',free:true},{id:'second',free:true}]:a.providerId==='own_workbuddy-cn'?[{id:'backup',free:true}]:[{id:'manual',free:false}]}));
 await adapter.prepareCall('native-router','autofree-owned');assert.equal(external,0);
 const proofId='native-router-proof-owned-'+'1'.repeat(32),close=adapter.beginOwnedFreeProof(proofId);
 for(let i=0;i<2;i++){const events=[];for await(const e of adapter.stream({model:'autofree-owned',sessionId:i===0?proofId:'turn-'+i,messages:[{role:'user',content:'OK'}]}))events.push(e);assert.ok(events.some(e=>e.type==='finish'&&e.reason.kind==='stop'))}
 assert.ok(adapter.getStatus().recentRoutes.every(r=>r.routeId==='autofree-owned'));assert.doesNotMatch(JSON.stringify(adapter.getStatus().recentRoutes),/accountBindings|credentialRef|driver:|freePolicySignature/);
 assert.deepEqual(close(),{failedAttempts:1,failedProviderCount:1,completedProvider:'own_workbuddy-cn',crossChannelSwitch:true});
 assert.equal(external,0);assert.deepEqual(calls.slice(0,2),[['own_loomy','first'],['own_workbuddy-cn','backup']]);assert.ok(calls.every(([id])=>id!=='own_workbuddy-global'));assert.equal(calls.filter(([id,model])=>id==='own_loomy'&&model==='first').length,1);
});
