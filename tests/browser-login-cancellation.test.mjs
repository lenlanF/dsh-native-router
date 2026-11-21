import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserLoginFlow} from '../src/channels/browser-login.mjs';

function deferred(){
 let resolve,reject;
 const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail});
 return {promise,resolve,reject};
}
async function eventually(check){
 for(let i=0;i<50;i++){
  if(check())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 throw Error('Expected login state transition did not occur');
}
function fixture({addAccount,rollbackAccount,validateCookie,waiting}={}){
 const opened=waiting??deferred(),calls=[];
 const flow=createBrowserLoginFlow({
  loginUrl:'https://www.doubao.com/chat/',
  extractCookie:()=>'',addAccount,rollbackAccount,validateCookie,
  browserRuntime:{
   async start({loginUrl}){calls.push('start:'+loginUrl);return opened.promise},
   cancel(){calls.push('cancel')},
   stop(){calls.push('stop')},
  },
 });
 return {flow,opened,calls};
}
test('cancel during isolated browser login never persists a late captured session',async()=>{
 let saves=0;
 const rig=fixture({addAccount:async()=>{saves++;return {account:{id:'new'}}}});
 assert.equal((await rig.flow.start()).status,'waiting');
 assert.equal(rig.flow.cancel().status,'canceled');
 rig.opened.resolve('sessionid=late-valid-session');
 await eventually(()=>rig.calls.includes('stop'));
 assert.equal(saves,0);
 assert.equal(rig.flow.status().status,'canceled');
 assert.equal(rig.calls.filter(x=>x==='cancel').length,1);
});
test('cancel while saving newly captured session rolls back private credential',async()=>{
 const saving=deferred(),release=deferred(),rolled=[];
 const account={id:'db_new',providerId:'own_doubao'};
 const rig=fixture({
  addAccount:async()=>{saving.resolve();await release.promise;return {account}},
  rollbackAccount:async result=>{rolled.push(result)},
 });
 await rig.flow.start();
 rig.opened.resolve('sessionid=saving-in-flight');
 await saving.promise;
 assert.equal(rig.flow.cancel().status,'canceled');
 release.resolve();
 await eventually(()=>rig.calls.includes('stop'));
 assert.equal(rig.flow.status().status,'canceled');
 assert.deepEqual(rolled,[account]);
});
test('cancel during duplicate login never deletes a previously owned credential',async()=>{
 const saving=deferred(),release=deferred(),rolled=[];
 const rig=fixture({
  addAccount:async()=>{saving.resolve();await release.promise;
   return {account:{id:'existing',alreadyOwned:true}}},
  rollbackAccount:async account=>rolled.push(account),
 });
 await rig.flow.start();
 rig.opened.resolve('sessionid=owned-session');
 await saving.promise;
 rig.flow.cancel();release.resolve();
 await eventually(()=>rig.calls.includes('stop'));
 assert.equal(rig.flow.status().status,'canceled');
 assert.deepEqual(rolled,[]);
});
test('cancel during a rotated existing credential triggers exact rollback receipt',async()=>{
 const saving=deferred(),release=deferred(),rolled=[];
 const account={id:'existing',alreadyOwned:true,rollbackToken:'private-random-receipt'};
 const rig=fixture({
  addAccount:async()=>{saving.resolve();await release.promise;return {account}},
  rollbackAccount:async result=>rolled.push(result),
 });
 await rig.flow.start();
 rig.opened.resolve('sessionid=rotated-existing-session');
 await saving.promise;
 rig.flow.cancel();release.resolve();
 await eventually(()=>rig.calls.includes('stop'));
 assert.equal(rig.flow.status().status,'canceled');
 assert.deepEqual(rolled,[account]);
});
test('uncanceled login saves exactly once and reports completed receipt',async()=>{
 const saves=[],rig=fixture({
  addAccount:async input=>{saves.push(input);
   return {account:{id:'owned-only',providerId:'own_doubao'}}},
 });
 await rig.flow.start();
 rig.opened.resolve('sessionid=completed-session');
 await eventually(()=>rig.flow.status().status==='done');
 assert.equal(rig.flow.status().account.id,'owned-only');
 assert.equal(saves.length,1);
 await eventually(()=>rig.calls.includes('stop'));
});
test('member cookie without a verified upstream identity cannot be saved as owned',async()=>{
 let writes=0,validations=0;
 const rig=fixture({
  validateCookie:async()=>{validations++;return false},
  addAccount:async()=>{writes++},
 });
 await rig.flow.start();
 rig.opened.resolve('sessionid=unverified');
 await eventually(()=>rig.flow.status().status==='error');
 assert.equal(validations,1);
 assert.equal(writes,0);
});
