import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkBuddyGrowthReader} from '../src/channels/workbuddy-growth.mjs';
import {createWorkBuddyDriver} from '../src/channels/workbuddy.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';

const auth={access:'FAKE_ACCESS_FOR_GROWTH_ACCOUNT_1234',uid:'USER_SYNTHETIC',
 domain:'www.workbuddy.cn',endpoint:'https://copilot.tencent.com'};
const account={id:'wbp_'+ 'a'.repeat(24),providerId:'own_workbuddy-cn',
 credentialRef:'driver:own_workbuddy-cn:wbp_'+'a'.repeat(24),enabled:true};

function fixture({ambiguous=false,travel=false}={}){
 const hits=[];let wallet=100,claimed=false,travelClaimed=false;
 const fetchImpl=async(url,init={})=>{
   const u=new URL(url),path=u.pathname;
   hits.push({path,method:init.method??'GET'});
   assert.equal(init.headers?.authorization,'Bearer '+auth.access);
   const ok=body=>new Response(JSON.stringify({code:0,data:body}),{status:200});
   if(path.endsWith('/growth/tasks')){
     return ok({tasks:[{task_code:'finished_free_task',title:'已完成免费任务',
       accept_status:claimed?'claimed':'completed',locked:false,reward_credit:40},
       {task_code:'unfinished_expensive',accept_status:'in_progress',
        locked:false,reward_credit:999999},
       {task_code:'locked_task',accept_status:'completed',locked:true,reward_credit:50}]});
   }
   if(path.endsWith('/growth/tasks/finished_free_task/claim')){
     assert.equal(init.method,'POST');assert.equal(claimed,false);
     claimed=true;wallet+=40;
     return ambiguous?new Response('',{status:503}):ok({});
   }
   if(path.endsWith('/growth/buddy/travel/status'))
     return ok({state:travel?(travelClaimed?'idle':'arrived'):'idle',
       record_id:travel?'TRAVEL_1234':undefined,
       reward_credit:travel?30:undefined});
   if(path.endsWith('/growth/buddy/travel/claim')){
     assert.equal(JSON.parse(init.body).record_id,'TRAVEL_1234');
     travelClaimed=true;wallet+=30;return ok({reward_credit:30});
   }
   if(path.endsWith('/v2/billing/meter/get-user-resource'))
     return ok({Response:{Data:{Accounts:[{
       PackageName:'免费额度',CapacityType:3,CapacityRemain:wallet,
       CapacitySize:200,ExpiredTime:'2027-11-30T00:00:00Z'}]}}});
   if(path.endsWith('/billing/meter/compensation-status')||
      path.endsWith('/billing/meter/check-gift-claimed'))
     return ok({active:false,claimed:false});
   if(path.endsWith('/v2/plugin/account')||
      path.endsWith('/v2/plugin/login/account'))return ok({uid:auth.uid,
       displayName:'成长中心测试会员'});
   throw Error('Unrecognized test-only route: '+path);
 };
 return {fetchImpl,hits,get wallet(){return wallet},get claimed(){return claimed}};
}
test('official growth discovery excludes unfinished, locked and unverifiable free tasks',async()=>{
 const f=fixture();
 const r=createWorkBuddyGrowthReader({fetchImpl:f.fetchImpl});
 const offers=await r.discover(auth,'cn');
 assert.equal(offers.length,1);
 assert.equal(offers[0].credit,40);
 assert.match(offers[0].kind,/^workbuddy_growth_task_[a-f0-9]{24}$/);
 assert.equal(offers[0].name,'已完成免费任务');
 assert.equal(f.hits.some(x=>x.method==='POST'),false,
   'read-only availability discovery must never submit claims');
 await assert.rejects(()=>r.discover(auth,'global'),/not been verified/);
 await assert.rejects(()=>r.discover({...auth,endpoint:'https://evil.example'},'cn'),
   /Unrecognized/);
});
test('growth task official claim requires durable receipt, verified claimed state and exact wallet increase',async()=>{
 const f=fixture(),r=createWorkBuddyGrowthReader({fetchImpl:f.fetchImpl});
 const receipt=createActivityClaimStore({path:null});
 const driver=createWorkBuddyDriver({ownedRegion:'cn',makeCredentialRef:x=>x,
   ownedVault:{resolve:async()=>({value:JSON.stringify({
     domain:'www.workbuddy.cn',accessToken:auth.access,uid:auth.uid,
     expiresAt:Math.floor(Date.now()/1000)+7200})})},
   fetchImpl:f.fetchImpl});
 const io={
  beforeClaim:(offer,meta)=>receipt.begin(account,offer,meta),
  onOutcome:(offer,state,meta)=>receipt.finish(account,offer,state,meta),
  onObserved:(offer,state,meta)=>receipt.finish(account,offer,state,meta),
  previousReceipt:offer=>receipt.receipt(account,offer)
 };
 const result=await driver.claimActivities({account,...io});
 assert.equal(result.confirmed,1);
 assert.equal(result.pending,0);
 assert.equal(f.wallet,140);
 assert.equal(f.hits.filter(x=>x.path.endsWith('/tasks/finished_free_task/claim')).length,1);
 assert.ok(f.hits.every(x=>!/unfinished_expensive|\/travel\/depart|lottery\/draw|buddy\/open/.test(x.path)));
 const again=await driver.claimActivities({account,...io});
 assert.equal(again.confirmed,0);
 assert.equal(f.hits.filter(x=>x.path.endsWith('/tasks/finished_free_task/claim')).length,1);
 assert.equal(receipt.summary(account).confirmed,1);
 const publicAccount=await driver.refreshAccountStatus({account});
 const benefits=publicAccount?.benefits??driver.accountSnapshot(account)?.benefits??[];
 assert.ok(benefits.some(x=>x.kind.startsWith('workbuddy_growth_task_')&&x.claimed===true));
});
test('ambiguous growth POST stays pending, never replays and is later reconciled by official wallet',async()=>{
 const f=fixture({ambiguous:true}),r=createWorkBuddyDriver({ownedRegion:'cn',
  makeCredentialRef:x=>x,ownedVault:{resolve:async()=>({value:JSON.stringify({
    domain:'www.workbuddy.cn',accessToken:auth.access,uid:auth.uid,
    expiresAt:Math.floor(Date.now()/1000)+7200})})},fetchImpl:f.fetchImpl});
 const store=createActivityClaimStore({path:null});
 const io={beforeClaim:(o,m)=>store.begin(account,o,m),
  onOutcome:(o,state,meta)=>store.finish(account,o,state,meta),
  onObserved:(o,state,meta)=>store.finish(account,o,state,meta),
  previousReceipt:o=>store.receipt(account,o)};
 const first=await r.claimActivities({account,...io});
 assert.equal(first.pending,1);
 assert.equal(store.summary(account).unconfirmed,1);
 assert.equal(f.wallet,140);
 const second=await r.claimActivities({account,...io});
 assert.equal(second.confirmed,0);
 assert.equal(store.summary(account).confirmed,1,
  'claim official status and exact balance increase reconcile submitted receipt');
 assert.equal(f.hits.filter(x=>x.path.endsWith('/finished_free_task/claim')).length,1,
  'no ambiguous POST retry, even when status already claimed');
});
test('already-arrived free Buddy travel gift can be claimed; travel is never dispatched',async()=>{
 const f=fixture({travel:true});
 const g=createWorkBuddyGrowthReader({fetchImpl:f.fetchImpl});
 const offers=await g.discover(auth,'cn');
 assert.equal(offers.length,2);
 const travel=offers.find(o=>o.kind.startsWith('workbuddy_growth_travel_'));
 assert.equal(travel.credit,30);
 const outcome=await g.claim(auth,'cn',travel);
 assert.equal(outcome.confirmed,true);
 assert.equal(outcome.credit,30);
 assert.equal(f.wallet,130);
 assert.equal(f.hits.filter(x=>x.path.endsWith('/travel/claim')).length,1);
 assert.equal(f.hits.some(x=>/travel\/depart|lottery|buddy\/open/.test(x.path)),false);
});
