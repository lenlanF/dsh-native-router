import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChannelActivityCatalog,createChannelActivityCenter}
  from '../src/channel-activities.mjs';

const now=Date.parse('2026-11-23T04:00:00Z');
const cfg={providers:[
 {id:'own_workbuddy-cn',name:'WorkBuddy 国内',enabled:true},
 {id:'own_doubao',name:'豆包',enabled:true},
 {id:'own_qoder',name:'Qoder',enabled:true},
 {id:'own_meoo_web',name:'秒悟',enabled:true},
 {id:'own_loomy',name:'Loomy',enabled:true},
 {id:'own_cline',name:'Cline',enabled:true},
 {id:'own_zcode',name:'ZCode',enabled:false}
]};
const account=(id,providerId,props={})=>({
 id,providerId,providerName:cfg.providers.find(p=>p.id===providerId)?.name,
 enabled:true,nickname:'测试用户 '+id,autoCheckinEffective:true,
 ...props
});
const catalog=rows=>buildChannelActivityCatalog({config:cfg,accountRows:rows,now});
const channel=(data,id)=>data.channels.find(x=>x.id===id);
test('one channel table each; only verified free automatic executors, not paid or manual campaigns',()=>{
 const x=catalog([
  account('wb','own_workbuddy-cn',{checkinSupported:true,checkinState:'success',
   activityClaims:{confirmed:1,unconfirmed:0},
   benefits:[
    {kind:'gift',active:true,claimed:false,credit:220,endAt:now+86400000},
    {kind:'compensation',active:true,claimed:true,credit:50,endAt:now+3*86400000},
    {kind:'purchase',active:true,claimed:false,credit:5000,endAt:now+2*86400000},
    {kind:'gift',active:false,claimed:false,credit:300},
   ]}),
  account('doubao','own_doubao',{checkinSupported:true,checkinState:'not_run',
   activityState:'claimable',activityTaskCount:5,
   activityTaskExecutionState:'requires_verified_executor'}),
  account('source','own_qoder',{sourceAccount:true,checkinSupported:true,
   checkinState:'not_run'}),
  account('meoo','own_meoo_web',{checkinSupported:false,
   benefits:[{kind:'gift',active:true,claimed:false,credit:500}]}),
  account('loomy','own_loomy',{sourceAccount:true,checkinSupported:true,
   checkinState:'client_required'}),
  account('cline','own_cline',{sourceAccount:true,checkinSupported:true,
   checkinState:'not_run'}),
  account('zcode','own_zcode',{sourceAccount:true,checkinSupported:true,
   checkinState:'not_run'}),
 ]);
 assert.equal(x.summary.channelCount,7);
 assert.equal(x.summary.activityCount,5);
 assert.deepEqual(x.channels.map(x=>x.id).sort(),
   ['workbuddy-cn','doubao','qoder','meoo_web','loomy','cline','zcode'].sort());
 const wb=channel(x,'workbuddy-cn');
 assert.deepEqual(wb.activities.map(x=>x.kind).sort(),['compensation','daily','gift'].sort());
 assert.equal(wb.activities.find(x=>x.kind==='gift').rewardAmount,220);
 assert.equal(wb.activities.find(x=>x.kind==='compensation').validity,'completed');
 const db=channel(x,'doubao');
 assert.equal(db.activities.length,1,'unknown non-signin reward is not an automatic activity');
 assert.equal(db.activities[0].rewardAmount,null,'no fabricated points');
 assert.equal(channel(x,'qoder').activities[0].execution,'automatic');
 assert.equal(channel(x,'meoo_web').activities.length,0);
 assert.equal(channel(x,'loomy').activities.length,0);
 assert.equal(channel(x,'cline').activities.length,0);
 assert.equal(channel(x,'zcode').activities.length,0);
 assert.ok(!JSON.stringify(x).includes('5000'));
});
test('Loomy official eight API-only activities are shown separately while Cline/Gemini do not fake sign-in',()=>{
 const providerConfig={providers:[
  {id:'own_loomy',name:'讯飞 Loomy',enabled:true},
  {id:'own_cline',name:'Cline',enabled:true},
  {id:'own_gemini',name:'Gemini',enabled:true}]};
 const tasks=[
  ['first_message',500,'发送你的第一条消息'],
  ['pick_skill',1000,'试试选择一个技能'],
  ['generate_ppt',1500,'生成第一份 PPT'],
  ['set_schedule',1000,'设置定时任务'],
  ['install_skill',1500,'在技能广场安装一个技能'],
  ['configure_remote',1000,'配置远程控制'],
  ['create_soul',1500,'创建你的第一个搭子'],
  ['share_soul',2000,'把搭子分享给朋友']];
 const accounts=[
  {id:'loomy-a',providerId:'loomy',providerName:'讯飞 Loomy',
   enabled:true,sourceAccount:true,nickname:'官方账号',
   checkinSupported:true,checkinState:'success',
   benefits:tasks.map(([key,credit,name])=>({kind:'loomy_'+key,credit,name,
     active:true,claimed:key==='first_message'}))},
  {id:'cline-a',providerId:'cline',nickname:'cline-wallet',enabled:true,
   sourceAccount:true,checkinState:'unsupported',checkinSupported:false,
   balance:10.5,balanceUnit:'USD'},
  {id:'gemini-a',providerId:'gemini',nickname:'gemini-window',enabled:true,
   sourceAccount:true,checkinState:'unsupported',checkinSupported:false,
   balanceUnit:'%',quotaWindows:[{kind:'5h',left:80}]}];
 const result=buildChannelActivityCatalog({config:providerConfig,
  accountRows:accounts,now});
 assert.equal(result.summary.activityCount,9,'8 onboarding + 1 proven Loomy daily source');
 const loomy=channel(result,'loomy');
 assert.equal(loomy.activities.filter(x=>x.kind.startsWith('loomy_')).length,8);
 for(const [key,credit,name] of tasks){
  const row=loomy.activities.find(x=>x.kind==='loomy_'+key);
  assert.equal(row.rewardAmount,credit);
  assert.equal(row.rewardUnit,'积分');
  assert.equal(row.name,name);
  assert.equal(row.endAt,null);
 }
 assert.equal(channel(result,'cline').activities.length,0);
 assert.match(channel(result,'cline').emptyReason,/余额查询/);
 assert.equal(channel(result,'gemini').activities.length,0);
 assert.match(channel(result,'gemini').emptyReason,/自然恢复/);
 assert.ok(!result.channels.some(c=>c.activities.some(a=>a.kind==='purchase')));
});

