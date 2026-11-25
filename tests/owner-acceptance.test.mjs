import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerAcceptance} from '../src/owner-acceptance.mjs';
const id='a'.repeat(32);
function fixture(overrides={}){
 let cfg={providers:[{id:'own_demo',enabled:true,protocol:'native-channel'}],
  accounts:[{id:'one',providerId:'own_demo',enabled:true,credentialRef:'private-ref'}]};
 let calls=[];
 const accountCenter={
  list:()=>({accounts:[{id:'one',providerId:'own_demo',nickname:'private-name',balance:12,balanceUnit:'积分',connectionState:'online',runtimeMode:'owned'}]}),
  verify:async id=>{calls.push(['verify',id]);return {state:'online'}},
  listTestModels:async(id,opts)=>{calls.push(['catalog',id,opts.officialOnly]);return {state:'ready',models:[{id:'zero',free:true}],freeCount:1}},
  verifyModel:async(id,opts)=>{calls.push(['model',id,opts.officialOnly]);return {state:'verified',modelId:'zero',responsePreview:'private-response'}},
  ...overrides.accountCenter,
 };
 const checkinCenter={snapshot:()=>({accounts:[{providerId:'own_demo',enabled:true,checkinSupported:true}]}),refreshSources:async()=>{},runActivityChannel:async channel=>{
   calls.push(['claim',channel]);return {summary:{attempted:1,confirmedSignins:1,newlyCreditedRewards:0,pendingAccounts:0,failedAccounts:0,noTaskAccounts:0}};
 }};
 const service=createOwnerAcceptance({configStore:{get:()=>structuredClone(cfg)},accountCenter,checkinCenter,now:()=>1000});
 return {service,calls,setCfg:value=>{cfg=value}};
}
const done=async service=>{for(let i=0;i<40;i++){const r=service.snapshot();if(r.state!=='running')return r;await new Promise(r=>setImmediate(r))}throw Error('job not settled')};
test('inventory is serial and redacts personal details; duplicate request is not rerun',async()=>{
 const f=fixture();assert.equal(f.service.start({requestId:id,mode:'inventory',consent:true}).state,'running');
 const r=await done(f.service);assert.equal(r.state,'complete');assert.equal(r.accounts[0].connection,'online');
 assert.equal(r.accounts[0].freeCandidates,1);assert.equal(r.accounts[0].hasBalance,true);
 assert.doesNotMatch(JSON.stringify(r),/private-name|private-ref|private-response/);
 assert.deepEqual(f.calls,[['verify','one'],['catalog','one',true]]);
 assert.equal(f.service.start({requestId:id,mode:'inventory',consent:true}).state,'complete');
 assert.equal(f.calls.length,2);
});
test('inventory retains separate official identity, quota and catalog outcomes',async()=>{
 const f=fixture({accountCenter:{list:()=>({accounts:[{id:'one',providerId:'own_demo',enabled:true,runtimeMode:'owned',nickname:'private-name',membershipState:'not_subscribed',usageState:'no_cycle'}]}),listTestModels:async()=>{throw Error('private-response')}}});
 f.service.start({requestId:id,mode:'inventory',consent:true});const r=await done(f.service);
 assert.equal(r.accounts[0].connection,'online');
 assert.equal(r.accounts[0].membershipState,'not_subscribed');assert.equal(r.accounts[0].usageState,'no_cycle');
 assert.equal(r.accounts[0].catalogState,'unavailable');assert.equal(r.accounts[0].state,'observed');
 assert.equal(r.accounts[0].code,'CATALOG_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(r),/private-response|private-name/);
});
test('model testing requires explicit consent and uses official-only evidence',async()=>{
 const f=fixture();assert.throws(()=>f.service.start({requestId:id,mode:'free-models'}));
 f.service.start({requestId:id,mode:'free-models',consent:true});const r=await done(f.service);
 assert.equal(r.accounts[0].modelState,'verified');assert.deepEqual(f.calls,[['model','one',true]]);
 assert.doesNotMatch(JSON.stringify(r),/private-response/);
});
test('activity mode requires an exact selected channel and preserves existing automatic configuration',async()=>{
 const f=fixture();assert.throws(()=>f.service.start({requestId:id,mode:'channel-activity',consent:true}));
 f.service.start({requestId:id,mode:'channel-activity',channel:'demo',consent:true});
 const r=await done(f.service);assert.deepEqual(f.calls,[['claim','demo']]);
 assert.equal(r.activity.newlyCreditedRewards,0);assert.equal(r.activity.confirmedSignins,1);
});
test('all-channel free activity runs eligible channels serially, isolates failures, and deduplicates the job',async()=>{
 const rows=[
  {providerId:'own_alpha',enabled:true,checkinSupported:true},
  {providerId:'alpha',enabled:true,activitiesSupported:true},
  {providerId:'beta',enabled:true,checkinSupported:true},
  {providerId:'gamma',enabled:true,activitiesSupported:true},
  {providerId:'disabled',enabled:false,checkinSupported:true},
  {providerId:'quota-only',enabled:true,checkinSupported:false}];
 const calls=[],config={providers:[],accounts:[],checkin:{autoEnabled:false}};
 const service=createOwnerAcceptance({configStore:{get:()=>structuredClone(config)},
  accountCenter:{list:()=>({accounts:[]})},checkinCenter:{
   snapshot:()=>({accounts:rows}),
   refreshSources:async ({onlyProviderId})=>{calls.push('read:'+onlyProviderId);if(onlyProviderId==='beta')throw Error('synthetic offline')},
   runActivityChannel:async channel=>{calls.push('claim:'+channel);return {summary:{attempted:1,confirmedSignins:1,newlyCreditedRewards:channel==='gamma'?1:0}}}
  },now:()=>1000});
 assert.throws(()=>service.start({requestId:id,mode:'all-channel-activity'}));
 assert.equal(service.start({requestId:id,mode:'all-channel-activity',consent:true}).channelCount,3);
 const report=await done(service);
 assert.deepEqual(calls,['read:alpha','claim:alpha','read:beta','read:gamma','claim:gamma']);
 assert.equal(report.activityChannels[1].state,'unavailable');
 assert.equal(report.activity.attempted,2);assert.equal(report.activity.newlyCreditedRewards,1);
 assert.equal(config.checkin.autoEnabled,false);
 assert.equal(service.start({requestId:id,mode:'all-channel-activity',consent:true}).state,'complete');
 assert.equal(calls.length,5);
});

test('one job at a time; cancel before next account; changed bindings never execute',async()=>{
 let release;const f=fixture({accountCenter:{verify:()=>new Promise(r=>{release=r})}});
 f.service.start({requestId:id,mode:'inventory',consent:true});
 await new Promise(r=>setImmediate(r));
 assert.throws(()=>f.service.start({requestId:'b'.repeat(32),mode:'free-models',consent:true}));
 f.service.cancel(id);release({state:'online'});
 const r=await done(f.service);assert.equal(r.state,'cancelled');assert.equal(f.calls.length,0);
});
test('inventory uses a selected account official reader without duplicate generic refresh',async()=>{
 const f=fixture({accountCenter:{
  driverFor:()=>({refreshAccountStatus:async()=>{}}),
  refreshReadOnly:async opts=>{assert.deepEqual(opts,{force:true,accountId:'one'});
    return [{state:'ready',authVerified:true}]},
  verify:async()=>{throw Error('duplicate refresh')},
 }});
 f.service.start({requestId:id,mode:'inventory',consent:true});
 const r=await done(f.service);
 assert.equal(r.accounts[0].connection,'online');
 assert.equal(r.accounts[0].state,'observed');
 assert.deepEqual(f.calls,[['catalog','one',true]]);
});
