import test from 'node:test';
import assert from 'node:assert/strict';
import {checkinGroups,latestConfirmedDate} from '../src/checkin-summary.mjs';
import {upstreamCheckedInToday,publicAccountName,credentialPublicIdentity} from '../src/account-facts.mjs';import {createCheckinCenter} from '../src/checkins.mjs';
import {normalizeConfig} from '../src/config.mjs';

const NOW=Date.parse('2026-11-20T07:45:00Z');
const TODAY='2026-11-20',YESTERDAY='2026-11-19';
test('signed-history proof is account-ID and date scoped, regardless of a later pending/failure',()=>{
 const history=[
  {date:YESTERDAY,accountId:'wbp-1',state:'success',at:10},
  {date:TODAY,accountId:'wbp-1',state:'success',at:20},
  {date:TODAY,accountId:'wbp-1',state:'pending_confirmation',at:30},
  {date:TODAY,accountId:'wbp-2',state:'failed',at:40},
  {date:TODAY,accountId:'source-1',state:'success',at:50},
 ];
 assert.equal(latestConfirmedDate(history,'wbp-1',TODAY),TODAY);
 assert.equal(latestConfirmedDate(history,'wbp-2',TODAY),null);
 assert.equal(latestConfirmedDate(history,'source-1',TODAY),TODAY);
 assert.equal(latestConfirmedDate(history,'wbp-1',YESTERDAY),YESTERDAY);
 assert.equal(latestConfirmedDate(history,'source-1',YESTERDAY),null);
 const accounts=[
  {id:'wbp-1',providerId:'own_workbuddy-cn',checkinState:'success',checkinSupported:true,lastConfirmedDate:TODAY},
  {id:'wbp-2',providerId:'workbuddy-cn',checkinState:'failed',checkinSupported:true},
  {id:'lm-1',providerId:'own_loomy',checkinState:'not_run',checkinSupported:true,lastConfirmedDate:YESTERDAY},
  {id:'lm-2',providerId:'loomy',checkinState:'pending_confirmation',checkinSupported:true},
  {id:'cx',providerId:'codearts',checkinState:'unsupported',checkinSupported:false}
 ];
 const groups=checkinGroups(accounts,[
   {id:'own_workbuddy-cn',name:'WorkBuddy · 聚合路由自有'},
   {id:'workbuddy-cn',name:'WorkBuddy 国内'},
   {id:'own_loomy',name:'Loomy · 聚合路由自有'},
   {id:'loomy',name:'Loomy'},
 ]);
 const wb=groups.find(x=>x.id==='workbuddy-cn');
 const lm=groups.find(x=>x.id==='loomy');
 assert.equal(groups.filter(x=>x.id==='loomy').length,1);
 assert.equal(wb.accountCount,2);
 assert.equal(wb.success,1);
 assert.equal(lm.accountCount,2);
 assert.equal(lm.success,0,'yesterday is never counted as today');
 assert.equal(lm.historyConfirmed,1);
 assert.equal(lm.pending,1);
 assert.equal(groups.find(x=>x.id==='codearts').accountCount,1);
 assert.equal(groups.filter(x=>x.id==='own_loomy').length,0);
});

test('a real earlier success cannot be overwritten by a later pending record or retried manually',async()=>{
 const cfg=normalizeConfig({providers:[{id:'own_lingxi',name:'Lingxi',protocol:'native-channel'}],
   accounts:[{id:'account-proven',providerId:'own_lingxi',
     credentialRef:'driver:own_lingxi:account-proven',enabled:true,autoCheckin:true}],
   checkin:{autoEnabled:true,timeZone:'Asia/Shanghai',runAt:'10:05'}});
 const records=[
   {date:YESTERDAY,accountId:'account-proven',providerId:'own_lingxi',state:'success',at:1},
   {date:TODAY,accountId:'account-proven',providerId:'own_lingxi',state:'success',at:2},
   {date:TODAY,accountId:'account-proven',providerId:'own_lingxi',
     state:'pending_confirmation',at:3},
 ];
 let executed=0;
 const driver={checkIn:async()=>{executed++;return {confirmed:true,date:TODAY}}};
 const account={id:'account-proven',providerId:'own_lingxi',enabled:true,
    autoCheckin:true,credentialRef:'driver:own_lingxi:account-proven'};
 const accountCenter={
   list:()=>({accounts:[{...account,connectionState:'online'}],
     channels:[{id:'own_lingxi',name:'Lingxi'}]}),
   find:()=>({account,provider:cfg.providers[0],driver}),
   driverFor:()=>driver,
 };
 const store={all:()=>structuredClone(records),append:r=>(records.push(r),r)};
 const center=createCheckinCenter({configStore:{get:()=>structuredClone(cfg)},
   accountCenter,store,now:()=>NOW});
 const snap=center.snapshot(),row=snap.accounts[0];
 assert.equal(row.checkinState,'success');
 assert.equal(row.lastConfirmedDate,TODAY);
 assert.equal(snap.groups.find(x=>x.id==='lingxi').success,1);
 assert.equal((await center.run('account-proven')).alreadyConfirmed,true);
 assert.equal((await center.tick()).attempted,0);
 assert.equal(executed,0);
 assert.equal(records.length,3);
});

test('exact credential public identity reveals only verified name and masked mobile',()=>{
 const payload={
   user_name:'Legitimate Channel User',phone:'13812345678',
   access_token:'SENSITIVE-ACCESS-TOKEN',refresh_token:'SENSITIVE-REFRESH-TOKEN',
   userid:'private-user-id',device_mid:'private-device-id'};
 const actual=credentialPublicIdentity(payload);
 assert.deepEqual(actual,{accountName:'Legitimate Channel User',maskedPhone:'138****5678'});
 assert.doesNotMatch(JSON.stringify(actual),/SENSITIVE|private-user|device-mid|13812345678/);
 assert.deepEqual(credentialPublicIdentity({nickname:'loomy · 独立账号',
   phone:'13812345678',access_token:'not-public'}),{maskedPhone:'138****5678'});
 assert.equal(publicAccountName({username:'13812345678'}),'138****5678');
 assert.equal(publicAccountName({username:'A'.repeat(65)}),'');
});

test('source confirmation accepts only same-day explicit upstream evidence',()=>{
 assert.equal(upstreamCheckedInToday({todayCheckedIn:true},TODAY),true);
 assert.equal(upstreamCheckedInToday({todayCheckedIn:false,checkinDates:[TODAY]},TODAY),true);
 assert.equal(upstreamCheckedInToday({checkinDates:[YESTERDAY]},TODAY),null);
 assert.equal(upstreamCheckedInToday({lastCheckinDate:YESTERDAY,lastCheckinOutcome:'claimed'},TODAY),null);
 assert.equal(upstreamCheckedInToday({lastCheckinDate:TODAY,lastCheckinOutcome:'claimed'},TODAY),true);
 assert.equal(upstreamCheckedInToday({todayCheckedIn:false},TODAY),false);
 assert.equal(upstreamCheckedInToday({checkinDates:[{date:TODAY,status:'failed'}]},TODAY),null);
 assert.equal(upstreamCheckedInToday({checkinDates:[{date:TODAY,status:'claimed'}]},TODAY),true);
 assert.equal(publicAccountName({nickname:'loomy · 独立账号'},{username:'actual-user'}),'actual-user');
});
