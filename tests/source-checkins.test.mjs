import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {SOURCE_DAILY_SIGNIN_PROVIDERS} from '../src/embedded-pack.mjs';

const NOW=Date.parse('2026-11-17T02:06:00Z');
function fixture({rows=[],enabled=true,autoSourceAccounts=true,
  channels={},independentChannels=[],handler=async()=>({confirmed:true,message:'status confirmed'}),
  normalAccounts=[],runAt='10:05',statusQuery}={}){ let at=NOW;
 const calls=[],records=[];
 const src={status:()=>({state:'mounted'}),
   async listAccounts(){return {state:'ready',accounts:rows.map(row=>({...row}))}},
    async checkinAccount(arg){calls.push(arg);return handler(arg)},
    ...(statusQuery?{readSourceStatuses:statusQuery}:{})}; const providerIds=[...new Set(normalAccounts.map(row=>row.providerId))];
 const providers=providerIds.map(id=>({id,protocol:'native-channel',models:[]}));
 let cfg=normalizeConfig({providers,accounts:normalAccounts,checkin:{
   autoEnabled:enabled,autoSourceAccounts,channels,independentChannels,timeZone:'Asia/Shanghai',runAt
  }});
  const configStore={get:()=>structuredClone(cfg),replace:()=>{}};
 const accountCenter={list:()=>({accounts:[],channels:[]}),find:()=>{throw Error('not configured')},
  driverFor:()=>undefined};
 const store={all:()=>structuredClone(records),append:r=>(records.push(r),structuredClone(r))};
 const center=createCheckinCenter({configStore,accountCenter,sourcePack:src,store,
  now:()=>at,intervalMs:60000});
 return {center,calls,records,src,setNow:value=>{at=value},
  setChannels:(channels,independentChannels=[])=>{
   cfg=normalizeConfig({...cfg,checkin:{...cfg.checkin,channels,independentChannels}});
  }};
}
const row=(providerId,id='acct-1',enabled=true)=>({id,providerId,nickname:providerId+' account',enabled});

test('selected source verification reads only unverified account IDs and discovers newly added member',async()=>{
 const rows=[row('loomy','already-online'),row('qoder','unselected')],calls=[];
 const h=fixture({rows,enabled:false,statusQuery:async(provider,id)=>{
  calls.push([provider,id??null]);
  return {state:'ready',accounts:rows.filter(x=>x.providerId===provider&&(!id||x.id===id)).map(x=>({accountId:x.id,authVerified:true,nickname:x.id}))};
 }});
 try{
  await h.center.refreshSources();
  calls.length=0;
  rows.push(row('loomy','new-member'));
  await h.center.refreshSources({onlyProviderId:'loomy',skipVerified:true});
  assert.deepEqual(calls,[['loomy','new-member']]);
  assert.equal(h.center.sourceSnapshot().find(x=>x.id===sourceAccountOpaqueId('loomy','new-member')).connectionState,'online');
  await h.center.refreshSources({onlyProviderId:'loomy',skipVerified:true});
  assert.equal(calls.length,1);
 }finally{h.center.stop()}
});

test('one source channel temporarily enabled works without global auto and restores off after test',async()=>{
 const h=fixture({enabled:false,rows:[row('loomy','one'),row('qoder','two')],
   channels:{loomy:true,qoder:false},independentChannels:['loomy']});
 try{
  await h.center.refreshSources();
  const initial=h.center.snapshot().accounts;
  assert.equal(initial.find(x=>x.providerId==='loomy').autoCheckinEffective,true);
  assert.equal(initial.find(x=>x.providerId==='qoder').autoCheckinEffective,false);
  assert.equal((await h.center.tick()).attempted,1);
  assert.deepEqual(h.calls.map(x=>x.providerId),['loomy']);
  h.setChannels({loomy:false,qoder:false});
  assert.equal((await h.center.tick()).skipped,'disabled');
  assert.equal(h.calls.length,1,'restoring original source toggle prohibits later claims');
 }finally{h.center.stop()}
});

test('source sign-in receipt and persisted history never store upstream credential-looking text',async()=>{
 const secret='wps_sid=SECRET_SOURCE_COOKIE_VALUE_XYZ';
 const h=fixture({enabled:false,rows:[row('loomy','acct-1')],
  handler:async()=>({confirmed:true,message:'Completed '+secret})});
 await h.center.refreshSources();
 const id=sourceAccountOpaqueId('loomy','acct-1');
 const done=await h.center.run(id);
 assert.equal(done.record.state,'success');
 assert.doesNotMatch(JSON.stringify(h.records),/SECRET_SOURCE_COOKIE_VALUE/);
 assert.doesNotMatch(JSON.stringify(h.center.snapshot()),/SECRET_SOURCE_COOKIE_VALUE/);
 h.center.stop();
});

