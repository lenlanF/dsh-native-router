import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAccountFacts} from '../src/source-account-facts.mjs';
import {createPublicAccountFactsStore} from '../src/account-public-facts-store.mjs';


test('CodeArts explicit total-credit metric is not an additional balance bucket',()=>{
 const packages=[{name:'总积分包',unit:'credit',remaining:300},
  {name:'基础积分包',unit:'credit',remaining:250},
  {name:'赠送积分包',unit:'credit',remaining:50}];
 const facts=sourceAccountFacts({providerId:'codearts',balanceRow:{balance:{total:300,packages}}});
 assert.equal(facts.balance,300);
 assert.equal(facts.balanceUnit,'积分');
 assert.equal(sourceAccountFacts({providerId:'codearts',
  balanceRow:{balance:{total:301,packages}}}).balanceUnit,undefined);
});

test('verified masked login survives partial responses without becoming a fabricated name',()=>{
 const store=createPublicAccountFactsStore();
 const account={id:'test',providerId:'own_loomy',credentialRef:'driver:own_loomy:test'};
 assert.equal(store.observe(account,{maskedPhone:'138****5678'}),true);
 assert.equal(store.get(account).maskedPhone,'138****5678');
 assert.equal(store.get(account).name,undefined);
 store.observe(account,{maskedPhone:'13812345678'});
 assert.equal(store.get(account).maskedPhone,'138****5678');
 assert.equal(store.get({...account,credentialRef:'driver:own_loomy:other'}),null);
});
