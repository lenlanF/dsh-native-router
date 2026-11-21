import test from 'node:test';
import assert from 'node:assert/strict';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';

const COOKIE='sessionid=standalone-web-session-1234567890; uid_tt=123123123';
const date='2026-11-20';
function fixture({already=false,afterClaim='verified',claimError=false,withTask=true}={}){
 const stored=new Map(),calls=[],delays=[];
 let claimed=false;
 const vault={
  async resolve(key){return stored.get(key)},
  async set(key,value){stored.set(key,{value})},
  async unset(key){stored.delete(key)},
 };
 const fetchImpl=async(uri,init={})=>{
  const url=new URL(String(uri));calls.push({path:url.pathname,method:init.method});
  assert.equal(url.hostname,'www.doubao.com','no desktop or local client endpoint');
  const data=value=>new Response(JSON.stringify({code:0,data:value}),{
   status:200,headers:{'content-type':'application/json'}});
  if(url.pathname==='/passport/account/info/v2/')
   return data({user_id_str:'member-web-101',screen_name:'豆包会员'});
  if(url.pathname==='/alice/user/launch')
   return data({ug_campaign_info:{campaign_group_code:'member-signin'}});
  if(url.pathname==='/alice/ug/campaign/v3/detail'){
   const done=already||claimed&&afterClaim==='verified';
   return data({campaign_code:'member-signin',tasks:withTask?[{
    campaign_code:'daily_check_in',task_kind:'daily_signin',
    daily_checkin:{checked_in_today:done}}]:[]});
  }
  if(url.pathname==='/alice/ug/campaign/landing/checkin'){
   assert.equal(init.method,'POST');
   const body=JSON.parse(init.body);
   assert.equal(body.scene,'member-signin');
   assert.equal(typeof body.biz_params,'object');
   if(claimError)return new Response(JSON.stringify({code:710010702,msg:'Unsupported operation'}),{
    status:200,headers:{'content-type':'application/json'}});
   claimed=true;return data({checked_in:true,checked_in_today:true});
  }
  throw Error('Unexpected upstream endpoint: '+url.pathname);
 };
 const driver=createDoubaoDriver({vault,fetchImpl,sleepMs:async ms=>{delays.push(ms)}});
 const accountPromise=driver.addCookie({cookie:COOKIE}).then(x=>({
  id:x.id,providerId:x.providerId,credentialRef:x.credentialRef,
 }));
 return {driver,accountPromise,calls,delays};
}

test('Doubao web member check-in confirms reward without a DoubaoWork process',async()=>{
 const rig=fixture(),account=await rig.accountPromise;
 const result=await rig.driver.checkIn({account,date});
 assert.equal(result.confirmed,true);
 assert.equal(result.date,date);
 assert.equal(rig.calls.filter(x=>x.path==='/alice/ug/campaign/landing/checkin').length,1);
 assert(rig.calls.some(x=>x.path==='/alice/ug/campaign/v3/detail'));
 assert(rig.calls.every(x=>x.method==='POST'));
});
test('Doubao already checked in never re-claims even with no original client',async()=>{
 const rig=fixture({already:true}),account=await rig.accountPromise;
 assert.equal((await rig.driver.checkIn({account,date})).confirmed,true);
 assert(!rig.calls.some(x=>x.path.includes('landing/checkin')));
});
test('Doubao check-in refuses to report success if server receipt is not confirmed',async()=>{
 const rig=fixture({afterClaim:'pending'}),account=await rig.accountPromise;
 const result=await rig.driver.checkIn({account,date});
 assert.equal(result.confirmed,undefined);
 assert.equal(result.state,'pending_confirmation');
 assert.deepEqual(rig.delays,[2000,4000]);
 assert.equal(rig.calls.filter(x=>x.path==='/alice/ug/campaign/v3/detail').length,4);
});
test('Doubao upstream rejection is not treated as a client-process requirement or success',async()=>{
 const rig=fixture({claimError:true}),account=await rig.accountPromise;
 const result=await rig.driver.checkIn({account,date});
 assert.equal(result.state,'pending_confirmation');
 assert.equal(result.confirmed,undefined);
 assert(!/客户端|启动/.test(result.message));
});
test('Doubao account without daily task does not claim anything',async()=>{
 const rig=fixture({withTask:false}),account=await rig.accountPromise;
 assert.equal((await rig.driver.checkIn({account,date})).state,'no_task');
 assert(!rig.calls.some(x=>x.path.includes('landing/checkin')));
});
