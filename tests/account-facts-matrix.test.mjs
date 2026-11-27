import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAccountName,publicBalance,checkinDisplayState,credentialPublicIdentity,
  expiredCheckinConfirmation,CHECKIN_CONFIRMATION_TIMEOUT_MS} from '../src/account-facts.mjs';
import {REFERENCE_CHANNELS} from '../src/channels.mjs';
import {SOURCE_PACK_PROVIDERS} from '../src/embedded-pack.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {mergeAccountSources} from '../src/account-source-view.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
test('public account labels recover official alternate fields but reject device labels and mask phones',()=>{
 assert.equal(publicAccountName({display_name:'真实昵称'}),'真实昵称');
 assert.equal(credentialPublicIdentity({account_label:'真实账号'}).accountName,'真实账号');
 assert.equal(credentialPublicIdentity({accountLabel:'设备 123'}).accountName,undefined);
 assert.equal(credentialPublicIdentity({accountLabel:'13812345678'}).accountName,'138****5678');
 assert.equal(credentialPublicIdentity({account_name:'',user_name:'真实账号'}).accountName,'真实账号');
 assert.equal(credentialPublicIdentity({display_name:'设备 123',displayName:'真实昵称'}).accountName,'真实昵称');
 assert.deepEqual(credentialPublicIdentity({userInfo:{displayName:'真实用户',mobile:'13812345678'}}),{accountName:'真实用户',maskedPhone:'138****5678'});
 assert.equal(credentialPublicIdentity({user_id:'raw-id',username:'raw-id',profile:{displayName:'Actual name'}}).accountName,'Actual name');
 assert.equal(publicAccountName({userId:'raw-id',userName:'raw-id'}),'');
 assert.equal(credentialPublicIdentity({user_id:'member-123',user:{id:'member-123',nick_name:'Official nickname'}}).accountName,'Official nickname');
 assert.equal(credentialPublicIdentity({user_id:'member-123',user:{id:'foreign-456',nick_name:'Foreign nickname',phone:'13812345678'}}).accountName,undefined);
 assert.deepEqual(credentialPublicIdentity({user_id:'member-123',user:{id:'foreign-456',name:'Foreign nickname',phone:'13812345678'}}),{});
 assert.equal(credentialPublicIdentity({user_id:'raw-id',access_token:'secret'}).accountName,undefined);
});

