import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_DAILY_SIGNIN_PROVIDERS} from '../src/embedded-pack.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {buildChannelActivityCatalog} from '../src/channel-activities.mjs';

test('all ten real source-pack daily executors are eligible via manual channel free-activity path',async()=>{
 assert.deepEqual([...SOURCE_DAILY_SIGNIN_PROVIDERS].sort(),
  ['buddy','codearts','lobsterai','loomy','minimax','qoder','qodercn',
    'raccoon','trae','zcode']);
 const today=Date.parse('2026-11-23T12:05:00Z');
 const rows=SOURCE_DAILY_SIGNIN_PROVIDERS.map(providerId=>({
   providerId,id:providerId+'-member',enabled:true,nickname:providerId+' account'}));
 const records=[],seen=[];
 const configStore={get:()=>normalizeConfig({checkin:{autoEnabled:false,runAt:'10:05',
   channels:{qoder:false}}})};
 const sourcePack={status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:rows}),
  readSourceStatuses:async providerId=>({state:'ready',accounts:[{
    accountId:providerId+'-member',authVerified:true,active:true,claimable:true,
    todayCheckedIn:false}]}),
  checkinAccount:async request=>{seen.push(request.providerId+':'+request.sourceAccountId);
    return {confirmed:true}}};
 const accountCenter={find:()=>{throw Error('no direct accounts')},
    driverFor:()=>undefined,list:()=>({accounts:[],channels:[]})};
 const center=createCheckinCenter({configStore,accountCenter,sourcePack,
   store:{all:()=>records,append:entry=>(records.push(entry),entry)},
   now:()=>today,activityStore:{blocked:false,summary:()=>({confirmed:0,unconfirmed:0})}});
 await center.refreshSources();
 try{
  const view=center.snapshot();
  assert.equal(view.accounts.length,10);
  assert.equal(view.groups.length,10);
  const catalog=buildChannelActivityCatalog({config:normalizeConfig({}),
    accountRows:view.accounts,now:today});
  assert.equal(catalog.summary.completedCount,0);
  assert.equal(catalog.summary.validCount,10,
    'only official authenticated eligibility generates valid noncredited rows');
  for(const row of rows){
    const result=await center.runActivityChannel(row.providerId);
    assert.equal(result.attempted,1);
    assert.equal(result.results[0].record.state,'success');
    assert.equal(result.results[0].accountId,
      sourceAccountOpaqueId(row.providerId,row.id));
  }
  assert.equal(seen.length,10,'each of ten channels gets one exact-account claim');
  assert.deepEqual(seen.sort(),rows.map(r=>r.providerId+':'+r.id).sort());
  for(const row of rows)await center.runActivityChannel(row.providerId);
  assert.equal(seen.length,10,'manual retries never repeat official confirmed daily POST');
 }finally{center.stop()}
});
test('unverified or stale account status never becomes claimable even when a reward is advertised',()=>{
 const now=Date.parse('2026-11-23T12:05:00Z');
 const cfg=normalizeConfig({providers:[{id:'own_doubao',name:'豆包',protocol:'native-channel'}]});
 const base={id:'db-test',providerId:'own_doubao',enabled:true,
   checkinSupported:true,checkinState:'not_run',activityState:'claimable',
   activityCheckedAt:now-1000,connectionState:'online'};
 const check=account=>buildChannelActivityCatalog({config:cfg,accountRows:[account],now});
 let c=check(base);
 assert.equal(c.summary.validCount,1);
 assert.equal(c.summary.completedCount,0);
 assert.equal(c.channels[0].activities[0].rewardAmount,null);
 for(const blocked of [
   {...base,connectionState:'not_checked'},
   {...base,activityCheckedAt:now-16*60*1000},
   {...base,activityState:'unavailable'},
   {...base,enabled:false},
   {...base,activityCheckedAt:now+60*1000},
  ])assert.equal(check(blocked).summary.validCount,0);
});
test('WorkBuddy and Doubao claimable rows are NOT credited rows and keep original free units',()=>{
 const now=Date.parse('2026-11-23T08:00:00Z');
 const cfg=normalizeConfig({providers:[{id:'own_workbuddy-cn',name:'WorkBuddy',
   protocol:'native-channel'}, {id:'own_doubao',name:'豆包',protocol:'native-channel'}]});
 const base={enabled:true,connectionState:'online',checkinSupported:true,
   checkinState:'not_run'};
 const rows=[{...base,id:'w',providerId:'own_workbuddy-cn',benefits:[
   {kind:'gift',active:true,claimed:false,credit:50}]},
   {...base,id:'d',providerId:'own_doubao',benefits:[
     {kind:'doubao_task_'+'e'.repeat(24),name:'已完成待领取任务',
       active:true,claimed:false,credit:20}]}];
 const x=buildChannelActivityCatalog({config:cfg,accountRows:rows,now});
 assert.equal(x.summary.completedCount,0);
 assert.equal(x.summary.validCount,2);
 const wb=x.channels.find(r=>r.id==='workbuddy-cn').activities[0],
    db=x.channels.find(r=>r.id==='doubao').activities[0];
 assert.equal(wb.rewardUnit,'积分');
 assert.equal(db.rewardUnit,'平台赠送额度');
 assert.match(db.progress,/尚未证明/);
});
