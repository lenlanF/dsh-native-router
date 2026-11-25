import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoFreePool,freeEvidence} from '../src/auto-free.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createRoutingEngine} from '../src/router.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

test('positive rate and duplicate contradictory host rows cannot qualify automatically',async()=>{
 assert.equal(freeEvidence({id:'contradictory',isFree:true,costMultiplier:0.04}),null);
 const host={status:()=>({hostProviders:[{providerId:'workbuddy'}]}),listHostModels:async()=>({state:'ready',models:[{id:'conflict',isFree:true},{id:'conflict',pricing:{input:1,output:0}},{id:'safe',isFree:true}]})};
 const pool=createAutoFreePool({getConfig:()=>normalizeConfig({}),hostProviderInventory:host});
 assert.deepEqual((await pool.refresh()).models.map(m=>m.model),['safe']);
});
test('configured catalog requires every checked account to agree on free entitlement',async()=>{
 const providerId='own_workbuddy-cn',ids=['a-one','a-two'];
 const cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts:ids.map(id=>({id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true}))});
 const pool=createAutoFreePool({getConfig:()=>cfg,ownedAccountEligible:()=>true,ownedAccountCatalog:async a=>({state:'ready',models:[{id:'same',free:a.id===ids[0]},{id:'safe',free:true}]})});
 const result=await pool.refresh();
 assert.deepEqual(result.models.map(x=>x.model),['safe']);
 assert.deepEqual(pool.tiers()[0].accountIds,ids);
 result.models[0].accountIds.length=0;
 assert.deepEqual(pool.tiers()[0].accountIds,ids);
});
function originalHost({models=[{id:'host-free',isFree:true},{id:'host-paid',isFree:false}]}={}){
 let calls=0,registered=true;
 return {setRegistered(v){registered=v},calls:()=>calls,
  status:()=>({hostProviders:registered?[{providerId:'workbuddy-global'}]:[]}),
  async listHostModels(providerId){
   calls++;assert.equal(providerId,'workbuddy-global');
   return {state:'ready',providerId,models};
  }};
}
test('AutoFree excludes guesses, paid and incomplete upstream pricing metadata',()=>{
 for(const row of [{id:'free-in-name'}, {id:'model',pricing:{input:0}},
  {id:'paid',isFree:false,pricing:{input:0,output:0}},
  {id:'unknown',pricing:{input:0,output:0.001}},null]){
  assert.equal(freeEvidence(row),null);
 }
 assert.equal(freeEvidence({id:'marked',isFree:true}),'来源明确标记免费');
 assert.equal(freeEvidence({pricing:{input:0,output:0}}),'来源输入与输出价格均为零');
 assert.equal(freeEvidence({pricing:{input:'0.00',output:'0.00'}}),'来源输入与输出价格均为零');
});
test('AutoFree automatically discovers original DSH providers, enables direct models and only verified-free tiers',async()=>{
 const host=originalHost({models:[{id:'model-free',isFree:true},
  {id:'model-unknown'},{id:'paid',pricing:{input:1,output:1}}]});
 const config=normalizeConfig({});
 const pool=createAutoFreePool({hostProviderInventory:host,getConfig:()=>config,ttlMs:10000});
 const scanned=await pool.refresh();
 assert.equal(scanned.catalog.length,3);
 assert.deepEqual(scanned.models.map(x=>x.model),['model-free']);
 assert.equal(scanned.unknownPricing,2);
 assert.equal(host.calls(),1);
 const dynamic=pool.effectiveConfig();
 assert.deepEqual(dynamic.routes,[],'Channel integration must NOT create model chains');
 assert.equal(dynamic.providers[0].protocol,'dsh-host');
 assert.equal(dynamic.accounts.length,0,'Host login remains in original plugin');
 assert.equal(pool.tiers()[0].providerId,'workbuddy-global');
 const published=await createCatalog({getConfig:()=>config,hostProviderInventory:host,
  autoFreePool:pool,ttlMs:10000}).list();
 assert.ok(published.some(row=>row.id==='autofree'));
 assert.ok(published.some(row=>row.id==='direct:workbuddy-global:model-free'));
 assert.ok(published.some(row=>row.id==='direct:workbuddy-global:model-unknown'));
 assert.equal(host.calls(),1,'TTL must avoid repeated host catalog calls');
 host.setRegistered(false);
 await pool.refresh({force:true});
 assert.equal(pool.tiers().length,0,'Removed original plugin must immediately leave AutoFree');
});
test('independently logged in source accounts enter AutoFree automatically, with exact source account identity',async()=>{
 const config=normalizeConfig({embeddedPack:{enabled:true}});
 let ready=true,modelCalls=0;
 const own={
  status:()=>({state:ready?'mounted':'blocked',experimentalMultiAccountProviders:[]}),
  async listAccounts(){return {state:'ready',accounts:[
   {providerId:'loomy',id:'loomy-11',enabled:true},
   {providerId:'zcode',id:'zcode-11',enabled:false}]}},
  async listModels(providerId){
   assert.equal(providerId,'loomy');modelCalls++;
   return {state:'ready',models:[{id:'free-source',upstreamFreeLabel:true},
    {id:'unknown-source'}]};
  }};
 const pool=createAutoFreePool({getConfig:()=>config,ownedPack:own});
 const result=await pool.refresh();
 assert.equal(result.sourceCount,1);
 assert.equal(modelCalls,1);
 assert.deepEqual(result.models.map(x=>x.providerId),['own_loomy']);
 const effective=pool.effectiveConfig();
 assert.equal(effective.routes.length,0);
 assert.equal(effective.providers.find(p=>p.id==='own_loomy').protocol,'native-channel');
 const ref=sourceAccountOpaqueId('loomy','loomy-11');
 assert.equal(effective.accounts[0].id,ref);
 assert.equal(effective.accounts[0].credentialRef,'driver:own_loomy:'+ref);
 assert.deepEqual(pool.tiers()[0].accountIds,[ref]);
 ready=false;
 await pool.refresh({force:true});
 assert.equal(pool.tiers().length,0);
});
test('AutoFree routing switches between providers without persisted model chains or secrets',async()=>{
 const config=normalizeConfig({});
 const host={
  status:()=>({hostProviders:[{providerId:'workbuddy'},{providerId:'loomy'}]}),
  async listHostModels(id){return {state:'ready',models:[{id:id+'-free',isFree:true}]}}};
 const pool=createAutoFreePool({getConfig:()=>config,hostProviderInventory:host});
 await pool.refresh();
 const attempted=[];
 const router=createRoutingEngine({
  getConfig:()=>pool.effectiveConfig(config),
  async request({provider,model}){
   attempted.push(provider.id+':'+model);
   if(provider.id==='loomy')throw Object.assign(Error('quota'),{status:429});
   return {text:'ok',finishReason:'stop',toolCalls:[]};
  },
 });
 const tiers=pool.tiers();
 assert.equal(tiers.length,2);
 const out=await router.execute({id:'autofree',name:'AutoFree',mode:'free',enabled:true,
  tiers,maxSwitches:1},{sessionId:'s1'});
 assert.equal(out.text,'ok');
 assert.deepEqual(attempted,['loomy:loomy-free','workbuddy:workbuddy-free']);
 assert.equal(config.routes.length,0);
});

