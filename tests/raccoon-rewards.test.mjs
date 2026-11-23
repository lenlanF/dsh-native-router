import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRaccoonLoginTask,readRaccoonLoginTask}
 from '../src/channels/raccoon-rewards.mjs';

const body=status=>({code:0,data:{new_user_task_states:[
 {key:'desktop_login',status}]}});
// Build synthetic bytes at runtime so the public privacy audit does not
// mistake a credential-shaped example for a saved production secret.
const syntheticBearer=['FAKE','RACCOON','BEARER','LONG','TOKEN'].join('_');

test('only exact official Raccoon task completion settles a free login reward',()=>{
 assert.deepEqual(parseRaccoonLoginTask(body('completed')),{state:'completed'});
 for(const status of ['pending','not_started','not_completed','uncompleted','incomplete','available','todo'])
  assert.deepEqual(parseRaccoonLoginTask(body(status)),{state:'pending'});
 for(const malformed of [null,{},{code:-1,data:{new_user_task_states:[{key:'desktop_login',
 status:'completed'}]}},{code:0,data:{new_user_task_states:[]}},
 {code:0,data:{new_user_task_states:[{key:'desktop_login',status:'UNKNOWN'}]}},
 {code:0,data:{new_user_task_states:[
   {key:'desktop_login',status:'completed'},{key:'desktop_login',status:'pending'}]}}])
  assert.deepEqual(parseRaccoonLoginTask(malformed),{state:'unavailable'});
});

test('Raccoon task verifier only performs a bounded official GET and never returns auth secrets',async()=>{
 let hits=0;
 const credential={access_token:syntheticBearer,
  office_identity:'org_42'};
 const result=await readRaccoonLoginTask({credential,fetchImpl:async(url,options)=>{
  hits++;
  assert.equal(url,'https://xiaohuanxiong.com/api/web/points/v1/tasks');
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+credential.access_token);
  assert.equal(options.headers['X-Org-Code'],'org_42');
  assert.ok(options.signal);
  return new Response(JSON.stringify(body('completed')),{status:200});
 }});
 assert.deepEqual(result,{state:'completed'});
 assert.equal(hits,1);
 assert.doesNotMatch(JSON.stringify(result),/RACCOON|TOKEN|org_42/);
});


test('Raccoon free daily trigger only sends official GET requests, never purchase or model calls',async()=>{
 const calls=[];
 const credential={access_token:syntheticBearer};
 const {triggerRaccoonFreeDaily}=await import('../src/channels/raccoon-rewards.mjs');
 const result=await triggerRaccoonFreeDaily({credential,fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method});
  assert.equal(options.method,'GET');
  assert.match(url,/^https:\/\/xiaohuanxiong\.com\/api\/web\/(?:auth|office)\//);
  assert.equal(options.headers.Authorization,'Bearer '+credential.access_token);
  return new Response('{}',{status:200});
 }});
 assert.equal(result.state,'triggered');
 assert.equal(calls.length,4);
 assert.ok(!JSON.stringify(calls).match(/checkout|purchase|pay|credit\/grant|chat\/completions|POST/i));
});
test('Raccoon free daily trigger with no official success is not a confirmed grant',async()=>{
 const {triggerRaccoonFreeDaily}=await import('../src/channels/raccoon-rewards.mjs');
 const result=await triggerRaccoonFreeDaily({
  credential:{access_token:syntheticBearer},
  fetchImpl:async()=>new Response('',{status:503})});
 assert.equal(result.state,'unavailable');
});

test('a failed or ambiguous Raccoon task query never becomes completed',async()=>{
 const credential={access_token:syntheticBearer};
 for(const handler of [
  async()=>new Response('',{status:503}),
  async()=>new Response('unexpected',{status:200}),
  async()=>new Response(JSON.stringify({code:0,data:{new_user_task_states:[]}})),
  async()=>{throw Error('FAKE_PRIVATE_ORIGINAL_ACCOUNT_TOKEN')},
 ]){
  const result=await readRaccoonLoginTask({credential,fetchImpl:handler});
  assert.deepEqual(result,{state:'unavailable'});
 }
 let requests=0;
 assert.deepEqual(await readRaccoonLoginTask({
  credential:{access_token:'\r\nPoison'},
  fetchImpl:async()=>{requests++;return new Response('{}')}
 }),{state:'unavailable'});
 assert.equal(requests,0);
});
