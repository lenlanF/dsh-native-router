import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createSourceCheckinCenter} from '../src/source-checkins.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';

const NOW=Date.parse('2026-11-21T05:15:00Z');
const defer=()=>{let release;const pending=new Promise(resolve=>{release=resolve});return {pending,release}};
const store=()=>{
 const items=[];return {blocked:false,all:()=>structuredClone(items),append:r=>(items.push(r),structuredClone(r))};
};
function sourceFixture(){
 const id=sourceAccountOpaqueId('loomy','already-bound-member');
 let cfg=normalizeConfig({embeddedPack:{enabled:true},
  providers:[{id:'own_loomy',protocol:'native-channel',enabled:true}],
  accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,enabled:true,
   autoCheckin:true}],
  checkin:{autoEnabled:false,autoSourceAccounts:true}});
 const configStore={get:()=>structuredClone(cfg),replace:next=>(cfg=normalizeConfig(next))};
 const started=defer(),upstream=defer(),history=store();
 let calls=0;
 const sourcePack={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[{
   providerId:'loomy',id:'already-bound-member',enabled:true}]}),
  checkinAccount:async()=>{
   calls++;started.release();await upstream.pending;
   return {confirmed:true,message:'server confirmed same-day claim'};
  }};
 const center=createSourceCheckinCenter({sourcePack,configStore,store:history,now:()=>NOW});
 return {id,center,configStore,history,started,upstream,get calls(){return calls}};
}
test('source claim accepted after user disabled account must not write successful history or permit inherited success',async()=>{
 const h=sourceFixture();await h.center.refresh();
 const claim=h.center.run(h.id);
 await h.started.pending;
 h.configStore.replace({...h.configStore.get(),accounts:h.configStore.get().accounts.map(a=>({...a,enabled:false}))});
 h.upstream.release();
 await assert.rejects(claim,e=>e?.status===409||e?.code==='ERR_ACCOUNT_CHANGED');
 assert.equal(h.history.all().length,0,'disabled account cannot publish success after in-flight source claim');
 assert.equal(h.center.snapshot()[0].checkinState,'not_run');
 h.center.stop();
});
test('old source account confirmation cannot write success after exact credential binding is replaced mid-claim',async()=>{
 const h=sourceFixture();await h.center.refresh();
 const claim=h.center.run(h.id);await h.started.pending;
 h.configStore.replace({...h.configStore.get(),accounts:h.configStore.get().accounts.map(a=>({
   ...a,credentialRef:'driver:own_loomy:sp_'+'b'.repeat(24),
 }))});
 h.upstream.release();
 await assert.rejects(claim,e=>e?.status===409||e?.code==='ERR_ACCOUNT_CHANGED');
 assert.equal(h.history.all().length,0,'old login cannot write new credential account history');
 h.center.stop();
});
function nativeFixture(){
 let cfg=normalizeConfig({providers:[{id:'own_lingxi',protocol:'native-channel',enabled:true}],
  accounts:[{id:'lingxi-a',providerId:'own_lingxi',credentialRef:'driver:own_lingxi:lingxi-a',
   enabled:true,autoCheckin:false}]});
 const configStore={get:()=>structuredClone(cfg),replace:next=>(cfg=normalizeConfig(next))};
 const started=defer(),upstream=defer(),history=store();
 const driver={checkIn:async({date})=>{
  started.release();await upstream.pending;
  return {confirmed:true,date,message:'Official confirmed'};
 }};
 const accountCenter=createAccountCenter({configStore,drivers:new Map([['own_lingxi',driver]])});
 const center=createCheckinCenter({configStore,accountCenter,store:history,now:()=>NOW});
 return {configStore,center,history,started,upstream};
}
test('claim confirmation refreshes only the claimed source Provider instead of refetching every other channel',async()=>{
 const sourceIds=['loomy','zcode'];
 const configStore={get:()=>normalizeConfig({embeddedPack:{enabled:true},
  checkin:{autoEnabled:false,autoSourceAccounts:true}}),replace(){}};
 const calls=[],checkinId=sourceAccountOpaqueId('loomy','a-member');
 let claimed=false;
 const sourcePack={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:sourceIds.map(providerId=>({
   providerId,id:'a-member',enabled:true,
  }))}),
  readSourceStatuses:async providerId=>{
   calls.push('status:'+providerId);
   return {state:'ready',accounts:[{
    accountId:'a-member',todayCheckedIn:providerId==='loomy'&&claimed,
    authVerified:true,
   }]};
  },
  checkinAccount:async({providerId})=>{
   calls.push('claim:'+providerId);claimed=true;
   return {state:'pending_confirmation',accepted:true};
  },
 };
 const center=createSourceCheckinCenter({sourcePack,configStore,store:store(),now:()=>NOW});
 await center.refresh();
 assert.deepEqual(calls,['status:loomy','status:zcode']);
 calls.length=0;
 const result=await center.run(checkinId,{source:'manual'});
 assert.equal(result.record.state,'success');
 assert.deepEqual(calls,['claim:loomy','status:loomy'],
  'claim confirmation must not recontact an unrelated ZCode account');
 center.stop();
});
test('accepted sign-in must await an existing PRE-claim source status read and then perform a NEW post-claim confirmation',async()=>{
 const id=sourceAccountOpaqueId('loomy','delayed-member');
 const configStore={get:()=>normalizeConfig({embeddedPack:{enabled:true}})};
 const firstStatus=defer(),statusStarted=defer();
 let checkedIn=false,reads=0;
 const sourcePack={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[{
   providerId:'loomy',id:'delayed-member',enabled:true,
  }]}),
  readSourceStatuses:async()=>{
   reads++;
   const before=checkedIn;
   if(reads===1){statusStarted.release();await firstStatus.pending}
   return {state:'ready',accounts:[{accountId:'delayed-member',authVerified:true,
    todayCheckedIn:before}]};
  },
  checkinAccount:async()=>{checkedIn=true;return {state:'pending_confirmation',accepted:true}},
 };
 const center=createSourceCheckinCenter({sourcePack,configStore,store:store(),now:()=>NOW});
 const preClaim=center.refresh();await statusStarted.pending;
 const claim=center.run(id,{source:'manual'});
 firstStatus.release();await preClaim;
 const result=await claim;
 assert.equal(result.record.state,'success',
  'pre-claim status result cannot replace post-claim confirmation');
 assert.equal(reads,2,'a separate post-claim read-only status probe is mandatory');
 center.stop();
});
test('native check-in in progress cannot confirm old account after owner disables Provider',async()=>{
 const h=nativeFixture();
 const claim=h.center.run('lingxi-a');await h.started.pending;
 h.configStore.replace({...h.configStore.get(),providers:h.configStore.get().providers.map(p=>({...p,enabled:false}))});
 h.upstream.release();
 await assert.rejects(claim,e=>e?.status===409||e?.code==='ERR_ACCOUNT_CHANGED');
 assert.equal(h.history.all().length,0);
 h.center.stop();
});

