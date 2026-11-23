import test from 'node:test';
import assert from 'node:assert/strict';
import {readLoomyFreeTasks,claimLoomyFreeTasks,LOOMY_FREE_TASKS}
 from '../src/channels/loomy-rewards.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';

const credential={access_token:['FAKE','LOOMY','TEST','TOKEN'].join('_')};
const ok=data=>new Response(JSON.stringify({code:'000000',data}),{status:200});
test('Loomy eight independent on-board offers total official 10000 points',()=>{
 assert.equal(Object.keys(LOOMY_FREE_TASKS).length,8);
 assert.equal(Object.values(LOOMY_FREE_TASKS).reduce((s,r)=>s+r.points,0),10000);
});
test('Loomy GET task snapshot only includes exact official boolean states',async()=>{
 const fetchImpl=async (url,opts)=>{
  assert.equal(url,'https://loomyad.xunfei.cn/api/v1/onboarding/tasks');
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  return ok({tasks:{first_message:true,pick_skill:false,unknown_task:false,
    share_soul:'false'}});
 };
 const out=await readLoomyFreeTasks({credential,fetchImpl});
 assert.equal(out.state,'available');assert.equal(out.tasks.length,2);
 assert.equal(out.tasks[0].claimed,true);
 assert.equal(out.tasks[1].claimed,false);
 assert.equal(out.tasks[1].credit,1000);
 assert.equal(JSON.stringify(out).includes('unknown_task'),false);
});
test('Loomy silent official POST complete verifies every offer by fresh task GET, with durable no-repeat ledger',async()=>{
 const statuses=Object.fromEntries(Object.keys(LOOMY_FREE_TASKS).map(k=>[k,false]));
 let posts=0;const calls=[];
 const fetchImpl=async (url,opts)=>{
  calls.push({url,method:opts.method});
  assert.ok(url.startsWith('https://loomyad.xunfei.cn/api/v1/onboarding/tasks'));
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.token,credential.access_token);
  if(opts.method==='GET')return ok({tasks:statuses,earned:Object.entries(statuses)
    .reduce((s,[k,v])=>s+(v?LOOMY_FREE_TASKS[k].points:0),0)});
  assert.equal(opts.method,'POST');assert.ok(url.endsWith('/complete'));
  const body=JSON.parse(opts.body);assert.deepEqual(Object.keys(body),['key']);
  assert.ok(Object.hasOwn(LOOMY_FREE_TASKS,body.key));posts++;
  statuses[body.key]=true;
  return ok({alreadyCompleted:false,balance:0});
 };
 const store=createActivityClaimStore({path:null});
 const account={providerId:'own_loomy',id:'source_test_loomy',
  credentialRef:'source:loomy:account'};
 const claim=()=>claimLoomyFreeTasks({credential,fetchImpl,
  beforeClaim:offer=>store.begin(account,offer),
  onOutcome:(offer,state)=>store.finish(account,offer,state),
  onObserved:(offer,state)=>store.finish(account,offer,state)});
 const result=await claim();
 assert.equal(result.state,'confirmed');
 assert.equal(result.confirmed,8);assert.equal(result.pending,0);
 assert.equal(posts,8);assert.equal(store.summary(account).confirmed,8);
 const again=await claim();
 assert.equal(again.state,'no_task');
 assert.equal(posts,8,'previous confirmed points cannot post twice');
 assert.ok(calls.every(c=>c.method==='GET'||c.url.endsWith('/tasks/complete')));
 assert.ok(calls.every(c=>!/(?:checkout|purchase|pay|share|chat|ppt|cron|schedule)/i
   .test(c.url)));
});
test('Loomy failed remote POST is treated as pending and not replayed even after status polling',async()=>{
 const statuses={first_message:false};let posts=0,readCount=0;
 const fetchImpl=async(url,opts)=>{
  if(opts.method==='GET'){readCount++;return ok({tasks:statuses})}
  posts++;return new Response('',{status:503});
 };
 const store=createActivityClaimStore({path:null});
 const account={providerId:'own_loomy',id:'one',credentialRef:'source:loomy:one'};
 const opts={credential,fetchImpl,beforeClaim:offer=>store.begin(account,offer),
  onOutcome:(offer,state)=>store.finish(account,offer,state),
  onObserved:(offer,state)=>store.finish(account,offer,state)};
 const first=await claimLoomyFreeTasks(opts);
 assert.equal(first.pending,1);assert.equal(posts,1);
 assert.equal(store.summary(account).unconfirmed,1);
 const retry=await claimLoomyFreeTasks(opts);
 assert.equal(retry.confirmed,0);assert.equal(posts,1);
 statuses.first_message=true;
 await claimLoomyFreeTasks(opts);
 assert.equal(store.summary(account).confirmed,1);
 assert.equal(posts,1);assert.ok(readCount>2);
});
test('Loomy stops after the first rejected API-only completion, never floods the other seven offers',async()=>{
 const tasks={first_message:false,pick_skill:false,generate_ppt:false};
 let posts=0;
 const result=await claimLoomyFreeTasks({credential,
  fetchImpl:async(_url,opts)=>{
   if(opts.method==='GET')return ok({tasks});
   posts++;
   return new Response(JSON.stringify({code:'TASK_REQUIRES_REAL_ACTION'}),{status:400});
  },beforeClaim:()=>true});
 assert.equal(result.state,'pending_confirmation');
 assert.equal(result.pending,1);
 assert.equal(posts,1,'a rejected simulated completion must not trigger the rest');
});

test('Loomy rejects non-official envelope and unusable access tokens without submitting rewards',async()=>{
 let posts=0;
 const fetchImpl=async(_url,opts)=>{if(opts.method==='POST')posts++;
  return new Response(JSON.stringify({code:'NOT_OK',data:{tasks:{first_message:false}}}))};
 const out=await claimLoomyFreeTasks({credential,fetchImpl,beforeClaim:()=>true});
 assert.equal(out.state,'unavailable');
 assert.equal(posts,0);
 const missing=await readLoomyFreeTasks({
  credential:{access_token:'\nBAD'},
  fetchImpl:()=>{throw Error('not expected')}});
 assert.equal(missing.state,'unavailable');
});
