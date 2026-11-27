import test from 'node:test';
import assert from 'node:assert/strict';
import {giftWalletFacts,publicGiftWallet,staleGiftWallet} from '../src/gift-wallet.mjs';
import {sourceAccountFacts} from '../src/source-account-facts.mjs';
import {parseWorkBuddyCredits} from '../src/channels/workbuddy-members.mjs';
import {freeEvidence} from '../src/auto-free.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';
const now=Date.parse('2026-11-25T00:00:00Z');
test('official gift facts are separate from model cost, stale snapshots and inconsistent balances fail closed',()=>{
 const facts=giftWalletFacts({balance:100,gift:25,ordinary:75,now});const balance={balance:100,balanceUnit:'积分',balanceState:'available'};
 assert.equal(publicGiftWallet(facts,balance,{now}).giftedBalance,25);
 assert.equal(publicGiftWallet(facts,balance,{now:now+180001}).giftCreditState,'unconfirmed');
 assert.equal(publicGiftWallet(facts,{...balance,balanceState:'cached'},{now}).giftCreditState,'unconfirmed');
 assert.equal(giftWalletFacts({balance:99,gift:25,ordinary:75,now}).giftCreditState,'unconfirmed');
 assert.equal(freeEvidence({id:'paid',costMultiplier:.04,...facts},'own_lingxi'),null);
});
test('Loomy requires exactly reconciled official buckets; duplicates or mismatches cannot grant free eligibility',()=>{
 const packages=[{name:'每日赠送',unit:'积分',remaining:2000},{name:'永久积分',unit:'积分',remaining:100}];
 const read=(p,total=2100)=>sourceAccountFacts({providerId:'loomy',observedAt:now,balanceRow:{balance:{total,packages:p}}});
 assert.equal(read(packages).giftedBalance,2000);assert.equal(read(packages).ordinaryBalance,100);
 assert.equal(read([...packages,packages[0]],4100).loomyDailyGift,undefined);
 assert.equal(read(packages,2101).loomyDailyGift,undefined);
});
test('Raccoon daily points are a distinct gift wallet, never the aggregate or ambiguous rewards',()=>{
 const daily={name:'每日积分',unit:'积分',remaining:300},paid={name:'充值积分',unit:'积分',remaining:100},reward={name:'奖励积分',unit:'积分',remaining:50};
 const read=(packages,total)=>sourceAccountFacts({providerId:'raccoon',observedAt:now,balanceRow:{balance:{total,packages}}});
 const exact=read([daily,paid],400);assert.equal(exact.giftedBalance,300);assert.equal(exact.ordinaryBalance,100);assert.equal(exact.giftCreditState,'verified');
 const partial=read([daily,paid,reward],450);assert.equal(partial.giftedBalance,300);assert.equal(partial.unclassifiedBalance,50);assert.equal(partial.giftCreditState,'partial');
 assert.equal(partial.giftRouteState,'cost_bound_unverified');
 assert.equal(read([daily,daily,paid],700).giftCreditState,'unconfirmed');
 assert.equal(read([daily,paid],399).giftCreditState,'unconfirmed');
 assert.equal(read([{name:'可用积分',unit:'积分',remaining:400}],400).giftCreditState,'unconfirmed');
 assert.equal(read([daily,{...paid,active:false}],400).giftCreditState,'unconfirmed');
});

test('Raccoon verified gift wallet reaches account center and stale wallet is hidden',()=>{
 const providerId='own_raccoon',id='sp_'+'a'.repeat(24),config=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts:[{id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true}]});
 let clock=now;
 const facts=sourceAccountFacts({providerId:'raccoon',observedAt:now,balanceRow:{balance:{total:400,packages:[{name:'每日积分',unit:'积分',remaining:300},{name:'充值积分',unit:'积分',remaining:100}]}}});
 const center=createAccountCenter({configStore:{get:()=>config,replace(){}},drivers:new Map([[providerId,{accountSnapshot:()=>facts}]]),now:()=>clock});
 assert.equal(center.list().accounts[0].giftedBalance,300);
 clock+=180001;
 assert.equal(center.list().accounts[0].giftCreditState,'unconfirmed');
 assert.equal(center.list().accounts[0].giftedBalance,undefined);
});

