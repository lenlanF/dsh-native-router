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
test('retired channels are not listed even if legacy snapshots contain a pending activity',()=>{
 const now=Date.parse('2026-11-23T12:05:00Z');
 const cfg=normalizeConfig({providers:[{id:'own_doubao',name:'Retired',protocol:'native-channel'}]});
 const legacy={id:'db-test',providerId:'own_doubao',enabled:true,checkinSupported:true,connectionState:'online',activityClaimable:true};
 const c=buildChannelActivityCatalog({config:cfg,accountRows:[legacy],now});
 assert.equal(c.summary.channelCount,0);assert.equal(c.summary.validCount,0);
});
test('WorkBuddy claimable rows are not credited rows and retain points units',()=>{
 const now=Date.parse('2026-11-23T08:00:00Z');
 const cfg=normalizeConfig({providers:[{id:'own_workbuddy-cn',name:'WorkBuddy',protocol:'native-channel'}]});
 const row={enabled:true,connectionState:'online',checkinSupported:true,checkinState:'not_run',id:'w',providerId:'own_workbuddy-cn',benefits:[{kind:'gift',active:true,claimed:false,credit:50}]};
 const x=buildChannelActivityCatalog({config:cfg,accountRows:[row],now});
 assert.equal(x.summary.completedCount,0);assert.equal(x.summary.validCount,1);
 assert.equal(x.channels[0].activities[0].rewardUnit,'积分');
 assert.match(x.channels[0].activities[0].progress,/尚未证明/);
});