test('WorkBuddy x0.00 is detected as zero credit multiplier but never guessed for other hosts',()=>{
 assert.equal(freeEvidence({id:'hy4-flash',name:'Hy4 Flash · x0.00'},'workbuddy'),
  'WorkBuddy 目录标记 x0.00 积分倍率');
 assert.equal(freeEvidence({id:'hy4-flash',name:'Hy4 Flash (x0.000)'},'workbuddy-global'),
  'WorkBuddy 目录标记 x0.00 积分倍率');
 for(const item of [{id:'paid',name:'Hy4 x0.01'},{id:'paid',name:'hy4 free'}])
  assert.equal(freeEvidence(item,'workbuddy'),null);
 assert.equal(freeEvidence({id:'paid',name:'Hy4 · x0.00'},'lingxi'),null);
 assert.equal(freeEvidence({id:'paid',name:'Hy4 · x0.00',isFree:false},'workbuddy'),null);
});
test('owned WorkBuddy member channels retain literal x0.00 free classification, never infer free from names on unrelated channels',()=>{
 for(const owner of ['own_workbuddy','own_workbuddy-cn','own_workbuddy-global']){
  assert.match(freeEvidence({id:'hy4',name:'Hy4 Flash · x0.00'},owner)??'',/x0.00/);
  assert.equal(freeEvidence({id:'hy4',name:'Hy4 Flash · x0.01'},owner),null);
 }
 assert.equal(freeEvidence({id:'hy4',name:'Hy4 Flash · x0.00'},'codearts'),null);
});
test('owner can explicitly mark exact models and entire channel free, exclude a model, and persist declarations',async()=>{
 let cfg=normalizeConfig({freePool:{providerIds:['deepseek-account'],
  models:[{providerId:'workbuddy',model:'wb-pro',free:true},
          {providerId:'deepseek-account',model:'paid-explicitly',free:false}]}});
 const host={
  status:()=>({hostProviders:[{providerId:'workbuddy'},{providerId:'deepseek-account'}]}),
  async listHostModels(id){return {state:'ready',models:id==='workbuddy'?
   [{id:'wb-free',name:'Hy4 · x0.00'},{id:'wb-pro',name:'Hy4 Pro x3.00'}]:
   [{id:'manual-free',name:'unknown'},{id:'paid-explicitly',name:'paid'}]}}
 };
 const pool=createAutoFreePool({hostProviderInventory:host,getConfig:()=>cfg});
 await pool.refresh();
 assert.deepEqual(pool.snapshot().models.map(x=>x.providerId+':'+x.model).sort(),[
  'deepseek-account:manual-free','workbuddy:wb-free','workbuddy:wb-pro']);
 assert.match(pool.snapshot().models.find(x=>x.model==='wb-pro').evidence,/用户手动/);
 assert.equal(cfg.routes.length,0,'Manual fee flags never generate model chains');
 cfg=normalizeConfig({...cfg,freePool:{providerIds:[],
  models:[{providerId:'workbuddy',model:'not-in-directory',free:true},
   {providerId:'workbuddy',model:'wb-free',free:false}]}});
 await pool.refresh();
 const list=pool.snapshot().models.map(x=>x.providerId+':'+x.model);
 assert.deepEqual(list,['workbuddy:not-in-directory']);
 assert.equal(pool.tiers().length,1);
 assert.equal(cfg.routes.length,0);
 assert.throws(()=>normalizeConfig({freePool:{models:[
   {providerId:'workbuddy',model:'x',free:true},{providerId:'workbuddy',model:'x',free:false}
 ]}}),/Duplicate AutoFree/);
 assert.throws(()=>normalizeConfig({freePool:{models:[
   {providerId:'native-router',model:'autofree',free:true}
 ]}}),/recursive/);
});
test('a deliberately removed private channel account never reappears through AutoFree dynamic reconstruction',async()=>{
 const id=sourceAccountOpaqueId('loomy','logged-out-01');
 let cfg=normalizeConfig({embeddedPack:{enabled:true},
  sessionReuse:{ignoredIds:[id]}});
 const ownedPack={status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'loomy',id:'logged-out-01',enabled:true}]}),
  listModels:async()=>({state:'ready',models:[{id:'free-model',isFree:true}]})};
 const pool=createAutoFreePool({getConfig:()=>cfg,ownedPack});
 await pool.refresh();
 assert.deepEqual(pool.snapshot().sourceAccounts,[],
  'manual account removal must survive source-pack roster refresh');
 assert.equal(pool.effectiveConfig().accounts.length,0,
  'removed member must never silently become a new private shadow account');
 assert.equal(pool.tiers().length,0);
 cfg=normalizeConfig({...cfg,providers:[{id:'own_loomy',protocol:'native-channel'}],
  accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id}]});
 await pool.refresh();
 assert.equal(pool.effectiveConfig().accounts.length,1,
  'user explicitly readopting the account overrides the previous ignore entry');
 assert.equal(pool.tiers().length,1);
});
test('private logout prevents account resurrection after automatic model rescan and plugin restart',async()=>{
 const id=sourceAccountOpaqueId('loomy','private-owner-01');
 let cfg=normalizeConfig({embeddedPack:{enabled:true},
  providers:[{id:'own_loomy',protocol:'native-channel'}],
  accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id}],
  sessionReuse:{linkedIds:[]}});
 const store={get:()=>structuredClone(cfg),replace(next){cfg=normalizeConfig(next);return store.get()}};
 const pack={status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'loomy',id:'private-owner-01',enabled:true}]}),
  listModels:async()=>({state:'ready',models:[{id:'free',isFree:true}]})};
 const createPool=()=>createAutoFreePool({getConfig:store.get,ownedPack:pack});
 const pool=createPool();
 await pool.refresh();
 assert.equal(pool.tiers().length,1);
 const center=createAccountCenter({configStore:store,drivers:new Map(),
  adapter:{invalidateCatalog(){pool.invalidate()}}});
 await center.logout(id);
 assert.ok(store.get().sessionReuse.ignoredIds.includes(id));
 await pool.refresh();
 assert.equal(pool.tiers().length,0);
 assert.equal(pool.effectiveConfig().accounts.length,0);
 assert.equal(pool.snapshot().sourceAccounts.length,0);
 const restarted=createPool();
 await restarted.refresh();
 assert.equal(restarted.tiers().length,0);
 assert.equal(restarted.effectiveConfig().accounts.length,0);
});
test('in-flight AutoFree scan cannot cache an account that was explicitly removed during source discovery',async()=>{
 const id=sourceAccountOpaqueId('loomy','slow-member-01');
 let cfg=normalizeConfig({embeddedPack:{enabled:true}}),release,started;
 const inFlight=new Promise(resolve=>{release=resolve});
 const sourceStarted=new Promise(resolve=>{started=resolve});
 let accountReads=0;
 const ownedPack={status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
  async listAccounts(){
   accountReads++;if(accountReads===1){started();await inFlight}
   return {state:'ready',accounts:[{providerId:'loomy',id:'slow-member-01',enabled:true}]};
  },
  listModels:async()=>({state:'ready',models:[{id:'free',isFree:true}]})};
 const pool=createAutoFreePool({getConfig:()=>cfg,ownedPack});
 const scan=pool.refresh();
 await sourceStarted;
 cfg=normalizeConfig({...cfg,sessionReuse:{ignoredIds:[id]}});
 release();
 await scan;
 assert.deepEqual(pool.snapshot().sourceAccounts,[],
  'a source account removed DURING an async scan must not be advertised');
 assert.deepEqual(pool.snapshot().models,[],
  'a free model from a stale private login cannot remain in cache');
 assert.equal(pool.effectiveConfig().accounts.length,0);
 assert.equal(pool.tiers().length,0);
 await pool.refresh();
 assert.equal(pool.snapshot().sourceAccounts.length,0);
 assert.ok(accountReads>=2,'the scan must recheck once when owner config changed mid-flight');
});
test('rapid owner changes during consecutive scans fail closed rather than publish a stale free account',async()=>{
 const id=sourceAccountOpaqueId('loomy','flapping-member-01');
 let cfg=normalizeConfig({embeddedPack:{enabled:true}}),reads=0;
 const ownedPack={status:()=>({state:'mounted',experimentalMultiAccountProviders:[]}),
  async listAccounts(){
   reads++;
   cfg=normalizeConfig({...cfg,sessionReuse:{ignoredIds:reads%2?[id]:[]}});
   return {state:'ready',accounts:[{providerId:'loomy',id:'flapping-member-01',enabled:true}]};
  },
  listModels:async()=>({state:'ready',models:[{id:'free',isFree:true}]})};
 const pool=createAutoFreePool({getConfig:()=>cfg,ownedPack});
 const result=await pool.refresh();
 assert.equal(result.state,'not_scanned','churning membership cannot be accepted as stable free evidence');
 assert.equal(result.models.length,0);
 assert.equal(pool.effectiveConfig().accounts.length,0);
 assert.equal(reads,2,'limit self-healing to two scans and avoid infinite retries');
});
test('multi-account owned-source inventory creates separate enabled account entries with no shadow Host login',async()=>{
 const config=normalizeConfig({embeddedPack:{enabled:true}});
 const own={
  status:()=>({state:'mounted',experimentalMultiAccountProviders:['loomy']}),
  async listAccounts(){return {state:'ready',accounts:[
   {providerId:'loomy',id:'lm-1',enabled:true},
   {providerId:'loomy',id:'lm-2',enabled:true}]}},
  async listModels(){return {state:'ready',models:[{id:'loomy-free',isFree:true}]}}
 };
 const pool=createAutoFreePool({getConfig:()=>config,ownedPack:own});
 await pool.refresh();
 const effective=pool.effectiveConfig();
 assert.equal(effective.providers.find(x=>x.id==='own_loomy').protocol,'native-channel');
 assert.deepEqual(effective.accounts.map(x=>x.id).sort(),[
  sourceAccountOpaqueId('loomy','lm-1'),
  sourceAccountOpaqueId('loomy','lm-2')].sort());
 assert.equal(effective.routes.length,0);
 assert.deepEqual(pool.tiers()[0].accountIds,[],'Host request will select and pin a verified exact owner account');
});
