import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeChannelExecution} from '../src/channel-execution-result.mjs';

const day='2026-11-24';
const stamp=Date.parse(day+'T03:00:00+08:00');
const account=(extra={})=>({id:'one',providerId:'own_workbuddy-cn',
  checkinState:'success',lastConfirmedDate:day,enabled:true,...extra});
const gift=(verified=true)=>({kind:'gift',active:true,claimed:true,credit:200,
  rewardVerified:verified,rewardProof:verified?'official_wallet_delta':undefined,
  rewardVerifiedAt:stamp});

test('HTTP 200 or accepted claim is never counted as wallet credit',()=>{
  const row=account({checkinState:'pending_confirmation',lastConfirmedDate:null,
    benefits:[gift(false)]});
  const result=summarizeChannelExecution({before:[row],after:[row],
    results:[{accountId:'one',record:{state:'pending_confirmation'},
      activities:{state:'pending_confirmation',pending:1}}],today:day});
  assert.equal(result.attempted,1);
  assert.equal(result.confirmedSignins,0);
  assert.equal(result.newlyCreditedRewards,0);
  assert.equal(result.pendingAccounts,1);
});

test('only a new official same-day wallet delta counts as newly credited',()=>{
  const result=summarizeChannelExecution({before:[account({benefits:[]})],
    after:[account({benefits:[gift(true)]})],
    results:[{accountId:'one',record:{state:'success'}}],today:day});
  assert.equal(result.confirmedSignins,1);
  assert.equal(result.newlyCreditedRewards,1);
  assert.equal(result.pendingAccounts,0);
});

test('already-existing verified reward is never counted again',()=>{
  const row=account({benefits:[gift(true)]});
  const result=summarizeChannelExecution({before:[row],after:[row],
    results:[{accountId:'one',alreadyConfirmed:true}],today:day});
  assert.equal(result.newlyCreditedRewards,0);
  assert.equal(result.confirmedSignins,1);
});

test('only official raccoon daily bill counts, and unknown/failure remain separate',()=>{
  const before=account({providerId:'raccoon',sourceAccount:true,checkinState:'no_task',lastConfirmedDate:null});
  const after={...before,checkinState:'success',lastConfirmedDate:day,
    activityRewardProof:'official_daily_grant_bill',
    activityRewardVerifiedAt:stamp,activityRewardAmount:30,activityRewardUnit:'积分'};
  const result=summarizeChannelExecution({before:[before],after:[after],
    results:[{accountId:'one',record:{state:'success'}},
      {accountId:'two',state:'unavailable'}],today:day});
  assert.equal(result.attempted,2);
  assert.equal(result.newlyCreditedRewards,1);
  assert.equal(result.failedAccounts,1);
});

test('a zero-result channel never claims execution or rewards',()=>{
  const result=summarizeChannelExecution({results:[],today:day});
  assert.deepEqual(result,{attempted:0,confirmedSignins:0,
    newlyCreditedRewards:0,pendingAccounts:0,failedAccounts:0,
    noTaskAccounts:0,verification:'official-receipt-only'});
});
