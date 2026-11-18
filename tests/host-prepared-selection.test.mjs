import test from 'node:test';
import assert from 'node:assert/strict';
import {attachHostFailover} from '../src/host-failover.mjs';
import {normalizeConfig} from '../src/config.mjs';

function harness(mode='free'){
 const listeners=new Map();
 const selections=[];
 let selected={provider:'paid',model:'expensive'};
 let cfg=normalizeConfig({hostFailover:{enabled:true,mode,priority:[
  {provider:'free',model:'model-a',free:true},
  {provider:'free',model:'model-b',free:true},
  {provider:'paid',model:'expensive',free:false},
 ]}});
 const agent={
  id:'session',status:'idle',model:{
   current:()=>({...selected}),select:s=>{selected={...s};selections.push(s)},
  },followup(){throw Error('free-mode admission must not submit a retry')},
 };
 const ctx={on:(event,fn)=>{listeners.set(event,fn);return()=>listeners.delete(event)},
  logger:{warn(){},info(){}}};
 const plugin=attachHostFailover(ctx,{configStore:{
  get:()=>structuredClone(cfg),replace:next=>{cfg=normalizeConfig(next)},
 }});
 const emit=(name,payload,next)=>listeners.get(name)?.(payload,next);
 return {ctx,agent,emit,plugin,selections,
  get selected(){return structuredClone(selected)},
  changeHost:change=>{cfg=normalizeConfig({...cfg,hostFailover:{...cfg.hostFailover,...change}})},
 };
}
const user={id:'u1',source:{kind:'user'},content:[{type:'text',text:'real user prompt'}]};
test('Agent created chooses a permitted free route before any DSH step is prepared',async()=>{
 const h=harness('free');
 await h.emit('agent/created',{agent:h.agent});
 assert.deepEqual(h.selected,{provider:'free',model:'model-a'});
 const captured=h.selected;
 const result=await h.emit('agent/pre-step',{agent:h.agent,messages:[user],modelSelection:captured},
  async()=>({kind:'enter',messages:[user]}));
 assert.equal(result.kind,'enter');
 assert.deepEqual(result.messages,[user]);
 h.plugin.dispose();
});
test('new Agent inbox input synchronously selects model ahead of DSH route capture',async()=>{
 const h=harness('pinned');
 h.changeHost({priority:[{provider:'free',model:'model-a',free:true}]});
 await h.emit('agent/inbox/inserted',{agent:h.agent,message:user});
 assert.equal(h.selected.model,'model-a');
 assert.equal(h.selections.length,1);
 h.plugin.dispose();
});
test('DSH prepared paid route cannot bypass free mode even if model.current was changed after preparation',async()=>{
 const h=harness('free');
 const captured=h.selected;
 await h.emit('agent/inbox/inserted',{agent:h.agent,message:user});
 assert.equal(h.selected.provider,'free');
 let downstreamCalled=false;
 const result=await h.emit('agent/pre-step',{
  agent:h.agent,messages:[user],modelSelection:captured,turn:1,step:1,
 },async()=>{downstreamCalled=true;return {kind:'enter',messages:[user]}});
 assert.equal(downstreamCalled,false);
 assert.deepEqual(result,{kind:'reject'});
 assert.equal(h.selections.length,1,'pre-step must not select a new model that cannot affect captured request');
 h.plugin.dispose();
});
test('captured allowed route remains valid after a future model selection, without rewriting prepared step',async()=>{
 const h=harness('pinned');
 await h.emit('agent/created',{agent:h.agent});
 const captured=h.selected;
 h.agent.model.select({provider:'paid',model:'expensive'});
 const result=await h.emit('agent/pre-step',{agent:h.agent,messages:[user],modelSelection:captured},
  async()=>({kind:'enter',messages:[user]}));
 assert.equal(result.kind,'enter');
 h.plugin.dispose();
});
test('no explicit free model rejects without emitting a paid model request',async()=>{
 const h=harness('free');
 h.changeHost({priority:[{provider:'paid',model:'expensive'}]});
 await h.emit('agent/created',{agent:h.agent});
 const result=await h.emit('agent/pre-step',{agent:h.agent,messages:[user],modelSelection:h.selected},
  async()=>({kind:'enter',messages:[user]}));
 assert.deepEqual(result,{kind:'reject'});
 assert.equal(h.selections.length,0);
 h.plugin.dispose();
});
test('mode off keeps normal DSH model choice and complete identified batch',async()=>{
 const h=harness('off');
 await h.emit('agent/inbox/inserted',{agent:h.agent,message:user});
 assert.equal(h.selected.provider,'paid');
 const result=await h.emit('agent/pre-step',{agent:h.agent,messages:[user],modelSelection:h.selected});
 assert.deepEqual(result,{kind:'enter',messages:[user]});
 h.plugin.dispose();
});
test('retry from DSH or another installed plugin remains permitted when not owned by native router',async()=>{
 const h=harness('off');
 const external={id:'external-DSH-retry',source:{kind:'retry'},content:[]};
 const result=await h.emit('agent/pre-step',{agent:h.agent,
  messages:[external],modelSelection:h.selected},
  async()=>({kind:'enter',messages:[external]}));
 assert.deepEqual(result,{kind:'enter',messages:[external]});
 h.plugin.dispose();
});
