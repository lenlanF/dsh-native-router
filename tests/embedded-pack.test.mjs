import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEmbeddedChannelPack,SOURCE_PACK_PROVIDERS} from '../src/embedded-pack.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {channelPackNodeRuntimeReason} from '../src/channel-pack-isolation.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const isolatedHome=mkdtempSync('E:\\Temp\\dsh-native-router-isolated-');
process.once('exit',()=>rmSync(isolatedHome,{recursive:true,force:true}));
const isolatedEnv={DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1',DSH_OPENAI_GATEWAY_ENABLED:'0',
 DSH_REASONING_LOOP_AUTO_RESUME:'0',DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE:'1',
 DSH_HOME:isolatedHome,DSH_CHANNEL_PACK_STATE_DIR:isolatedHome};
const enabled=()=>({embeddedPack:{enabled:true}});
test('ZCode signed claimable plan can enter exact-account claim without legacy available field',async()=>{
 const rows=[{id:'zc-a',provider:'zcode',enabled:true,credentialRef:'ZA'},
             {id:'zc-b',provider:'zcode',enabled:true,credentialRef:'ZB'}];
 let eligible=true,kind='claimed',called=0;
 const pool={listAllAccounts:async()=>rows};
 const ops={
  status:async(p,id)=>({ok:true,value:{accounts:[{accountId:id,status:{
    active:true,claimable:eligible,planCount:eligible?1:0,todayCheckedIn:false}}]}}),
  claim:async(p,id)=>{assert.equal(p,'zcode');assert.equal(id,'zc-b');called++;
    return {ok:true,value:{results:[{accountId:'zc-b',outcome:{kind}},
      {accountId:'zc-a',outcome:{kind:'failed'}}]}}}
 };
  let livePool;
  const scope={llm:{listProviders:async()=>[]},
   get:k=>k==='accountPool'?livePool:k==='nativeRouterSourceCheckins'?ops:undefined};
  const bridge=createEmbeddedChannelPack({ctx:{inject(_d,fn){fn(scope)}},getConfig:enabled,
   env:isolatedEnv,loadPack:async()=>({apply(){livePool=pool}})}); bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 try{
  const out=await bridge.checkinAccount({providerId:'zcode',sourceAccountId:'zc-b'});
  assert.equal(out.state,'pending_confirmation');
  assert.equal(called,1,'one exact-account claim only');
  eligible=false;
  const blocked=await bridge.checkinAccount({providerId:'zcode',sourceAccountId:'zc-b'});
  assert.equal(blocked.state,'no_task');
  assert.equal(blocked.claimPosted,false,'signed empty plan is read-only');
  assert.equal(called,1,'do not claim without official eligibility');
  const missing=await bridge.checkinAccount({providerId:'zcode',sourceAccountId:'absent'});
  assert.equal(missing.state,'unavailable');
  assert.equal(called,1);
  eligible=true;
  kind='captcha';
  const challenge=await bridge.checkinAccount({providerId:'zcode',sourceAccountId:'zc-b'});
  assert.equal(challenge.state,'client_required');
  assert.equal(challenge.accepted,undefined,
    'captcha is not accepted and cannot be marked as a claimed gift');
  kind='ineligible';
  const ineligible=await bridge.checkinAccount({providerId:'zcode',sourceAccountId:'zc-b'});
  assert.equal(ineligible.state,'no_task','current ineligibility is not a confirmed grant');
  assert.equal(ineligible.claimPosted,true,'ineligible reply followed a real claim POST');
  kind='unexpected-upstream-kind';
  const unknown=await bridge.checkinAccount({providerId:'zcode',sourceAccountId:'zc-b'});
  assert.equal(unknown.state,'failed','unknown upstream outcome fails closed');
  assert.equal(called,4);
 }finally{bridge.dispose()}
});
test('Loomy official API-only tasks are read and claimed by exact owned source account, never by an adjacent account',async()=>{
 const ids=['loomy-member-a','loomy-member-b'];
 const refs={['loomy-member-a']:'LOOMY_A_TOKEN',['loomy-member-b']:'LOOMY_B_TOKEN'};
 const tokens={['loomy-member-a']:['FAKE','A','LOOMY','TOKEN'].join('_'),
   ['loomy-member-b']:['FAKE','B','LOOMY','TOKEN'].join('_')};
 const keys=['first_message','pick_skill','generate_ppt','set_schedule',
   'install_skill','configure_remote','create_soul','share_soul'];
 const states=Object.fromEntries(ids.map(id=>[id,
   Object.fromEntries(keys.map(key=>[key,false]))]));
 const wallets={'loomy-member-a':0,'loomy-member-b':0};
 const pool={listAllAccounts:async()=>ids.map(id=>({
   id,provider:'loomy',enabled:true,credentialRef:refs[id]}))};
 let livePool,posts=0;
 const credentials={resolve:async ref=>{
   const id=ids.find(x=>refs[x]===ref);
   return {value:JSON.stringify({access_token:tokens[id]})};
 }};
 const ops={status:async(_p,id)=>({ok:true,value:{accounts:(id?[id]:ids)
   .map(accountId=>({accountId,status:{active:true,todayCheckedIn:true}}))}}),
   identity:async()=>({ok:true,value:{accounts:ids.map(accountId=>({
     accountId,name:accountId}))}}),
   claim:async()=>{throw Error('generic signin claim must NOT be used for onboarding')}};
 const scope={llm:{listProviders:async()=>[]},credentials,
   get:k=>k==='accountPool'?livePool:k==='nativeRouterSourceCheckins'?ops:undefined};
 const fetchImpl=async(_url,init)=>{
   const id=ids.find(x=>init.headers?.token===tokens[x]);
   assert.ok(id,'exact owned account token');
   if(init.method==='GET')return new Response(JSON.stringify({
     code:'000000',data:_url.includes('/points/records')?
       {balance:wallets[id]}:{tasks:states[id]}}),{status:200});
   assert.equal(init.method,'POST');
   const key=JSON.parse(init.body).key;
   assert.ok(Object.hasOwn(states[id],key));
   posts++;states[id][key]=true;
   wallets[id]+=({first_message:500,pick_skill:1000,generate_ppt:1500,
     set_schedule:1000,install_skill:1500,configure_remote:1000,
     create_soul:1500,share_soul:2000})[key];
   return new Response(JSON.stringify({code:'000000',data:{balance:0}}),{status:200});
 };
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,fn){fn(scope)}},
   getConfig:enabled,env:isolatedEnv,loomyFetchImpl:fetchImpl,
   loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 try{
   const first=await bridge.readSourceStatuses('loomy');
   assert.equal(first.state,'ready');
   assert.equal(first.accounts.length,2);
   assert.ok(first.accounts.every(x=>x.benefits.length===8));
   assert.equal(posts,0);
   let confirmed=0;
   const claimed=await bridge.claimLoomyActivities({
     sourceAccountId:'loomy-member-b',
     beforeClaim:()=>true,
     onOutcome:(offer,state)=>{assert.equal(state,'confirmed');confirmed++}});
   assert.equal(claimed.confirmed,8);
   assert.equal(confirmed,8);
   assert.equal(posts,8);
   assert.ok(keys.every(key=>states['loomy-member-b'][key]));
   assert.ok(keys.every(key=>!states['loomy-member-a'][key]));
   const after=await bridge.readSourceStatuses('loomy');
   assert.ok(after.accounts.find(x=>x.accountId==='loomy-member-b')
     .benefits.every(x=>x.claimed));
   assert.ok(after.accounts.find(x=>x.accountId==='loomy-member-a')
     .benefits.every(x=>!x.claimed));
   const wrong=await bridge.claimLoomyActivities({
     sourceAccountId:'unowned',beforeClaim:()=>true});
   assert.equal(wrong.state,'unavailable');
   assert.equal(posts,8);
   assert.doesNotMatch(JSON.stringify(after),/LOOMY_A_TOKEN|LOOMY_B_TOKEN|FAKE_B_LOOMY/);
 }finally{bridge.dispose()}
});