test('all 13 built-in source providers are represented by channel metadata',()=>{
 const ids=REFERENCE_CHANNELS.map(row=>row.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.equal(SOURCE_PACK_PROVIDERS.length,13);
 for(const id of SOURCE_PACK_PROVIDERS){
  const row=REFERENCE_CHANNELS.find(c=>c.id===id);
  assert.ok(row,'channel missing from shared list: '+id);
  assert.ok(row.name&&row.auth);
 }
 assert.ok(ids.includes('own_mimo_desktop'));
 assert.ok(!ids.includes('own_doubao'));
});
test('every enumerated source uses one read-only identity and balance contract without fabricated credits',()=>{  const channels=new Set([...REFERENCE_CHANNELS.map(x=>x.id),...SOURCE_PACK_PROVIDERS,
    'lingxi','codebuddy','workbuddy-global']);
  assert.ok(channels.size>=13);
  for(const providerId of channels){
    const actualUnit=providerId==='zcode'?'token':
      providerId==='loomy'?'积分':providerId==='lingxi'?'积分':'upstream-unit';
    const returned={id:'source-id',username:'Real-'+providerId,
      balance:42.75,balanceUnit:actualUnit,balanceCheckedAt:1000};
    assert.equal(publicAccountName(returned,{nickname:'账号 1'}),'Real-'+providerId);
    const fact=publicBalance(returned);
    assert.equal(fact.balance,42.75,providerId);
    assert.equal(fact.balanceUnit,actualUnit,'never rewrite upstream units');
    assert.equal(fact.balanceCheckedAt,1000);
    assert.equal(publicBalance({balance:null,balanceUnit:actualUnit}).balanceState,'not_checked');
    assert.equal('balance' in publicBalance({balance:-1}),false);
    assert.equal('balance' in publicBalance({balance:NaN}),false);
    assert.deepEqual(publicBalance({balance:0,balanceUnit:actualUnit}).balance,0);
  }
  assert.equal(publicAccountName({nickname:'账号 1'},{nickname:'ZCode · 独立账号'}),'');
  assert.equal(publicAccountName({nickname:'sp_'+'a'.repeat(24)}),'');
  assert.equal(publicAccountName({nickname:'My Real Name'}),'My Real Name');
  assert.equal(publicAccountName({username:'abc',nickname:'Preferred Member'}),'Preferred Member');
  assert.equal(publicAccountName({account_name:'平台登录账户'}),'平台登录账户');
  assert.equal(publicAccountName({loginName:'backup-login'}),'backup-login');
  assert.equal(publicBalance({balanceState:'not_supported'}).balanceState,'not_supported');
});

test('read-only account driver snapshot is isolated per channel and keeps original units',()=>{
 const providers=['own_lingxi','own_zcode','own_codearts','own_loomy'];
 const cfg=normalizeConfig({providers:providers.map(id=>({id,
   name:id,protocol:'native-channel',models:['test-model']})),
    accounts:providers.map((providerId,i)=>({id:'mock-'+i,providerId,
      credentialRef:'driver:'+providerId+':mock-'+i,enabled:true,
      ...(providerId==='own_loomy'?{displayName:'Persisted Loomy account'}:{})}))}); const snapshots=new Map(providers.map((id,i)=>[id,{
   accountSnapshot(){if(id==='own_loomy')throw Error('unavailable original cache');
     return {username:'User '+i,balance:i===0?0:125.5,
       balanceUnit:id==='own_zcode'?'token':id==='own_codearts'?'quota':'积分',
       balanceCheckedAt:9900,checkinDate:'2026-11-20',
       checkinOutcome:i===0?'claimed':'unknown'};},
 }]));
  const center=createAccountCenter({configStore:{get:()=>structuredClone(cfg),replace(){}},
    drivers:snapshots}); const view=center.list();
 assert.equal(view.accounts.length,4);
 assert.equal(view.accounts[0].nickname,'User 0');
 assert.equal(view.accounts[0].balance,0);
 assert.equal(view.accounts[1].balanceUnit,'token');
 assert.equal(view.accounts[2].balanceUnit,'quota');
  assert.equal(view.accounts[3].nickname,'Persisted Loomy account');
  assert.equal(view.accounts[3].balanceState,'not_checked',
    'offline owned account must not copy stale original plugin balances'); assert.ok(view.accounts.every(x=>!JSON.stringify(x).includes('secret')));
});

test('partial official quota windows retain remaining-only, total-only and used-only values with units',()=>{
 const providerId='own_aws_quick';
 const cfg=normalizeConfig({providers:[{id:providerId,name:'Amazon Quick',protocol:'native-channel'}],
  accounts:[{id:'aq-test',providerId,credentialRef:'driver:'+providerId+':aq-test',enabled:true}]});
 const driver={accountSnapshot(){return {
  accountName:'Real Quick Member',
  balanceState:'unavailable',
  quotaCheckedAt:123456,
  quotaWindows:[
   {label:'Automation Hours',left:4.5,unit:'h'},
   {label:'Research Hours',total:10,used:2.5,unit:'h'},
   {label:'Trial Hours',used:1.5,unit:'h'},
   {label:'Invalid Data',left:-1,total:NaN,unit:'h'},
  ],
 }}};
 const center=createAccountCenter({configStore:{get:()=>structuredClone(cfg),replace(){}},
  drivers:new Map([[providerId,driver]])});
 const row=center.list().accounts[0];
 assert.equal(row.nickname,'Real Quick Member');
 assert.equal(row.balanceState,'unavailable','temporary quota error is not a permanently absent entitlement');
 assert.equal(row.quotaWindows.length,3);
 assert.deepEqual(row.quotaWindows[0],{label:'Automation Hours',left:4.5,unit:'h'});
 assert.deepEqual(row.quotaWindows[1],{label:'Research Hours',total:10,used:2.5,unit:'h'});
 assert.deepEqual(row.quotaWindows[2],{label:'Trial Hours',used:1.5,unit:'h'});
 center.stop();
});

test('same account/source rank never selects a disabled or unverified backup as available',()=>{
 const id=sourceAccountOpaqueId('loomy','same');
 const view=mergeAccountSources({roster:{
   channels:[{id:'loomy',name:'Loomy'}],
   accounts:[{id,providerId:'loomy',nickname:'Original session',
     enabled:true,connectionState:'online',reusedExistingSession:true}]},
   embeddedAccounts:{accounts:[{providerId:'loomy',id:'same',
     nickname:'Standalone',authorizationSource:'autonomous',enabled:false}]},
   sourceRows:[{id,providerId:'loomy',sourceAccount:true,connectionState:'online'}],
 });
 assert.equal(view.accounts.length,1);
 assert.equal(view.accounts[0].activeSource,'reused');
 assert.equal(view.accounts[0].backupSources.length,1);
 assert.equal(view.accounts[0].backupSources[0].available,false);
 assert.equal(view.accounts[0].backupSources[0].configured,false);
});

test('private pool disable overrides stale verified config and never revives a disabled login',()=>{
  const providerId='loomy',sourceId='source-1',id=sourceAccountOpaqueId(providerId,sourceId);
  const view=mergeAccountSources({
    roster:{channels:[{id:'own_loomy',name:'Loomy'}],accounts:[{
      id,providerId:'own_loomy',enabled:true,connectionState:'online',
      origin:{kind:'embedded-account-pool'}}]},
    embeddedAccounts:{accounts:[{id:sourceId,providerId,
      authorizationSource:'adopted',enabled:false}]},
    sourceRows:[{id,sourceAccount:true,providerId,connectionState:'online'}],
  });
  assert.equal(view.accounts.length,1);
  assert.equal(view.accounts[0].enabled,false);
  assert.equal(view.accounts[0].connectionState,'disabled');
  assert.equal(view.accounts[0].activeSource,'adopted');
});
test('every checkin state has one bounded confirmation rule independent of provider',()=>{
 const recent={state:'pending_confirmation',at:1000};
 for(const providerId of ['lingxi','codearts','loomy','zcode','qoder','raccoon']){
   assert.equal(checkinDisplayState({recent,now:1000+CHECKIN_CONFIRMATION_TIMEOUT_MS-1}),
     'pending_confirmation',providerId);
   assert.equal(checkinDisplayState({recent,now:1000+CHECKIN_CONFIRMATION_TIMEOUT_MS+1}),
     'failed',providerId);
   assert.equal(checkinDisplayState({recent,confirmed:true,now:1000+99999999}),
     'success',providerId);
   assert.equal(checkinDisplayState({recent:{state:'success',at:1000},
     implemented:false,now:1000+99999999}),'success',providerId);
   assert.equal(checkinDisplayState({recent,now:1000+99999999,pending:true}),
     'running',providerId);
   assert.equal(expiredCheckinConfirmation(recent,1000+99999999),true);
   assert.equal(checkinDisplayState({recent:{state:'no_task',at:1000}}),'no_task');
 }
});

test('slow account read-only probes do not block independent channels or leak errors',async()=>{
 const providers=['own_lingxi','own_codearts','own_loomy'];
 const cfg=normalizeConfig({providers:providers.map(id=>({id,name:id,protocol:'native-channel'})),
   accounts:providers.map((providerId,i)=>({id:'src-'+i,providerId,
     credentialRef:'driver:'+providerId+':src-'+i,enabled:true}))});
 let aborted=false,completed=false;
 const drivers=new Map([
   ['own_lingxi',{refreshAccountStatus:async({signal})=>{
     signal.addEventListener('abort',()=>{aborted=true},{once:true});
     return new Promise(()=>{});
   }}],
   ['own_codearts',{refreshAccountStatus:async()=>{throw Error('private connection failure')}}],
   ['own_loomy',{refreshAccountStatus:async()=>{completed=true;return {state:'ready'}}}],
 ]);
 const center=createAccountCenter({configStore:{get:()=>structuredClone(cfg),replace(){}},
   drivers,readOnlyTimeoutMs:20,readOnlyConcurrency:2});
 const result=await center.refreshReadOnly({force:true});
 assert.equal(result.length,3);
 assert.equal(result.filter(x=>x?.state==='unavailable').length,2);
 assert.equal(result.filter(x=>x?.state==='ready').length,1);
 assert.equal(aborted,true);
 assert.equal(completed,true);
 assert.doesNotMatch(JSON.stringify(result),/private connection failure/);
});
test('account read deadline follows bounded driver budget unless an explicit override is supplied',async()=>{
 const cfg=normalizeConfig({providers:[{id:'own_lingxi',protocol:'native-channel'}],accounts:[{id:'one',providerId:'own_lingxi',credentialRef:'driver:own_lingxi:one',enabled:true}]});
 const drivers=new Map([['own_lingxi',{accountReadTimeoutMs:40,refreshAccountStatus:async()=>{await new Promise(resolve=>setTimeout(resolve,70));return {state:'ready'}}}]]);
 const store={get:()=>structuredClone(cfg),replace(){}};
 const bounded=createAccountCenter({configStore:store,drivers});
 try{assert.equal((await bounded.refreshReadOnly({force:true}))[0].state,'unavailable')}finally{bounded.stop()}
 const override=createAccountCenter({configStore:store,drivers,readOnlyTimeoutMs:250});
 try{assert.equal((await override.refreshReadOnly({force:true}))[0].state,'ready')}finally{override.stop()}
});
