import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {UpstreamError} from '../src/failure.mjs';

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