test('Raccoon exact source account claims free login bonus first, then daily web grant with official confirmations',async()=>{
 const pool={listAllAccounts:async()=>[{id:'racc-A',provider:'raccoon',enabled:true,credentialRef:'RACCOON_TEST'}]};
 let loginPending=true,dailyGranted=false,claims=0,dailyTriggers=0;
 const ops={
  status:async(_provider,id)=>({ok:true,value:{accounts:[{accountId:id??'racc-A',status:{
   active:true,loginRewardPending:loginPending,
   todayCheckedIn:dailyGranted,dailyGranted,webTriggered:true,claimable:true,
   ...(dailyGranted?{todayCredit:300}:{})
  }}]}}),
  claim:async(_provider,id)=>{
   claims++;
   const outcome=loginPending?{kind:'claimed',credit:3000}:
     {kind:'claimed',credit:300};
   if(loginPending)loginPending=false;
   return {ok:true,value:{results:[{accountId:id,outcome}]}};
  }
 };
 let livePool;
 const scope={llm:{listProviders:async()=>[]},
  get:k=>k==='accountPool'?livePool:k==='nativeRouterSourceCheckins'?ops:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,
  raccoonTaskVerifier:async()=>({state:loginPending?'pending':'completed'}),
  raccoonDailyTrigger:async()=>{dailyTriggers++;dailyGranted=true;return {state:'triggered'}},
  loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 try{
  let start=0,confirmed=0;
  const result=await bridge.checkinAccount({providerId:'raccoon',sourceAccountId:'racc-A',
   beforeOneTimeClaim:offer=>{assert.equal(offer.kind,'raccoon_login');start++;return true},
   onOneTimeOutcome:(kind,state,meta)=>{
    assert.equal(kind,'raccoon_login');assert.equal(state,'confirmed');
    assert.equal(meta.credit,3000);confirmed++;
   }});
  assert.equal(result.confirmed,true);
  assert.equal(result.activityRewardAmount,300);
  assert.equal(start,1);
  assert.equal(confirmed,1);
  assert.equal(claims,1,'one-time login reward is the ONLY POST');
  assert.equal(dailyTriggers,1,'daily grant is triggered via free GET-only workflow');
  const replay=await bridge.checkinAccount({providerId:'raccoon',sourceAccountId:'racc-A',
   beforeOneTimeClaim:()=>{throw Error('should not retry')}});
  assert.equal(replay.confirmed,true);
  assert.equal(claims,1);
  assert.equal(dailyTriggers,1);
  const read=await bridge.readSourceStatuses('raccoon');
  assert.equal(read.accounts[0].loginRewardPending,false);
  assert.equal(read.accounts[0].activityRewardAmount,300);
  assert.equal(read.accounts[0].activityRewardUnit,'积分');
  assert.doesNotMatch(JSON.stringify(read),/RACCOON_TEST/);
 }finally{bridge.dispose()}
});

test('Raccoon uncertain login bonus never retries POST; existing daily grant does not mask pending login',async()=>{
 const pool={listAllAccounts:async()=>[{id:'racc-B',provider:'raccoon',enabled:true,credentialRef:'RACC_B'}]};
 let loginPending=true,dailyGranted=true,claims=0,approve=true;
 const ops={
  status:async(_p,id)=>({ok:true,value:{accounts:[{accountId:id,status:{
   active:true,loginRewardPending:loginPending,todayCheckedIn:dailyGranted,
   dailyGranted,webTriggered:true,claimable:loginPending
  }}]}}),
  claim:async(_p,id)=>{claims++;return {ok:true,value:{results:[{
   accountId:id,outcome:{kind:'claimed',credit:3000}}]}}}
 };
 let livePool;
 const scope={llm:{listProviders:async()=>[]},
  get:k=>k==='accountPool'?livePool:k==='nativeRouterSourceCheckins'?ops:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_d,fn){fn(scope)}},
  getConfig:enabled,env:isolatedEnv,
  raccoonTaskVerifier:async()=>({state:loginPending?'pending':'completed'}),
  loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 try{
  const receipts=[];
  const claim=()=>bridge.checkinAccount({providerId:'raccoon',sourceAccountId:'racc-B',
   beforeOneTimeClaim:()=>approve,
   onOneTimeOutcome:(_kind,state)=>receipts.push(state)});
  const first=await claim();
  assert.equal(first.state,'pending_confirmation');
  assert.equal(first.loginRewardState,'pending_confirmation');
  assert.equal(claims,1);
  assert.deepEqual(receipts,['pending_confirmation']);
  approve=false;
  const next=await claim();
  assert.equal(next.confirmed,true,'the already credited daily grant stays confirmed');
  assert.equal(next.loginRewardState,'pending_confirmation');
  assert.equal(claims,1,'uncertain one-time POST is not replayed');
  loginPending=false;
  const after=await claim();
  assert.equal(after.confirmed,true);
  assert.equal(claims,1);
 }finally{bridge.dispose()}
});


