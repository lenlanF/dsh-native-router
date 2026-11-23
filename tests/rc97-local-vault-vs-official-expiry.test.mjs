import test from 'node:test';
import assert from 'node:assert/strict';
import {createMimoDesktopDriver} from '../src/channels/mimo-desktop.mjs';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';

const mimoAccount={providerId:'own_mimo_desktop',
 id:'sp_'+'a'.repeat(24),
 credentialRef:'driver:own_mimo_desktop:sp_'+'a'.repeat(24),enabled:true};
const doubaoAccount={providerId:'own_doubao',
 id:'db_'+'b'.repeat(28),
 credentialRef:'driver:own_doubao:db_'+'b'.repeat(28),enabled:true};
test('MiMo credential service temporarily unreadable is NOT official proof that user login expired',async()=>{
 let calls=0;
 const driver=createMimoDesktopDriver({
   vault:{resolve:async()=>{throw Error('simulated vault service not ready')}},
   transport:{probe:async()=>{calls++;return {state:'online',authVerified:true}}},
   readCurrentSession:async()=>null,
 });
 const row=await driver.refreshAccountStatus({account:mimoAccount});
 assert.notEqual(row.state,'expired');
 assert.equal(row.authVerified,false);
 assert.equal(calls,0,'no unauthorized official inference/probe');
});
test('Doubao credential service temporarily unreadable is NOT a revoked cookie',async()=>{
 let requests=0;
 const driver=createDoubaoDriver({
  vault:{resolve:async()=>{throw Error('simulated vault service not ready')}},
  fetchImpl:async()=>{requests++;throw Error('network must not start')}
 });
 const row=await driver.refreshAccountStatus({account:doubaoAccount});
 assert.notEqual(row.state,'expired');
 assert.equal(row.authVerified,false);
 assert.equal(requests,0);
});
test('Doubao official 401 remains a definitive expired session, not a local transient issue',async()=>{
 let requests=0;
 const driver=createDoubaoDriver({
  vault:{resolve:async()=>({value:JSON.stringify({
   cookie:'sessionid=synthetic-session-abcdefghijklmnopqrstuvwxyz'})})},
  fetchImpl:async()=>{requests++;return new Response('{}',{status:401})}
 });
 const row=await driver.refreshAccountStatus({account:doubaoAccount});
 assert.equal(row.state,'expired');
 assert.equal(row.authVerified,false);
 assert.equal(requests,1);
});
test('MiMo official explicit expired reply remains expired after private vault resolves',async()=>{
 // Establish a real synthetic independently owned credential via its public
 // driver import path, then make the remote authority reject that same user.
 let remoteState='online',fetchCount=0;
 const session={region:'cn',userId:'member-123',cUserId:'c-user',
   passToken:'synthetic-long-pass-token-12345678'};
 const entries=new Map();
 const driver=createMimoDesktopDriver({
  vault:{
   resolve:async key=>entries.get(key),
   set:async(key,value)=>entries.set(key,{value}),
   unset:async key=>entries.delete(key),
  },
  readCurrentSession:async()=>session,
  transport:{probe:async()=>{fetchCount++;return {
   state:remoteState,authVerified:remoteState==='online',accountName:'Test Owner'}}}
 });
 const discovered=await driver.discover();
 const imported=await driver.importCandidate({candidateId:discovered[0].id,consent:true});
 const account={id:imported.id,credentialRef:imported.credentialRef,
   providerId:'own_mimo_desktop',enabled:true};
 remoteState='expired';
 const row=await driver.refreshAccountStatus({account});
 assert.equal(row.state,'expired');
 assert.equal(row.authVerified,false);
 assert.ok(fetchCount>=2);
});