test('legacy source history with private upstream text is redacted in every account and history view',async()=>{
 const h=fixture({enabled:false,rows:[row('loomy','legacy')]});
 const id=sourceAccountOpaqueId('loomy','legacy');
 h.records.push({date:'2026-11-17',accountId:id,providerId:'loomy',
   state:'failed',message:'Authorization wps_sid=LEGACY_PRIVATE_SESSION_XYZ',
   at:NOW-1000,source:'manual'});
 await h.center.refreshSources();
 const publicState=JSON.stringify(h.center.snapshot());
 assert.doesNotMatch(publicState,/LEGACY_PRIVATE_SESSION_XYZ/);
 assert.match(publicState,/签到未完成或尚无可靠确认依据/);
 assert.equal(h.records.length,1,'do not destroy the owner historical file while redacting views');
 h.center.stop();
});
test('official nonzero free reward metadata reaches the channel activities table without balance confusion',async()=>{
 const h=fixture({enabled:false,rows:[row('codearts','reward-source')],
  statusQuery:async()=>({state:'ready',accounts:[{
   accountId:'reward-source',nickname:'Official CodeArts',active:true,
   authVerified:true,claimable:true,todayCheckedIn:false,
   balance:500,balanceUnit:'积分',activityRewardAmount:16,
   activityRewardUnit:'积分',activityExpiresAt:Date.parse('2026-11-20T00:00:00Z')}]})});
 await h.center.refreshSources();
 const item=h.center.snapshot().accounts[0];
 assert.equal(item.activityRewardAmount,16);
 assert.equal(item.activityRewardUnit,'积分');
 assert.equal(item.balance,500,'account total is not the daily activity reward');
 assert.equal(item.activityExpiresAt,Date.parse('2026-11-20T00:00:00Z'));
 assert.equal(h.calls.length,0,'display must only read, never claim');
 h.center.stop();
});