test('Loomy task-level pending receipt never incorrectly marks other free tasks unverified',()=>{
 const state={providers:[{id:'own_loomy',name:'Loomy',enabled:true}]};
 const result=buildChannelActivityCatalog({config:state,now,
  accountRows:[{id:'loomy-x',providerId:'loomy',sourceAccount:true,
   enabled:true,checkinSupported:true,checkinState:'success',
   activityClaims:{confirmed:0,unconfirmed:1},
   benefits:[
    {kind:'loomy_first_message',name:'发送你的第一条消息',
     active:true,claimed:false,credit:500,receiptState:'pending_confirmation'},
    {kind:'loomy_pick_skill',name:'试试选择一个技能',
     active:true,claimed:false,credit:1000},
   ]}]});
 const items=result.channels[0].activities;
 assert.equal(items.find(x=>x.kind==='loomy_first_message').validity,'unverified');
 assert.equal(items.find(x=>x.kind==='loomy_pick_skill').validity,'valid',
   'one ambiguous POST does not taint every other activity on this account');
});

test('expired and disabled activities excluded; unsupported sign-in states never treated as eligible',()=>{
 const x=catalog([
  account('wb','own_workbuddy-cn',{checkinSupported:false,checkinState:'unsupported',
   benefits:[{kind:'gift',active:true,claimed:false,credit:9,endAt:now-1},
     {kind:'compensation',active:false,claimed:false,credit:900}]}),
  account('db','own_doubao',{checkinSupported:true,activityState:'not_offered',
   checkinState:'not_run'}),
  account('q','own_qoder',{enabled:false,sourceAccount:true,
    checkinSupported:true,checkinState:'success'}),
 ]);
 assert.equal(x.summary.activityCount,0);
 assert.ok(x.channels.every(x=>x.activities.length===0));
});
test('official account with inactive free plan cannot be shown as an actionable activity',()=>{
 const x=catalog([account('qoder-inactive','own_qoder',{
   sourceAccount:true,checkinSupported:true,checkinState:'not_run',
   activityActive:false})]);
 assert.equal(x.summary.activityCount,0);
 assert.equal(channel(x,'qoder').activities.length,0);
});