test('Raccoon vendor false-after-/tasks-error cannot trigger a new one-shot POST or settle reward',async()=>{
 const pool={listAllAccounts:async()=>[{id:'racc-unknown',provider:'raccoon',
  enabled:true,credentialRef:'RACC_UNKNOWN'}]};
 let called=0;const ops={
  status:async(_provider,id)=>({ok:true,value:{accounts:[{accountId:id??'racc-unknown',
   status:{active:true,todayCheckedIn:false,loginRewardPending:false,
    dailyGranted:false,webTriggered:true}}]}}),
  claim:async()=>{called++;throw Error('claim must be impossible')}
 };
 let livePool;
 const scope={llm:{listProviders:async()=>[]},
  get:k=>k==='accountPool'?livePool:k==='nativeRouterSourceCheckins'?ops:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,
  raccoonTaskVerifier:async()=>({state:'unavailable'}),
  loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 try{
  const read=await bridge.readSourceStatuses('raccoon');
  assert.equal(read.accounts.length,1);
  assert.equal(read.accounts[0].loginRewardPending,undefined);
  assert.equal(read.accounts[0].loginRewardTaskVerified,undefined);
  const out=await bridge.checkinAccount({providerId:'raccoon',
   sourceAccountId:'racc-unknown',beforeOneTimeClaim:()=>true});
  assert.equal(out.state,'failed');
  assert.equal(called,0,'never trust vendor default false when task GET failed');
 }finally{bridge.dispose()}
});

test('Raccoon uses exact account credential binding for official task verification',async()=>{
 const pool={listAllAccounts:async()=>[{id:'racc-owned',provider:'raccoon',
   enabled:true,credentialRef:'RACC_NATIVE_TEST'}]};
 let livePool,fetches=0,posts=0;
 const syntheticBearer=['FAKE','RACCOON','BEARER','LONG','TOKEN'].join('_');
 const credentials={resolve:async ref=>{
   assert.equal(ref,'RACC_NATIVE_TEST');
   return {value:JSON.stringify({access_token:syntheticBearer})};
 }};
 const ops={
  status:async(_provider,id)=>({ok:true,value:{accounts:[{accountId:id??'racc-owned',
   status:{active:true,todayCheckedIn:true,loginRewardPending:false,
    dailyGranted:true,webTriggered:true,todayCredit:300}}]}}),
  claim:async()=>{posts++;return {ok:false}}
 };
 const scope={llm:{listProviders:async()=>[]},credentials,
  get:k=>k==='accountPool'?livePool:k==='nativeRouterSourceCheckins'?ops:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,
  raccoonFetchImpl:async(url,options)=>{
   fetches++;
   assert.equal(options.method,'GET');
   assert.equal(url,'https://xiaohuanxiong.com/api/web/points/v1/tasks');
   assert.equal(options.headers.Authorization,'Bearer '+syntheticBearer);
   return new Response(JSON.stringify({code:0,data:{new_user_task_states:[
    {key:'desktop_login',status:'completed'}]}}),{status:200});
  },
  loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 try{
  const observed=await bridge.readSourceStatuses('raccoon');
  assert.equal(observed.accounts.length,1);
  assert.equal(observed.accounts[0].loginRewardPending,false);
  assert.equal(observed.accounts[0].loginRewardTaskVerified,true);
  const out=await bridge.checkinAccount({providerId:'raccoon',
   sourceAccountId:'racc-owned'});
  assert.equal(out.confirmed,true);
  assert.equal(posts,0);
  assert.ok(fetches>=2);
  assert.doesNotMatch(JSON.stringify({observed,out}),/RACCOON_NATIVE_TEST|FAKE_RACCOON_BEARER/);
 }finally{bridge.dispose()}
});

test('real pinned source pack ESM import is refused on incompatible Node runtimes before loading its embedded Undici',()=>{
  const available=()=>{};
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'22.5.0',markAsUncloneable:undefined}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'22.9.0',markAsUncloneable:available}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'21.16.0',markAsUncloneable:available}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'24.1.0',markAsUncloneable:null}),/22.10/);
  assert.match(channelPackNodeRuntimeReason({nodeVersion:'malformed',markAsUncloneable:available}),/无法确认/);
  assert.equal(channelPackNodeRuntimeReason({nodeVersion:'22.10.0',markAsUncloneable:available}),'');
  assert.equal(channelPackNodeRuntimeReason({nodeVersion:'22.16.0',markAsUncloneable:available}),'');
  assert.equal(channelPackNodeRuntimeReason({nodeVersion:'24.1.0',markAsUncloneable:available}),'');
});
test('pinned MIT channel pack is a verified upstream distribution snapshot, including WASM',()=>{
 const receipt=JSON.parse(readFileSync(join(root,'vendor','channel-pack','SOURCE_RECEIPT.json'),'utf8'));
  assert.equal(receipt.sourceCommit,'114b4a516ab32e6f318a53cab4ac7f83ef8dd0b0');
  assert.equal(receipt.upstreamVersion,'3.5.4');
 assert.equal(receipt.sourceLicense,'MIT');
 assert.equal(receipt.referenceFiles.length,4);
 for(const item of receipt.referenceFiles){
   const bytes=readFileSync(join(root,'vendor','channel-pack',item.file));
   const source=item.file.endsWith('.wasm')?bytes:Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
   assert.equal(source.length,item.bytes,'canonical source size '+item.file);
   assert.equal(createHash('sha256').update(source).digest('hex'),item.sha256,
    'canonical source SHA '+item.file);
 }
 assert.deepEqual(SOURCE_PACK_PROVIDERS,[
  'codearts','buddy','workbuddy','lobsterai','qoder','qodercn',
  'trae','cline','loomy','raccoon','minimax','zcode','gemini']);
});
test('pack reuse is disabled by default and never calls loader or inject',async()=>{
 let called=0;
 const ctx={inject(){throw Error('not allowed')}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:()=>normalizeConfig({}),
  loadPack:()=>{called++;throw Error('not allowed')}});
 assert.equal(bridge.attach().state,'disabled');
 await tick();assert.equal(called,0);
});
test('experimental mount requires three explicit permissions, including disabled upstream auto-resume',async()=>{
 let called=0;
 const ctx={inject(){called++}};
 for(const env of [{},{DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1'},
  {DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1',DSH_OPENAI_GATEWAY_ENABLED:'0'},
  {...isolatedEnv,DSH_REASONING_LOOP_AUTO_RESUME:'1'},
  {...isolatedEnv,DSH_OPENAI_GATEWAY_ENABLED:'on'}]){
  const bridge=createEmbeddedChannelPack({ctx,env,getConfig:enabled,
   loadPack:()=>{throw Error('not allowed')}});
  assert.equal(bridge.attach().state,'blocked');
 }
 await tick();assert.equal(called,0);
});
test('rejects nonisolated or mismatched profile BEFORE source code import, even if three old safety switches are enabled',async()=>{
 let imports=0,injections=0;
 const ctx={inject(){injections++}};
 const attempts=[
  {...isolatedEnv,DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE:'0'},
  {...isolatedEnv,DSH_HOME:'C:\\Users\\Public\\.dsh'},
  {...isolatedEnv,DSH_HOME:'E:\\Temp'},
  {...isolatedEnv,DSH_CHANNEL_PACK_STATE_DIR:'E:\\Temp'},
  {...isolatedEnv,DSH_CHANNEL_PACK_STATE_DIR:'E:\\Temp\\nonexistent-source-profile'},
 ];
 for(const env of attempts){
  const b=createEmbeddedChannelPack({ctx,env,getConfig:enabled,loadPack:()=>{imports++;return {apply(){}}}});
  assert.equal(b.attach().state,'blocked');
  assert.match(b.status().reason,/Profile|状态目录|隔离目录/);
 }
 await tick();
 assert.equal(imports,0);assert.equal(injections,0);
});
test('different actual host profile is denied and source pack never imported',async()=>{
 let imports=0;
 const ctx={inject(_names,cb){cb({get:key=>key==='profileContext'?{home:'C:\\Users\\Public\\.dsh'}:undefined})}};
 const b=createEmbeddedChannelPack({ctx,env:isolatedEnv,getConfig:enabled,
  loadPack:()=>{imports++;return {apply(){}}}});
 assert.equal(b.attach().state,'blocked');
 await tick();assert.equal(imports,0);
 assert.match(b.status().reason,/profileContext/);
});
test('isolation safety is checked AGAIN immediately before async source apply',async()=>{
 let release,applied=0;
 const env={...isolatedEnv};
 const ctx={inject(_names,cb){cb({get:()=>undefined})}};
 const b=createEmbeddedChannelPack({ctx,env,getConfig:enabled,
  loadPack:()=>new Promise(resolve=>{release=resolve})});
 assert.equal(b.attach().state,'loading');
 await tick();
 env.DSH_CHANNEL_PACK_STATE_DIR='C:\\Users\\Public\\.dsh';
 release({apply(){applied++}});
 await tick();await tick();
 assert.equal(b.status().state,'blocked');
 assert.equal(applied,0);
});
test('host provider collisions deny bundled pack before it is even imported',async()=>{
 let imports=0;
 for(const row of [
  ['workbuddy','native-router'],
  [{provider:'qoder'},{id:'other'}],
  [{id:'loomy'}],
 ]){
  const scope={llm:{listProviders:async()=>row},get:()=>undefined};
  const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
   env:isolatedEnv,getConfig:enabled,loadPack:async()=>{imports++;return {apply(){}}}});
  assert.equal(bridge.attach().state,'loading');
  await tick();await tick();
  assert.equal(bridge.status().state,'blocked');
  assert.match(bridge.status().reason,/已注册/);
 }
 assert.equal(imports,0);
});
test('incomplete host provider registry is blocked rather than risking partial takeover',async()=>{
 let imports=0;
 const scope={llm:{listProviders:async()=>[{unexpected:'not-a-provider'}]},get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
  env:isolatedEnv,getConfig:enabled,loadPack:async()=>{imports++;return {apply(){}}}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'blocked');
 assert.equal(imports,0);
});
test('unoccupied host provider names permit isolated source mount',async()=>{
 let imports=0,applies=0;
 const scope={llm:{listProviders:async()=>['native-router','local-custom']},get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
  env:isolatedEnv,getConfig:enabled,loadPack:async()=>{imports++;return {apply(){applies++}}}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.equal(imports,1);assert.equal(applies,1);
 bridge.dispose();
});
test('approved mount reuses upstream apply inside DSH scope only once',async()=>{
 let called=0,load=0,received,receivedOptions;
 const scope={get:()=>undefined};
 const ctx={inject(names,cb){called++;assert.deepEqual(names,['credentials','commands','llm','connection']);cb(scope)}};
 const bridge=createEmbeddedChannelPack({ctx,env:isolatedEnv,getConfig:enabled,
  loadPack:async()=>{load++;return {apply(x,o){received=x;receivedOptions=o}}}});
 assert.equal(bridge.attach().state,'loading');
 assert.equal(bridge.attach().state,'loading');
 await tick();await tick();
 assert.equal(called,1);assert.equal(load,1);
 assert.equal(received,scope);assert.equal(receivedOptions.disableOpencode,true);
 assert.equal(bridge.status().state,'mounted');
 assert.equal(bridge.attach().state,'mounted');
 bridge.dispose();assert.equal(bridge.status().state,'disposed');
});
test('upstream accountPool blocks duplicate mount without importing any bundle',async()=>{
 let imported=0;
 const ctx={inject(names,cb){cb({get:key=>key==='accountPool'?{}:undefined})}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,
  env:isolatedEnv,loadPack:()=>{imported++;return {apply(){}}}});
 assert.equal(bridge.attach().state,'blocked');
 await tick();assert.equal(imported,0);
});
test('upstream failure never leaks raw secret-bearing error to status',async()=>{
 const ctx={inject(names,cb){cb({get:()=>undefined})},logger:{warn() {}}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>{throw Error('Authorization Bearer SECRET_AND_LOCAL_PATH')}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'failed');
 assert.doesNotMatch(JSON.stringify(bridge.status()),/SECRET_AND_LOCAL_PATH/);
});
test('dispose before lazy load completes must not mount after host shutdown',async()=>{
 let complete;let applied=0;
 const ctx={inject(names,cb){cb({get:()=>undefined})}};
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:()=>new Promise(resolve=>{complete=resolve})});
 bridge.attach();await tick();bridge.dispose();
 complete({apply(){applied++}});await tick();await tick();
 assert.equal(applied,0);assert.equal(bridge.status().state,'disposed');
});
test('host injection scope disposal before async import prevents late mount',async()=>{
 let complete,cleanup,applied=0;
 const scope={get:()=>undefined,effect(cb){cleanup=cb()}};
 const bridge=createEmbeddedChannelPack({ctx:{inject(names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  loadPack:()=>new Promise(resolve=>{complete=resolve})});
 bridge.attach();await tick();cleanup();
 complete({apply(){applied++}});await tick();await tick();
 assert.equal(applied,0);assert.equal(bridge.status().state,'host_disposed');
});
test('synchronous injection failure is observable without taking down native router',()=>{
 const bridge=createEmbeddedChannelPack({ctx:{inject(){throw Error('secret path')}} ,getConfig:enabled,env:isolatedEnv,
  loadPack:()=>{throw Error('unreachable')}});
 assert.equal(bridge.attach().state,'failed');
 assert.doesNotMatch(JSON.stringify(bridge.status()),/secret path/);
});
test('disabled embedded facade never enumerates private account pool',async()=>{
 const bridge=createEmbeddedChannelPack({ctx:{inject(){throw Error('should not inject')}},getConfig:()=>normalizeConfig({})});
 assert.deepEqual(await bridge.listAccounts(),{state:'disabled',accounts:[]});
});
test('embedded facade maps only safe account metadata, never raw credential references',async()=>{
 const upstreamRows=[
  {id:'workbuddy-01',provider:'workbuddy',nickname:'My WorkBuddy',enabled:true,refreshable:true,
   credentialRef:'USER_TOKEN_REF',accessToken:'TOP_SECRET',refreshToken:'VERY_SECRET'},
  {id:'loomy-02',provider:'loomy',nickname:'Loomy',enabled:false,refreshable:false,
   token:'ANOTHER_SECRET'},
  {id:'unknown-03',provider:'not_a_pack_channel',nickname:'skip',credentialRef:'leak'},
 ];
 let poolCalls=0,scopePool;
 const pool={async listAllAccounts(){poolCalls++;return upstreamRows}};
 const scope={get:key=>key==='accountPool'?scopePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){scopePool=pool}})});
 assert.equal(bridge.attach().state,'loading');
 await tick();await tick();
 const snapshot=await bridge.listAccounts();
 assert.equal(snapshot.state,'ready');
 assert.equal(snapshot.accounts.length,2);
 assert.equal(poolCalls,1);
  assert.deepEqual(snapshot.accounts[0],{
    id:'workbuddy-01',providerId:'workbuddy',nickname:'My WorkBuddy',
    enabled:true,refreshable:true,authorizationSource:'unclassified',
    connectionState:'not_checked'});
 assert.equal(snapshot.accounts[1].enabled,false);
 const asText=JSON.stringify(snapshot);
 assert.doesNotMatch(asText,/TOKEN_REF|TOP_SECRET|VERY_SECRET|ANOTHER_SECRET|credentialRef|accessToken|token/);
 bridge.dispose();
 assert.equal((await bridge.listAccounts()).accounts.length,0);
 assert.equal(poolCalls,1);
});
test('independent source read-only identity and credit APIs provide usernames, ZCode token and CodeArts credits',async()=>{
 const rows=[
   {id:'codearts-oauth',provider:'codearts',nickname:'codearts-oauth',
     credentialRef:'NATIVE_ROUTER_SOURCE_CODEARTS_ACCOUNT_X',enabled:true},
   {id:'zcode-oauth',provider:'zcode',nickname:'zcode-oauth',
     credentialRef:'NATIVE_ROUTER_SOURCE_ZCODE_ACCOUNT_Y',enabled:true},
   {id:'nr_adopted',provider:'loomy',nickname:'loomy · 独立账号',
     credentialRef:'NATIVE_ROUTER_PRIVATE_PACK_Z',enabled:true},
 ];
 const ops={
  async identity(provider){
   return {ok:true,value:{accounts:rows.filter(row=>row.provider===provider).map(row=>({
     id:row.id,nickname:row.nickname,
     ...(provider==='codearts'?{accountName:'actual-huawei-user'}:{}),
     ...(provider==='zcode'?{accountName:'actual-zcode-name',phone:'13812345678'}:{})}))}};
  },
  async status(provider){
   return {ok:true,value:{accounts:rows.filter(row=>row.provider===provider).map(row=>({
     accountId:row.id,status:{active:true,todayCheckedIn:false,
       ...(provider==='codearts'?{amount:16}:{}),
       ...(provider==='zcode'?{planCount:8}:{}),}}))}};
  },
  async balances(provider){
   return {ok:true,value:{accounts:rows.filter(row=>row.provider===provider).map(row=>({
     accountId:row.id,balance:{total:provider==='zcode'?9000:provider==='codearts'?75:15,
       packages:[{unit:provider==='zcode'?'token':'积分'}]}}))}};
  },
 };
 let pool;
 const scope={get:key=>key==='accountPool'?pool:key==='nativeRouterSourceCheckins'?ops:undefined};
 const bridge=createEmbeddedChannelPack({
   ctx:{inject(_names,callback){callback(scope)}},
   getConfig:enabled,env:isolatedEnv,
   loadPack:async()=>({apply(){pool={async listAllAccounts(){return rows}}}}),
 });
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 const inventory=await bridge.listAccounts();
 const loomy=inventory.accounts.find(row=>row.providerId==='loomy');
 assert.equal(loomy.authorizationSource,'adopted');
 assert.equal(loomy.nickname,'','generated independent nickname must never be shown');
 assert.equal(inventory.accounts.find(row=>row.providerId==='codearts').authorizationSource,'autonomous');
 for(const [providerId,value,unit,username] of [
   ['codearts',75,'积分','actual-huawei-user'],
   ['zcode',9000,'token','actual-zcode-name'],
   ['loomy',15,'积分',''],
 ]){
   const status=await bridge.readSourceStatuses(providerId);
   assert.equal(status.state,'ready');
   assert.equal(status.accounts.length,1);
   assert.equal(status.accounts[0].authVerified,true);
   assert.equal(status.accounts[0].balance,value);
   assert.equal(status.accounts[0].balanceUnit,unit);
   assert.equal(status.accounts[0].nickname,username);
   if(providerId==='codearts'){
     assert.equal(status.accounts[0].activityRewardAmount,16);
     assert.equal(status.accounts[0].activityRewardUnit,'积分');
   }
   if(providerId==='zcode'){
     assert.equal(status.accounts[0].activityRewardAmount,undefined,
       'count of plans is not a token reward quantity');
   }
   assert.doesNotMatch(JSON.stringify(status),/NATIVE_ROUTER_PRIVATE_PACK|access_token|credentialRef/);
 }
 // Identity read-only fallbacks must look beyond the first placeholder nickname.
 const originalStatus=ops.status;
 ops.status=async provider=>{
   const result=await originalStatus(provider);
   if(provider==='loomy'){
     const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',
       year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
     result.value.accounts[0].status={
       active:true,username:'real-loomy-from-status',
       todayCheckedIn:false,checkinDates:[today]};
   }
   return result;
 };
 const loomyLive=await bridge.readSourceStatuses('loomy');
 assert.equal(loomyLive.accounts[0].nickname,'real-loomy-from-status');
 assert.equal(loomyLive.accounts[0].todayCheckedIn,true,
   'confirmed same-day checkin history is stronger than an incomplete today false');
 const masked=await bridge.readSourceStatuses('zcode');
 assert.equal(masked.accounts[0].maskedPhone,'138****5678');
 bridge.dispose();
});
test('owned source account roster uses trusted login accountName if nickname is only a generated pool ID',async()=>{
 const entry={id:'loomy-safe-id-1',provider:'loomy',enabled:true,
   nickname:'账号1',accountName:'已确认登录账户',credentialRef:'NATIVE_ROUTER_SOURCE_FAKE_PRIVATE_REF',
   refreshable:false};
 let pool;
 const scope={get:key=>key==='accountPool'?pool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
   getConfig:enabled,env:isolatedEnv,
   loadPack:async()=>({apply(){pool={listAllAccounts:async()=>[entry]}}})});
 bridge.attach();await tick();await tick();
 try{
  const result=await bridge.listAccounts();
  assert.equal(result.state,'ready');
  assert.equal(result.accounts[0].nickname,'已确认登录账户');
  assert.equal(result.accounts[0].connectionState,'not_checked',
    'account name in private pool does NOT prove remote auth');
  assert.doesNotMatch(JSON.stringify(result),
    /NATIVE_ROUTER_SOURCE_FAKE_PRIVATE_REF|credentialRef/);
 }finally{bridge.dispose()}
});
test('unavailable upstream pool and failed metadata read never mutate accounts or expose errors',async()=>{
 const scope={get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){}})});
 bridge.attach();await tick();await tick();
 assert.deepEqual(await bridge.listAccounts(),{state:'unavailable',accounts:[]});
 scope.get=()=>({listAllAccounts:async()=>{throw Error('SECRET_UPSTREAM_CREDENTIALS')}});
 assert.deepEqual(await bridge.listAccounts(),{state:'error',accounts:[]});
});
test('upstream model catalogue uses the selected provider only and never publishes credentials or cross-provider models',async()=>{
 const queried=[],scope={llm:{async listModels(provider){
  queried.push(provider);
  return [{id:'model-alpha',name:'Alpha',provider,token:'SECRET_TOKEN',isFree:true},
   {id:'model-alpha',name:'duplicate',provider},
   {id:'wrong',name:'Cross-channel',provider:'different'},
   {id:'with\nnewline',provider},
   {id:'model-beta',name:'Beta',provider,isFree:false},
   {id:'SECRET?\nunsafe',provider}];
 }},get:()=>undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>({apply(){}})});
 assert.deepEqual(await bridge.listModels('loomy'),{state:'unavailable',providerId:'loomy',models:[]});
 assert.deepEqual(queried,[]);
 bridge.attach();await tick();await tick();
 const reply=await bridge.listModels('loomy');
 assert.deepEqual(queried,['loomy']);
 assert.equal(reply.state,'ready');
 assert.deepEqual(reply.models,[{id:'model-alpha',name:'Alpha',upstreamFreeLabel:true},
   {id:'model-beta',name:'Beta'}]);
 assert.doesNotMatch(JSON.stringify(reply),/SECRET_TOKEN|wrong|Cross-channel/);
 assert.equal((await bridge.listModels('untrusted')).state,'invalid');
 assert.deepEqual(queried,['loomy']);
 bridge.dispose();
 assert.equal((await bridge.listModels('loomy')).state,'unavailable');
});
test('upstream account enable toggle verifies exact provider and uses source pool update, no credentials copied',async()=>{
 const accounts=[{id:'loomy-a1',provider:'loomy',nickname:'sample',enabled:false,
  credentialRef:'SECRET_REF'}];
 const updates=[];
 const pool={listAllAccounts:async()=>accounts.map(row=>({...row})),
   updateAccount:async(id,patch)=>{updates.push({id,patch});accounts[0].enabled=patch.enabled}};
 let livePool;
 const scope={get:key=>key==='accountPool'?livePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){livePool=pool}})});
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:true})).state,'unavailable');
 bridge.attach();await tick();await tick();
 const mismatch=await bridge.changeAccountEnabled({providerId:'workbuddy',accountId:'loomy-a1',enabled:true});
 assert.equal(mismatch.state,'not_found');
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:'true'})).state,'invalid');
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:true})).state,'updated');
 assert.deepEqual(updates,[{id:'loomy-a1',patch:{enabled:true}}]);
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:true})).state,'unchanged');
 assert.equal(updates.length,1);
 const preview=await bridge.listAccounts();
 assert.equal(preview.accounts[0].enabled,true);
 assert.doesNotMatch(JSON.stringify(preview),/SECRET_REF/);
 bridge.dispose();
 assert.equal((await bridge.changeAccountEnabled({providerId:'loomy',accountId:'loomy-a1',enabled:false})).state,'unavailable');
 assert.equal(updates.length,1);
});
test('source account update must confirm the observed state and reject duplicates',async()=>{
 const rows=[{id:'qoder-a',provider:'qoder',enabled:false}];
 let updates=0,livePool;
 const pool={listAllAccounts:async()=>rows.map(row=>({...row})),updateAccount:async()=>{updates++}};
 const scope={get:key=>key==='accountPool'?livePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 const unconfirmed=await bridge.changeAccountEnabled({providerId:'qoder',accountId:'qoder-a',enabled:true});
 assert.equal(unconfirmed.state,'unconfirmed');
 assert.equal(unconfirmed.changed,false);
 rows.push({...rows[0],provider:'loomy'});
 assert.equal((await bridge.changeAccountEnabled({providerId:'qoder',accountId:'qoder-a',enabled:true})).state,'not_found');
 assert.equal(updates,1);
});
test('catalog lookup timeout releases the UI and duplicate requests cannot flood the same upstream channel',async()=>{
 let finish,called=0;
 const upstream=new Promise(resolve=>{finish=resolve});
 const scope={get:()=>undefined,llm:{async listModels(){called++;return upstream}}};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},getConfig:enabled,env:isolatedEnv,
  modelTimeoutMs:12,loadPack:async()=>({apply(){}})});
 bridge.attach();await tick();await tick();
 const first=bridge.listModels('loomy');
 await tick();
 assert.equal((await bridge.listModels('loomy')).state,'busy');
 assert.equal((await first).state,'timeout');
 assert.equal(called,1);
 finish([{id:'model-late'}]);
 bridge.dispose();
 assert.equal((await bridge.listModels('loomy')).state,'unavailable');
});

