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
