import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLingxiWallet} from '../src/channels/lingxi-wallet.mjs';
const now=Date.parse('2026-11-25T00:00:00Z'),future='2026-11-26T00:00:00Z';
const wallet=(bonus,purchased,total)=>({data:{total_balance:total,bonus_credits:bonus,purchased_credits:purchased}});
test('Lingxi gift bucket and ordinary balance are separate; no guessed execution price',()=>{
 const r=parseLingxiWallet(wallet([{balance:100,expire_time:future}],[{balance:500}],600),now);
 assert.equal(r.giftedBalance,100);assert.equal(r.ordinaryBalance,500);assert.equal(r.balance,600);assert.equal(r.expiringPoints,100);assert.equal(r.giftCreditState,'verified');assert.equal(r.giftRouteState,'cost_bound_unverified');assert.equal(r.quotaWindows[0].endAt,Date.parse(future));
});
test('expired, absent, mismatching or partial gift buckets do not create fake spendable rights',()=>{
 for(const input of [wallet([{balance:100,expire_time:'2026-11-24T00:00:00Z'}],[{balance:500}],600),wallet([{balance:100}],[{balance:500}],600),wallet([{balance:100,expire_time:future}],[{balance:500}],800),wallet([{balance:'unknown'}],[],0),{data:{total_balance:600}}]){
 const r=parseLingxiWallet(input,now);assert.equal(r.giftCreditState,'unconfirmed');assert.equal(r.giftedBalance,undefined);
 }
 const r=parseLingxiWallet(wallet([],[{balance:500}],500),now);assert.equal(r.giftedBalance,0);assert.equal(r.giftRouteState,'no_gift');
});

test('Lingxi UTC+8 local expiry and wallet with no purchased detail preserve non-gift remainder',()=>{
 const r=parseLingxiWallet({data:{credits_balance:'150',bonus_credits:[{balance:'100',expire_time:'2026-11-26 08:00:00'}]}},now);
 assert.equal(r.giftedBalance,100);assert.equal(r.ordinaryBalance,50);assert.equal(r.giftExpiresAt,Date.parse(future));
 assert.equal(parseLingxiWallet({data:{total_balance:99,bonus_credits:[{balance:100,expire_time:future}]}},now).giftCreditState,'unconfirmed');
});