test('CodeArts signed pricing must remain exact and expire; unknown/cached zeros never become free',async()=>{
  const fresh=Date.now();
  const scope={get:()=>undefined,llm:{async listModels(){return [
    {provider:'codearts',id:'glm-5.3-flash',name:'GLM · x0.00',
     priceSource:'codearts-official-credit-ratio',costMultiplier:0.003,
     catalogObservedAt:fresh,catalogSource:'codearts-signed-official-model-catalog'},
    {provider:'codearts',id:'qwen3.8-flash',name:'Qwen',
     priceSource:'codearts-official-credit-ratio',costMultiplier:0,
     catalogObservedAt:fresh,catalogSource:'codearts-signed-official-model-catalog'},
    {provider:'codearts',id:'unknown',name:'Unknown',priceSource:'local-guessed',costMultiplier:0},
    {provider:'codearts',id:'stale-zero',name:'Old catalog',
     priceSource:'codearts-official-credit-ratio',costMultiplier:0,
     catalogObservedAt:fresh-16*60*1000,catalogSource:'codearts-signed-official-model-catalog'},
    {provider:'codearts',id:'unstamped-zero',name:'Missing time',
     priceSource:'codearts-official-credit-ratio',costMultiplier:0,
     catalogSource:'codearts-signed-official-model-catalog'},
  ]}}};
  const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
    getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){}})});
  bridge.attach();await tick();await tick();
  const result=await bridge.listModels('codearts');
  assert.equal(result.state,'ready');
  assert.equal(result.models.length,5);
  assert.equal(result.models[0].costMultiplier,0.003);
  assert.equal(result.models[1].costMultiplier,0);
  assert.equal(result.models[0].catalogSource,'codearts-signed-official-model-catalog');
  assert.equal(result.models[2].costMultiplier,undefined);
  assert.equal(result.models[3].costMultiplier,undefined,'expired rate cannot be free');
  assert.equal(result.models[4].costMultiplier,undefined,'unknown rate age cannot be free');
  bridge.dispose();
});
test('direct private CodeArts adapter directory bypasses DSH metadata stripping without exposing credentials',async()=>{
 let hostCalls=0,privateCalls=0;
 const raw=[{provider:'codearts',id:'glm-5.3-flash',name:'Direct signed',
   catalogSource:'codearts-signed-official-model-catalog',catalogObservedAt:Date.now(),
   priceSource:'codearts-official-credit-ratio',costMultiplier:0.003}];
 const scope={get:()=>undefined,llm:{async listModels(){hostCalls++;return [{provider:'codearts',id:'glm-5.3-flash',name:'Host stripped'}]}}};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
   getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(_scope,opts){
     opts.nativeRouterSourceCatalogReady({codearts:async()=>{privateCalls++;return raw}});
   }})});
 bridge.attach();await tick();await tick();
 const result=await bridge.listModels('codearts');
 assert.equal(result.state,'ready');
 assert.equal(result.models[0].costMultiplier,0.003);
 assert.equal(result.models[0].catalogSource,'codearts-signed-official-model-catalog');
 assert.equal(hostCalls,0);
 assert.equal(privateCalls,1);
 bridge.dispose();
 assert.equal((await bridge.listModels('codearts')).state,'unavailable');
});
test('private CodeArts accessor error falls back to DSH with no invented price',async()=>{
 let hostCalls=0;
 const scope={get:()=>undefined,llm:{async listModels(){hostCalls++;return [{provider:'codearts',id:'fallback-model',name:'Fallback only'}]}}};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
   getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(_scope,opts){
     opts.nativeRouterSourceCatalogReady({codearts:async()=>{throw Error('private read not available')}});
   }})});
 bridge.attach();await tick();await tick();
 const result=await bridge.listModels('codearts');
 assert.equal(result.state,'ready');assert.equal(hostCalls,1);
 assert.equal(result.models[0].costMultiplier,undefined);
 bridge.dispose();
});
test('native source facade validates exact source account before invoking host DSH llm stream',async()=>{
 const rows=[{id:'q-a',provider:'qoder',enabled:true,credentialRef:'SECRET_REF'}];
 let livePool,invocations=0,seen;
 const scope={get:key=>key==='accountPool'?livePool:undefined,llm:{
  async listProviders(){return ['native-router']},
  stream(input){invocations++;seen=input;return (async function*(){
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text:'hi'};
   yield {type:'block-end',index:0};
   yield {type:'finish',reason:{kind:'stop'}};
  })()}
 }};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},env:isolatedEnv,getConfig:enabled,
   loadPack:async()=>({apply(){livePool={listAllAccounts:async()=>rows.map(x=>({...x})),
     getAvailableAccount:async()=>({entry:rows[0],credential:'NEVER_EXPOSE_SECRET'})}}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 const request={providerId:'qoder',sourceAccountId:'q-a',model:'qoder-chat',messages:[{role:'user',content:[]}],tools:[]};
 for await(const event of await bridge.streamNative(request))assert.ok(event.type);
 assert.equal(invocations,1);
 assert.deepEqual(seen.tools,[]);
  assert.equal(seen.provider,'qoder');assert.equal(seen.model,'qoder-chat');
  assert.doesNotMatch(JSON.stringify(seen),/NEVER_EXPOSE_SECRET|SECRET_REF/);
  await assert.rejects(()=>bridge.streamNative({...request,sourceAccountId:'q-b'}),/not unambiguous/);
  const available=livePool.getAvailableAccount;
  livePool.getAvailableAccount=async()=>null;
  await assert.rejects(()=>bridge.streamNative(request),/not currently available/);
  assert.equal(invocations,1);
  livePool.getAvailableAccount=available;
 rows.push({id:'q-b',provider:'qoder',enabled:true});
  await assert.rejects(()=>bridge.streamNative(request),/not verified/);
 assert.equal(invocations,1);
 bridge.dispose();
 await assert.rejects(()=>bridge.streamNative(request),/not mounted/);
});
test('isolated upstream logout refuses source accounts referenced by native configuration and verifies removal',async()=>{
 const rows=[{id:'q-a',provider:'qoder',enabled:true,credentialRef:'SECRET_SOURCE'}];
  const exactRef=sourceAccountOpaqueId('qoder','q-a');
  const otherRef=sourceAccountOpaqueId('qoder','q-other');
  let livePool,deleted=0,config={embeddedPack:{enabled:true},accounts:[
   {id:exactRef,providerId:'qoder',credentialRef:'driver:qoder:'+exactRef},
  ]};
 const pool={listAllAccounts:async()=>rows.map(x=>({...x})),
  removeAccount:async id=>{deleted++;rows.splice(rows.findIndex(row=>row.id===id),1)}};
 const scope={get:key=>key==='accountPool'?livePool:undefined};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_names,cb){cb(scope)}},env:isolatedEnv,
  getConfig:()=>config,loadPack:async()=>({apply(){livePool=pool}})});
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'unavailable');
 bridge.attach();await tick();await tick();
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'referenced');
 assert.equal(deleted,0);
  // Another source account under this provider must not block deletion of q-a.
  config={embeddedPack:{enabled:true},accounts:[
    {id:otherRef,providerId:'qoder',credentialRef:'driver:qoder:'+otherRef},
  ]};
 assert.equal((await bridge.removeSourceAccount({providerId:'loomy',accountId:'q-a'})).state,'not_found');
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'removed');
 assert.equal(deleted,1);
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'not_found');
 bridge.dispose();
 assert.equal((await bridge.removeSourceAccount({providerId:'qoder',accountId:'q-a'})).state,'unavailable');
});


