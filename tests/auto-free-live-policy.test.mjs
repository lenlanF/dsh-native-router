import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {UpstreamError} from '../src/failure.mjs';

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

