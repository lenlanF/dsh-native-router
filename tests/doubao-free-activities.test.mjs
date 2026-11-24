import test from 'node:test';
import assert from 'node:assert/strict';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';
import {completedDoubaoRewards} from '../src/channels/doubao-upstream.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';
const cookie='sessionid=SYNTHETIC_TEST_DOUYIN_SESSION_123; uid_tt=12341234';
function fixture({postFails=false,noGrant=false}={}){
 const values=new Map(),calls=[];let wallet=100,claimed=false;
 const vault={resolve:async k=>values.get(k),set:async(k,v)=>values.set(k,{value:v}),
  unset:async k=>values.delete(k)};
 const data=x=>new Response(JSON.stringify({code:0,data:x}),{status:200});
 const fetchImpl=async(url,init={})=>{
  const path=new URL(url).pathname;calls.push({path,body:init.body});
  assert.equal(new URL(url).origin,'https://www.doubao.com');
  if(path==='/passport/account/info/v2/')return data({
    user_id_str:'member-free-001',screen_name:'豆包免费会员'});
  if(path==='/alice/user/launch')return data({ug_campaign_info:{
    campaign_group_code:'pc_incentive_task_mvp_v3'}});
  if(path==='/alice/ug/campaign/v3/detail')return data({
    campaign_code:'pc_incentive_task_mvp_v3',
    tasks:[{campaign_code:'daily_signin',task_kind:'daily_signin',
      task_status:1,daily_checkin:{checked_in_today:true}},
      {campaign_code:'done_free_task',title:'免费签到已完成任务',task_status:claimed?3:2,
       reward_summaries:[{reward_amount:20}]},
      {campaign_code:'incomplete_task',task_status:1,
       reward_summaries:[{reward_amount:99999}]},
      {campaign_code:'unknown_reward',task_status:2,reward_summaries:[]}]});
  if(path==='/alice/commerce/sale/subscription/quota/summary/')
    return data({incentive_quota_section:noGrant?{}:{window_limit_groups:[{
     feature_group_name:'免费赠送额度',window_limits:[{window_type:3,
       total_amount:200,used_amount:200-wallet}]}]}});
  if(path==='/alice/ug/campaign/item/reward/claim/'){
    assert.equal(init.method,'POST');
    const sent=JSON.parse(init.body);
    assert.deepEqual([sent.campaign_group_code,sent.campaign_item_code],
      ['pc_incentive_task_mvp_v3','done_free_task']);
    assert.equal(claimed,false);claimed=true;wallet+=20;
    return postFails?new Response('',{status:503}):data({});
  }
  throw Error('unexpected Doubao campaign route: '+path);
 };
 const driver=createDoubaoDriver({vault,fetchImpl});
 const receipts=createActivityClaimStore({path:null});
 const callbacks={beforeClaim:(o,m)=>receipts.begin(account,o,m),
   onOutcome:(o,state,meta)=>receipts.finish(account,o,state,meta),
   onObserved:(o,state,meta)=>receipts.finish(account,o,state,meta),
   previousReceipt:o=>receipts.receipt(account,o)};
 let account=null;
 return {driver,receipts,callbacks,calls,async login(){
  const registered=await driver.addCookie({cookie});account={
    id:registered.id,providerId:registered.providerId,
    credentialRef:registered.credentialRef};
  return account;
 },completeOfficial(){claimed=true;wallet+=20},get wallet(){return wallet},get claimed(){return claimed}};
}
test('Doubao only considers official completed, known-value campaign reward; never executes task',()=>{
 const result=completedDoubaoRewards({group:'pc_incentive_task_mvp_v3',
  tasks:[{code:'done',group:'pc_incentive_task_mvp_v3',status:2,
    reward:[{reward_amount:25}],title:'完成领取'},
   {code:'not_done',group:'pc_incentive_task_mvp_v3',status:1,
    reward:[{reward_amount:1000}]},
   {code:'unknown',group:'pc_incentive_task_mvp_v3',status:2,reward:[]},
   {code:'evil/special',group:'pc_incentive_task_mvp_v3',status:2,
    reward:[{reward_amount:20}]}]});
 assert.deepEqual(result.map(x=>x.code),['done']);
});
test('Doubao PC-only completed tasks discovered without any plugin reward claim',async()=>{
 const rig=fixture(),account=await rig.login();
 for(let i=0;i<2;i++){
  const result=await rig.driver.claimActivities({account,...rig.callbacks});
  assert.equal(result.state,'client_required');assert.equal(result.confirmed,0);
 }
 assert.equal(rig.wallet,100);assert.equal(rig.receipts.summary(account).confirmed,0);
 assert.equal(rig.calls.filter(x=>x.path.endsWith('/item/reward/claim/')).length,0);
});
test('Doubao previous uncertain receipt reconciles after official completion and exact wallet delta',async()=>{
 const rig=fixture(),account=await rig.login();
 await rig.driver.claimActivities({account,...rig.callbacks});
 const offer=rig.driver.accountSnapshot(account).benefits.find(x=>!x.claimed);
 assert.ok(offer);assert.equal(await rig.callbacks.beforeClaim(offer,{baselineBalance:100}),true);
 await rig.callbacks.onOutcome(offer,'pending_confirmation',{});
 rig.completeOfficial();
 const result=await rig.driver.claimActivities({account,...rig.callbacks});
 assert.equal(result.confirmed,1);assert.equal(rig.receipts.summary(account).confirmed,1);
 assert.equal(rig.calls.filter(x=>x.path.endsWith('/item/reward/claim/')).length,0);
 assert.equal((await rig.driver.claimActivities({account,...rig.callbacks})).confirmed,0);
});
test('Doubao missing independent free grant balance causes zero campaign POST',async()=>{
 const rig=fixture({noGrant:true});const account=await rig.login();
 const result=await rig.driver.claimActivities({account,...rig.callbacks});
 assert.equal(result.confirmed,0);assert.equal(result.pending,0);
 assert.equal(rig.calls.filter(x=>x.path.endsWith('/item/reward/claim/')).length,0);
});
