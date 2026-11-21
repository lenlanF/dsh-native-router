import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_PACK_PROVIDERS} from '../src/embedded-pack.mjs';
import {sourceAccountFacts} from '../src/source-account-facts.mjs';
import {createSourceChannelDriver} from '../src/source-channel-driver.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {publicAccountName} from '../src/account-facts.mjs';

const stream=()=>async function*(){
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text:'verified inference'};
  yield {type:'block-end',index:0,block:{type:'text',text:'verified inference'}};
  yield {type:'finish',reason:{kind:'stop'}};
};

test('all 13 owned source drivers read account facts from their OWN channel API and separately prove inference',async()=>{
  assert.equal(SOURCE_PACK_PROVIDERS.length,13);
  for(const providerId of SOURCE_PACK_PROVIDERS){
    const sourceAccountId='owned-'+providerId;
    const id=sourceAccountOpaqueId(providerId,sourceAccountId);
    const owner='own_'+providerId;
    const calls=[];
    const ownPack={
      status:()=>({state:'mounted',channels:[providerId],
        modelAdapterReady:[providerId],experimentalMultiAccountProviders:[providerId]}),
      listAccounts:async()=>({state:'ready',accounts:[{
        id:sourceAccountId,providerId,enabled:true,nickname:''}]}),
      readSourceStatuses:async requested=>{
        calls.push('remote:'+requested);
        return {state:'ready',checkedAt:12345,accounts:[{
          accountId:sourceAccountId,nickname:providerId+'-real-user',
          balance:0,balanceUnit:'积分',authVerified:true,
          authEvidence:'authenticated_upstream_balance'}]};
      },
      listModels:async()=>({state:'ready',models:[{id:'test-model'}]}),
      streamNative:async req=>{
        calls.push('generate:'+req.providerId+':'+req.sourceAccountId);
        return stream()();
      },
    };
    const driver=createSourceChannelDriver({
      providerId,accountProviderId:owner,embeddedPack:ownPack,
    });
    const account={id,providerId:owner,credentialRef:'driver:'+owner+':'+id};
    assert.deepEqual((await driver.listModels({account})),[{id:'test-model'}]);
    assert.equal(driver.accountSnapshot(account).modelInferenceVerifiedAt,null);
    const facts=await driver.refreshAccountStatus({account});
    assert.equal(facts.nickname,providerId+'-real-user');
    assert.equal(facts.balance,0,'true zero is not missing balance');
    assert.equal(facts.authVerified,true);
    assert.equal(driver.accountSnapshot(account).nickname,providerId+'-real-user');
    assert.equal((await driver.refresh({account})).state,'online');
    assert.equal(driver.accountSnapshot(account).modelInferenceVerifiedAt,null,
      'account read-only authentication is distinct from successful inference');
    const output=await driver.generate({account,model:'test-model',options:{
      messages:[{role:'user',content:[{type:'text',text:'ping'}]}],
    }});
    assert.equal(output.text,'verified inference');
    assert.ok(driver.accountSnapshot(account).modelInferenceVerifiedAt>0);
    assert.ok(calls.some(x=>x==='generate:'+providerId+':'+sourceAccountId));
    assert.ok(calls.every(x=>!x.includes('original-plugin')),
      'never fall back to the original plugin');
  }
});

test('catalog enumeration or account discovery alone cannot prove a logged-in model works',async()=>{
 const providerId='codearts',sourceAccountId='own-empty';
 const id=sourceAccountOpaqueId(providerId,sourceAccountId);
 const pack={
   status:()=>({state:'mounted',modelAdapterReady:[providerId]}),
   listAccounts:async()=>({state:'ready',accounts:[{id:sourceAccountId,
     providerId,enabled:true,nickname:'账号1'}]}),
   listModels:async()=>({state:'ready',models:[{id:'fake-model'}]}),
   readSourceStatuses:async()=>({state:'ready',accounts:[{
      accountId:sourceAccountId,nickname:'',authVerified:false,
      balanceState:'not_returned'}]}),
 };
 const driver=createSourceChannelDriver({providerId,
   accountProviderId:'own_'+providerId,embeddedPack:pack});
 const account={id,providerId:'own_'+providerId,
   credentialRef:'driver:own_'+providerId+':'+id};
 assert.deepEqual(await driver.listModels({account}),[{id:'fake-model'}]);
 assert.equal((await driver.refresh({account})).state,'pending');
 assert.equal((await driver.refreshAccountStatus({account})).authVerified,false);
 assert.equal(driver.accountSnapshot(account).nickname,'');
 assert.equal(driver.accountSnapshot(account).modelInferenceVerifiedAt,null);
});