test('disabled borrowed provider cannot hide an enabled independently owned channel activity',()=>{
 const state={providers:[{id:'codearts',name:'CodeArts 原插件',enabled:false},
   {id:'own_codearts',name:'CodeArts 自有',enabled:true}]};
 const result=buildChannelActivityCatalog({config:state,now,accountRows:[
  {id:'sp-test',providerId:'own_codearts',sourceAccount:true,
    enabled:true,checkinSupported:true,checkinState:'success',
    nickname:'可领取的自有账号',activityRewardAmount:16,
    activityRewardUnit:'积分'}]});
 assert.equal(result.channels.length,1);
 assert.equal(result.channels[0].activities.length,1);
 assert.equal(result.channels[0].activities[0].rewardAmount,16);
});


test('Raccoon free daily credited points and one-time login bonus have two independent catalog rows',()=>{
 const cfg={providers:[{id:'own_raccoon',name:'小浣熊',enabled:true}]};
 const base={id:'sp_raccoon',providerId:'raccoon',providerName:'小浣熊',
  nickname:'官方账号',sourceAccount:true,enabled:true,checkinSupported:true,
  checkinState:'success',activityRewardAmount:300,activityRewardUnit:'积分',
  autoCheckinEffective:true};
 const result=buildChannelActivityCatalog({config:cfg,now,accountRows:[{...base,
  activityClaims:{confirmed:1,unconfirmed:0},
  benefits:[{kind:'raccoon_login',active:true,claimed:true,credit:3000}]}]});
 assert.equal(result.channels.length,1);
 const row=result.channels[0];
 assert.equal(row.id,'raccoon');
 assert.equal(row.activities.length,2);
 assert.equal(row.activities.find(x=>x.kind==='daily').rewardAmount,300);
 assert.equal(row.activities.find(x=>x.kind==='raccoon_login').rewardAmount,3000);
 assert.equal(row.activities.find(x=>x.kind==='raccoon_login').validity,'completed');
 assert.equal(row.activities.find(x=>x.kind==='raccoon_login').endAt,null,
   'do not invent a one-time login bonus deadline');
 const pending=buildChannelActivityCatalog({config:cfg,now,accountRows:[{...base,
  activityClaims:{confirmed:0,unconfirmed:1},
  benefits:[{kind:'raccoon_login',active:true,claimed:false}]}]});
 assert.equal(pending.channels[0].activities.find(x=>x.kind==='raccoon_login')
   .validity,'unverified');
 assert.equal(pending.channels[0].activities.find(x=>x.kind==='raccoon_login')
   .rewardAmount,null,'do not advertise inferred upstream 3000 as a confirmed reward');
});

test('source and owned views of the same account do not duplicate an official daily activity',()=>{
 const row=account('source-1','own_loomy',{sourceAccount:true,checkinSupported:true,
  checkinState:'success'});
 const merged=catalog([row,{...row,providerId:'loomy'}]);
 assert.equal(channel(merged,'loomy').activities.length,1);
});
test('read-only activity endpoint uses cached state; refresh requires explicit caller and is throttled',async()=>{
 let at=now,nAccount=0,nSource=0,nActivity=0;
 const snapshot={accounts:[account('wb','own_workbuddy-cn',{checkinSupported:true,
  checkinState:'success'})]};
 const center=createChannelActivityCenter({
  configStore:{get:()=>cfg},
  accountCenter:{refreshReadOnly:async()=>{nAccount++}},
  checkinCenter:{snapshot:()=>{nActivity++;return snapshot},
   refreshSources:async args=>{assert.equal(args.force,true);nSource++}},
  now:()=>at,minRefreshMs:25000});
 assert.equal(center.snapshot().summary.activityCount,1);
 assert.equal(nAccount,0);
 assert.equal(nSource,0);
 await Promise.all([center.refresh(),center.refresh()]);
 assert.equal(nAccount,1);
 assert.equal(nSource,1);
 await center.refresh();
 assert.equal(nAccount,1,'repeated page clicks cannot flood official providers');
 at+=26000;
 await center.refresh();
 assert.equal(nAccount,2);
 assert.equal(nSource,2);
 assert.ok(nActivity>=3);
});
