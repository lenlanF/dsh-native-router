import test from 'node:test';
import assert from 'node:assert/strict';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';

const COOKIE='sessionid=standalone-web-session-1234567890; uid_tt=123123123';
const date='2026-11-20';
function fixture({already=false,afterClaim='verified',claimError=false,withTask=true,
  taskUnknown=false,chatOnly=false}={}){
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
     campaign_code:chatOnly?'daily_chat_activity':'daily_check_in',
     task_kind:chatOnly?'chat_activity':'daily_signin',
     ...(taskUnknown?{}:{daily_checkin:{checked_in_today:done}})}]:[]});
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

test('Doubao unchecked official PC campaign remains read-only, never consumes a claim attempt',async()=>{
 const rig=fixture(),account=await rig.accountPromise;
 const result=await rig.driver.checkIn({account,date});
 assert.equal(result.state,'client_required');assert.equal(result.diagnosticCode,'DOUBAO_OFFICIAL_CLIENT');
 assert.equal(result.confirmed,undefined);
 assert(!rig.calls.some(x=>x.path.includes('landing/checkin')));
 assert(rig.calls.some(x=>x.path==='/alice/ug/campaign/v3/detail'));
});
test('Doubao already checked in never re-claims even with no original client',async()=>{
 const rig=fixture({already:true}),account=await rig.accountPromise;
 assert.equal((await rig.driver.checkIn({account,date})).confirmed,true);
 assert(!rig.calls.some(x=>x.path.includes('landing/checkin')));
});
test('Doubao repeated status checks never call unsupported web mutation',async()=>{
 const rig=fixture({claimError:true}),account=await rig.accountPromise;
 for(let i=0;i<2;i++)assert.equal((await rig.driver.checkIn({account,date})).state,'client_required');
 assert.equal(rig.calls.filter(x=>x.path.includes('landing/checkin')).length,0);
 assert.equal(rig.calls.filter(x=>x.path.includes('/campaign/v3/detail')).length,2);
});
test('Doubao missing official unchecked flag cannot consume a claim attempt',async()=>{
 const rig=fixture({taskUnknown:true}),account=await rig.accountPromise;
 const result=await rig.driver.checkIn({account,date});
 assert.equal(result.state,'failed');assert.equal(result.diagnosticCode,'ELIGIBILITY_UNKNOWN');
 assert.equal(rig.calls.filter(x=>x.path.includes('landing/checkin')).length,0);
});
test('Doubao chat activity is not a daily-signin task and cannot be claimed blindly',async()=>{
 const rig=fixture({chatOnly:true}),account=await rig.accountPromise;
 const result=await rig.driver.checkIn({account,date});
 assert.equal(result.state,'no_task');
 assert.equal(rig.calls.filter(x=>x.path.includes('landing/checkin')).length,0);
});
test('Doubao account without daily task does not claim anything',async()=>{
 const rig=fixture({withTask:false}),account=await rig.accountPromise;
 assert.equal((await rig.driver.checkIn({account,date})).state,'no_task');
 assert(!rig.calls.some(x=>x.path.includes('landing/checkin')));
});