test('single official quota package with explicit remaining balance and unit is presented without inventing totals',()=>{
 const result=sourceAccountFacts({providerId:'zcode',observedAt:5566,
   balanceRow:{accountId:'member-a',balance:{packages:[{
     remaining:12.5,unit:'token',name:'valid subscription'}]}}});
 assert.equal(result.balance,12.5);
 assert.equal(result.balanceUnit,'token');
 assert.equal(result.balanceCheckedAt,5566);
 assert.equal(result.authVerified,true);
 const remainingBeforeTotal=sourceAccountFacts({providerId:'loomy',
  balanceRow:{balance:{remaining:20,total:100,unit:'积分'}},observedAt:5567});
 assert.equal(remainingBeforeTotal.balance,20,
  'show actual remaining quota, not subscription total while remaining exists');
 const ambiguous=sourceAccountFacts({providerId:'zcode',
   balanceRow:{balance:{packages:[{remaining:10,unit:'token'},
     {remaining:20,unit:'points'}]}}});
 assert.equal(ambiguous.balance,undefined,
   'multiple different quota packages cannot be combined or treated as one currency');
 assert.equal(ambiguous.authVerified,false);
 assert.equal(ambiguous.balanceState,'not_returned');
 const unsupported=sourceAccountFacts({providerId:'unknown',
   balanceRow:{balance:{packages:[{remaining:5,unit:'token'}]}}});
 assert.equal(unsupported.authVerified,false,'unknown channel balance is never proof of login');
});
test('ZCode Start Plan gift uses signed plan ID and exact model instead of free-word guesses',()=>{
 const now=Date.now(),expiry=new Date(now+86400000).toISOString();
 const start={name:'GLM-5.3-Flash',officialName:'GLM-5.3-Flash',
  officialPlanId:'zcode-v3-start-plan-trust-1006',officialUnitType:'token',
  officialMeter:'input+output',unit:'token',remaining:2600,expiredTime:expiry};
 const paid={name:'Premium Coding',officialName:'GLM-5.3-Flash',
  officialPlanId:'coding-plan-paid-monthly',officialUnitType:'token',
  remaining:700000,expiredTime:expiry};
 const fallback={name:'ZCode 免费额度',officialName:null,
  officialPlanId:null,officialUnitType:'token',remaining:90000,expiredTime:expiry};
 const eligible=sourceAccountFacts({providerId:'zcode',observedAt:now,
  balanceRow:{balance:{total:792600,previewStartPlanCount:2,packages:[start,paid,fallback,{...start,remaining:9000}]}}});
 assert.equal(eligible.balance,792600);
 assert.equal(eligible.giftedBalance,2600,
   'duplicate Start Plan must never inflate a no-charge allowance');
 assert.equal(eligible.zcodePlanBuckets,2);
 assert.equal(eligible.zcodeFlashBuckets,2);
  assert.equal(eligible.zcodePreviewStartPlans,2);
  for(const change of [
  {officialPlanId:'coding-plan-premium'},
  {officialPlanId:null},{officialPlanId:'zcode-v3-paid-plan-123'},
  {officialName:null},{officialName:'GLM-5.3'},
  {officialName:'GLM-5.3-Flash paid'},
  {officialUnitType:'points'},{officialUnitType:null},
  {expiredTime:''},{expiredTime:new Date(now-200).toISOString()},
  {expiredTime:new Date(now+60000).toISOString()},
  {active:false},{remaining:-1},
 ]){
   const facts=sourceAccountFacts({providerId:'zcode',observedAt:now,
    balanceRow:{balance:{packages:[{...start,...change}]}}});
   assert.equal(facts.giftedBalance,undefined,JSON.stringify(change));
 }
 const two=sourceAccountFacts({providerId:'zcode',observedAt:now,
  balanceRow:{balance:{packages:[start,{...start,
   officialPlanId:'zcode-v3-start-plan-trust-1007',remaining:1700}]}}});
 assert.equal(two.giftedBalance,4300);
});
test('Loomy daily gift is extracted only from the exact official daily bucket, not paid permanent points',()=>{
 const gift=sourceAccountFacts({providerId:'loomy',balanceRow:{balance:{total:9500,packages:[
  {name:'永久积分',unit:'积分',remaining:7500},
  {name:'每日赠送',unit:'积分',remaining:2000,active:true},
 ]}}});
 assert.equal(gift.loomyDailyGift,2000);
 assert.equal(gift.authVerified,true);
 const paid=sourceAccountFacts({providerId:'loomy',balanceRow:{balance:{total:9000,packages:[
  {name:'永久积分',unit:'积分',remaining:8000},
  {name:'订阅赠送',unit:'积分',remaining:1000},
 ]}}});
 assert.equal(paid.loomyDailyGift,undefined,'permanent balance cannot fund a free-only test');
 const ambiguous=sourceAccountFacts({providerId:'loomy',balanceRow:{balance:{total:9999}}});
 assert.equal(ambiguous.loomyDailyGift,undefined,'aggregate balance cannot be treated as daily gift');
});

test('all source balance shapes and missing identity are safe, with no synthetic names or zeros',()=>{
 const date=1234;
 for(const [providerId,balance,balanceValue,unit] of [
  ['codearts',0,0,null],
  ['zcode',{total:2700,packages:[{unit:'token'}]},2700,'token'],
  ['loomy',{remaining:33,unit:'积分'},33,'积分'],
  ['qoder',{balance:6},6,null],
  ['trae',{credits:7},7,null],
 ]){
  const facts=sourceAccountFacts({providerId,
   identity:{nickname:providerId+' · 本机账号 1'},
   statusRow:{accountId:'selected',status:{available:true}},
   balanceRow:{accountId:'selected',balance},observedAt:date});
  assert.equal(facts.nickname,undefined);
  assert.equal(facts.balance,balanceValue);
  assert.equal(facts.balanceUnit,unit??undefined);
  assert.equal(facts.authVerified,true);
  assert.equal(facts.balanceCheckedAt,date);
 }
 assert.equal(sourceAccountFacts({providerId:'codearts',
   balanceRow:{balance:null,error:'no credit package'}}).authVerified,false);
 assert.equal(sourceAccountFacts({providerId:'codearts',
   balanceRow:{balance:null,error:'no credit package'}}).balance,undefined);
 assert.equal(sourceAccountFacts({providerId:'unknown',
   balanceRow:{balance:1}}).authVerified,false);
 for(const label of ['账号1','账号 #23','Account 7',
   'Loomy · 独立账号','Loomy · 本机账号 1','ZCode 来源账号']){
   assert.equal(publicAccountName({nickname:label}),'',label+' must be filtered');
 }
 assert.equal(publicAccountName({username:'real-person'}),'real-person');
});
