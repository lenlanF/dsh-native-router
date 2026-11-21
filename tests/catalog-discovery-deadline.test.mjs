import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../src/catalog.mjs';
import {normalizeConfig} from '../src/config.mjs';

const config=normalizeConfig({providers:[{
 id:'own_loomy',name:'Loomy',protocol:'native-channel',models:['configured'],
}],accounts:[
 {id:'s1',providerId:'own_loomy',credentialRef:'driver:own_loomy:s1'},
 {id:'s2',providerId:'own_loomy',credentialRef:'driver:own_loomy:s2'},
]});

test('hung model discovery on first owned login cannot block healthy second account or DSH model selector',async()=>{
 let calls=0,firstAborted=false;
 const driver={
  generate:async()=>({text:'reply',finishReason:'stop'}),
  listModels:async({account,signal})=>{
   calls++;
   if(account.id==='s1'){
    signal?.addEventListener('abort',()=>{firstAborted=true},{once:true});
    return new Promise(()=>{});
   }
   return [{id:'healthy-peer-model',name:'Live peer · x0.00'}];
  },
 };
 const catalog=createCatalog({getConfig:()=>config,
  channelDrivers:new Map([['own_loomy',driver]]),
  accountDiscoveryTimeoutMs:40,providerDiscoveryTimeoutMs:150});
 const selector=await Promise.race([catalog.list(),
  new Promise((_,reject)=>setTimeout(()=>reject(Error('Model picker stuck behind source discovery')),650))]);
 assert.equal(calls,2);
 assert.equal(firstAborted,true,'timed-out upstream request gets an abort signal');
 assert.ok(selector.some(x=>x.id==='direct:own_loomy:healthy-peer-model'));
 assert.equal((await catalog.list()).length,selector.length,
  'fresh cached model selector must not probe again immediately');
});
test('many blocked own-source logins remain within one provider deadline and bounded concurrency',async()=>{
 let active=0,peak=0,started=0,aborted=0;
 const rows=normalizeConfig({providers:[{id:'own_loomy',protocol:'native-channel',models:['safe-configured']}],
  accounts:Array.from({length:20},(_,i)=>({
   id:'s'+i,providerId:'own_loomy',credentialRef:'driver:own_loomy:s'+i,
  }))});
 const driver={generate:async()=>({text:'ok',finishReason:'stop'}),
  listModels:async({signal})=>{
   started++;active++;peak=Math.max(peak,active);
   signal?.addEventListener('abort',()=>{aborted++;active--},{once:true});
   return new Promise(()=>{});
  }};
 const cat=createCatalog({getConfig:()=>rows,channelDrivers:new Map([['own_loomy',driver]]),
  accountDiscoveryTimeoutMs:55,providerDiscoveryTimeoutMs:170,
  maxConcurrentDiscoveries:3});
 const startedAt=Date.now();
 const models=await Promise.race([cat.list(),new Promise((_,reject)=>
  setTimeout(()=>reject(Error('20 hung accounts blocked model selector')),700))]);
 assert.ok(Date.now()-startedAt<700,'directory listing must finish within bounded time');
 assert.ok(peak<=3,'never start uncontrolled parallel model requests');
 assert.ok(started<=3,'do not launch another request after an upstream ignores cancellation');
 assert.equal(aborted,started,'each stuck request receives abort');
 assert.ok(models.some(row=>row.id==='direct:own_loomy:safe-configured'),
  'configured models remain displayed while live discovery is unavailable');
});
test('two simultaneous model selector reloads share one in-flight native roster probe',async()=>{
 let requests=0,notify,release;
 const started=new Promise(resolve=>{notify=resolve});
 const waiting=new Promise(resolve=>{release=resolve});
 const driver={generate:async()=>({text:'OK',finishReason:'stop'}),
  async listModels(){requests++;notify();await waiting;return [{id:'concurrent-live-model'}]}};
 const cfg=normalizeConfig({providers:[{id:'codearts',protocol:'native-channel'}],
  accounts:[{id:'one',providerId:'codearts',credentialRef:'driver:codearts:one'}]});
 const cat=createCatalog({getConfig:()=>cfg,channelDrivers:new Map([['codearts',driver]])});
 const first=cat.list();await started;
 const second=cat.list();
 release();const [a,b]=await Promise.all([first,second]);
 assert.equal(requests,1,'concurrent UI/DSH model selectors must not issue the same model query twice');
 assert.deepEqual(a,b);
 assert.notEqual(a,b,'separate caller must receive its own model array');
 assert.ok(a.some(x=>x.id==='direct:codearts:concurrent-live-model'));
});
test('catalog invalidation during upstream discovery never publishes a detached provider model',async()=>{
 let cfg=normalizeConfig({providers:[{id:'codearts',protocol:'native-channel'}],
  accounts:[{id:'one',providerId:'codearts',credentialRef:'driver:codearts:one'}]});
 let notify,release;
 const started=new Promise(resolve=>{notify=resolve});
 const waiting=new Promise(resolve=>{release=resolve});
 const driver={generate:async()=>({text:'ok',finishReason:'stop'}),
  async listModels(){notify();await waiting;return [{id:'stale-credential-model'}]}};
 const cat=createCatalog({getConfig:()=>cfg,channelDrivers:new Map([['codearts',driver]])});
 const old=cat.list();await started;
 cfg=normalizeConfig({});
 cat.invalidate();
 release();
 const stale=await old;
 assert.equal(stale.some(x=>x.id==='direct:codearts:stale-credential-model'),false,
  'a catalog scan started before owner logout cannot advertise a credentialless model');
 const fresh=await cat.list();
 assert.equal(fresh.some(x=>x.id==='direct:codearts:stale-credential-model'),false);
});
test('an unreachable provider does not delay unrelated healthy provider model discovery',async()=>{
 const providers=Array.from({length:6},(_,i)=>({id:'chan'+i,
  name:'Channel '+i,protocol:'native-channel',models:['old'+i]}));
 const accounts=providers.map((p,i)=>({id:'member'+i,providerId:p.id,
  credentialRef:'driver:'+p.id+':member'+i}));
 const cfg=normalizeConfig({providers,accounts});
 const drivers=new Map(providers.map((p,i)=>[p.id,{
  generate:async()=>({text:'ok',finishReason:'stop'}),
  async listModels(){return i===5?[{id:'new-from-healthy-last'}]:new Promise(()=>{})},
 }]));
 const cat=createCatalog({getConfig:()=>cfg,channelDrivers:drivers,
  accountDiscoveryTimeoutMs:95,providerDiscoveryTimeoutMs:150,
  maxConcurrentDiscoveries:1});
 const started=Date.now();
 const found=await Promise.race([cat.list(),new Promise((_,reject)=>
   setTimeout(()=>reject(Error('Six providers blocked model selector')),410))]);
 assert.ok(Date.now()-started<410,'independent providers must be scanned in a small parallel queue');
 assert.ok(found.some(row=>row.id==='direct:chan5:new-from-healthy-last'));
});
test('direct model discovered from a healthy peer can complete the full DSH routing stream after first account auth failure',async()=>{
 const {createNativeRouterAdapter}=await import('../src/adapter.mjs');
 const {UpstreamError}=await import('../src/failure.mjs');
 const attempts=[];
 const driver={
  listModels:async({account})=>account.id==='s1'?Promise.reject(new Error('expired source')):
    [{id:'healthy-live-model',name:'Healthy · x0.00'}],
  async generate({account,model}){
   attempts.push([account.id,model]);
   if(account.id==='s1')throw new UpstreamError('expired',{status:401});
   return {text:'REAL PATH OK',finishReason:'stop',toolCalls:[]};
  },
 };
 const adapter=createNativeRouterAdapter({configStore:{get:()=>config},
  channelDrivers:new Map([['own_loomy',driver]])});
 adapter.setAccountVerificationResolver(()=>true);
 const picker=await adapter.listModels();
 const selected='direct:own_loomy:healthy-live-model';
 assert.ok(picker.some(x=>x.id===selected));
 const events=[];
 for await(const event of adapter.stream({model:selected,sessionId:'peer-recovery',
  messages:[{role:'user',content:[{type:'text',text:'ping'}]}]}))events.push(event);
 assert.equal(events.find(x=>x.type==='text-delta')?.text,'REAL PATH OK');
 assert.deepEqual(attempts,[['s1','healthy-live-model'],['s2','healthy-live-model']],
  'DSH must actually route to the second authenticated account after the first fails');
});



