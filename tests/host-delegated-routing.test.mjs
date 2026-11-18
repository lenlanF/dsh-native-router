import test from 'node:test';
import assert from 'node:assert/strict';
import {createExistingDshChannelFacade} from '../src/existing-dsh-channels.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

function fixture(){
 const models=['host-flash'];
 const cfg=normalizeConfig({
  providers:[{id:'workbuddy-global',name:'WorkBuddy 国际',protocol:'dsh-host',
   models,enabled:true,supportsTools:true}],
  routes:[{id:'host_wb',name:'复用宿主模型链',enabled:true,mode:'priority',
   maxSwitches:2,tiers:[{providerId:'workbuddy-global',model:'host-flash',
    free:false,accountIds:[]}]}],
  accounts:[],
 });
 const requests=[];
 let registered=true;
 const llm={
  listProviders(){return registered?[{id:'workbuddy-global'},{id:'native-router'}]:[{id:'native-router'}]},
  listModels:async()=>[{id:'host-flash',provider:'workbuddy-global'}],
  async *stream(options){
   requests.push(options);
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text:'hello via original provider'};
   yield {type:'block-end',index:0,block:{type:'text',text:'hello via original provider'}};
   yield {type:'finish',reason:{kind:'stop'}};
  }
 };
 const source=createExistingDshChannelFacade({ctx:{llm,get:()=>undefined}});
 const adapter=createNativeRouterAdapter({configStore:{get:()=>cfg},hostProviderInventory:source,
  vault:{resolve(){throw Error('MUST NOT ACCESS CREDENTIALS')}}});
 return {source,adapter,requests,unregister:()=>{registered=false}};
}
test('accountless registered host plugin publishes real aggregate models and delegates a completed DSH stream',async()=>{
 const rig=fixture();
 const list=await rig.adapter.listModels();
 assert.ok(list.some(model=>model.id==='chain:host_wb'));
 assert.ok(list.some(model=>model.id==='direct:workbuddy-global:host-flash'));
 const options={model:'chain:host_wb',sessionId:'session-test-01',
  messages:[{role:'user',content:[{type:'text',text:'ping'}]}],tools:[]};
 const events=[];
 for await(const event of rig.adapter.stream(options))events.push(event);
 assert.equal(rig.requests.length,1);
 assert.equal(rig.requests[0].provider,'workbuddy-global');
 assert.equal(rig.requests[0].model,'host-flash');
 assert.equal(rig.requests[0].messages[0].role,'user');
 assert.equal(rig.requests[0].messages[0].content[0].text,'ping');
 assert.equal(events.find(x=>x.type==='text-delta')?.text,'hello via original provider');
 assert.deepEqual(events.at(-1),{type:'finish',reason:{kind:'stop'}});
 assert.equal(rig.adapter.getStatus().metrics.successfulTurns,1);
 rig.source.dispose();
});
test('native-router does not create shadow credentials and rejects removed or unregistered host providers',async()=>{
 assert.throws(()=>normalizeConfig({providers:[{id:'wb',protocol:'dsh-host',models:['test']}],
  accounts:[{id:'bad',providerId:'wb',credentialRef:'host:any'}]}),/shadow accounts/);
 const rig=fixture();
 rig.unregister();
 assert.deepEqual((await rig.adapter.listModels()).filter(x=>x.id!=='autofree'),[]);
 await assert.rejects(async()=>{for await(const _ of rig.adapter.stream({
  model:'chain:host_wb',messages:[{role:'user',content:[{type:'text',text:'ping'}]}]
 })){}},/not available|Original DSH plugin request failed|unavailable/);
 assert.equal(rig.requests.length,0);
 rig.source.dispose();
});
test('registered host provider removed between model discovery and generation fails closed',async()=>{
 const rig=fixture();
 assert.equal((await rig.adapter.listModels()).filter(x=>x.id!=='autofree').length,2);
 rig.unregister();
 await assert.rejects(async()=>{for await(const _ of rig.adapter.stream({
  model:'direct:workbuddy-global:host-flash',messages:[{role:'user',content:[{type:'text',text:'ping'}]}]
 })){}});
 assert.equal(rig.requests.length,0);
 rig.source.dispose();
});