test('isolated multiaccount beta pins the selected upstream credential without changing enabled flags',async()=>{
 const rows=[
  {id:'lob-a',provider:'lobsterai',enabled:true,credentialRef:'LOBSTER_A'},
  {id:'lob-b',provider:'lobsterai',enabled:true,credentialRef:'LOBSTER_B'},
 ];
 const resolutions=[],calls=[],credentials={
  async resolve(ref){resolutions.push(ref);return {value:JSON.stringify({selected:ref})}},
  async set(){throw Error('unexpected credential write')},
  async unset(){throw Error('unexpected credential deletion')},
 };
 let pool;
 pool={
  listAllAccounts:async()=>rows.map(row=>({...row})),
  listAccountsByProvider:id=>rows.filter(row=>row.provider===id),
  async getAvailableAccount(provider,model,exclude){
   const entry=rows.find(row=>row.provider===provider&&row.enabled&&!exclude?.has(row.id));
   if(!entry)return null;
   const credential=await credentials.resolve(entry.credentialRef);
   return {entry,credential:JSON.parse(credential.value)};
  },
 };
 const baseGet=pool.getAvailableAccount,baseResolve=credentials.resolve;
  let livePool;
  const scope={credentials,get:key=>key==='accountPool'?livePool:key==='credentials'?credentials:undefined,
  llm:{listProviders:async()=>['native-router'],
   stream(input){calls.push(input);return (async function*(){
    const matched=await pool.getAvailableAccount(input.provider,input.model);
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:matched.credential.selected};
    yield {type:'block-end',index:0};
    yield {type:'finish',reason:{kind:'stop'}};
   })()},
  }};
 const env={...isolatedEnv,DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1'};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
   env,getConfig:enabled,loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.deepEqual(bridge.status().experimentalMultiAccountProviders.includes('lobsterai'),true);
 try{
  const request={providerId:'lobsterai',sourceAccountId:'lob-b',model:'lobster-chat',
   messages:[{role:'user',content:[{type:'text',text:'hi'}]}],tools:[]};
  const events=[];
  for await(const event of await bridge.streamNative(request))events.push(event);
  assert.equal(events.find(event=>event.type==='text-delta').text,'LOBSTER_B');
  assert.equal(calls.length,1);
  assert.equal(rows.filter(row=>row.enabled).length,2);
  assert.equal(resolutions.at(-1),'LOBSTER_B');
  const outside=await pool.getAvailableAccount('lobsterai','lobster-chat');
  assert.equal(outside.entry.id,'lob-a');
  await assert.rejects(()=>bridge.streamNative({...request,providerId:'qoder'}),/not unambiguous/);
 }finally{
  bridge.dispose();
  assert.equal(pool.getAvailableAccount,baseGet);
  assert.equal(credentials.resolve,baseResolve);
 }
});
test('all-source multiaccount guard refuses a Qoder request when upstream tries a different account',async()=>{
 const rows=[
  {id:'q-a',provider:'qoder',enabled:true,credentialRef:'QODER_A'},
  {id:'q-b',provider:'qoder',enabled:true,credentialRef:'QODER_B'},
 ];
 let called=0;
 const credentials={resolve:async()=>({value:'{}'})};
 const pool={listAllAccounts:async()=>rows,listAccountsByProvider:p=>rows.filter(a=>a.provider===p),
  getAvailableAccount:async()=>({entry:rows[0],credential:{}})};
  let livePool;
  const scope={credentials,get:k=>k==='accountPool'?livePool:undefined,llm:{
  listProviders:async()=>['native-router'],stream:()=>{called++;throw Error('never called')},
 }};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},getConfig:enabled,
  env:{...isolatedEnv,DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1'},
   loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 await assert.rejects(()=>bridge.streamNative({providerId:'qoder',sourceAccountId:'q-b',
  model:'q-chat',messages:[{role:'user',content:[]}]}),/not currently available/);
 assert.equal(called,0);
 bridge.dispose();
});
test('experimental source account gate fails closed when host cannot expose a credential service',async()=>{
 const rows=[
  {id:'lob-a',provider:'lobsterai',enabled:true},
  {id:'lob-b',provider:'lobsterai',enabled:true},
 ];
 const pool={listAllAccounts:async()=>rows,listAccountsByProvider:p=>rows.filter(a=>a.provider===p),
  getAvailableAccount:async()=>({entry:rows[0],credential:{}})};
  let livePool;
  const scope={get:k=>k==='accountPool'?livePool:undefined,llm:{
  listProviders:async()=>['native-router'],stream:()=>{throw Error('must not stream')},
 }};
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},getConfig:enabled,
  env:{...isolatedEnv,DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1'},
   loadPack:async()=>({apply(){livePool=pool}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted','legacy single-source mode stays available');
 assert.deepEqual(bridge.status().experimentalMultiAccountProviders,[]);
 await assert.rejects(()=>bridge.streamNative({providerId:'lobsterai',sourceAccountId:'lob-a',
  model:'lobster-chat',messages:[{role:'user',content:[]}]}),/not verified/);
 bridge.dispose();
});

test('source bridge cleanup deletes its own Cordis inject child once and blocks later apply',async()=>{
 const scope={llm:{listProviders:async()=>['native-router']},get:()=>undefined};
 let callback,deleted=0,applied=0,load=0;
 const ctx={
  inject(deps,fn){assert.deepEqual(deps,['credentials','commands','llm','connection']);callback=fn;fn(scope)},
  registry:{delete(fn){assert.equal(fn,callback);deleted++;return {removed:true}}},
 };
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:async()=>{load++;return {apply(){applied++}}}});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.equal(load,1);assert.equal(applied,1);
 bridge.dispose();
 bridge.dispose();
 assert.equal(deleted,1,'Cordis child injection is removed exactly once');
 assert.equal(bridge.status().state,'disposed');
 assert.equal(bridge.attach().state,'disposed');
});
test('disposing source bridge before asynchronous pack import is resolved prevents startup effects',async()=>{
 let release,removed=0,applied=0;
 const scope={get:()=>undefined,llm:{listProviders:async()=>[]}};
 const ctx={
  inject(_deps,fn){fn(scope)},
  registry:{delete(){removed++}},
 };
 const bridge=createEmbeddedChannelPack({ctx,getConfig:enabled,env:isolatedEnv,
  loadPack:()=>new Promise(resolve=>{release=resolve})});
 bridge.attach();await tick();
 bridge.dispose();
 release({apply(){applied++}});
 await tick();await tick();
 assert.equal(applied,0);
 assert.equal(removed,1);
 assert.equal(bridge.status().state,'disposed');
});
test('real Cordis optional service getters are safe without reading strict missing services',async()=>{
 const reads=[];
 const scope={
  llm:{listProviders:async()=>['native-router']},
  get(name,strict=true){
   reads.push([name,strict]);
   if((name==='profileContext'||name==='accountPool')&&strict)
    throw Error('Cordis strict absent service: '+name);
   return undefined;
  },
  get profileContext(){throw Error('Never read strict Cordis property getter')},
 };
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,fn){fn(scope)}},
  getConfig:enabled,env:isolatedEnv,loadPack:async()=>({apply(){}})});
 bridge.attach();await tick();await tick();
 assert.equal(bridge.status().state,'mounted');
 assert.equal(reads.some(([name,strict])=>name==='profileContext'&&strict===false),true);
 assert.equal(reads.some(([name,strict])=>name==='accountPool'&&strict===false),true);
 bridge.dispose();
});

test('source pack status never infers login RPC or model readiness from package load alone',()=>{
 const b=createEmbeddedChannelPack({ctx:{inject(){throw Error('disabled package must not inject')}},
   getConfig:()=>normalizeConfig({})});
 assert.equal(b.status().state,'disabled');
 assert.equal(b.status().rpcReady,false);
 assert.deepEqual(b.status().modelAdapterReady,[]);
 assert.deepEqual(b.status().modelAdapterUnready,[]);
 assert.equal(b.status().sourceErrorLocation,'');
 b.dispose();
});
