import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

const basicConfig={
 providers:[{id:'workbuddy',name:'WorkBuddy test driver',protocol:'native-channel',models:[]}],
 accounts:[{id:'wb1',providerId:'workbuddy',credentialRef:'driver:workbuddy:wb1'}],
 routes:[{id:'native',mode:'priority',tiers:[{providerId:'workbuddy',model:'native-model'}]}],
};
function fixture(driver,config=basicConfig){
 let current=normalizeConfig(config);
 const configStore={get:()=>structuredClone(current),replace:value=>(current=normalizeConfig(value))};
 const drivers=new Map([['workbuddy',driver]]);
 return {configStore,drivers,get cfg(){return current}};
}
test('native-channel config accepts opaque driver refs but rejects cross-provider refs and inline secrets',()=>{
 const c=normalizeConfig(basicConfig);
 assert.equal(c.providers[0].baseUrl,'');
 assert.equal(c.accounts[0].credentialRef,'driver:workbuddy:wb1');
 assert.throws(()=>normalizeConfig({...basicConfig,accounts:[{
  id:'bad',providerId:'workbuddy',credentialRef:'driver:other:wb1'}]}),/match its provider/);
 assert.throws(()=>normalizeConfig({providers:[{id:'generic',protocol:'openai-chat',baseUrl:'https://api.example.invalid/v1'}],
  accounts:[{id:'a',providerId:'generic',credentialRef:'driver:generic:tokenid'}],routes:[]}),/require native-channel/);
 assert.throws(()=>normalizeConfig({...basicConfig,accounts:[{
  id:'bad',providerId:'workbuddy',credentialRef:'driver:workbuddy:wb1',token:'secret'}]}),/Secrets/);
});
test('native driver model catalog and request stream operate through first-party DSH adapter',async()=>{
 const calls=[];
 const driver={
  listModels:async()=>[{id:'native-model'}],
  generate:async({provider,account,model,options})=>{
   calls.push({provider:provider.id,account:account.id,model,tools:options.tools});
   return {text:'driver completed',reasoning:'',finishReason:'stop',toolCalls:[],usage:{prompt_tokens:4,completion_tokens:2}};
  },
 };
 const r=fixture(driver);
 const adapter=createNativeRouterAdapter({configStore:r.configStore,channelDrivers:r.drivers});
 const models=await adapter.listModels();
 assert.ok(models.some(x=>x.id==='chain:native'));
 assert.ok(models.some(x=>x.id==='direct:workbuddy:native-model'));
 const events=[];
 for await(const e of adapter.stream({model:'chain:native',messages:[{role:'user',content:'hello'}]}))events.push(e);
 assert.equal(events.find(e=>e.type==='text-delta').text,'driver completed');
 assert.equal(calls[0].account,'wb1');
});
test('native driver cannot request unadvertised tool and does not execute tools itself',async()=>{
 const fake={generate:async()=>({text:'',reasoning:'',finishReason:'tool_calls',toolCalls:[
   {id:'evil-1',name:'secret_shell',arguments:'{}'}]})};
 const r=fixture(fake);
 const adapter=createNativeRouterAdapter({configStore:r.configStore,channelDrivers:r.drivers});
 const events=[];
 await assert.rejects(async()=>{
  for await(const e of adapter.stream({model:'chain:native',tools:[
    {name:'todo_write',parameters:{type:'object',properties:{}}}],
    messages:[{role:'user',content:'todo'}]}))events.push(e);
 },/Unadvertised/);
 assert.equal(events.length,0);
});
test('native driver missing never advertises phantom models or chains',async()=>{
 const r=fixture({});
 const adapter=createNativeRouterAdapter({configStore:r.configStore,channelDrivers:r.drivers});
 const models=await adapter.listModels();
 assert.equal(models.length,0);
});
test('discovery requires explicit scan and approval before an account joins the pool',async()=>{
 const called=[];
 const driver={
  generate:async()=>({text:'ok',finishReason:'stop',toolCalls:[]}),
  discover:async()=>[{id:'candidate_2',label:'Desktop account',source:'official_app',accessToken:'SENSITIVE'}],
  importCandidate:async({candidateId,consent})=>{
    called.push({candidateId,consent});
    return {id:'wb2',credentialRef:'driver:workbuddy:wb2'};
  },
  refresh:async()=>({state:'online',message:'官方登录态有效'}),
  login:async()=>({state:'online',message:'授权校验通过'}),
  logout:async()=>{},
 };
 const r=fixture(driver),center=createAccountCenter({configStore:r.configStore,drivers:r.drivers});
 await assert.rejects(()=>center.importCandidate('workbuddy','candidate_2'),error=>error.status===409);
 const found=await center.discover('workbuddy');
 assert.equal(found.imported,0);
 assert.equal(found.candidates.length,1);
 assert.doesNotMatch(JSON.stringify(found),/SENSITIVE/);
 assert.equal(r.cfg.accounts.length,1);
 const approved=await center.importCandidate('workbuddy','candidate_2');
 assert.equal(approved.id,'wb2');
 assert.equal(approved.enabled,false);
 assert.equal(r.cfg.accounts.length,2);
 assert.deepEqual(called,[{candidateId:'candidate_2',consent:true}]);
 assert.equal(center.list().pools.find(x=>x.providerId==='workbuddy').enabled,1);
 center.setEnabled('wb2',true);
 assert.equal(center.list().pools.find(x=>x.providerId==='workbuddy').enabled,2);
 assert.equal((await center.verify('wb2',{login:true})).state,'online');
 await assert.rejects(()=>center.importCandidate('workbuddy','candidate_2'),error=>error.status===409);
});
test('native driver logout removes plugin account binding after channel driver succeeds',async()=>{
 let calls=0;
 const driver={logout:async()=>{calls++;return {revokedUpstream:true}}};
 const r=fixture(driver);
 const center=createAccountCenter({configStore:r.configStore,drivers:r.drivers});
 const result=await center.logout('wb1');
 assert.equal(result.revokedUpstream,true);
 assert.equal(calls,1);
 assert.equal(r.cfg.accounts.length,0);
});

test('native registry subscribes to driver changes without credentials or automatic account imports',async()=>{
 const {registerNativeChannelDriver,getNativeChannelDrivers}=await import('../src/driver-registry.mjs');
 const {onNativeChannelDriverChange}=await import('../src/driver-registry.mjs');
 const events=[],unsub=onNativeChannelDriverChange((id,action)=>events.push(id+':'+action));
 const dispose=registerNativeChannelDriver('workbuddy',{generate:async()=>({text:'ok',finishReason:'stop',toolCalls:[]})});
 assert.equal(typeof getNativeChannelDrivers().get('workbuddy').generate,'function');
 assert.throws(()=>registerNativeChannelDriver('workbuddy',{refresh:async()=>({state:'online'})}),/already registered/);
 dispose();unsub();
 assert.deepEqual(events,['workbuddy:added','workbuddy:removed']);
 assert.equal(getNativeChannelDrivers().has('workbuddy'),false);
});
