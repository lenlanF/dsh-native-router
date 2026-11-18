import test from 'node:test';
import assert from 'node:assert/strict';
import {attachHostFailover} from '../src/host-failover.mjs';
import {normalizeConfig} from '../src/config.mjs';

function harness(){
 const cfg=normalizeConfig({hostFailover:{enabled:true,mode:'off',priority:[
  {provider:'native-router',model:'chain:primary'},
  {provider:'native-router',model:'chain:backup'},
  {provider:'native-router',model:'chain:last'},
 ]}});
 const events=new Map(),selections=[],followups=[];
 let state=cfg,selection={provider:'native-router',model:'chain:primary'};
 const agent={id:'session',status:'idle',model:{
  current:()=>({...selection}),select(next){selection={...next};selections.push(next)},
 },followup(row){followups.push(row)}};
 const ctx={agents:{get:()=>agent},logger:{info(){},warn(){}},
  llm:{resolveCallConfig:async()=>{}},
  on(event,fn){events.set(event,fn);return()=>events.delete(event)}};
 const emit=(event,data,next=async()=>({kind:'give-up'}))=>events.get(event)(data,next);
 const plugin=attachHostFailover(ctx,{configStore:{
  get:()=>structuredClone(state),replace:value=>{state=normalizeConfig(value)},
 },createUserMessage:async args=>({id:'retry-'+(followups.length+1),...args})});
  return {ctx,agent,emit,selections,followups,plugin,get selection(){return selection},
    get config(){return structuredClone(state)},
    updateHost:change=>{state=normalizeConfig({...state,hostFailover:{...state.hostFailover,...change}})}};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const fail=h=>h.emit('agent/request-error',{agent:h.agent,
 provider:'native-router',model:'chain:primary',
 failure:{code:'SERVER',status:503},turn:5,step:2,signal:{aborted:false}});
test('human message while async model validation awaits prevents automatic retry and model change',async()=>{
 const h=harness();
 let release;
 h.ctx.llm.resolveCallConfig=()=>new Promise(resolve=>{release=resolve});
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});
 await pause();
 assert.equal(typeof release,'function');
 await h.emit('agent/inbox/inserted',{agent:h.agent,
  message:{source:{kind:'user'},content:[{type:'text',text:'new request'}]}});
 release();
 await pause();
 assert.equal(h.followups.length,0);
 assert.equal(h.selections.length,0);
 h.plugin.dispose();
});
test('repeated idle/error notifications never re-enqueue an already queued retry',async()=>{
 const h=harness();
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});
 await pause();
 assert.equal(h.followups.length,1);
 for(let i=0;i<4;i++)await h.emit('agent/status',{agent:h.agent,status:'idle'});
 await pause();
 assert.equal(h.followups.length,1);
  assert.equal(h.selection.model,'chain:backup');
  assert.equal(h.config.hostFailover.switchLog.length,1);
  assert.deepEqual({from:h.config.hostFailover.switchLog[0].from,
    to:h.config.hostFailover.switchLog[0].to,
    code:h.config.hostFailover.switchLog[0].code},{
      from:'native-router/chain:primary',to:'native-router/chain:backup',code:'SERVER'});
 h.plugin.dispose();
});
test('throwing followup fails closed without a second replay or quota-cycle',async()=>{
 const h=harness();
 h.agent.followup=()=>{throw Error('agent queue unavailable')};
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});
 await pause();
 assert.equal(h.selection.model,'chain:primary','roll back model selection when followup never succeeds');
 assert.equal(h.selections.filter(s=>s.model==='chain:last').length,0);
 assert.equal(h.plugin.states.get(h.agent).intent,undefined);
 h.plugin.dispose();
});
test('model selection validates target and continues to next candidate without executing tools',async()=>{
 const h=harness();
 h.ctx.llm.resolveCallConfig=async ({model})=>{
  if(model==='chain:backup')throw Error('not registered');
 };
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});
 await pause();
 assert.equal(h.selection.model,'chain:last');
 assert.equal(h.followups.length,1);
 assert.equal(h.followups[0].source.kind,'retry');
 assert.deepEqual(h.followups[0].content,[]);
 h.plugin.dispose();
});
test('settings can enable host failover dynamically inside the same DSH plugin lifecycle',async()=>{
 const h=harness();
 h.updateHost({enabled:false});
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});await pause();
 assert.equal(h.followups.length,0);
 h.updateHost({enabled:true});
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});await pause();
 assert.equal(h.followups.length,1);
 h.plugin.dispose();
});
test('after human input invalidates queued failover, only OUR stale retry is rejected at DSH pre-step',async()=>{
 const h=harness();
 await fail(h);
 await h.emit('agent/status',{agent:h.agent,status:'idle'});
 await pause();
 assert.equal(h.followups.length,1);
 const ours=h.followups[0];
 assert.ok(h.plugin.states.get(h.agent).ownedRetryIds.has(ours.id));
 await h.emit('agent/inbox/inserted',{agent:h.agent,
   message:{id:'new-human',source:{kind:'user'},content:[{type:'text',text:'stop and do a new task'}]}});
 assert.equal(h.plugin.states.get(h.agent).intent,undefined);
 const result=await h.emit('agent/pre-step',{
   agent:h.agent,messages:[ours],modelSelection:h.selection},async()=>({kind:'enter',messages:[ours]}));
 assert.deepEqual(result,{kind:'reject'});
 const external={id:'real-DSH-retry',source:{kind:'retry'},content:[]};
 const next=await h.emit('agent/pre-step',{
   agent:h.agent,messages:[external],modelSelection:h.selection},
   async()=>({kind:'enter',messages:[external]}));
 assert.deepEqual(next,{kind:'enter',messages:[external]});
 assert.equal(h.followups.length,1,'no second retry after competing human request');
 h.plugin.dispose();
});
