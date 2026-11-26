import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChannelActivityCatalog,createChannelActivityCenter}
  from '../src/channel-activities.mjs';

const now=Date.parse('2026-11-23T04:00:00Z');
const cfg={providers:[
 {id:'own_workbuddy-cn',name:'WorkBuddy 国内',enabled:true},
 {id:'own_qoder',name:'Qoder',enabled:true},
 {id:'own_loomy',name:'Loomy',enabled:true},
 {id:'own_raccoon',name:'小浣熊',enabled:true},
 {id:'own_cline',name:'Cline',enabled:true},
 {id:'own_gemini',name:'Gemini',enabled:true},
 {id:'own_zcode',name:'ZCode',enabled:false},
]};
const account=(id,providerId,props={})=>({
 id,providerId,enabled:true,nickname:'测试用户 '+id,
 sourceAccount:false,checkinSupported:true,checkinState:'not_run',
 autoCheckinEffective:true,...props,
});
const channel=(data,id)=>data.channels.find(x=>x.id===id);
const catalog=(rows,nowAt=now)=>buildChannelActivityCatalog({
 config:cfg,accountRows:rows,now:nowAt});

test('official daily offer exposes known reward, rejects expired and conflicting claimed states',()=>{
 const row=account('ca','own_codearts',{sourceAccount:true,connectionState:'online',activityClaimable:true,activityActive:true,activityRewardAmount:1000,activityRewardUnit:'积分',activityExpiresAt:now+60000});
 const read=r=>channel(catalog([r]),'codearts').activities;
 assert.equal(read(row).length,1);assert.equal(read(row)[0].rewardAmount,1000);
 assert.equal(read(row)[0].rewardUnit,'积分');assert.equal(read(row)[0].validity,'valid');
 assert.equal(read({...row,checkinState:'success'}).length,0);
 assert.equal(read({...row,checkinState:'pending_confirmation'}).length,0);
 assert.equal(read({...row,activityExpiresAt:now-1}).length,0);
 assert.equal(read({...row,activityRewardUnit:'USD'})[0].rewardAmount,null);
 assert.equal(read({...row,activityRewardAmount:-1})[0].rewardUnit,null);
});

test('channel checkin summary preserves unresolved states without inventing reward rows',()=>{
 const rows=['success','pending_confirmation','failed','no_task','unsupported','not_run'].map((checkinState,i)=>account('ca'+i,'own_codearts',{sourceAccount:true,checkinState}));
 const c=channel(catalog([...rows,rows[0],{...rows[1],id:'disabled',enabled:false}]),'codearts');
 assert.deepEqual(c.checkinSummary,{confirmed:1,pending:1,failed:1,noTask:1,unsupported:1,unchecked:1});
 assert.equal(c.activities.length,0);
});

test('catalog hides ALL advertised, callable, uncredited, failed or paid rewards',()=>{
 const x=catalog([
  account('wb','own_workbuddy-cn',{checkinState:'success',
   benefits:[{kind:'gift',active:true,claimed:true,credit:220},
    {kind:'compensation',active:true,claimed:false,credit:50},
    {kind:'purchase',active:true,claimed:true,credit:5000}]}),
  account('q','own_qoder',{sourceAccount:true,checkinState:'success',
   activityRewardAmount:10,activityRewardUnit:'积分'}),
  account('loomy','own_loomy',{sourceAccount:true,checkinState:'success',
   benefits:Object.entries({
    first_message:500,pick_skill:1000,generate_ppt:1500,set_schedule:1000,
    install_skill:1500,configure_remote:1000,create_soul:1500,share_soul:2000,
   }).map(([key,credit])=>({kind:'loomy_'+key,active:true,claimed:true,credit}))}),
  account('cline','own_cline',{sourceAccount:true,checkinState:'unsupported',
   balance:10,balanceUnit:'USD'}),
  account('gemini','own_gemini',{sourceAccount:true,
   quotaWindows:[{kind:'5h',left:100}]}),
 ]);
 assert.equal(x.summary.channelCount,7,'all configured channels retain empty tables');
 assert.equal(x.summary.activityCount,0);
 assert.ok(x.channels.every(c=>c.activities.length===0));
 assert.match(channel(x,'cline').emptyReason,/余额查询/);
 assert.match(channel(x,'gemini').emptyReason,/自然恢复/);
 assert.ok(!JSON.stringify(x).includes('5000'));
});

test('Loomy only displays the ONE task with proven official wallet-credit delta',()=>{
 const tasks=[['first_message',500],['pick_skill',1000],['generate_ppt',1500],
  ['set_schedule',1000],['install_skill',1500],['configure_remote',1000],
  ['create_soul',1500],['share_soul',2000]];
 const x=catalog([account('owned-loomy','own_loomy',{
  sourceAccount:true,checkinState:'success',
  activityClaims:{confirmed:8,unconfirmed:0},
  benefits:tasks.map(([key,credit])=>({
   kind:'loomy_'+key,name:'官方任务 '+key,active:true,claimed:true,credit,
   ...(key==='first_message'?{rewardVerified:true,
      rewardProof:'official_wallet_delta',rewardVerifiedAt:now-120000}:{}),
  })),
 })]);
 const items=channel(x,'loomy').activities;
 assert.equal(items.length,1,'seven nominally completed but uncredited tasks remain hidden');
 assert.equal(items[0].kind,'loomy_first_message');
 assert.equal(items[0].rewardAmount,500);
 assert.equal(items[0].rewardUnit,'积分');
 assert.equal(items[0].validity,'completed');
 assert.equal(items[0].endAt,null,'never invent a deadline');
 assert.match(items[0].progress,/钱包增量/);
});

