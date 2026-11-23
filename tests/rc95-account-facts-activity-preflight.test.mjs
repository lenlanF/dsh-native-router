import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceChannelDriver} from '../src/source-channel-driver.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createWorkBuddyDriver} from '../src/channels/workbuddy.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {buildChannelActivityCatalog} from '../src/channel-activities.mjs';

const statusResult=payload=>({state:'ready',checkedAt:Date.now(),accounts:[payload]});
const sourceRig=({signed=true,nickname='真实来源显示名',officialName=''}={})=>{
 const rawId='real-loomy-member-1',id=sourceAccountOpaqueId('loomy',rawId);
 const account={providerId:'own_loomy',id,
   credentialRef:'driver:own_loomy:'+id,enabled:true};
 const pack={
  status:()=>({state:'mounted',channels:['loomy']}),
  listAccounts:async()=>({state:'ready',accounts:[
   {providerId:'loomy',id:rawId,nickname,enabled:true}]}),
  readSourceStatuses:async()=>statusResult({accountId:rawId,
   ...(officialName?{nickname:officialName}:{}),
   authVerified:signed,balance:1200,balanceUnit:'积分',
   balanceState:'available',balanceCheckedAt:Date.now()})
 };
 return{account,driver:createSourceChannelDriver({providerId:'loomy',
   accountProviderId:'own_loomy',embeddedPack:pack})};
};
test('official authenticated source account inherits its exact private pool nickname when status omits it',async()=>{
 const r=sourceRig();
 const status=await r.driver.refreshAccountStatus({account:r.account});
 assert.equal(status.authVerified,true);
 assert.equal(r.driver.accountSnapshot(r.account).nickname,'真实来源显示名');
 assert.equal(r.driver.accountSnapshot(r.account).balance,1200);
});
test('official identity supersedes a stale pool nickname; guest, placeholder and unsigned replies cannot fake identity',async()=>{
 const official=sourceRig({nickname:'旧名称',officialName:'新官方姓名'});
 await official.driver.refreshAccountStatus({account:official.account});
 assert.equal(official.driver.accountSnapshot(official.account).nickname,'新官方姓名');
 const unverified=sourceRig({signed:false,nickname:'未经认证的昵称'});
 await unverified.driver.refreshAccountStatus({account:unverified.account});
 assert.equal(unverified.driver.accountSnapshot(unverified.account).nickname,undefined);
 const placeholder=sourceRig({nickname:'账号1'});
 await placeholder.driver.refreshAccountStatus({account:placeholder.account});
 assert.equal(placeholder.driver.accountSnapshot(placeholder.account).nickname,undefined);
});
const ownedId='wbp_'+'a'.repeat(24);
const owned={id:ownedId,providerId:'own_workbuddy-cn',
 credentialRef:'driver:own_workbuddy-cn:'+ownedId,enabled:true,autoCheckin:true};
test('WorkBuddy CN official daily status makes a read-only, account-specific claimable row, not a paid or credited bonus',async()=>{
 let postClaims=0,dailyReads=0;
 const vault={resolve:async()=>({value:JSON.stringify({
  accessToken:'test-access-'+('a'.repeat(18)),
  refreshToken:'test-refresh-'+('b'.repeat(18)),
  expiresAt:Math.floor(Date.now()/1000)+18000,domain:'www.workbuddy.cn',
  uid:'SYNTHETIC_MEMBER_UID',nickname:'模拟会员'})})};
 const ok=value=>new Response(JSON.stringify({code:0,data:value}),{status:200});
 const fetchImpl=async(url,request={})=>{
  const path=new URL(url).pathname;
  if(path==='/v2/plugin/account')return ok({uid:'SYNTHETIC_MEMBER_UID',
    displayName:'模拟会员'});
  if(path==='/v2/billing/meter/get-user-resource')return ok({
    Response:{Data:{Accounts:[{PackageName:'每日赠送积分',
      CapacityType:3,CapacityRemain:500,CapacitySize:800,
      ExpiredTime:'2027-12-01T00:00:00Z'}]}}});
  if(path.endsWith('/billing/meter/compensation-status')||
     path.endsWith('/billing/meter/check-gift-claimed'))
    return ok({active:false,claimed:false});
  if(path==='/v2/billing/meter/checkin-activity-status'){
    dailyReads++;return ok({active:true,today_checked_in:false});
  }
  if(path.includes('/growth/tasks'))return ok({tasks:[]});
  if(path.includes('/growth/buddy/travel/status'))return ok({state:'idle'});
  if(path==='/v2/billing/meter/daily-checkin'){postClaims++;return ok({})}
  throw Error('Synthetic fixture unrecognized WorkBuddy route');
 };
 const driver=createWorkBuddyDriver({ownedRegion:'cn',ownedVault:vault,
  makeCredentialRef:x=>x,fetchImpl});
 const config=normalizeConfig({providers:[{id:'own_workbuddy-cn',
  name:'WorkBuddy CN',protocol:'native-channel'}],accounts:[owned]});
 const configStore={get:()=>structuredClone(config),replace:()=>{}};
 const center=createAccountCenter({configStore,drivers:new Map([['own_workbuddy-cn',driver]])});
 await center.refreshReadOnly();
 const checkins=createCheckinCenter({configStore,accountCenter:center,
  store:{all:()=>[],append:()=>{throw Error('read-only test must never write')}},
  activityStore:createActivityClaimStore({path:null})});
 const row=checkins.snapshot().accounts[0];
 assert.equal(row.connectionState,'online');
 assert.equal(row.nickname,'模拟会员');
 assert.equal(row.activityClaimable,true);
 assert.equal(row.activityState,'claimable');
 assert.ok(row.activityCheckedAt>Date.now()-10000);
 assert.ok(dailyReads>0);
 const catalog=buildChannelActivityCatalog({config,accountRows:[row]});
 assert.equal(catalog.summary.validCount,1);
 assert.equal(catalog.summary.completedCount,0);
 assert.equal(catalog.channels[0].activities[0].rewardAmount,null);
 assert.equal(postClaims,0,'read-only official preflight must not submit sign-in');
});
