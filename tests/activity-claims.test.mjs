import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createActivityClaimStore} from '../src/activity-claims.mjs';
import {createCheckinCenter,createCheckinStore} from '../src/checkins.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

const root=()=>{
 const base=process.platform==='win32'?'E:\\Temp':tmpdir();
 mkdirSync(base,{recursive:true});
 return mkdtempSync(join(base,'dsh-reward-'));
};
const pid='own_workbuddy-cn',id='wbp_'+'a'.repeat(24);
const cfg=normalizeConfig({providers:[{id:pid,name:'WorkBuddy',protocol:'native-channel',enabled:true}],
 accounts:[{id,providerId:pid,credentialRef:'driver:'+pid+':'+id,
  autoCheckin:true,enabled:true}],checkin:{autoEnabled:true,runAt:'00:00',
    timeZone:'Asia/Shanghai',autoSourceAccounts:false}});
const gift=(credit=40,endAt=Date.parse('2026-12-02T00:00:00Z'))=>
 ({kind:'gift',credit,endAt});

test('activity claim receipt survives restart, never stores credentials, changes only on new offer',()=>{
 const dir=root();try{
  const path=join(dir,'rewards.json'),a=cfg.accounts[0],offer=gift();
  let clock=Date.parse('2026-11-23T08:00:00Z');
  let store=createActivityClaimStore({path,now:()=>clock});
  assert.equal(store.begin(a,offer),true,'receipt is durable before POST');
  assert.equal(store.state(a,offer),'submitted');
  assert.equal(store.begin(a,offer),false,'same offer never resubmitted');
  clock+=1000;store=createActivityClaimStore({path,now:()=>clock});
  assert.equal(store.begin(a,offer),false,'restart must not replay ambiguous claim');
  assert.equal(store.finish(a,offer,'confirmed'),true);
  assert.equal(store.summary(a).confirmed,1);
  assert.equal(store.begin(a,gift(50)),true,'genuinely new offer may be claimed');
  assert.equal(store.begin({...a,credentialRef:'driver:'+pid+':'+id+'changed'},offer),true,
    'new credential binding is independent');
  const text=readFileSync(path,'utf8');
  assert.doesNotMatch(text,/driver:|wbp_|own_workbuddy|NATIVE_ROUTER|Bearer/);
  assert.equal(JSON.parse(text).receipts.length,3);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('one-shot activity receipt blocks metadata drift across restart without reusing wallet proof',()=>{
 const dir=root();try{
  const path=join(dir,'rewards.json'),account=cfg.accounts[0];
  for(const kind of ['loomy_first_message','workbuddy_growth_task_'+'a'.repeat(24),'workbuddy_growth_travel_'+'b'.repeat(24)]){
   let store=createActivityClaimStore({path});
   const original={kind,credit:50,endAt:1000},changed={kind,credit:60,endAt:2000};
   assert.equal(store.begin(account,original,{baselineBalance:100}),true);
   store=createActivityClaimStore({path});
   assert.equal(store.begin(account,changed),false);
   const receipt=store.receipt(account,changed);
   assert.equal(receipt.state,'pending_confirmation');
   assert.equal(receipt.baselineBalance,undefined);
   assert.equal(store.finish(account,changed,'confirmed',{credit:60}),false);
   assert.equal(store.finish(account,original,'confirmed',{credit:50}),true);
   assert.equal(store.receipt(account,changed).state,'confirmed');
   assert.equal(store.receipt(account,changed).credit,undefined);
  }
  const store=createActivityClaimStore({path});
  assert.equal(store.begin(account,{kind:'workbuddy_growth_travel_'+'c'.repeat(24),credit:50}),true);
  assert.equal(store.begin(account,gift(50)),true);
  assert.equal(store.begin(account,gift(60)),true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('corrupted durable activity receipts fail closed; no duplicate POST can be authorized',()=>{
 const dir=root();try{
  const path=join(dir,'rewards.json');
  writeFileSync(path,'{invalid');
  const store=createActivityClaimStore({path});
  assert.equal(store.blocked,true);
  assert.equal(store.begin(cfg.accounts[0],gift()),false);
  assert.equal(readFileSync(path,'utf8'),'{invalid');
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('filled durable claim journal never evicts old accepted POST receipts',()=>{
 const dir=root();try{
   const path=join(dir,'rewards.json'),account=cfg.accounts[0],offer=gift();
  const first=createActivityClaimStore({path});
  assert.equal(first.begin(account,offer),true);
  const old=JSON.parse(readFileSync(path,'utf8')).receipts[0];
  const rows=[old,...Array.from({length:9999},(_,i)=>({
   key:createHash('sha256').update('filler-'+i).digest('hex'),
   binding:'0'.repeat(64),kind:'gift',state:'confirmed',at:1
  }))];
  writeFileSync(path,JSON.stringify({version:1,receipts:rows}));
  const reopened=createActivityClaimStore({path});
  assert.equal(reopened.blocked,false);
  assert.equal(reopened.count(),10000);
  assert.equal(reopened.begin(account,offer),false);
  assert.equal(reopened.begin(account,gift(100)),false,
   'full ledger must fail closed, not discard the oldest one-time claims');
  assert.equal(reopened.count(),10000);
  assert.equal(createActivityClaimStore({path}).begin(account,offer),false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('opted-in scheduler discovers a new activity AFTER daily sign-in and resumes safely after restart',async()=>{
 const dir=root();try{
  const configStore={get:()=>structuredClone(cfg),replace(){}};
  let clock=Date.parse('2026-11-23T08:00:00Z');
  let offer=null,signCalls=0,claimPosts=0,claimStatusCalls=0;
  const driver={
    checkIn:async({date,includeActivities})=>{
      assert.equal(includeActivities,false,'DSH owner separates sign-in from rewards');
      signCalls++;return {date,confirmed:true};
    },
    async claimActivities({beforeClaim,onOutcome}){
      claimStatusCalls++;
      if(!offer)return {state:'no_task',confirmed:0,pending:0,eligible:0};
      if(!(await beforeClaim(offer)))
        return {state:'skipped',confirmed:0,pending:0,eligible:1};
      claimPosts++;
      await onOutcome(offer,'confirmed');
      return {state:'confirmed',confirmed:1,pending:0,eligible:1};
    },
  };
  const accountCenter=createAccountCenter({configStore,drivers:new Map([[pid,driver]])});
  const store=createCheckinStore({path:join(dir,'checkins.json')});
  const activityPath=join(dir,'rewards.json');
  const mount=()=>createCheckinCenter({configStore,accountCenter,store,
    activityStore:createActivityClaimStore({path:activityPath,now:()=>clock}),
    now:()=>clock});
  let center=mount();
  assert.equal((await center.tick()).attempted,1);
  assert.equal(signCalls,1);
  assert.equal(claimPosts,0);
  offer=gift();
  clock+=31*60*1000;
  const second=await center.tick();
  assert.equal(second.attempted,0,'same-day verified sign-in must not be sent again');
  assert.equal(second.rewards[0].confirmed,1,'late new reward is independently claimed');
  assert.equal(claimPosts,1);
  assert.equal(center.snapshot().accounts[0].activityClaims.confirmed,1);
  center.stop();
  center=mount();
  clock+=31*60*1000;
  await center.tick();
  assert.equal(claimPosts,1,'durable receipt blocks same offer after restart');
  offer=gift(60);
  clock+=31*60*1000;
  assert.equal((await center.tick()).rewards[0].confirmed,1);
  assert.equal(claimPosts,2,'new distinct official offer is independently claimable');
  assert.equal(signCalls,1);
  assert.ok(claimStatusCalls>=4,'late activities continue to be discovered');
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
