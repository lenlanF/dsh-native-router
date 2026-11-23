import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {allowsHostModel,filterHostModels,filterHostRoutes}
  from '../src/host-model-selection.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {buildChannelActivityCatalog} from '../src/channel-activities.mjs';

const provider={id:'own_workbuddy-cn',name:'WorkBuddy 国内',
 protocol:'native-channel',enabled:true};
const owner={id:'one',providerId:'own_workbuddy-cn',
 credentialRef:'driver:own_workbuddy-cn:one',enabled:true,autoCheckin:true};
const clock=Date.parse('2026-11-23T07:00:00Z');
function rig({channelAuto=false,withActivity=false,globalAuto=true,independent=false}={}){
 let config=normalizeConfig({providers:[provider],accounts:[owner],
  checkin:{autoEnabled:globalAuto,runAt:'10:05',
   independentChannels:independent?['workbuddy-cn']:[],
   channels:{'workbuddy-cn':channelAuto}}});
 const rows=[];let signins=0,claims=0;
 const driver={checkIn:async({date})=>{signins++;return {confirmed:true,date}},
  ...(withActivity?{claimActivities:async()=>{claims++;return {
     state:'pending_confirmation',confirmed:0,pending:1,eligible:1}}}:{})};
 const accountCenter={find:()=>({account:config.accounts[0],
  provider:config.providers[0],driver}),driverFor:()=>driver,
  list:()=>({accounts:[{...config.accounts[0],nickname:'WorkBuddy 实验账号',
    enabled:true,connectionState:'online',providerName:'WorkBuddy 国内',
    benefits:withActivity?[{kind:'compensation',active:true,
      claimed:true,credit:100}]:[]}],
    channels:[{id:provider.id,name:provider.name}]}),
  refreshReadOnly:async()=>{}};
 const checkins=createCheckinCenter({configStore:{get:()=>config},
  accountCenter,now:()=>clock,store:{all:()=>rows,
  append:entry=>{rows.push(entry);return entry}},
  activityStore:{blocked:false,summary:()=>({confirmed:0,unconfirmed:0}),
    receipt:()=>null,begin:()=>true,finish:()=>true}});
 return {checkins,setChannel:v=>{config=normalizeConfig({...config,checkin:{
    ...config.checkin,channels:{'workbuddy-cn':v}}})},
  get config(){return config},get signins(){return signins},
  get claims(){return claims},stop:()=>checkins.stop()};
}
test('host model allowlist: absence means all; selected IDs are exact, and not inherited by another provider',()=>{
 const cfg=normalizeConfig({providers:[{id:'workbuddy',name:'WorkBuddy',
   protocol:'dsh-host',enabled:true},{id:'lingxi',name:'Lingxi',
   protocol:'dsh-host',enabled:true}],accounts:[],
  hostModelSelection:{workbuddy:['free-flash','free-flash']},
  routes:[{id:'mixed',name:'Mixed',enabled:true,mode:'priority',tiers:[
   {providerId:'workbuddy',model:'free-flash'},
   {providerId:'workbuddy',model:'paid-pro'},
   {providerId:'lingxi',model:'other'}]}]});
 assert.deepEqual(cfg.hostModelSelection.workbuddy,['free-flash']);
 assert.equal(allowsHostModel(cfg,'workbuddy','free-flash'),true);
 assert.equal(allowsHostModel(cfg,'workbuddy','paid-pro'),false);
 assert.equal(allowsHostModel(cfg,'lingxi','anything'),true);
 assert.deepEqual(filterHostModels(cfg,'workbuddy',
  [{id:'free-flash'},{id:'paid-pro'}]).map(x=>x.id),['free-flash']);
 assert.deepEqual(filterHostRoutes(cfg).routes[0].tiers.map(x=>x.model),
  ['free-flash','other']);
 assert.equal(allowsHostModel(normalizeConfig({}),'workbuddy','paid-pro'),true);
 assert.throws(()=>normalizeConfig({hostModelSelection:{workbuddy:['\u0000']}}),/Invalid selected host model/);
 assert.throws(()=>normalizeConfig({checkin:{channels:{'workbuddy-cn':'true'}}}),
  /Invalid per-channel auto check-in/);
});
test('host AutoFree cache invalidates immediately when selected model IDs change',async()=>{
 const {createAutoFreePool}=await import('../src/auto-free.mjs');
 let selections={},calls=0;
 let cfg=normalizeConfig({freePool:{models:[
  {providerId:'workbuddy',model:'free-flash',free:true},
  {providerId:'workbuddy',model:'other-free',free:true}]},
  hostModelSelection:selections});
 const inventory={status:()=>({hostProviders:[{providerId:'workbuddy'}]}),
  listHostModels:async()=>{calls++;return {state:'ready',models:[
   {id:'free-flash',name:'Flash'},{id:'other-free',name:'Other'}]}}};
 const pool=createAutoFreePool({hostProviderInventory:inventory,
  getConfig:()=>cfg,ttlMs:900000});
 await pool.refresh();
 assert.deepEqual(pool.tiers().map(x=>x.model).sort(),['free-flash','other-free']);
 assert.equal(calls,1);
 cfg=normalizeConfig({...cfg,hostModelSelection:{workbuddy:['free-flash']}});
 await pool.refresh();
 assert.deepEqual(pool.tiers().map(x=>x.model),['free-flash']);
 assert.equal(calls,2,'a changed allowlist invalidates a 15-minute cache immediately');
 cfg=normalizeConfig({...cfg,hostModelSelection:{}});
 await pool.refresh();
 assert.deepEqual(pool.tiers().map(x=>x.model).sort(),['free-flash','other-free']);
 assert.equal(calls,3);
});
test('per-channel auto-off blocks background execution but not explicit manual sign-in',async()=>{
 const v=rig({channelAuto:false});
 try{
  assert.equal(v.checkins.snapshot().groups.length,1);
  assert.equal(v.checkins.snapshot().groups[0].autoEnabled,false);
  assert.equal((await v.checkins.tick()).attempted,0);
  assert.equal(v.signins,0);
  const explicit=await v.checkins.runChannel('workbuddy-cn');
  assert.equal(explicit.attempted,1);
  assert.equal(v.signins,1);
  assert.equal(explicit.results[0].record.state,'success');
  assert.equal((await v.checkins.runChannel('workbuddy-cn')).results[0].alreadyConfirmed,true);
  assert.equal(v.signins,1,'manual repeat must not resubmit a confirmed daily POST');
 }finally{v.stop()}
});
test('one explicitly enabled channel runs safely while global scheduling is off',async()=>{
 const selected=rig({channelAuto:true,globalAuto:false,independent:true});
 try{
  assert.equal(selected.checkins.snapshot().groups[0].autoEnabled,true);
  assert.equal(selected.checkins.snapshot().accounts[0].autoCheckinEffective,true);
  assert.equal((await selected.checkins.tick()).attempted,1);
  assert.equal(selected.signins,1);
  assert.equal((await selected.checkins.tick()).attempted,0,
   'confirmed daily sign-in is never posted twice');
 }finally{selected.stop()}
 const legacyPreset=rig({channelAuto:true,globalAuto:false});
 try{
  assert.equal(legacyPreset.checkins.snapshot().groups[0].autoEnabled,false);
  assert.equal((await legacyPreset.checkins.tick()).skipped,'disabled');
  assert.equal(legacyPreset.signins,0,'existing stored presets must stay inert after upgrade');
 }finally{legacyPreset.stop()}
 const off=rig({channelAuto:false,globalAuto:false});
 try{
  assert.equal(off.checkins.snapshot().groups[0].autoEnabled,false);
  assert.equal((await off.checkins.tick()).skipped,'disabled');
  assert.equal(off.signins,0,'other disabled channels cannot run');
 }finally{off.stop()}
});
test('channel manual sign-in and free activities never generate fake catalog rewards',async()=>{
 const v=rig({channelAuto:false,withActivity:true});
 try{
  assert.equal((await v.checkins.runChannel('mimo_desktop')).attempted,0,
    'a channel without the official signer is never executed');
  assert.equal((await v.checkins.runActivityChannel('workbuddy-cn')).attempted,1);
  assert.equal(v.claims,1);
  assert.equal(v.signins,1,
    'channel activity action now also executes its real official daily free signer');
  assert.equal(buildChannelActivityCatalog({config:v.config,
    accountRows:v.checkins.snapshot().accounts,now:clock}).summary.completedCount,0,
    'confirmed daily check-in is not proof of credited wallet reward');
 }finally{v.stop()}
});
