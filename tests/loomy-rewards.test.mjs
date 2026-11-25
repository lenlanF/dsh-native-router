import test from 'node:test';
import assert from 'node:assert/strict';
import {readLoomyFreeTasks,readLoomyWallet,claimLoomyFreeTasks,LOOMY_FREE_TASKS}
 from '../src/channels/loomy-rewards.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';

const credential={access_token:['FAKE','LOOMY','TEST','TOKEN'].join('_')};
const ok=data=>new Response(JSON.stringify({code:'000000',data}),{status:200});
test('Loomy wallet accepts decimal strings and refuses nonnumeric or negative balances',async()=>{
 for(const balance of ['1200','1200.25',1200.25])assert.deepEqual(await readLoomyWallet({credential,fetchImpl:async()=>ok({balance})}),{state:'available',permanent:Number(balance)});
 for(const balance of ['',null,'-1','1e6',' 12 ',Infinity])assert.deepEqual(await readLoomyWallet({credential,fetchImpl:async()=>ok({balance})}),{state:'unavailable'});
});
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
test('Loomy unperformed onboarding offers remain manual even when local auto-claim is enabled',async()=>{
 const tasks=Object.fromEntries(Object.keys(LOOMY_FREE_TASKS).map(k=>[k,false]));
 let posts=0,approvals=0;
 const fetchImpl=async(url,opts)=>{if(opts.method!=='GET')posts++;return url.includes('/points/records')?ok({balance:0}):ok({tasks})};
 const r=await claimLoomyFreeTasks({credential,fetchImpl,beforeClaim:()=>{approvals++;return true}});
 assert.equal(r.state,'client_required');assert.equal(r.eligible,8);assert.equal(r.confirmed,0);assert.equal(posts,0);assert.equal(approvals,0);
});
test('Loomy historical ambiguous task receipts remain pending even when aggregate balance increases',async()=>{
 let observed=0;
 const r=await claimLoomyFreeTasks({credential,fetchImpl:async(url,opts)=>{assert.equal(opts.method,'GET');return url.includes('/points/records')?ok({balance:500}):ok({tasks:{first_message:true}})},previousReceipt:()=>({state:'submitted',baselineBalance:0}),onObserved:()=>{observed++}});
 assert.equal(r.state,'pending_confirmation');assert.equal(r.pending,1);assert.equal(observed,0);
});

test('no official wallet statement means zero task completion POSTs',async()=>{
 let posts=0;
 const result=await claimLoomyFreeTasks({credential,
   fetchImpl:async(url,opts)=>{
     if(opts.method==='POST')posts++;
     return url.includes('/points/records')?new Response('',{status:503}):
       ok({tasks:{first_message:false}});
   },beforeClaim:()=>true});
 assert.equal(result.state,'unavailable');
 assert.equal(posts,0);
 assert.deepEqual(await readLoomyWallet({credential,
   fetchImpl:async()=>new Response('unexpected',{status:503})}),
   {state:'unavailable'});
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
