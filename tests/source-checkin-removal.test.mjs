import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createSourceCheckinCenter} from '../src/source-checkins.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

function fixture(){
 const id=sourceAccountOpaqueId('loomy','session-held-by-pack-01');
 let cfg=normalizeConfig({
  embeddedPack:{enabled:true},
  checkin:{autoEnabled:true,autoSourceAccounts:true,timeZone:'Asia/Shanghai',runAt:'10:05'},
 });
 const configStore={
  get:()=>structuredClone(cfg),
  replace:value=>(cfg=normalizeConfig(value)),
 };
 const calls=[],history=[],statusReads=[],now=()=>Date.parse('2026-11-21T04:10:00Z');
 const sourcePack={
  status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[
   {providerId:'loomy',id:'session-held-by-pack-01',enabled:true,nickname:'Managed member'}]}),
  readSourceStatuses:async providerId=>{statusReads.push(providerId);return {state:'ready',accounts:[
   {accountId:'session-held-by-pack-01',authVerified:true,todayCheckedIn:false}]};},
  checkinAccount:async params=>{calls.push(params);return {confirmed:true,message:'confirmed'}}};
 const store={blocked:false,all:()=>structuredClone(history),append:entry=>{
  history.push(entry);return entry;
 }};
 const center=createSourceCheckinCenter({sourcePack,configStore,store,now});
 return {id,center,configStore,calls,statusReads,sourcePack,store,now};
}

test('explicitly detached private member disappears from the source check-in UI and all execution paths',async()=>{
 const {id,center,configStore,calls,statusReads}=fixture();
 const initial=await center.refresh();
 assert.deepEqual(statusReads,['loomy']);
 assert.equal(initial.length,1);
 assert.equal(initial[0].connectionState,'online');
 assert.equal(initial[0].autoCheckinEffective,true);
 configStore.replace({...configStore.get(),sessionReuse:{ignoredIds:[id]}});
 assert.equal(center.has(id),false,'a removed account cannot be treated as a registered sign-in candidate');
 assert.deepEqual(center.snapshot(),[],'the source check-in roster must not resurrect an intentionally removed member');
 await assert.rejects(()=>center.run(id,{source:'manual'}),e=>e.status===404||e.status===409,
  'manual sign-in cannot call the old standalone source session after owner removal');
 assert.equal((await center.tick()).attempted,0,'automatic sign-in must respect account removal');
 assert.deepEqual(calls,[]);
 await center.refresh({force:true});
 assert.deepEqual(center.snapshot(),[],'later read-only channel refresh cannot republish the removed member');
 assert.deepEqual(statusReads,['loomy'],
  'a detached private source with no other active accounts must not be contacted again');
 center.stop();
});

test('disabling self-owned channel blocks source auto-signin even if account is dynamically discovered',async()=>{
 const {id,center,configStore,calls,statusReads}=fixture();
 await center.refresh();
 configStore.replace({...configStore.get(),providers:[
  {id:'own_loomy',protocol:'native-channel',enabled:false},
 ]});
 const item=center.snapshot().find(x=>x.id===id);
 assert.equal(item?.enabled,false);
 assert.equal(item?.autoCheckinEffective,false);
 assert.equal((await center.tick()).attempted,0);
 await assert.rejects(()=>center.run(id,{source:'manual'}),e=>e.status===409);
 assert.equal(calls.length,0);
 await center.refresh({force:true});
 assert.deepEqual(statusReads,['loomy'],
  'a source whose own Provider is disabled must not continue polling official status endpoints');
 center.stop();
});

test('top-level check-in API hides detached source account and refuses every claim path',async()=>{
 const {id,configStore,calls,sourcePack,store,now}=fixture();
 const accountCenter=createAccountCenter({configStore,drivers:new Map()});
 const center=createCheckinCenter({configStore,accountCenter,sourcePack,store,now});
 await center.refreshSources();
 assert.equal(center.snapshot().accounts.filter(x=>x.id===id).length,1);
 configStore.replace({...configStore.get(),sessionReuse:{ignoredIds:[id]}});
 assert.equal(center.snapshot().accounts.some(x=>x.id===id),false);
 assert.equal((await center.tick()).attempted,0);
 await assert.rejects(()=>center.run(id,{source:'manual'}),e=>e.status===404);
 assert.deepEqual(calls,[]);
 center.stop();
});

test('newly enabled second account gets its own remote auth status immediately despite first account provider cache',async()=>{
 const first=sourceAccountOpaqueId('loomy','existing-member-01');
 const second=sourceAccountOpaqueId('loomy','new-enabled-member-02');
 const provider={id:'own_loomy',protocol:'native-channel',enabled:true};
 const member=id=>({id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,
  enabled:id===first,autoCheckin:false});
 let cfg=normalizeConfig({providers:[provider],accounts:[member(first),member(second)]});
 const configStore={get:()=>structuredClone(cfg),replace:next=>(cfg=normalizeConfig(next))};
 const sourcePack={
  listAccounts:async()=>({state:'ready',accounts:[
   {providerId:'loomy',id:'existing-member-01',enabled:true},
   {providerId:'loomy',id:'new-enabled-member-02',enabled:true}]}),
  readSourceStatuses:async()=>{statusReads++;return {state:'ready',accounts:[
   {accountId:'existing-member-01',authVerified:true},
   {accountId:'new-enabled-member-02',authVerified:true}]};},
 };
 let statusReads=0;
 const center=createSourceCheckinCenter({sourcePack,configStore,
  now:()=>Date.parse('2026-11-21T04:00:00Z'),
  store:{blocked:false,all:()=>[],append:entry=>entry}});
 await center.refresh();
 assert.equal(statusReads,1);
 assert.equal(center.snapshot().find(x=>x.id===first).connectionState,'online');
 assert.equal(center.snapshot().find(x=>x.id===second).connectionState,'disabled');
 configStore.replace({...cfg,accounts:cfg.accounts.map(a=>a.id===second?{...a,enabled:true}:a)});
 await center.refresh();
 assert.equal(statusReads,2,
  'existing member source status TTL must not block a newly enabled account');
 assert.equal(center.snapshot().find(x=>x.id===second).connectionState,'online');
 center.stop();
});
test('explicit re-adoption of previously ignored member revives source identity without duplicate claim',async()=>{
 const {id,center,configStore,calls}=fixture();
 await center.refresh();
 configStore.replace({...configStore.get(),sessionReuse:{ignoredIds:[id]}});
 assert.equal(center.snapshot().length,0);
 configStore.replace({...configStore.get(),
  providers:[{id:'own_loomy',protocol:'native-channel',enabled:true}],
  accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,enabled:true,autoCheckin:true}],
 });
 assert.equal(center.has(id),true);
 assert.equal(center.snapshot().length,1);
 assert.equal((await center.tick()).attempted,1);
 assert.equal(calls.length,1);
 assert.equal((await center.tick()).attempted,0);
 center.stop();
});