test('Raccoon opt-in scheduler claims free login bonus even when daily points are already posted, then persists across restart',async()=>{
 const {mkdtempSync,mkdirSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');
 const {createActivityClaimStore}=await import('../src/activity-claims.mjs');
 const base=process.platform==='win32'?'E:\\Temp':(await import('node:os')).tmpdir();
 mkdirSync(base,{recursive:true});
 const dir=mkdtempSync(join(base,'dsh-raccoon-auto-'));
 try{
  const cfg=normalizeConfig({providers:[{id:'own_raccoon',name:'Raccoon',enabled:true,protocol:'native-channel'}],
   checkin:{autoEnabled:true,autoSourceAccounts:true,runAt:'10:05',timeZone:'Asia/Shanghai'}});
  const configStore={get:()=>structuredClone(cfg),replace(){}};
  const records=[],store={all:()=>structuredClone(records),
   append:v=>{records.push(v);return structuredClone(v)}};
  let at=Date.parse('2026-11-23T02:06:00Z'),pending=true,posts=0,seen=0;
  const sourcePack={
   status:()=>({state:'mounted'}),
   listAccounts:async()=>({state:'ready',accounts:[{id:'raccoon-1',
    providerId:'raccoon',nickname:'Raccoon demo',enabled:true}]}),
   readSourceStatuses:async()=>({state:'ready',accounts:[{
    accountId:'raccoon-1',authVerified:true,active:true,loginRewardPending:pending,
    loginRewardTaskVerified:true,
    todayCheckedIn:true,activityRewardAmount:300,activityRewardUnit:'积分'}]}),
   async checkinAccount({providerId,sourceAccountId,beforeOneTimeClaim,onOneTimeOutcome}){
    assert.equal(providerId,'raccoon');
    assert.equal(sourceAccountId,'raccoon-1');
    seen++;
    if(!pending)return {confirmed:true};
    const approved=await beforeOneTimeClaim({kind:'raccoon_login'});
    if(!approved)return {state:'pending_confirmation',
      loginRewardState:'pending_confirmation'};
    posts++;pending=false;
    await onOneTimeOutcome('raccoon_login','confirmed',{credit:3000});
    return {confirmed:true};
   }
  };
  const accountCenter={list:()=>({accounts:[],channels:[]}),
   find:()=>{throw Error('No native standalone account')},
   driverFor:()=>undefined};
  const path=join(dir,'reward-claims.json');
  const mount=()=>createCheckinCenter({configStore,accountCenter,store,
   sourcePack,now:()=>at,activityStore:createActivityClaimStore({path,now:()=>at})});
  let center=mount();
  await center.refreshSources();
  const first=await center.tick();
  assert.equal(first.attempted,1);
  assert.equal(posts,1);
  const view=center.snapshot().accounts[0];
  assert.equal(view.checkinState,'success');
  assert.equal(view.benefits[0].kind,'raccoon_login');
  assert.equal(view.benefits[0].claimed,true);
  assert.equal(view.benefits[0].credit,3000);
  assert.equal(view.activityClaims.confirmed,1);
  await center.tick();
  assert.equal(posts,1);
  center.stop();
  center=mount();
  at+=60*60*1000;
  await center.refreshSources();
  const reloaded=center.snapshot().accounts[0];
  assert.equal(reloaded.activityClaims.confirmed,1);
  assert.equal(reloaded.benefits[0].claimed,true);
  assert.equal((await center.tick()).attempted,0);
  assert.equal(posts,1);
  assert.equal(seen,1,'offline restart cannot send another login bonus request');
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Raccoon ambiguous one-time reward receipt is never replayed and may be reconciled by new official task status',async()=>{
 const {mkdtempSync,mkdirSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');
 const {createActivityClaimStore}=await import('../src/activity-claims.mjs');
 const base=process.platform==='win32'?'E:\\Temp':(await import('node:os')).tmpdir();
 mkdirSync(base,{recursive:true});
 const dir=mkdtempSync(join(base,'dsh-raccoon-uncertain-'));
 try{
  const cfg=normalizeConfig({providers:[{id:'own_raccoon',enabled:true,protocol:'native-channel'}],
    checkin:{autoEnabled:true,autoSourceAccounts:true,runAt:'10:05'}});
  const configStore={get:()=>structuredClone(cfg),replace(){}};
  const accountCenter={list:()=>({accounts:[],channels:[]}),
    find:()=>{throw Error('not owned')},driverFor:()=>undefined};
  let at=Date.parse('2026-11-23T02:06:00Z'),loginPending=true,dailyGranted=false,posts=0;
  const sourcePack={
   status:()=>({state:'mounted'}),
   listAccounts:async()=>({state:'ready',accounts:[{id:'raccoon-x',providerId:'raccoon',
     nickname:'Raccoon X',enabled:true}]}),
   readSourceStatuses:async()=>({state:'ready',accounts:[{accountId:'raccoon-x',
     authVerified:true,active:true,loginRewardPending:loginPending,
     loginRewardTaskVerified:true,
     todayCheckedIn:dailyGranted}]}),
   async checkinAccount({beforeOneTimeClaim,onOneTimeOutcome}){
    if(loginPending){
     if(await beforeOneTimeClaim({kind:'raccoon_login'})){
      posts++;
      await onOneTimeOutcome('raccoon_login','pending_confirmation');
     }
     return {state:'pending_confirmation',accepted:true,
       loginRewardState:'pending_confirmation'};
    }
    dailyGranted=true;
    return {confirmed:true};
   }
  };
  const records=[],store={all:()=>structuredClone(records),
    append:x=>(records.push(x),structuredClone(x))};
  const path=join(dir,'claim.json');
  const mount=()=>createCheckinCenter({configStore,accountCenter,store,
    sourcePack,now:()=>at,activityStore:createActivityClaimStore({path,now:()=>at})});
  let center=mount();
  await center.refreshSources();
  const first=await center.tick();
  assert.equal(posts,1);
  assert.equal(first.attempted,1);
  center.stop();
  center=mount();
  at+=60*60*1000;
  await center.refreshSources();
  await center.tick();
  assert.equal(posts,1,'ambiguous POST is never re-sent after restart');
  assert.equal(center.snapshot().accounts[0].activityClaims.unconfirmed,1);
  loginPending=false;at+=60*60*1000;
  await center.refreshSources({force:true});
  assert.equal(center.snapshot().accounts[0].activityClaims.confirmed,1,
    'official absent task reconciles previously submitted receipt');
  const done=await center.tick();
  assert.equal(done.attempted,1,'daily free GET can finish after one-time reward');
  assert.equal(center.snapshot().accounts[0].checkinState,'success');
  assert.equal(posts,1);
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

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
 assert.equal(h.records.length,2,'fresh authenticated confirmation closes the earlier pending record');
 assert.equal(h.records[1].source,'status');
 assert.equal(h.records[1].state,'success');
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
test('ZCode official empty preview is not false signed-in or claimable; rechecks when cache expires',async()=>{
 let scans=0,available=false;
 const h=fixture({rows:[row('zcode','zcode-grant')],
  statusQuery:async()=>{
   scans++;return {state:'ready',accounts:[{
    accountId:'zcode-grant',authVerified:true,active:true,
    todayCheckedIn:false,claimable:available,noClaimablePlans:!available,
   }]};
  }});
 await h.center.refreshSources();
 let state=h.center.snapshot().accounts[0];
 assert.equal(state.checkinState,'no_task');
 assert.match(state.checkinMessage,/当前没有可领取/);
 assert.notEqual(state.checkinState,'success');
 assert.equal((await h.center.tick()).attempted,0,
  'must not request captcha or claim when official preview is empty');
 assert.equal(h.calls.length,0);
 available=true;
  h.setNow(Date.parse('2026-11-17T11:05:00Z')); // Beijing 19:05 card window
  assert.equal((await h.center.tick()).attempted,1,
   'later claimable plan is reconsidered after short status cache expiry'); assert.equal(h.calls.length,1);
 assert.ok(scans>=2);
 h.center.stop();
});
test('ZCode unknown preview does not pretend no-task or completed, and does not invent a balance',async()=>{
 const h=fixture({enabled:false,rows:[row('zcode','failed-preview')],
  statusQuery:async()=>({state:'ready',accounts:[{
    accountId:'failed-preview',authVerified:true,active:true,
    todayCheckedIn:null,balanceState:'not_returned'}]})});
 await h.center.refreshSources();
 const a=h.center.snapshot().accounts[0];
 assert.notEqual(a.checkinState,'no_task');
 assert.notEqual(a.checkinState,'success');
 assert.equal(a.balance,undefined);
 assert.equal(a.checkinMessage,'今日签到状态暂未核实');
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
test('global DSH opt-in signs in every supported source channel; three unsupported channels are shown but never touched',async()=>{
 const supported=SOURCE_DAILY_SIGNIN_PROVIDERS;
 assert.equal(Object.isFrozen(supported),true,'channel support inventory cannot mutate at runtime');
 const rows=[...supported.map(id=>row(id)),...['workbuddy','cline','gemini'].map(id=>row(id))];
 const h=fixture({rows});
 await h.center.refreshSources();
 const view=h.center.snapshot();
 assert.equal(view.accounts.length,rows.length);
 assert.equal(view.accounts.filter(x=>x.checkinSupported).length,supported.length);
 assert.equal(view.accounts.filter(x=>x.checkinState==='unsupported').length,3);
 assert.ok(view.accounts.every(x=>x.id.startsWith('sp_')));
 assert.ok(view.accounts.every(x=>!x.id.includes('acct-1')));
 h.setNow(Date.parse('2026-11-17T11:06:00Z')); // Beijing 19:06: claim window open
 const result=await h.center.tick(); assert.equal(result.attempted,supported.length);
 assert.deepEqual(h.calls.map(x=>x.providerId),[...supported]);
 assert.equal(h.records.filter(x=>x.state==='success').length,supported.length);
 assert.equal((await h.center.tick()).attempted,0,'confirmed today cannot repeat');
 await h.center.run(sourceAccountOpaqueId('buddy','acct-1'));
 assert.equal(h.calls.length,supported.length,'manual repeat of success is idempotent');
 h.center.stop();
});
test('late ZCode 19:30 banner is reconsidered after 30min without exhausting claim limit',async()=>{
 let tries=0;
 const h=fixture({rows:[row('zcode','late-card')],
   handler:async()=>++tries<3?{state:'no_task',claimPosted:false}:{confirmed:true}});
 h.setNow(Date.parse('2026-11-17T11:05:00Z')); // Beijing 19:05, empty
 assert.equal((await h.center.tick()).attempted,1);
 assert.equal(h.records.at(-1).state,'no_task');
 h.setNow(Date.parse('2026-11-17T11:20:00Z')); // 15min, still empty
 assert.equal((await h.center.tick()).attempted,0);
 h.setNow(Date.parse('2026-11-17T11:36:00Z')); // 31min, new banner can appear
 assert.equal((await h.center.tick()).attempted,1);
 assert.equal(h.records.at(-1).state,'no_task');
 h.setNow(Date.parse('2026-11-17T12:07:00Z')); // another 31min
 assert.equal((await h.center.tick()).attempted,1);
 assert.equal(h.records.at(-1).state,'success');
 assert.equal(tries,3,'two empty marketing reads are not three claim POST attempts');
 assert.equal((await h.center.tick()).attempted,0,'claimed plan must not be requested again');
 h.center.stop();
});
test('ZCode claim POST that returned ineligible is never mistaken for a read-only empty banner',async()=>{
 let posts=0;
 const h=fixture({rows:[row('zcode','posted-ineligible')],
   handler:async()=>{posts++;return {state:'no_task',claimPosted:true}}});
 h.setNow(Date.parse('2026-11-17T11:05:00Z'));
 assert.equal((await h.center.tick()).attempted,1);
 assert.equal(h.records.at(-1).state,'no_task');
 assert.equal(h.records.at(-1).readOnlyNoTask,undefined,
   'a submitted claim cannot acquire the persisted read-only exemption');
 h.setNow(Date.parse('2026-11-17T11:36:00Z'));
 assert.equal((await h.center.tick()).attempted,0,
   '30-minute free recheck must only apply before a claim POST');
 h.setNow(Date.parse('2026-11-17T13:07:00Z'));
 assert.equal((await h.center.tick()).attempted,0,
   'server ineligibility after a real POST must not create a claim loop');
 assert.equal(posts,1);
 h.center.stop();
});
test('ZCode real CAPTCHA status is client-required and never auto-retried as accepted',async()=>{
 const h=fixture({rows:[row('zcode','captcha-account')],
   handler:async()=>({state:'client_required',message:'must verify in ZCode app'})});
 h.setNow(Date.parse('2026-11-17T11:10:00Z'));
 await h.center.refreshSources();
 const id=sourceAccountOpaqueId('zcode','captcha-account');
 const result=await h.center.run(id);
 assert.equal(result.record.state,'client_required');
 h.setNow(Date.parse('2026-11-17T12:50:00Z'));
 assert.equal((await h.center.tick()).attempted,0);
 assert.equal(h.calls.length,1,'CAPTCHA must never be silently repeated');
 assert.doesNotMatch(JSON.stringify(h.records),/must verify in ZCode app/);
 h.center.stop();
});
test('ZCode evening window does not exhaust attempts in the morning',async()=>{
 const h=fixture({rows:[row('zcode','zc'),row('qoder','qd')]});
 h.setNow(Date.parse('2026-11-17T02:06:00Z'));
 assert.equal((await h.center.tick()).attempted,1);
 assert.deepEqual(h.calls.map(x=>x.providerId),['qoder']);
 h.setNow(Date.parse('2026-11-17T10:59:00Z'));
 assert.equal((await h.center.tick()).attempted,0);
 h.setNow(Date.parse('2026-11-17T11:05:00Z'));
 assert.equal((await h.center.tick()).attempted,1);
 assert.deepEqual(h.calls.map(x=>x.providerId),['qoder','zcode']);
 h.center.stop();
});
test('ZCode pre-19:00 no_task does not stop the evening card; pending acceptance does not loop',async()=>{
 const h=fixture({rows:[row('zcode','zc')],
   handler:async()=>({state:'pending_confirmation',accepted:true})});
 h.setNow(Date.parse('2026-11-17T02:10:00Z'));
 await h.center.refreshSources();
 const id=sourceAccountOpaqueId('zcode','zc');
 h.records.push({date:'2026-11-17',accountId:id,providerId:'zcode',
   state:'no_task',message:'morning empty',at:Date.parse('2026-11-17T02:10:00Z'),source:'manual'});
 assert.equal((await h.center.tick()).attempted,0);
 h.setNow(Date.parse('2026-11-17T11:05:00Z'));
 assert.equal((await h.center.tick()).attempted,1);
 assert.equal(h.records.at(-1).state,'pending_confirmation');
 h.setNow(Date.parse('2026-11-17T12:15:00Z'));
 assert.equal((await h.center.tick()).attempted,0);
 assert.equal(h.calls.length,1);
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
  h.setNow(Date.parse('2026-11-17T11:06:00Z')); // Beijing 19:06
  await h.center.tick(); assert.equal(h.calls.length,1);
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
