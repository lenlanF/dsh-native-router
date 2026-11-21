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
test('ZCode only counts unexpired official named token gifts, never fallback labels or paid packages',()=>{
 const expiry=new Date(Date.now()+86400000).toISOString();
 const facts=sourceAccountFacts({providerId:'zcode',observedAt:Date.now(),
  balanceRow:{accountId:'safe',balance:{total:90000,packages:[
   {name:'签到赠送',officialName:'签到赠送',officialUnitType:'token',
    unit:'token',remaining:2400,active:true,expiredTime:expiry},
   {name:'购买套餐',officialName:'购买套餐',officialUnitType:'token',
    unit:'token',remaining:38000,active:true,expiredTime:expiry},
   {name:'ZCode 免费额度',officialName:null,officialUnitType:'token',
    unit:'token',remaining:49000,active:true,expiredTime:expiry},
   {name:'每日赠送过期',officialName:'每日赠送过期',officialUnitType:'token',
    unit:'token',remaining:600,expiredTime:'2020-01-01T00:00:00Z'},
  ]}}});
 assert.equal(facts.balance,90000);
 assert.equal(facts.giftedBalance,2400);
 const official=sourceAccountFacts({providerId:'zcode',balanceRow:{balance:{packages:[
  {name:'ZCode 免费额度',officialName:'ZCode 免费额度',officialUnitType:'token',
   remaining:1300,expiredTime:expiry}]}}});
 assert.equal(official.giftedBalance,1300,'exact name read from official bucket may be free');
 for(const change of [{officialName:null},{officialUnitType:null},
   {expiredTime:''},{officialName:'购买的免费订阅'},{remaining:-1}]){
  const bad=sourceAccountFacts({providerId:'zcode',balanceRow:{balance:{packages:[{
   name:'ZCode 免费额度',officialName:'ZCode 免费额度',officialUnitType:'token',
   remaining:1300,expiredTime:expiry,...change}]}}});
  assert.equal(bad.giftedBalance,undefined,JSON.stringify(change));
 }
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
