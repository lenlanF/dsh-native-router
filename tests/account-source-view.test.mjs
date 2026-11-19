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
test('same provider-scoped source identity selects verified existing or autonomous source; backup retained',()=>{
 const id=sourceAccountOpaqueId('zcode','same-user');
 const original={id,providerId:'zcode',nickname:'ZCode user',enabled:true,
   connectionState:'online',reusedExistingSession:true};
 const embedded={state:'ready',accounts:[{providerId:'zcode',id:'same-user',
   nickname:'ZCode user',enabled:true}]};
 const view=(state)=>mergeAccountSources({
   roster:{channels:[{id:'zcode',name:'ZCode'}],accounts:[{...original,connectionState:state}]},
   embeddedAccounts:embedded,
   sourceRows:[{id,providerId:'zcode',sourceAccount:true,
     connectionState:state==='online'?'not_checked':'online'}],
 });
 const first=view('online');
 assert.equal(first.accounts.length,1);
 assert.equal(first.accounts[0].activeSource,'reused');
 assert.equal(first.accounts[0].backupSources.length,1);
 assert.equal(first.accounts[0].backupSources[0].kind,'owned');
 const switched=view('expired');
 assert.equal(switched.accounts.length,1);
 assert.equal(switched.accounts[0].activeSource,'owned');
 assert.equal(switched.accounts[0].backupSources[0].kind,'reused');
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
