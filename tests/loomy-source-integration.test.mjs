import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCheckinCenter,createCheckinStore} from '../src/checkins.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';
import {LOOMY_FREE_TASKS,claimLoomyFreeTasks}
 from '../src/channels/loomy-rewards.mjs';
import {normalizeConfig} from '../src/config.mjs';

const root=()=>{const base=process.platform==='win32'?'E:\\Temp':tmpdir();
 mkdirSync(base,{recursive:true});return mkdtempSync(join(base,'dsh-loomy-silent-'))};
const keySet=['first_message','pick_skill','generate_ppt','set_schedule',
 'install_skill','configure_remote','create_soul','share_soul'];
const ok=data=>new Response(JSON.stringify({code:'000000',data}),{status:200});
test('Loomy source accounts report manual tasks and do not assert completion after restart',async()=>{
 const dir=root();try{
  const config=normalizeConfig({providers:[{id:'own_loomy',enabled:true,
    name:'Loomy',protocol:'native-channel'}],
    checkin:{autoEnabled:true,autoSourceAccounts:true,runAt:'10:05',timeZone:'Asia/Shanghai'}});
  const configStore={get:()=>structuredClone(config),replace(){}};
  const accounts=['member_A','member_B'];let at=Date.parse('2026-11-23T04:00:00Z');
  const completed=Object.fromEntries(accounts.map(id=>[id,
    Object.fromEntries(keySet.map(key=>[key,false]))]));
  const postCounts={member_A:0,member_B:0},methods=[];
  const wallet={member_A:0,member_B:0};
  const sourcePack={
   status:()=>({state:'mounted'}),
   listAccounts:async()=>({state:'ready',accounts:accounts.map(id=>({
    id,providerId:'loomy',nickname:id,enabled:true}))}),
   readSourceStatuses:async(providerId)=>{
    assert.equal(providerId,'loomy');
    return {state:'ready',accounts:accounts.map(id=>({
     accountId:id,nickname:id,authVerified:true,active:true,todayCheckedIn:true,
     benefits:keySet.map(key=>({kind:'loomy_'+key,
       name:LOOMY_FREE_TASKS[key].name,active:true,
       credit:LOOMY_FREE_TASKS[key].points,claimed:completed[id][key]}))
    }))};
   },
   async claimLoomyActivities({sourceAccountId,beforeClaim,onOutcome,onObserved,previousReceipt}){
    const id=sourceAccountId;
    return claimLoomyFreeTasks({credential:{access_token:['FAKE',id,'TOKEN'].join('_')},
     fetchImpl:async(url,options)=>{
      methods.push(options.method);
      if(options.method==='GET')return url.includes('/points/records')?
        ok({balance:wallet[id]}):ok({tasks:completed[id]});
      const key=JSON.parse(options.body).key;
      postCounts[id]++;completed[id][key]=true;
      wallet[id]+=LOOMY_FREE_TASKS[key].points;
      return ok({balance:0});
     },beforeClaim,onOutcome,onObserved,previousReceipt,now:()=>at});
   }
  };
  const accountCenter={find:()=>{throw Error('no owned account')},
    driverFor:()=>undefined,list:()=>({accounts:[],channels:[]}),
    refreshReadOnly:async()=>({})};
  const claims=join(dir,'reward-claims.json'),checkins=join(dir,'checkins.json');
  const mount=()=>createCheckinCenter({configStore,accountCenter,sourcePack,
    activityStore:createActivityClaimStore({path:claims,now:()=>at}),
    store:createCheckinStore({path:checkins}),now:()=>at});
  let center=mount();
  await center.refreshSources();
  assert.equal(center.snapshot().accounts.length,2);
  assert.equal(Object.values(postCounts).reduce((a,b)=>a+b,0),0,
   'discovery is read only');
  const done=await center.tick();
  assert.equal(done.rewards.length,0);
  assert.equal(done.rewards.reduce((sum,r)=>sum+r.confirmed,0),0);
  assert.ok(methods.length>=4,'the automatic scheduler still reads both exact official accounts');
  assert.deepEqual(postCounts,{member_A:0,member_B:0});
  assert.ok(methods.every(x=>x==='GET'));
  assert.ok(center.snapshot().accounts.every(x=>x.benefits.length===8&&x.benefits.every(y=>!y.claimed&&y.requiresAction)));
  center.stop();
  at+=3600000;center=mount();
  await center.refreshSources();
  const next=await center.tick();
  assert.equal(next.rewards.reduce((sum,r)=>sum+r.confirmed,0),0);
  assert.deepEqual(postCounts,{member_A:0,member_B:0},
   'restart cannot submit bonus rewards twice');
  assert.ok(center.snapshot().accounts.every(x=>x.activityClaims.confirmed===0));
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('Loomy disabled auto tasks never submit a completion API call',async()=>{
 const dir=root();try{
  const cfg=normalizeConfig({providers:[{id:'own_loomy',enabled:true,
   protocol:'native-channel'}],
   checkin:{autoEnabled:false,autoSourceAccounts:true,runAt:'10:05'}});
  const configStore={get:()=>cfg,replace(){}},at=Date.parse('2026-11-23T04:00:00Z');
  let post=0;
  const sourcePack={status:()=>({state:'mounted'}),
   listAccounts:async()=>({state:'ready',accounts:[{
    id:'loomy_1',providerId:'loomy',enabled:true}]}),
   readSourceStatuses:async()=>({state:'ready',accounts:[{
    accountId:'loomy_1',authVerified:true,active:true,
    benefits:[{kind:'loomy_first_message',active:true,
      claimed:false,credit:500}]}]}),
   claimLoomyActivities:async()=>{post++;return {state:'confirmed',confirmed:1}}};
  const accountCenter={find:()=>{throw Error('not called')},
    driverFor:()=>undefined,list:()=>({accounts:[],channels:[]})};
  const center=createCheckinCenter({configStore,accountCenter,sourcePack,
   store:createCheckinStore({path:join(dir,'checkins.json')}),
   activityStore:createActivityClaimStore({path:join(dir,'rewards.json')}),
   now:()=>at});
  await center.refreshSources();
  assert.equal((await center.tick()).skipped,'disabled');
  assert.equal(post,0);
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
