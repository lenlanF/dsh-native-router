import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRules,qualifies,DEFAULT_TRIGGERS} from '../src/failover/rules.mjs';
import {attachHostFailover} from '../src/host-failover.mjs';
import {normalizeConfig} from '../src/config.mjs';

test('unavailable or uninstalled DSH Provider is a default failover trigger, while invalid requests stay terminal',()=>{
 const defaultRules=normalizeRules({enabled:true});
 assert.ok(DEFAULT_TRIGGERS.includes('PROVIDER_NOT_READY'));
 assert.equal(qualifies({code:'PROVIDER_NOT_READY'},defaultRules),true);
 assert.equal(qualifies({code:'AUTH',status:401},defaultRules),false);
 assert.equal(qualifies({code:'INVALID_REQUEST',status:503},defaultRules),false);
 assert.equal(qualifies({code:'CANCELLED'},defaultRules),false);
});
test('explicitly opted in authentication failure can use another configured Provider, never retry a failed model by default',()=>{
 const manual=normalizeRules({enabled:true,triggers:['AUTH','PROVIDER_NOT_READY']});
 assert.equal(qualifies({code:'AUTH',status:401},manual),true);
 assert.equal(qualifies({code:'AUTH',status:503},normalizeRules({enabled:true,triggers:['PROVIDER_NOT_READY']})),false);
 assert.equal(qualifies({code:'PROVIDER_NOT_READY'},normalizeRules({enabled:true,triggers:['QUOTA']})),false,
  'a user-specified trigger allowlist remains authoritative');
});
test('Agent request to an unregistered DSH Provider continues to the configured next model exactly once',async()=>{
 let selected={provider:'brokenHost',model:'uninstalled-model'};
 const selections=[],followups=[],events=new Map();
 const agent={id:'id',status:'idle',
  model:{current:()=>({...selected}),select(next){selected={...next};selections.push(next)}},
  followup(message){followups.push(message)}};
 let config=normalizeConfig({hostFailover:{enabled:true,mode:'off',priority:[
  {provider:'brokenHost',model:'uninstalled-model'},
  {provider:'workingHost',model:'available-model'},
 ]}});
 const ctx={agents:{get:()=>agent},llm:{resolveCallConfig:async()=>{}},
  logger:{info(){},warn(){}},
  on(event,fn){events.set(event,fn);return ()=>events.delete(event)}};
 const plugin=attachHostFailover(ctx,{configStore:{get:()=>structuredClone(config),
  replace:next=>{config=normalizeConfig(next)}},
  createUserMessage:async info=>({...info,id:'owned-retry-id'})});
 await events.get('agent/request-error')({
  agent,provider:'brokenHost',model:'uninstalled-model',
  turn:17,step:3,signal:{aborted:false},
  failure:{code:'PROVIDER_NOT_READY',message:'DSH Provider unloaded'}
 },async()=>({kind:'give-up'}));
 events.get('agent/status')({agent,status:'idle'});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(selected.provider,'workingHost');
 assert.equal(selected.model,'available-model');
 assert.equal(followups.length,1);
 assert.equal(followups[0].source.kind,'retry');
 assert.deepEqual(followups[0].content,[]);
 assert.equal(config.hostFailover.switchLog.length,1);
 assert.equal(config.hostFailover.switchLog[0].code,'PROVIDER_NOT_READY');
 events.get('agent/status')({agent,status:'idle'});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(followups.length,1,'idle repeats must not double-submit tool execution');
 plugin.dispose();
});
