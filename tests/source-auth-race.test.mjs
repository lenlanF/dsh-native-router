import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createSourceCheckinCenter} from '../src/source-checkins.mjs';

test('an in-flight source auth probe cannot grant online status after logout and immediate private re-adoption',async()=>{
 const id=sourceAccountOpaqueId('loomy','race-login-01');
 let cfg=normalizeConfig({embeddedPack:{enabled:true}});
 const configStore={get:()=>structuredClone(cfg),replace:value=>(cfg=normalizeConfig(value))};
 let release,signalStart;
 const started=new Promise(resolve=>{signalStart=resolve});
 const blocked=new Promise(resolve=>{release=resolve});
 let reads=0;
 const sourcePack={
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'loomy',id:'race-login-01',enabled:true}]}),
  async readSourceStatuses(){
   reads++;signalStart();
   await blocked;
   return {state:'ready',accounts:[{accountId:'race-login-01',authVerified:true}]};
  },
 };
 const center=createSourceCheckinCenter({sourcePack,configStore,
  store:{blocked:false,all:()=>[],append:e=>e},
  now:()=>Date.parse('2026-11-21T04:15:00Z')});
 const pending=center.refresh();
 await started;
 configStore.replace({...cfg,sessionReuse:{ignoredIds:[id]}});
 release();
 await pending;
 assert.equal(center.snapshot().length,0);
 configStore.replace({...cfg,providers:[{id:'own_loomy',protocol:'native-channel'}],
  accounts:[{id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,enabled:true}]});
 const after=center.snapshot().find(x=>x.id===id);
 assert.equal(after?.connectionState,'not_checked',
  'auth evidence from a session detached during the remote request cannot authorize a new binding');
 await center.refresh();
 assert.equal(reads,2,'re-adoption must receive independent new server confirmation');
 assert.equal(center.snapshot()[0].connectionState,'online');
 center.stop();
});

test('a disabled source channel cannot regain auth from a response issued before it was disabled',async()=>{
 const id=sourceAccountOpaqueId('loomy','race-provider-02');
 let cfg=normalizeConfig({embeddedPack:{enabled:true},providers:[{id:'own_loomy',protocol:'native-channel'}]});
 const configStore={get:()=>structuredClone(cfg),replace:next=>(cfg=normalizeConfig(next))};
 let release,signalStart;
 const started=new Promise(resolve=>{signalStart=resolve});
 const waiting=new Promise(resolve=>{release=resolve});
 const pack={listAccounts:async()=>({state:'ready',accounts:[{
  providerId:'loomy',id:'race-provider-02',enabled:true}]}),
  readSourceStatuses:async()=>{signalStart();await waiting;
   return {state:'ready',accounts:[{accountId:'race-provider-02',authVerified:true}]};}};
 const center=createSourceCheckinCenter({sourcePack:pack,configStore,
  now:()=>Date.parse('2026-11-21T04:20:00Z'),
  store:{blocked:false,all:()=>[],append:e=>e}});
 const request=center.refresh();
 await started;
 configStore.replace({...cfg,providers:[{id:'own_loomy',protocol:'native-channel',enabled:false}]});
 release();await request;
 assert.equal(center.snapshot()[0].connectionState,'disabled');
 configStore.replace({...cfg,providers:[{id:'own_loomy',protocol:'native-channel',enabled:true}]});
 assert.equal(center.snapshot()[0].connectionState,'not_checked',
  're-enabling source must not inherit auth data from before it was switched off');
 center.stop();
});