test('CodeArts total metric is not a second wallet; explicit gift and base components reconcile',()=>{
 const packages=[{name:'总积分包',unit:'credit',remaining:300},{name:'基础积分包',unit:'credit',remaining:250},{name:'赠送积分包',unit:'credit',remaining:50}];
 const r=sourceAccountFacts({providerId:'codearts',observedAt:now,balanceRow:{balance:{total:300,packages}}});
 assert.equal(r.giftedBalance,50);assert.equal(r.ordinaryBalance,250);assert.equal(r.giftRouteState,'cost_bound_unverified');
});
test('CodeArts gift balance reconciles with optional on-demand and absent zero buckets',()=>{
 const p=(name,remaining)=>({name,remaining,unit:'credit'});
 const read=(packages,total)=>sourceAccountFacts({providerId:'codearts',observedAt:now,balanceRow:{balance:{total,packages}}});
 const a=read([p('总积分包',300),p('基础积分包',200),p('赠送积分包',50),p('按需积分包',50)],300);
 assert.equal(a.giftedBalance,50);assert.equal(a.ordinaryBalance,250);
 assert.equal(read([p('总积分包',50),p('赠送积分包',50)],50).giftedBalance,50);
 assert.equal(read([p('总积分包',100),p('赠送积分包',50)],100).giftCreditState,'unconfirmed');
 assert.equal(read([p('总积分包',100),p('赠送积分包',50),p('赠送积分包',50)],100).giftCreditState,'unconfirmed');
 assert.equal(read([p('总积分包',100),p('赠送积分包',50),p('未知积分包',50)],100).giftCreditState,'unconfirmed');
});
test('WorkBuddy a nonmonthly bucket is not automatically a gift; explicit active gift is identified',()=>{
 const read=PackageName=>parseWorkBuddyCredits({data:{Response:{Data:{Accounts:[{CapacityType:4,CycleCapacityRemainPrecise:50,CycleEndTime:'2026-12-01T00:00:00Z'},{CapacityType:1,PackageName,CapacityRemainPrecise:20,ExpiredTime:'2026-12-01T00:00:00Z'}]}}}},{now});
 assert.equal(read('活动赠送积分').giftedBalance,20);assert.equal(read('活动赠送积分').ordinaryBalance,50);
 assert.equal(read('未知积分包').giftCreditState,'unconfirmed');assert.equal(read('购买积分').giftedBalance,0);
});

test('WorkBuddy preserves confirmed gift buckets alongside unclassified balances without granting free routing',()=>{
 const end='2026-12-01T00:00:00Z';
 const r=parseWorkBuddyCredits({data:{Accounts:[
  {CapacityType:4,CycleCapacityRemainPrecise:50,CycleEndTime:end},
  {CapacityType:1,PackageName:'活动赠送积分',CapacityRemainPrecise:20,ExpiredTime:end},
  {CapacityType:1,PackageName:'未知积分包',CapacityRemainPrecise:30,ExpiredTime:end}
 ]}},{now});
 assert.equal(r.giftCreditState,'partial');assert.equal(r.giftedBalance,20);
 assert.equal(r.ordinaryBalance,50);assert.equal(r.unclassifiedBalance,30);
 assert.equal(r.balance,100);assert.equal(r.giftRouteState,'cost_bound_unverified');
 const view=publicGiftWallet(r,r,{now});
 assert.equal(view.giftCreditState,'partial');assert.equal(view.giftedBalance,20);assert.equal(view.unclassifiedBalance,30);
 assert.equal(publicGiftWallet(r,r,{now:now+180001}).giftCreditState,'unconfirmed');
 assert.equal(staleGiftWallet(r).unclassifiedBalance,undefined);
 assert.equal(freeEvidence({id:'paid',costMultiplier:.1,...view},'own_workbuddy-cn'),null);
});

test('wallet invalidation retains last balance as cached but removes spendable grant evidence',()=>{
 const r=staleGiftWallet({balance:100,balanceUnit:'积分',loomyDailyGift:80,quotaWindows:[{left:80}],...giftWalletFacts({balance:100,gift:80,ordinary:20,now})});
 assert.equal(r.balance,100);assert.equal(r.balanceState,'cached');assert.equal(r.giftedBalance,undefined);assert.equal(r.loomyDailyGift,undefined);assert.deepEqual(r.quotaWindows,[]);assert.equal(publicGiftWallet(r,r,{now}).giftCreditState,'unconfirmed');
});
