import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAccountFacts} from '../src/source-account-facts.mjs';

test('source-pack account identity supports official nested profile and safe verified points',()=>{
 const row=sourceAccountFacts({providerId:'loomy',
  identity:{accountId:'a1',profile:{displayName:'真实用户昵称'}},
  statusRow:{accountId:'a1',status:{todayCheckedIn:false}},
  balanceRow:{accountId:'a1',balance:{available:92,unit:'积分'}}});
 assert.equal(row.nickname,'真实用户昵称');
 assert.equal(row.balance,92);
 assert.equal(row.balanceUnit,'积分');
 assert.equal(row.authVerified,true);
 assert.equal(row.balanceState,'available');
});
test('source totals are trusted only from a recognized signed billing channel; opaque names stay hidden',()=>{
 const row=sourceAccountFacts({providerId:'unknown',
  identity:{data:{accountName:'Bearer private-super-secret'},username:'账号1'},
  statusRow:{status:{}},
  balanceRow:{balance:{total:1800,unit:'积分'}}});
 assert.equal('nickname' in row,false);
 assert.equal('balance' in row,false);
 assert.equal(row.authVerified,false);
 const signed=sourceAccountFacts({providerId:'codearts',
  balanceRow:{balance:{total:75,unit:'积分'}}});
 assert.equal(signed.balance,75,'signed CodeArts source pack total is spendable points');
 assert.equal(signed.authVerified,true);
});
test('remote numeric zero with explicit credits field is valid, not an invented absence',()=>{
 const row=sourceAccountFacts({providerId:'qoder',
  identity:{profile:{nickname:'Qoder 个人账号'}},
  balanceRow:{balance:{credits:0,unit:'积分'}}});
 assert.equal(row.balance,0);
 assert.equal(row.balanceState,'available');
 assert.equal(row.authVerified,true);
});
test('private source pack does not add incompatible packages across different currencies',()=>{
 const row=sourceAccountFacts({providerId:'zcode',
  identity:{profile:{nickname:'ZCode User'}},
  balanceRow:{balance:{packages:[{unit:'token',remaining:2000},
    {unit:'积分',remaining:30}]}}});
 assert.equal('balance' in row,false);
 assert.equal(row.balanceState,'not_returned');
});

test('Loomy wallet recovers its OFFICIAL points unit only from fully reconciled same-unit buckets',()=>{
 const pkg=[{name:'每日赠送',unit:'积分',remaining:110},
   {name:'永久积分',unit:'积分',remaining:280}];
 const wallet=total=>sourceAccountFacts({providerId:'loomy',
   balanceRow:{balance:{total,packages:pkg}}});
 assert.equal(wallet(390).balanceUnit,'积分');
 assert.equal(wallet(390).balance,390);
 assert.equal(wallet(391).balanceUnit,undefined,
   'mismatched official totals are not enough to assert one wallet unit');
 assert.equal(sourceAccountFacts({providerId:'loomy',
   balanceRow:{balance:{total:390,packages:[pkg[0],
     {...pkg[1],unit:'token'}]}}}).balanceUnit,undefined);
 assert.equal(sourceAccountFacts({providerId:'codearts',
   balanceRow:{balance:{total:390,packages:[]}}}).balanceUnit,undefined,
   'do not guess CodeArts units without official bucket information');
});
test('account name is the fallback when the official profile omits nickname',()=>{
 const row=sourceAccountFacts({providerId:'codearts',
  identity:{account_name:'customer-team-login'},
  balanceRow:{balance:{total:73,unit:'积分'}}});
 assert.equal(row.nickname,'customer-team-login');
 assert.equal(row.balance,73);
});
test('source wallet shows only reconciled points due within seven days, never overlapping quotas',()=>{
 const observedAt=Date.parse('2026-11-23T00:00:00Z');
 const pkg=[
  {unit:'积分',remaining:60,expiredTime:'2026-11-26T00:00:00Z'},
  {unit:'积分',remaining:40,expiredTime:'2026-12-15T00:00:00Z'}];
 const read=total=>sourceAccountFacts({providerId:'loomy',observedAt,
  balanceRow:{balance:{total,unit:'积分',packages:pkg}}});
 const row=read(100);
 assert.equal(row.balance,100);
 assert.equal(row.expiringPoints,60);
 assert.equal(row.expiringAt,Date.parse('2026-11-26T00:00:00Z'));
 assert.equal(read(130).expiringPoints,undefined,
  'do not present expiring rewards from unreconciled packages');
 assert.equal(sourceAccountFacts({providerId:'zcode',observedAt,
  balanceRow:{balance:{total:100,unit:'token',packages:pkg}}}).expiringPoints,undefined,
   'never disguise tokens as expiring points');
});
