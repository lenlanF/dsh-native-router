import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoFreePool,freeEvidence} from '../src/auto-free.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createRoutingEngine} from '../src/router.mjs';

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
