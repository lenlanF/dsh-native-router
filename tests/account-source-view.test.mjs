import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAccountSources} from '../src/account-source-view.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';

test('CodeArts autonomous OAuth account appears in existing CodeArts channel, not phantom zero-account card',()=>{
 const accountId=sourceAccountOpaqueId('codearts','ca_owned_x1');
 const data=mergeAccountSources({
   roster:{channels:[{id:'codearts',name:'华为云 CodeArts',referenceOnly:true}],
     accounts:[]},
   embeddedAccounts:{state:'ready',accounts:[{providerId:'codearts',id:'ca_owned_x1',
     nickname:'huaweicloud-user',enabled:true}]},
   sourceRows:[],embeddedStatus:{modelAdapterReady:['codearts']},
 });
 assert.equal(data.accounts.length,1);
 assert.equal(data.accounts[0].providerId,'codearts');
 assert.equal(data.accounts[0].routeProviderId,'own_codearts');
 assert.equal(data.accounts[0].id,accountId);
 assert.equal(data.accounts[0].nickname,'huaweicloud-user');
 assert.equal(data.channels.length,1);
 assert.equal(data.accounts[0].connectionState,'not_checked');
});
test('same native identity has a verified original provider and a separate autonomous credential path',()=>{
  const id=sourceAccountOpaqueId('zcode','same-user');
  const original={id,providerId:'zcode',nickname:'ZCode user',enabled:true,
    connectionState:'online',reusedExistingSession:true};
  const embedded={state:'ready',accounts:[{providerId:'zcode',id:'same-user',
    nickname:'ZCode user',enabled:true,authorizationSource:'autonomous'}]};
  const view=state=>mergeAccountSources({
    roster:{channels:[{id:'zcode',name:'ZCode'}],accounts:[{...original,connectionState:state}]},
    embeddedAccounts:embedded,
    sourceRows:[{id,providerId:'zcode',sourceAccount:true,
      connectionState:state==='online'?'not_checked':'online'}],
  });
  const first=view('online');
  assert.equal(first.accounts.length,1);
  assert.equal(first.accounts[0].activeSource,'reused');
  assert.equal(first.accounts[0].backupSources.length,1);
  assert.equal(first.accounts[0].backupSources[0].kind,'autonomous');
  const switched=view('expired');
  assert.equal(switched.accounts.length,1);
  assert.equal(switched.accounts[0].activeSource,'autonomous');
  assert.equal(switched.accounts[0].backupSources[0].kind,'reused');
});
test('actual four-record pool taxonomy: two adopted original logins, one CodeArts OAuth and one ZCode OAuth',()=>{
 const rows=[
   {providerId:'loomy',id:'nr_migrated_loomy',enabled:true,
     authorizationSource:'adopted',nickname:''},
   {providerId:'zcode',id:'nr_migrated_zcode',enabled:true,
     authorizationSource:'adopted',nickname:''},
   {providerId:'codearts',id:'codearts-real',enabled:true,
     authorizationSource:'autonomous',nickname:''},
   {providerId:'zcode',id:'zcode-new',enabled:true,
     authorizationSource:'autonomous',nickname:'ZCode real account'},
 ];
 const codearts=sourceAccountOpaqueId('codearts','codearts-real');
 const migratedLoomy=sourceAccountOpaqueId('loomy','nr_migrated_loomy');
 const migratedZcode=sourceAccountOpaqueId('zcode','nr_migrated_zcode');
 const status=rows.map(r=>({id:sourceAccountOpaqueId(r.providerId,r.id),
   providerId:r.providerId,sourceAccount:true,
   connectionState:'online',balance:r.providerId==='codearts'?72:5,
   balanceUnit:r.providerId==='zcode'?'token':'积分'}));
 const view=mergeAccountSources({
   roster:{channels:[
     {id:'own_loomy',name:'Loomy'},
     {id:'own_zcode',name:'ZCode'},
     {id:'codearts',name:'华为云 CodeArts'},
   ],accounts:[
     {id:migratedLoomy,providerId:'own_loomy',
       origin:{kind:'embedded-account-pool'},connectionState:'online',enabled:true},
     {id:migratedZcode,providerId:'own_zcode',
       origin:{kind:'embedded-account-pool'},connectionState:'online',enabled:true},
     {id:codearts,providerId:'codearts',
       origin:{kind:'embedded-account-pool'},connectionState:'pending',enabled:true},
   ]},
   embeddedAccounts:{state:'ready',accounts:rows},
   sourceRows:status,
 });
 assert.equal(view.accounts.length,4,'do not double count registered private pool refs');
 const counts=new Map(['loomy','zcode','codearts'].map(provider=>[
   provider,view.accounts.filter(x=>x.providerId===provider).length]));
 assert.deepEqual([...counts.values()],[1,2,1]);
 assert.equal(view.accounts.find(x=>x.providerId==='loomy').sourceKind,'adopted');
 assert.equal(view.accounts.find(x=>x.id===migratedZcode).sourceKind,'adopted');
 assert.equal(view.accounts.find(x=>x.id===codearts).sourceKind,'autonomous');
 assert.equal(view.accounts.find(x=>x.id===codearts).connectionState,'online');
 assert.equal(view.accounts.find(x=>x.id===codearts).balance,72);
 assert.equal(view.accounts.find(x=>x.id===codearts).nickname,'');
 assert.equal(view.accounts.find(x=>x.id===codearts).backupSources.length,0);
 assert.equal(view.channels.filter(x=>x.id==='zcode').length,1);
 assert.equal(view.accounts.filter(x=>x.activeSource==='autonomous').length,2);
});
test('CodeArts self-owned QR login uses the public provider ID without duplicate fallback or losing its model-test affordance',()=>{
 const id=sourceAccountOpaqueId('codearts','qr-user');
 const view=mergeAccountSources({
   roster:{channels:[{id:'codearts',name:'CodeArts'}],accounts:[{
     id,providerId:'codearts',runtimeMode:'owned',modelTestAvailable:true,
     origin:{kind:'independent-owned'},connectionState:'online',enabled:true,
   }]},
   embeddedAccounts:{state:'ready',accounts:[{providerId:'codearts',id:'qr-user',
     enabled:true,authorizationSource:'autonomous',nickname:'real-name'}]},
   sourceRows:[{id,providerId:'codearts',sourceAccount:true,
     connectionState:'online',balance:50,balanceUnit:'积分'}],
 });
 assert.equal(view.accounts.length,1);
 assert.equal(view.accounts[0].sourceKind,'autonomous');
 assert.equal(view.accounts[0].runtimeMode,'owned');
 assert.equal(view.accounts[0].routeProviderId,'codearts');
 assert.equal(view.accounts[0].modelTestAvailable,true);
 assert.equal(view.accounts[0].backupSources.length,0);
 assert.equal(view.accounts[0].balance,50);
});
test('different account IDs and different channels never merge based on nickname',()=>{
 const sameName='duplicate-nickname';
 const result=mergeAccountSources({
   roster:{channels:[{id:'codearts',name:'CodeArts'},{id:'zcode',name:'ZCode'}],
     accounts:[{id:sourceAccountOpaqueId('codearts','a'),providerId:'codearts',
       nickname:sameName,enabled:true,connectionState:'online'}]},
   embeddedAccounts:{accounts:[
     {providerId:'codearts',id:'b',nickname:sameName,enabled:true},
     {providerId:'zcode',id:'a',nickname:sameName,enabled:true}]},
 });
 assert.equal(result.accounts.length,3);
 assert.equal(result.accounts.every(x=>x.backupSources.length===0),true);
});
