import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS} from '../src/embedded-pack.mjs';

const NOW=Date.parse('2026-11-17T02:06:00Z');
function fixture({rows=[],enabled=true,autoSourceAccounts=true,
  handler=async()=>({confirmed:true,message:'status confirmed'}),normalAccounts=[],runAt='10:05',statusQuery}={}){ let at=NOW;
 const calls=[],records=[];
 const src={status:()=>({state:'mounted'}),
   async listAccounts(){return {state:'ready',accounts:rows.map(row=>({...row}))}},
    async checkinAccount(arg){calls.push(arg);return handler(arg)},
    ...(statusQuery?{readSourceStatuses:statusQuery}:{})}; const providerIds=[...new Set(normalAccounts.map(row=>row.providerId))];
 const providers=providerIds.map(id=>({id,protocol:'native-channel',models:[]}));
 const cfg=normalizeConfig({providers,accounts:normalAccounts,checkin:{
   autoEnabled:enabled,autoSourceAccounts,timeZone:'Asia/Shanghai',runAt
 }});
 const configStore={get:()=>structuredClone(cfg),replace:()=>{}};
 const accountCenter={list:()=>({accounts:[],channels:[]}),find:()=>{throw Error('not configured')},
  driverFor:()=>undefined};
 const store={all:()=>structuredClone(records),append:r=>(records.push(r),structuredClone(r))};
 const center=createCheckinCenter({configStore,accountCenter,sourcePack:src,store,
  now:()=>at,intervalMs:60000});
 return {center,calls,records,src,setNow:value=>{at=value}};
}
const row=(providerId,id='acct-1',enabled=true)=>({id,providerId,nickname:providerId+' account',enabled});
test('a confirmed same-day source check-in survives a later pending record and prevents duplicate claims',async()=>{
  const h=fixture({rows:[row('codearts','valid-source')],
    statusQuery:async()=>({state:'ready',accounts:[{
      accountId:'valid-source',nickname:'Real CodeArts Account',
      todayCheckedIn:false,active:true,authVerified:true}]})});
  const opaque=sourceAccountOpaqueId('codearts','valid-source');
  h.records.push({date:'2026-11-17',accountId:opaque,providerId:'codearts',
    state:'success',at:NOW-10000,source:'auto'});
  h.records.push({date:'2026-11-17',accountId:opaque,providerId:'codearts',
    state:'pending_confirmation',at:NOW-5000,source:'manual'});
  await h.center.refreshSources();
  const account=h.center.snapshot().accounts[0];
  assert.equal(account.checkinState,'success');
  assert.equal(account.nickname,'Real CodeArts Account');
  assert.match(account.checkinMessage,/确认成功记录/);
  assert.equal((await h.center.run(opaque)).alreadyConfirmed,true);  assert.equal((await h.center.tick()).attempted,0);
  assert.equal(h.calls.length,0);
  h.center.stop();
});

