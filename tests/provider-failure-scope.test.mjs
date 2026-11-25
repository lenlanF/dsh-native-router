import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountPool} from '../src/accounts.mjs';
import {createRoutingEngine} from '../src/router.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {UpstreamError} from '../src/failure.mjs';

const config=normalizeConfig({
 providers:[
  {id:'own_loomy',protocol:'native-channel',enabled:true},
  {id:'own_zcode',protocol:'native-channel',enabled:true},
 ],
 accounts:[
  {id:'failed-A',providerId:'own_loomy',credentialRef:'driver:own_loomy:failed-A'},
  {id:'failed-B',providerId:'own_loomy',credentialRef:'driver:own_loomy:failed-B'},
  {id:'working',providerId:'own_zcode',credentialRef:'driver:own_zcode:working'},
 ],
 routes:[{id:'fallback',enabled:true,mode:'priority',maxSwitches:3,tiers:[
   {providerId:'own_loomy',model:'model-A',free:true},
   {providerId:'own_loomy',model:'model-B',free:true},
   {providerId:'own_zcode',model:'model-C',free:true},
 ]}],
});
test('whole-provider outage tries only one private account then switches to another channel, never hammering sibling accounts/models',async()=>{
 let clock=1_000_000;
 const pool=createAccountPool({now:()=>clock});
 const attempts=[];
 const router=createRoutingEngine({getConfig:()=>config,pool,
  request:async({provider,account,model})=>{
   attempts.push([provider.id,account.id,model]);
   if(provider.id==='own_loomy')
     throw new UpstreamError('driver not mounted',{code:'PROVIDER_NOT_READY'});
   return {text:'backup channel succeeded',finishReason:'stop',toolCalls:[]};
  }});
 const first=await router.execute('fallback',{sessionId:'one'});
 assert.equal(first.text,'backup channel succeeded');
 assert.deepEqual(attempts.map(row=>row[0]),['own_loomy','own_zcode'],
  'one provider outage is not an account-specific failure; do not ping every account');
 assert.equal(pool.providerReady('own_loomy','model-B'),false,
  'provider-unavailable cooldown must cover ALL models and accounts of that Provider');
 attempts.length=0;
 await router.execute('fallback',{sessionId:'two'});
 assert.deepEqual(attempts,[['own_zcode','working','model-C']],
  'subsequent model turn bypasses offline provider while cooldown is active');
 clock+=60_001;
 attempts.length=0;
 await router.execute('fallback',{sessionId:'three'});
 assert.equal(attempts[0][0],'own_loomy','provider may retry after cooldown expires');
 assert.deepEqual(attempts.map(row=>row[0]),['own_loomy','own_zcode']);
});
test('account-specific quota retains fallback on another account of same provider',async()=>{
 const route={id:'same-source',enabled:true,mode:'priority',maxSwitches:1,tiers:[
  {providerId:'own_loomy',model:'model-A',free:true},
 ]};
 const attempts=[];
 const pool=createAccountPool();
 const router=createRoutingEngine({getConfig:()=>config,pool,
  request:async({account})=>{
   attempts.push(account.id);
   if(attempts.length===1)throw new UpstreamError('quota exhausted',{status:402,code:'QUOTA'});
   return {text:'other source account',finishReason:'stop',toolCalls:[]};
  }});
 const result=await router.execute(route,{sessionId:'quota'});
 assert.equal(result.text,'other source account');
 assert.equal(attempts.length,2,'quota exhaustion is per account, not entire Provider');
 assert.notEqual(attempts[0],attempts[1]);
 assert.equal(pool.providerReady('own_loomy','model-A'),true);
});
test('a disabled or missing provider is never dispatched via a stale route tier',async()=>{
 const stale={...config,providers:config.providers.filter(p=>p.id!=='own_loomy')};
 const attempts=[];
 const router=createRoutingEngine({getConfig:()=>stale,
  request:async({provider})=>{attempts.push(provider.id);return {text:'ok',finishReason:'stop'}}});
 const result=await router.execute({id:'orphaned',enabled:true,mode:'priority',maxSwitches:1,tiers:[
  {providerId:'own_loomy',model:'x',free:true},
  {providerId:'own_zcode',model:'y',free:true},
 ]});
 assert.equal(result.text,'ok');
 assert.deepEqual(attempts,['own_zcode']);
});
test('disabling a fallback account during an in-flight failed request prevents dispatch using stale account roster',async()=>{
 let current=structuredClone(config);
 const attempts=[];
 const router=createRoutingEngine({getConfig:()=>current,
  request:async({account})=>{
   attempts.push(account.id);
   if(attempts.length===1){
    current=normalizeConfig({...current,accounts:current.accounts.map(row=>({
     ...row,enabled:row.id===account.id,
    }))});
    throw new UpstreamError('quota',{status:402,code:'QUOTA'});
   }
   return {text:'should never run',finishReason:'stop',toolCalls:[]};
  }});
 await assert.rejects(()=>router.execute({id:'one',enabled:true,mode:'priority',maxSwitches:0,
   tiers:[{providerId:'own_loomy',model:'A',free:true}]},{sessionId:'concurrent'}),
   error=>error?.code==='QUOTA');
 assert.equal(attempts.length,1,'a removed/disabled second credential must not be used after owner revocation');
});
test('disabling the backup Provider during the first failed tier prevents stale cross-channel failover',async()=>{
 let current=structuredClone(config);
 const attempts=[];
 const router=createRoutingEngine({getConfig:()=>current,
  request:async({provider})=>{
   attempts.push(provider.id);
   current=normalizeConfig({...current,providers:current.providers.map(p=>({
    ...p,enabled:p.id!=='own_zcode',
   }))});
   throw new UpstreamError('outage',{code:'PROVIDER_NOT_READY'});
  }});
 await assert.rejects(()=>router.execute('fallback',{sessionId:'switch'}),
  error=>error?.code==='PROVIDER_NOT_READY');
 assert.deepEqual(attempts,['own_loomy'],
  'provider disabled while earlier attempt was pending must not be dispatched as backup');
});
test('an in-flight successful response cannot emit stale tool calls after owner disables the binding',async()=>{
 let current=structuredClone(config);
 let deliver;
 const wait=new Promise(resolve=>{deliver=resolve});
 let running;
 const started=new Promise(resolve=>{running=resolve});
 const attempts=[];
 const router=createRoutingEngine({getConfig:()=>current,
  request:async({account})=>{
   attempts.push(account.id);
   running();await wait;
   return {text:'stale model response',finishReason:'tool_calls',
    toolCalls:[{id:'call-1',name:'execute-command',arguments:'{}'}]};
  }});
 const req=router.execute({id:'inflight',enabled:true,mode:'priority',maxSwitches:0,
  tiers:[{providerId:'own_loomy',model:'A',free:true}]});
 await started;
 const selected=attempts[0];
 current=normalizeConfig({...current,accounts:current.accounts.map(row=>({
  ...row,enabled:row.id===selected?false:row.enabled,
 }))});
 deliver();
 await assert.rejects(req,error=>error?.code==='ERR_ACCOUNT_CHANGED',
  'never release tool calls from a model account revoked while request was running');
 assert.equal(attempts.length,1,'owner revocation never triggers a second paid request');
});
test('full AutoFree adapter skips a down multi-account Provider and continues through a healthy owned free channel',async()=>{
 const {createNativeRouterAdapter}=await import('../src/adapter.mjs');
 const {sourceAccountOpaqueId}=await import('../src/source-account-ref.mjs');
 const cfg=normalizeConfig({embeddedPack:{enabled:true}});
 const members=[
  {providerId:'loomy',id:'member-1',enabled:true},
  {providerId:'loomy',id:'member-2',enabled:true},
  {providerId:'raccoon',id:'backup-1',enabled:true},
 ];
 const pack={status:()=>({state:'mounted',experimentalMultiAccountProviders:['loomy']}),
  listAccounts:async()=>({state:'ready',accounts:members}),
  listModels:async providerId=>({state:'ready',models:[{
   id:providerId+'-zero',isFree:true,name:'Zero-rated'}]})};
 const calls=[];
 const failing={isSourceBridge:true,runtimeReady:true,
  async generate({account}){
   calls.push(account.id);
   throw new UpstreamError('Provider not mounted',{code:'PROVIDER_NOT_READY'});
  }};
 const backup={isSourceBridge:true,runtimeReady:true,
  async generate({account}){
   calls.push(account.id);
   return {text:'Free backup completed',finishReason:'stop',toolCalls:[]};
  }};
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},ownedPack:pack,
  channelDrivers:new Map([['own_loomy',failing],['own_raccoon',backup]])});
 adapter.setAccountVerificationResolver(()=>true);
 const stream=async()=>{
  const events=[];
  for await(const row of adapter.stream({model:'autofree',sessionId:'agent-stable',
   messages:[{role:'user',content:[{type:'text',text:'Hello'}]}]}))events.push(row);
  return events;
 };
 const loomyIds=new Set(['member-1','member-2'].map(x=>sourceAccountOpaqueId('loomy',x)));
 const backupId=sourceAccountOpaqueId('raccoon','backup-1');
 for(let turn=0;turn<3;turn++){
  const result=await stream();
  assert.equal(result.find(x=>x.type==='text-delta')?.text,'Free backup completed');
 }
 assert.equal(calls.filter(id=>loomyIds.has(id)).length,1,
  'one Provider outage must never request another sibling on any later Agent turn in cooldown');
 assert.equal(calls.filter(id=>id===backupId).length,3,
  'three successive AutoFree turns complete on independent healthy backup');
});



