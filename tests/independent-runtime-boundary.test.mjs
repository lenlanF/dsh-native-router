import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeOwnership} from '../src/account-runtime-ownership.mjs';
import {createSessionReuse} from '../src/session-reuse.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

test('only exact private-vault or private-pack bindings qualify for independent ownership',()=>{
  const account=(providerId,id,ref='driver:'+providerId+':'+id)=>({
    id,providerId,credentialRef:ref,
  });
  assert.equal(runtimeOwnership(account('own_lingxi','pr_'+'a'.repeat(28))),'owned');
  assert.equal(runtimeOwnership(account('own_workbuddy-cn','wbp_'+'b'.repeat(24))),'owned');
  assert.equal(runtimeOwnership(account('own_workbuddy-global','wbp_'+'a'.repeat(24))),'owned');
  assert.equal(runtimeOwnership(account('own_zcode','sp_'+'c'.repeat(24))),'owned');
  assert.equal(runtimeOwnership(account('own_loomy','sp_'+'d'.repeat(24))),'owned');
  assert.equal(runtimeOwnership(account('own_mimo_desktop','sp_'+'a'.repeat(24))),'owned');
  assert.equal(runtimeOwnership(account('own_doubao','db_'+'b'.repeat(28))),'unverified_binding');
  assert.equal(runtimeOwnership(account('own_aws_quick','aq_'+'a'.repeat(28))),'owned');
  assert.equal(runtimeOwnership(account('own_aws_quick','aq_'+'a'.repeat(24))),'unverified_binding');
  assert.equal(runtimeOwnership(account('own_aws_quick','aq_'+'a'.repeat(28),'host:other')),'linked');
  assert.equal(runtimeOwnership(account('own_custom','sp_'+'f'.repeat(24))),'unverified_binding');
  assert.equal(runtimeOwnership(account('own_zcode','sp_'+'c'.repeat(32))),'unverified_binding');
  assert.equal(runtimeOwnership(account('own_doubao','sp_'+'f'.repeat(24))),'unverified_binding');
  assert.equal(runtimeOwnership(account('codearts','sp_'+'c'.repeat(32))),'linked');
  assert.equal(runtimeOwnership(account('workbuddy','wb_'+'c'.repeat(20))),'linked');
  assert.equal(runtimeOwnership(account('own_loomy','untrusted-id')),'unverified_binding');
  assert.equal(runtimeOwnership(account('own_lingxi','pr_'+'a'.repeat(28),'host:something')),'linked');
});

test('adopted account inventory reads persisted metadata and its own driver, never installed original plugin data',()=>{
 const id='pr_'+'a'.repeat(28);
 const cfg=normalizeConfig({providers:[{id:'own_lingxi',name:'Lingxi',protocol:'native-channel'}],
   accounts:[{id,providerId:'own_lingxi',
     credentialRef:'driver:own_lingxi:'+id,
     displayName:'Persisted From One-Time Import',enabled:true}]});
 let originalCalls=0,driverReads=0;
 const originalReader=()=>{originalCalls++;throw Error('original plugin removed')};
 const center=createAccountCenter({
   configStore:{get:()=>structuredClone(cfg),replace(){}},
   drivers:new Map([['own_lingxi',{accountSnapshot(){
     driverReads++;return {balance:45,balanceUnit:'积分',
       checkinDate:'2026-11-20',checkinOutcome:'claimed'};
   }}]]),
   publicMetadataFor:originalReader,
 });
 assert.equal(center.list().accounts[0].nickname,'Persisted From One-Time Import');
 assert.equal(center.list().accounts[0].balance,45);
 assert.equal(center.list().accounts[0].runtimeMode,'owned');
 assert.equal(center.list().accounts[0].origin.kind,'independent-owned'); const stop=center.start();
 assert.equal(center.list().accounts[0].nickname,'Persisted From One-Time Import');
 stop();
 assert.equal(originalCalls,0);
 assert.ok(driverReads>=2);
});

test('starting reuse service never scans an installed original plugin',async()=>{
 let scans=0,discovery=0,imports=0;
 const cfg=normalizeConfig({sessionReuse:{enabled:true}});
 const store={get:()=>structuredClone(cfg),replace(){imports++}};
 const reuse=createSessionReuse({configStore:store,
   installedInventory:{scan:async()=>{scans++;return {accounts:[]}}},
   drivers:new Map([['workbuddy',{discover:async()=>{discovery++;return []}}]]),
   embeddedPack:{status:()=>({state:'mounted'}),listAccounts:async()=>({state:'ready',accounts:[]})},
   intervalMs:20,
 });
 const stop=reuse.start();
 await new Promise(resolve=>setTimeout(resolve,90));
 stop();
 assert.equal(scans,0);
 assert.equal(discovery,0);
 assert.equal(imports,0);
});

test('manual reuse scan is discovery-only and does not silently import source references',async()=>{
 const cfg=normalizeConfig({sessionReuse:{enabled:true}});
 let writes=0,imports=0;
 const store={get:()=>structuredClone(cfg),replace(){writes++}};
 const reuse=createSessionReuse({configStore:store,
   installedInventory:{scan:async()=>({accounts:[]})},
   drivers:new Map([['workbuddy',{discover:async()=>[{
     id:'wb_'+'a'.repeat(20),reusable:true,
   }],importCandidate:async()=>{imports++;throw Error('should not import')}}]]),
   embeddedPack:{status:()=>({state:'mounted'}),
     listAccounts:async()=>({state:'ready',accounts:[]})},
 });
 const result=await reuse.scan({importReferences:false});
 assert.equal(result.linked,0);
 assert.equal(result.needsOneTimeMigration,1);
 assert.ok(result.results.some(row=>row.state==='requires_independent_adoption'));
 assert.equal(writes,0);
 assert.equal(imports,0);
 reuse.stop();
});