test('check-in dashboard must not show a source-disabled imported account as online from stale local account proof',async()=>{
 const id=sourceAccountOpaqueId('loomy','disabled-upstream-member');
 const cfg=normalizeConfig({providers:[{id:'own_loomy',protocol:'native-channel',enabled:true}],
  accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,
   enabled:true,autoCheckin:true}],
  checkin:{autoEnabled:true,autoSourceAccounts:true,runAt:'10:05'}});
 const configStore={get:()=>structuredClone(cfg),replace(){}};
 const accounts=createAccountCenter({configStore,drivers:new Map([['own_loomy',{
  accountSnapshot:()=>({nickname:'Visible member'}),
 }]])});
 const sourcePack={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[{
   providerId:'loomy',id:'disabled-upstream-member',enabled:false,
  }]})};
 const center=createCheckinCenter({configStore,accountCenter:accounts,sourcePack,
  store:store(),now:()=>NOW});
 await center.refreshSources();
 const row=center.snapshot().accounts.find(x=>x.id===id);
 assert.ok(row,'imported account remains visible for re-enable');
 assert.equal(row.enabled,false,'source being disabled must override configured enabled account card');
 assert.equal(row.connectionState,'disabled','source account state must not display stale local online');
 assert.equal(row.autoCheckinEffective,false);
 await assert.rejects(()=>center.run(id),error=>error.status===409);
 center.stop();
});
test('native claim response cannot be attached to new credential binding under same id',async()=>{
 const h=nativeFixture();
 const claim=h.center.run('lingxi-a');await h.started.pending;
 h.configStore.replace({...h.configStore.get(),accounts:h.configStore.get().accounts.map(a=>({
  ...a,credentialRef:'driver:own_lingxi:replacement',
 }))});
 h.upstream.release();
 await assert.rejects(claim,e=>e?.status===409||e?.code==='ERR_ACCOUNT_CHANGED');
 assert.equal(h.history.all().length,0);
 h.center.stop();
});
