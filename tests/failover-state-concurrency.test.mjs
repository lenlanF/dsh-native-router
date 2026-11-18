import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateStore,requestDrive,recordIntent,noteIncoming} from '../src/failover/state.mjs';
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const setup=()=>{
 const agent={id:'isolated-agent',status:'running'};
 const state=createStateStore().stateFor(agent);
 recordIntent(state,{agent,provider:'fake',turn:1,step:2,signal:{aborted:false}},
  {code:'SERVER',status:503,message:'synthetic failure'});
 return state;
};
test('real AgentLoop agent/error while running plus idle before first drive settles is never lost',async()=>{
 const state=setup();
 let calls=0,release;
 const first=new Promise(resolve=>{release=resolve});
 const drive=async()=>{
  calls++;
  if(calls===1)await first; // Actual first failed intent may still be running.
  if(state.agent.status==='idle')state.intent.queuedMessageId='alpha18-retry-1';
 };
 requestDrive(state,drive);
 await pause();
 assert.equal(calls,1);
 assert.equal(state.agent.status,'running');
 state.agent.status='idle';
 for(let i=0;i<3;i++)requestDrive(state,drive);
 assert.equal(state.rerunPending,true,'idle arrival during the first in-flight drive must queue a final run');
 release();
 await pause();
 assert.equal(calls,2,'coalesced rerun exactly once after the pending run exits');
 assert.equal(state.intent.queuedMessageId,'alpha18-retry-1');
 assert.equal(state.running,undefined);
 assert.equal(state.rerunPending,false);
});
test('unexpected driver exception fails closed, never leaks an unhandled rejection or resends',async()=>{
 const state=setup();
 let warnings=0,calls=0;
 requestDrive(state,async()=>{calls++;throw Error('SYNTHETIC_PRIVATE_EXCEPTION')},()=>warnings++);
 await pause();
 assert.equal(calls,1);
 assert.equal(warnings,1);
 assert.equal(state.intent,undefined);
 assert.equal(state.driverFailed,true);
 assert.equal(state.running,undefined);
});
test('external DSH retry supersedes our pending intent, our own retry does not',()=>{
 const state=setup();
 state.ownedRetryIds.add('native-router-generated');
 assert.equal(noteIncoming(state,{id:'native-router-generated',source:{kind:'retry'}}),false);
 assert.ok(state.intent,'our own queued message must not cancel our intent');
 assert.equal(noteIncoming(state,{id:'another-DSH-component',source:{kind:'retry'}}),true);
 assert.equal(state.intent,undefined);
});
test('stopped agent cannot be rescheduled by an idle notification',async()=>{
 const state=setup();
 let calls=0;
 state.stopping=true;
 requestDrive(state,async()=>{calls++});
 await pause();
 assert.equal(calls,0);
 assert.equal(state.running,undefined);
});