test('source upstream confirmed sign-in returns a success receipt even if latest history is pending',async()=>{
 const h=fixture({rows:[row('loomy','upstream')],
   statusQuery:async()=>({state:'ready',accounts:[{accountId:'upstream',
     todayCheckedIn:true,active:true,authVerified:true}]})});
 const opaque=sourceAccountOpaqueId('loomy','upstream');
 h.records.push({date:'2026-11-17',accountId:opaque,providerId:'loomy',
   state:'pending_confirmation',at:NOW-3000,source:'manual'});
 await h.center.refreshSources();
 const result=await h.center.run(opaque);
 assert.equal(result.alreadyConfirmed,true);
 assert.equal(result.record.state,'success');
 assert.equal(result.record.date,'2026-11-17');
 assert.equal(h.calls.length,0,'verified upstream status must not cause a second claim');
 assert.equal(h.records.length,1,'read-only verification must not fabricate persisted history');
 h.center.stop();
});
test('source checkin and reported balance sync when automatic checkin is disabled; no claim is issued',async()=>{
 let scanned=0;
 const h=fixture({enabled:false,rows:[row('qoder','acct-1')],
   statusQuery:async providerId=>{
     scanned++;
     assert.equal(providerId,'qoder');
     return {state:'ready',accounts:[{
       accountId:'acct-1',nickname:'Qoder Verified User',todayCheckedIn:true,
       active:true,balance:72,balanceUnit:'积分',
     }]};
   }});
 await h.center.refreshSources();
 const record=h.center.snapshot().accounts[0];
  assert.equal(record.nickname,'Qoder Verified User','prefer verified upstream username'); assert.equal(record.checkinState,'success');
 assert.equal(record.balance,72);
 assert.equal(record.balanceUnit,'积分');
 assert.ok(record.balanceCheckedAt);
 assert.equal(h.calls.length,0,'read-only status must never claim even with auto off');
 await h.center.refreshSources();
 assert.equal(scanned,1,'fresh results must be cached');
 h.setNow(NOW+6*60*1000);
 await h.center.refreshSources();
 assert.equal(scanned,2,'results must refresh after TTL');
 h.center.stop();
});
test('unknown source credit response never invents a zero balance or successful check-in',async()=>{
 const h=fixture({enabled:false,rows:[row('buddy','acct-1')],
   statusQuery:async()=>({state:'ready',accounts:[{
     accountId:'acct-1',todayCheckedIn:null,active:null,balance:null,
   }]})});
 await h.center.refreshSources();
 const a=h.center.snapshot().accounts[0];
 assert.equal('balance' in a,false);
 assert.notEqual(a.checkinState,'success');
 assert.equal(h.calls.length,0);
 h.center.stop();
});
test('accepted source claim is immediately followed by a fresh authenticated status read',async()=>{
  let claimed=false,checks=0;
  const h=fixture({enabled:false,rows:[row('loomy','acct-1')],
    handler:async()=>{claimed=true;return {state:'pending_confirmation',accepted:true}},
    statusQuery:async()=>{checks++;return {state:'ready',accounts:[{
      accountId:'acct-1',todayCheckedIn:claimed,active:true,
      authVerified:true,nickname:'Loomy verified'}]}}});
  await h.center.refreshSources();
  const id=sourceAccountOpaqueId('loomy','acct-1');
  const result=await h.center.run(id);
  assert.equal(result.record.state,'success','confirmed status must override acceptance-only receipt');
  assert.equal(h.calls.length,1,'claim must be account-scoped and issued once');
  assert.ok(checks>=2,'the status after claim must bypass the TTL cache');
  assert.equal(h.center.snapshot().accounts[0].checkinState,'success');
  assert.equal((await h.center.run(id)).alreadyConfirmed,true);
  assert.equal(h.calls.length,1,'confirmed source must never claim again');
  h.center.stop();
});
test('unconfirmed source acceptance does not remain pending forever',async()=>{
  const h=fixture({enabled:false,rows:[row('zcode','acct-2')],
    handler:async()=>({state:'pending_confirmation',accepted:true,
      message:'请求已发送等待服务端确认'}),
    statusQuery:async()=>({state:'ready',accounts:[{
      accountId:'acct-2',todayCheckedIn:null,active:true,authVerified:true}]})});
  await h.center.refreshSources();
  const id=sourceAccountOpaqueId('zcode','acct-2');
  const result=await h.center.run(id);
  assert.equal(result.record.state,'pending_confirmation');
  h.setNow(NOW+21*60*1000);
  const snapshot=h.center.snapshot().accounts[0];
  assert.equal(snapshot.checkinState,'failed','expired pending must have an explicit terminal display state');
  assert.match(snapshot.checkinMessage,/超过20分钟/);
  assert.equal(h.calls.length,1);
  h.center.stop();
});
test('global DSH opt-in signs in every supported source channel; four unsupported channels are shown but never touched',async()=>{
 const supported=SOURCE_DAILY_SIGNIN_PROVIDERS;
 assert.equal(Object.isFrozen(supported),true,'channel support inventory cannot mutate at runtime');
 const rows=[...supported.map(id=>row(id)),...['workbuddy','cline','gemini','raccoon'].map(id=>row(id))];
 const h=fixture({rows});
 await h.center.refreshSources();
 const view=h.center.snapshot();
 assert.equal(view.accounts.length,rows.length);
 assert.equal(view.accounts.filter(x=>x.checkinSupported).length,supported.length);
 assert.equal(view.accounts.filter(x=>x.checkinState==='unsupported').length,4);
 assert.ok(view.accounts.every(x=>x.id.startsWith('sp_')));
 assert.ok(view.accounts.every(x=>!x.id.includes('acct-1')));
 const result=await h.center.tick();
 assert.equal(result.attempted,supported.length);
 assert.deepEqual(h.calls.map(x=>x.providerId),[...supported]);
 assert.equal(h.records.filter(x=>x.state==='success').length,supported.length);
 assert.equal((await h.center.tick()).attempted,0,'confirmed today cannot repeat');
 await h.center.run(sourceAccountOpaqueId('buddy','acct-1'));
 assert.equal(h.calls.length,supported.length,'manual repeat of success is idempotent');
 h.center.stop();
});
test('source auto-signin respects global off and independent source-off switch',async()=>{
 for(const options of [{enabled:false},{enabled:true,autoSourceAccounts:false}]){
  const h=fixture({rows:[row('qoder')],...options});
  assert.equal((await h.center.tick()).attempted??0,0);
  assert.deepEqual(h.calls,[]);
  h.center.stop();
 }
});
test('explicitly opted-out imported source account is not auto-signed while unimported enabled source is',async()=>{
 const id=sourceAccountOpaqueId('qoder','acct-1');
 const imported={id,providerId:'qoder',enabled:true,autoCheckin:false,
  credentialRef:'driver:qoder:sp_test',weight:1};
 const h=fixture({normalAccounts:[imported],rows:[row('qoder','acct-1'),row('buddy','acct-2')]});
 assert.equal((await h.center.tick()).attempted,1);
 assert.deepEqual(h.calls.map(x=>x.providerId),['buddy']);
 const view=h.center.snapshot();
 assert.equal(view.accounts.find(x=>x.id===id).autoCheckin,false);
 h.center.stop();
});
test('unconfirmed upstream claim remains pending; retry at most three times with one-hour backoff',async()=>{
 const h=fixture({rows:[row('minimax')],handler:async()=>({
   state:'pending_confirmation',accepted:true,message:'claim accepted but not checked in'
 })});
 await h.center.tick();
 assert.equal(h.records[0].state,'pending_confirmation');
 assert.equal((await h.center.tick()).attempted,0);
 h.setNow(NOW+3600001);
 assert.equal((await h.center.tick()).attempted,1);
 h.setNow(NOW+7200002);
 assert.equal((await h.center.tick()).attempted,1);
 h.setNow(NOW+10800003);
 assert.equal((await h.center.tick()).attempted,0);
 assert.equal(h.calls.length,3);
 assert.equal(h.records.filter(x=>x.state==='success').length,0);
 h.center.stop();
});
test('disabled source account, no-task, unavailable service and no-ready source never falsely claim success',async()=>{
 const h=fixture({rows:[row('qoder','a',false),row('zcode','b',true)],
  handler:async({sourceAccountId})=>sourceAccountId==='b'
   ?{state:'no_task',message:'daily event not available'}:{confirmed:true}});
 await h.center.tick();
 assert.equal(h.calls.length,1);
 assert.equal(h.records[0].state,'no_task');
 assert.equal((await h.center.tick()).attempted,0);
 const broken=fixture({rows:[row('qoder')],handler:async()=>({state:'unavailable'})});
 await broken.center.tick();
 assert.equal(broken.records.length,0);
 assert.equal(broken.calls.length,1);
 broken.center.stop();h.center.stop();
 });
 test('source API exceptions are counted as failed attempts with one-hour cooldown, never spun every minute',async()=>{
  const h=fixture({rows:[row('qoder')],handler:async()=>{
   throw Error('Bearer A_SENSITIVE_FAKE_TEST_TOKEN_123456');
  }});
  assert.equal((await h.center.tick()).attempted,1);
  assert.equal(h.records[0].state,'failed');
  assert.doesNotMatch(JSON.stringify(h.records),/A_SENSITIVE_FAKE_TEST_TOKEN/);
  h.setNow(NOW+60000);
  assert.equal((await h.center.tick()).attempted,0);
  h.setNow(NOW+3600001);
  assert.equal((await h.center.tick()).attempted,1);
  assert.equal(h.calls.length,2);
  h.center.stop();
 });
 test('all-source auto checkin waits for Beijing 10:05 even when the user selects an earlier global schedule',async()=>{
  const h=fixture({rows:[row('qoder')],runAt:'08:00'});
  h.setNow(Date.parse('2026-11-17T01:59:00Z')); // Beijing 09:59
  assert.equal((await h.center.tick()).attempted,0);
  assert.equal(h.calls.length,0);
  h.setNow(Date.parse('2026-11-17T02:06:00Z')); // Beijing 10:06
  assert.equal((await h.center.tick()).attempted,1);
  assert.equal(h.records[0].state,'success');
  h.center.stop();
 });
