import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckinCenter} from '../src/checkins.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';
import {buildChannelActivityCatalog} from '../src/channel-activities.mjs';
import {normalizeConfig} from '../src/config.mjs';

const at=Date.parse('2026-11-23T04:00:00Z');
const approved=(providerId,accountId)=>normalizeConfig({
 providers:[{id:providerId,name:providerId,protocol:'native-channel',enabled:true}],
 accounts:accountId?[{id:accountId,providerId,
   credentialRef:'driver:'+providerId+':'+accountId,enabled:true}]:[],
 checkin:{autoEnabled:false,autoSourceAccounts:false,timeZone:'Asia/Shanghai'}
});
const emptyHistory={all:()=>[],blocked:false};
const benefits=()=>[{kind:'compensation',active:true,claimed:true,credit:160,
 endAt:at+2*86400000}];
test('WorkBuddy official claimed task without observed wallet credit never enters activity table',()=>{
 const id='workbuddy_fixture',pid='own_workbuddy-cn',
  cfg=approved(pid,id),account=cfg.accounts[0],offer=benefits()[0];
 const balance=createActivityClaimStore({path:null,now:()=>at});
 const provider=cfg.providers[0];
 const accountCenter={list:()=>({channels:[],accounts:[{
   id,providerId:pid,enabled:true,nickname:'官方账号',benefits:benefits(),
   connectionState:'online'}]}),
  find:()=>({account,provider,driver:{}}),driverFor:()=>({})};
 const center=createCheckinCenter({configStore:{get:()=>cfg},accountCenter,
  store:emptyHistory,activityStore:balance,now:()=>at});
 let result=buildChannelActivityCatalog({config:cfg,
   accountRows:center.snapshot().accounts,now:at});
 assert.equal(result.summary.activityCount,0,
  'official claimed checkbox and 160 advertised points are not wallet proof');
 assert.equal(balance.begin(account,offer,{baselineBalance:100}),true);
 assert.equal(balance.finish(account,offer,'confirmed'),true);
 result=buildChannelActivityCatalog({config:cfg,
   accountRows:center.snapshot().accounts,now:at});
 assert.equal(result.summary.activityCount,0,
  'old confirmed receipt without proof remains hidden');
 assert.equal(balance.finish(account,offer,'confirmed',{
  credit:160,proof:'official_wallet_delta',verifiedAt:at}),true);
 result=buildChannelActivityCatalog({config:cfg,
   accountRows:center.snapshot().accounts,now:at});
 assert.equal(result.summary.activityCount,1);
 const row=result.channels[0].activities[0];
 assert.equal(row.kind,'compensation');
 assert.equal(row.rewardAmount,160);
 assert.equal(row.validity,'completed');
 assert.match(row.progress,/钱包增量/);
 center.stop();
});

test('Raccoon positive daily-grant bill survives real source/checkin/account/catalog pipeline',async()=>{
 const pid='own_raccoon',cfg=approved(pid),clock=()=>at;
 const configStore={get:()=>cfg};
 const source={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[
   {id:'raccoon_live',providerId:'raccoon',nickname:'小浣熊',enabled:true}]}),
  readSourceStatuses:async()=>({state:'ready',accounts:[{
   accountId:'raccoon_live',nickname:'小浣熊',authVerified:true,
   todayCheckedIn:true,active:true,activityRewardAmount:300,
   activityRewardUnit:'积分',activityRewardProof:'official_daily_grant_bill',
   activityRewardVerifiedAt:at}]}),
 };
 const accountCenter={
  find:()=>{throw Error('No native owner for source-only member')},
  list:()=>({accounts:[],channels:[]}),driverFor:()=>null};
 const center=createCheckinCenter({configStore,accountCenter,
  store:emptyHistory,sourcePack:source,
  activityStore:createActivityClaimStore({path:null,now:clock}),now:clock});
 await center.refreshSources();
 const status=center.snapshot().accounts;
 assert.equal(status.length,1);
 assert.equal(status[0].checkinState,'success');
 assert.equal(status[0].activityRewardProof,'official_daily_grant_bill');
 const result=buildChannelActivityCatalog({config:cfg,accountRows:status,now:at});
 assert.equal(result.summary.activityCount,1);
 assert.equal(result.channels[0].activities[0].rewardAmount,300);
 center.stop();
});

test('Raccoon unauthenticated or missing official billing proof is filtered before catalog',async()=>{
 const cfg=approved('own_raccoon');
 const source={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[{
   id:'bad',providerId:'raccoon',enabled:true}]}),
  readSourceStatuses:async()=>({state:'ready',accounts:[{
   accountId:'bad',authVerified:false,active:true,todayCheckedIn:true,
   activityRewardAmount:300,activityRewardUnit:'积分',
   activityRewardProof:'official_daily_grant_bill',
   activityRewardVerifiedAt:at}]}),
 };
 const center=createCheckinCenter({
  configStore:{get:()=>cfg},
  accountCenter:{find:()=>{throw Error('none')},list:()=>({accounts:[],channels:[]}),
   driverFor:()=>null},
  store:emptyHistory,sourcePack:source,now:()=>at,
  activityStore:createActivityClaimStore({path:null,now:()=>at})});
 await center.refreshSources();
 const data=buildChannelActivityCatalog({config:cfg,
  accountRows:center.snapshot().accounts,now:at});
 assert.equal(data.summary.activityCount,0);
 assert.equal(center.snapshot().accounts[0].activityRewardProof,undefined);
 center.stop();
});
