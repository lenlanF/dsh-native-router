import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createAccountVerificationStore} from '../src/account-verification-store.mjs';

const providers=['own_mimo_desktop','own_meoo_web','own_qwenwork','own_workbuddy-cn'];
const ids=['sp_'+'a'.repeat(24),
 'mw_'+'c'.repeat(28),'qw_'+'d'.repeat(28),'wbp_'+'e'.repeat(24)];
const config=normalizeConfig({providers:providers.map(id=>({id,protocol:'native-channel',enabled:true})),
 accounts:providers.map((providerId,i)=>({id:ids[i],providerId,
  credentialRef:'driver:'+providerId+':'+ids[i],enabled:true}))});

test('fresh persisted online status restores live public names, quota and campaign facts once per Host lifetime for all owned drivers',async()=>{
 const store=createAccountVerificationStore(),clock=()=>Date.now();
 for(const account of config.accounts)store.set(account,{state:'online',at:clock()});
 const configStore={get:()=>structuredClone(config),replace:()=>{}};
 const restored=new Map(),counters=new Map();
 const makeDrivers=()=>{
  const snapshots=new Map();
  return new Map(providers.map((providerId,i)=>[providerId,{
   accountSnapshot:account=>snapshots.get(account.id)??{},
   refresh:async()=>{throw Error('No automatic model catalog or paid generation allowed')},
   refreshAccountStatus:async({account,signal})=>{
    assert.equal(account.providerId,providerId);
    assert.equal(signal?.aborted,false);
    counters.set(providerId,(counters.get(providerId)??0)+1);
    snapshots.set(account.id,{
     accountName:'真实个人资料'+(i+1),nickname:'真实个人资料'+(i+1),
     profileCheckedAt:clock(),balanceCheckedAt:clock(),
     balance:50+i,balanceUnit:'积分',
     ...(providerId==='own_mimo_desktop'?{
       membershipState:'not_subscribed',usageState:'available',
       usagePercentRemaining:73,usageCheckedAt:clock()}:{}),
    });
    return {state:'online',authVerified:true,checkedAt:clock()};
   },
  }]));
 };
 for(let lifetime=0;lifetime<2;lifetime++){
  const center=createAccountCenter({configStore,verificationStore:store,now:clock,
   drivers:makeDrivers()});
  assert(center.list().accounts.every(a=>!a.nickname),
   'an in-memory snapshot is genuinely absent on next Host start');
  await center.refreshReadOnly();
  const view=center.list().accounts;
  assert.equal(view.length,4);
  for(let i=0;i<view.length;i++){
   assert.equal(view[i].nickname,'真实个人资料'+(i+1));
   assert.equal(view[i].balance,50+i);
   assert.equal(view[i].connectionState,'online');
  }
  assert.equal(view[0].usagePercentRemaining,73);
  await center.refreshReadOnly();
  for(const providerId of providers)
   assert.equal(counters.get(providerId),lifetime+1,
    'no duplicate backend auth requests after volatile account profile is restored');
  center.stop();
 }
});
test('negative persisted login within cooldown cannot trigger extra profile hydration calls',async()=>{
 const account=config.accounts[0],store=createAccountVerificationStore(),clock=()=>Date.now();
 store.set(account,{state:'expired',at:clock()});
 const only=normalizeConfig({providers:[config.providers[0]],accounts:[account]});
 let queried=0;
 const center=createAccountCenter({configStore:{get:()=>structuredClone(only),replace(){}},
  verificationStore:store,now:clock,
  drivers:new Map([[account.providerId,{
   accountSnapshot:()=>({}),
   refreshAccountStatus:async()=>{queried++;return {state:'expired',authVerified:false}},
  }]])});
 await center.refreshReadOnly();
 await center.refreshReadOnly();
 assert.equal(queried,0,'within cooldown existing invalid auth proof is inherited, no wasted remote member request');
 assert.equal(center.list().accounts[0].connectionState,'expired');
 center.stop();
});