test('Raccoon official positive daily_grant bill is visible; login task without bill is hidden',()=>{
 const row=account('racc','own_raccoon',{sourceAccount:true,
  checkinState:'success',activityRewardAmount:300,activityRewardUnit:'积分',
  activityRewardProof:'official_daily_grant_bill',
  activityRewardVerifiedAt:now-60000,
  benefits:[{kind:'raccoon_login',active:true,claimed:true,credit:3000}]});
 const x=catalog([row]);
 const tasks=channel(x,'raccoon').activities;
 assert.equal(tasks.length,1);
 assert.equal(tasks[0].kind,'daily');
 assert.equal(tasks[0].rewardAmount,300);
 assert.equal(tasks[0].validity,'completed');
 assert.match(tasks[0].progress,/账单/);
 assert.equal(catalog([{...row,activityRewardVerifiedAt:now+3600000}])
   .summary.activityCount,0,'future verification timestamps are not real evidence');
 assert.equal(catalog([row],now+86400000).summary.activityCount,0,
   'yesterday daily-grant proof cannot count as a new day reward');
});

test('different provider can never reuse Raccoon daily-grant evidence',()=>{
 const spoof=account('fake','own_qoder',{sourceAccount:true,
  checkinState:'success',activityRewardAmount:300,activityRewardUnit:'积分',
  activityRewardProof:'official_daily_grant_bill',
  activityRewardVerifiedAt:now-15000});
 assert.equal(catalog([spoof]).summary.activityCount,0);
 const zero=account('zero','own_raccoon',{...spoof,providerId:'own_raccoon',
  activityRewardAmount:0});
 assert.equal(catalog([zero]).summary.activityCount,0);
 const wrongUnit={...zero,activityRewardAmount:300,activityRewardUnit:'Token'};
 assert.equal(catalog([wrongUnit]).summary.activityCount,0);
});

test('disabled channel/account or expired activity cannot show even verified reward',()=>{
 const valid=account('r','own_raccoon',{sourceAccount:true,
  checkinState:'success',activityRewardAmount:300,activityRewardUnit:'积分',
  activityRewardProof:'official_daily_grant_bill',
  activityRewardVerifiedAt:now-3000});
 assert.equal(catalog([{...valid,enabled:false}]).summary.activityCount,0);
 const state={providers:[{id:'own_raccoon',enabled:false}]};
 assert.equal(buildChannelActivityCatalog({config:state,accountRows:[valid],now})
   .summary.activityCount,0);
 const expired=account('l','own_loomy',{sourceAccount:true,
  benefits:[{kind:'loomy_first_message',active:true,claimed:true,
   credit:500,rewardVerified:true,rewardProof:'official_wallet_delta',
   rewardVerifiedAt:now-1000,endAt:now-6000}]});
 assert.equal(catalog([expired]).summary.activityCount,0);
});

test('source/owned duplicate account preserves one proven reward row',()=>{
 const row=account('source-1','own_raccoon',{sourceAccount:true,
  checkinState:'success',activityRewardAmount:300,activityRewardUnit:'积分',
  activityRewardProof:'official_daily_grant_bill',
  activityRewardVerifiedAt:now-1000});
 const result=catalog([row,{...row,providerId:'raccoon'}]);
 assert.equal(channel(result,'raccoon').activities.length,1);
});

test('refresh is a read-only status request, not an automatic claim or proof generator',async()=>{
 let at=now,nAccount=0,nSource=0,nSnapshots=0;
 const state={accounts:[account('wb','own_workbuddy-cn',
  {checkinState:'success',activityState:'claimable'})]};
 const center=createChannelActivityCenter({
  configStore:{get:()=>cfg},
  accountCenter:{refreshReadOnly:async()=>{nAccount++}},
  checkinCenter:{snapshot:()=>{nSnapshots++;return state},
   refreshSources:async args=>{assert.equal(args.force,true);nSource++}},
  now:()=>at,minRefreshMs:25000,
 });
 assert.equal(center.snapshot().summary.activityCount,0);
 await Promise.all([center.refresh(),center.refresh()]);
 assert.equal(nAccount,1);assert.equal(nSource,1);
 assert.equal(center.snapshot().summary.activityCount,0,
  'a successful GET refresh is not proof of claimed points');
 await center.refresh();assert.equal(nAccount,1);
 at+=26000;await center.refresh();
 assert.equal(nAccount,2);assert.equal(nSource,2);
 assert.ok(nSnapshots>=3);
});

test('Loomy current incomplete tasks requiring actual action are visible but never automatic or credited',()=>{
 const x=catalog([account('loomy','own_loomy',{sourceAccount:true,connectionState:'online',benefits:[{kind:'loomy_first_message',name:'First message',active:true,claimed:false,requiresAction:true,credit:500}]})]);
 const rows=channel(x,'loomy').activities;assert.equal(rows.length,1);assert.equal(rows[0].execution,'manual');assert.equal(rows[0].validity,'valid');assert.equal(x.summary.completedCount,0);
});
