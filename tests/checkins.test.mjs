import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createCheckinStore,createCheckinCenter,todayKey} from '../src/checkins.mjs';
import {sample} from './fixtures.mjs';

function fixture(t,{drivers=new Map(),config=sample,millis=Date.parse('2026-11-17T02:06:00Z')}={}){
 const dir=mkdtempSync(join(tmpdir(),'native-router-checkin-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const file=join(dir,'checkins.json');
 let now=millis,settings=normalizeConfig(config);
 const configStore={get:()=>structuredClone(settings),replace:x=>(settings=normalizeConfig(x))};
 const accountCenter=createAccountCenter({configStore,drivers,fetchImpl:async()=>new Response('{}',{status:200})});
 const store=createCheckinStore({path:file});
 const center=createCheckinCenter({configStore,accountCenter,store,now:()=>now});
 return {center,configStore,accountCenter,store,file,setNow:v=>{now=v}};
}
test('today key honors the selected timezone including UTC day rollover',()=>{
 const stamp=Date.parse('2026-11-16T18:00:00Z');
 assert.equal(todayKey(stamp,'Asia/Shanghai'),'2026-11-17');
 assert.equal(todayKey(stamp,'America/Los_Angeles'),'2026-11-16');
});
test('unsupported check-in stays unsupported and never invents an executed result',async t=>{
 const rig=fixture(t);
 const view=rig.center.snapshot();
 assert.equal(view.today,'2026-11-17');
 assert.equal(view.groups.some(x=>x.id==='workbuddy'),false,
   'channels without a real executor are absent from sign-in UI');
 assert.equal(view.accounts.find(x=>x.id==='a1').checkinState,'unsupported');
 await assert.rejects(()=>rig.center.run('a1'),e=>e.status===501);
 assert.equal(existsSync(rig.file),false);
});
test('accepted response remains pending until remote confirms the actual same-day task',async t=>{
 let flag=false,attempts=0;
 const driver={checkIn:async({date})=>{
  attempts++;
  return flag?{confirmed:true,date,message:'已从活动详情确认签到'}:
    {accepted:true,state:'pending_confirmation',message:'提交已受理，回查未完成'};
 }};
 const rig=fixture(t,{drivers:new Map([['alpha',driver]])});
 const first=await rig.center.run('a1');
 assert.equal(first.record.state,'pending_confirmation');
 assert.equal(rig.center.snapshot().accounts.find(a=>a.id==='a1').checkinState,'pending_confirmation');
 flag=true;
 const second=await rig.center.run('a1');
 assert.equal(second.record.state,'success');
 assert.equal(rig.center.snapshot().accounts.find(a=>a.id==='a1').checkinState,'success');
 assert.equal((await rig.center.run('a1')).alreadyConfirmed,true);
 assert.equal(attempts,2,'same-day confirmed check-in must not run again');
 assert.equal(JSON.parse(readFileSync(rig.file,'utf8')).history.length,2);
});
test('owned WorkBuddy and Doubao pending daily rewards survive manual repeat without another POST',async t=>{
 for(const providerId of ['own_workbuddy-cn','own_doubao']){
  let attempts=0;
  const settings={...sample,providers:sample.providers.map(x=>x.id==='alpha'?
   {...x,id:providerId,name:providerId}:x),
    accounts:sample.accounts.map(x=>x.providerId==='alpha'? {...x,providerId}:x),
    routes:[]};
  const rig=fixture(t,{config:settings,drivers:new Map([[providerId,{
   checkIn:async()=>{attempts++;return {state:'pending_confirmation',accepted:true}}
  }]])});
  const first=await rig.center.run('a1');
  assert.equal(first.record.state,'pending_confirmation');
  const again=await rig.center.run('a1');
  assert.equal(again.alreadyPending,true);
  assert.equal(again.record.at,first.record.at);
  assert.equal(attempts,1);
  assert.equal(rig.store.all().length,1);
 }
});
test('response marked success without same-day confirmation cannot become success',async t=>{
 const driver={checkIn:async()=>({state:'success',confirmed:false,message:'only an acceptance receipt'})};
 const rig=fixture(t,{drivers:new Map([['alpha',driver]])});
 assert.equal((await rig.center.run('a1')).record.state,'failed');
});
test('client-required and no-task remain distinct states',async t=>{
 const drivers=new Map([['alpha',{checkIn:async({account})=>account.id==='a1'
   ?{state:'client_required',message:'官方客户端处理'}:{state:'no_task',message:'无签到任务'}}]]);
 const rig=fixture(t,{drivers});
 assert.equal((await rig.center.run('a1')).record.state,'client_required');
 assert.equal((await rig.center.run('a2')).record.state,'no_task');
});
test('daily opt-in scheduler runs only due, enabled, opted-in accounts and only once per day',async t=>{
 const calls=[];
 const config={...sample,accounts:sample.accounts.map(a=>({...a,autoCheckin:a.id==='a1'})),
  checkin:{autoEnabled:true,timeZone:'Asia/Shanghai',runAt:'10:05'}};
 const driver={checkIn:async({account,date,source})=>{
  calls.push(account.id+':'+source);
  return {confirmed:true,date,message:'Verified'};
 }};
 const rig=fixture(t,{config,drivers:new Map([['alpha',driver]]),
  millis:Date.parse('2026-11-17T02:04:00Z')});
 assert.deepEqual(await rig.center.tick(),{skipped:'not_due'});
 rig.setNow(Date.parse('2026-11-17T02:06:00Z'));
 assert.equal((await rig.center.tick()).attempted,1);
 assert.deepEqual(calls,['a1:auto']);
 assert.equal((await rig.center.tick()).attempted,0);
 assert.equal(rig.center.snapshot().accounts.find(a=>a.id==='a1').checkinState,'success');
 rig.setNow(Date.parse('2026-11-18T02:06:00Z'));
 assert.equal(rig.center.snapshot().accounts.find(a=>a.id==='a1').checkinState,'not_run');
 assert.equal((await rig.center.tick()).attempted,1);
 assert.deepEqual(calls,['a1:auto','a1:auto']);
});
test('auto scheduler disabled by default and keeps startup read-only',async t=>{
 let calls=0;
 const rig=fixture(t,{drivers:new Map([['alpha',{checkIn:async()=>{calls++}}]])});
 assert.deepEqual(await rig.center.tick(),{skipped:'disabled'});
 assert.equal(calls,0);
 assert.equal(existsSync(rig.file),false);
});
test('corrupt sign-in history is rejected rather than silently overwritten',t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-router-corrupt-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const file=join(dir,'checkins.json');
 writeFileSync(file,'THIS_IS_NOT_JSON','utf8');
 const store=createCheckinStore({path:file});
 assert.equal(store.blocked,true);
 assert.match(store.error,/禁止签到/);
 assert.throws(()=>store.append({date:'2026-11-17',accountId:'x',state:'success'}),/禁止签到/);
 assert.equal(readFileSync(file,'utf8'),'THIS_IS_NOT_JSON');
});
test('real local time configuration validates timezone and preserves account opt-in',()=>{
 const cfg=normalizeConfig({...sample,accounts:sample.accounts.map((a,i)=>({...a,autoCheckin:i===0})),
  checkin:{autoEnabled:true,timeZone:'Asia/Shanghai',runAt:'08:32'}});
 assert.equal(cfg.checkin.autoEnabled,true);
 assert.equal(cfg.checkin.runAt,'08:32');
 assert.equal(cfg.accounts[0].autoCheckin,true);
 assert.equal(cfg.accounts[1].autoCheckin,false);
 assert.throws(()=>normalizeConfig({...sample,checkin:{timeZone:'Invalid/Unknown'}}),/timezone/);
});

test('corrupt history blocks automatic and manual check-in but does not prevent state API reads',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'native-router-blocked-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const path=join(dir,'checkins.json');
 writeFileSync(path,'INVALID','utf8');
 const store=createCheckinStore({path});
 const fake={checkIn:async()=>{throw Error('should not call upstream when history is corrupt')}};
 const cfg=normalizeConfig({...sample,checkin:{autoEnabled:true,runAt:'10:05',timeZone:'Asia/Shanghai'},
   accounts:sample.accounts.map(a=>({...a,autoCheckin:true}))});
 const configStore={get:()=>cfg,replace:()=>{}};
 const acc=createAccountCenter({configStore,drivers:new Map([['alpha',fake]])});
 const center=createCheckinCenter({configStore,accountCenter:acc,store,now:()=>Date.parse('2026-11-17T02:07:00Z')});
 assert.equal(center.snapshot().historyBlocked,true);
 assert.deepEqual(await center.tick(),{skipped:'history_blocked'});
 await assert.rejects(()=>center.run('a1'),e=>e.status===503);
 assert.equal(readFileSync(path,'utf8'),'INVALID');
});
