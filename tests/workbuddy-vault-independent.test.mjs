import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {createInstalledPluginInventory} from '../src/installed-plugin-inventory.mjs';
import {createWorkbuddyVaultInventory} from '../src/workbuddy-vault.mjs';
import {createWorkbuddyVaultAdoption,workbuddyOwnedId} from '../src/workbuddy-vault-adoption.mjs';
import {createWorkBuddyDriver} from '../src/channels/workbuddy.mjs';
import {createActivityClaimStore} from '../src/activity-claims.mjs';
import {freeEvidence} from '../src/auto-free.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const safeRoot=()=>mkdtempSync(join(tmpdir(),'dsh-workbuddy-own-test-'));
const content=[{choices:[{delta:{content:'independent workbuddy'},finish_reason:'stop'}]}];
function testRig(region,{benefitCampaign=false,dailyActive=true,dailyClaimError=false,
 benefitPostAmbiguous=false,benefitWalletUnchanged=false}={}){
 const root=safeRoot();
 const domain=region==='cn'?'www.workbuddy.cn':'www.workbuddy.ai';
 const source='workbuddy-'+region,own='own_workbuddy-'+region;
 const uin='FAKE_UIN_'+region,id=sha('workbuddy\0'+uin).slice(0,24);
 const folder=join(root,'.dsh','workbuddy-vault',region);
 mkdirSync(folder,{recursive:true});
 const original={version:1,accountId:id,
  auth:{accessToken:'FAKE_WORKBUDDY_ACCESS_'+region,
   refreshToken:'FAKE_WORKBUDDY_REFRESH_'+region,
   expiresAt:Math.floor(Date.now()/1000)+7200,domain},
   account:{uin,uid:'FAKE_UID_'+region,nickname:'Synthetic'}};
 writeFileSync(join(folder,id+'.json'),JSON.stringify(original));
 const plugins=join(root,'.dsh','profiles','desktop','node_modules','dsh-connect-workbuddy');
 mkdirSync(plugins,{recursive:true});
 writeFileSync(join(plugins,'package.json'),JSON.stringify({name:'dsh-connect-workbuddy',version:'5.24.10'}));
 const inventory=createInstalledPluginInventory({home:root,
  profileDir:join(root,'.dsh','profiles','desktop'),publicLoomyDir:null});
 let cfg=normalizeConfig({});
 const configStore={get:()=>structuredClone(cfg),replace:value=>(cfg=normalizeConfig(value))};
 const store=new Map();
 const vault={
  async resolve(key){return store.has(key)?{value:store.get(key)}:undefined},
  async set(key,value){store.set(key,value)},
  async unset(key){store.delete(key)},
 };
  const hits=[];let checked=false,compensationClaimed=false,walletBalance=100;
 const fetchImpl=async(url,init={})=>{
  hits.push(String(url));
  assert.ok(String(url).startsWith('https://'+domain+'/')
   ||(region==='cn'&&String(url).startsWith('https://www.codebuddy.cn/')));
  assert.ok(String(init.headers?.authorization??'').includes('FAKE_WORKBUDDY_ACCESS_'));
  assert.equal(init.headers?.['x-domain'],domain);
   if(String(url).includes('/v2/chat/completions')||
     String(url).includes('/v2/billing/meter/'))
    assert.equal(init.headers?.['x-user-id'],'FAKE_UID_'+region,
      'signed official user ID must be the UID, never different UIN');
   if(String(url).includes('/v2/billing/meter/checkin-activity-status'))
     return new Response(JSON.stringify({code:0,data:{active:dailyActive,today_checked_in:checked}}),
      {status:200,headers:{'content-type':'application/json'}});
  if(String(url).includes('/v2/billing/meter/daily-checkin')){
     if(dailyClaimError)return new Response('',{status:503});
     checked=true;return new Response(JSON.stringify({code:0,data:{credit:10}}),
      {status:200,headers:{'content-type':'application/json'}});
  }
   if(String(url).includes('/v2/billing/meter/get-user-resource'))
    return new Response(JSON.stringify({code:0,data:{Response:{Data:{Accounts:[{
      PackageName:'测试免费积分',CapacityType:3,CapacityRemain:walletBalance,
      CapacitySize:walletBalance,ExpiredTime:'2027-11-23T00:00:00Z'}]}}}}));
   if(String(url).includes('/billing/meter/compensation-status'))
    return new Response(JSON.stringify({code:0,data:{active:benefitCampaign,claimed:compensationClaimed,credit_num:160}}));
   if(String(url).includes('/billing/meter/check-gift-claimed'))
    return new Response(JSON.stringify({code:0,data:{active:false,claimed:false}}));
   if(String(url).includes('/billing/meter/claim-compensation')){
    if(!benefitCampaign)throw Error('No grant advertised');
    compensationClaimed=true;
    if(!benefitWalletUnchanged)walletBalance+=160;
    if(benefitPostAmbiguous)return new Response('',{status:503});
    return new Response(JSON.stringify({code:0,data:{}}));
   }
   if(String(url).includes('/v3/config'))return new Response(JSON.stringify({
   code:0,data:{models:[{id:region==='cn'?'hy4-preview-f':'default-model',
     name:'Synthetic Model',credits:'x0.00 credits',supportsToolCall:true},
     {id:'synthetic-premium',name:'Synthetic paid',credits:'x0.79 credits',supportsToolCall:true}]}}),{
     status:200,headers:{'content-type':'application/json'}});
  if(String(url).includes('/v2/chat/completions')){
   const s='data: '+JSON.stringify({choices:[{
    index:0,delta:{content:'independent workbuddy'},finish_reason:'stop'}]})+'\n\n'+
    'data: [DONE]\n\n';
   return new Response(s,{status:200,headers:{'content-type':'text/event-stream'}});
  }
  throw Error('Unexpected WorkBuddy upstream');
 };
  const profileArchive=createWorkbuddyVaultInventory({home:root});
  const driver=createWorkBuddyDriver({ownedRegion:region,ownedVault:vault,
    makeCredentialRef:x=>x,fetchImpl,
    ownedIdentityLookup:id=>profileArchive.ownedPublicName(own,id)});
 const adoption=createWorkbuddyVaultAdoption({inventory,configStore,vault,
   makeCredentialRef:x=>x,drivers:new Map([[own,driver]])});
 return {root,region,source,own,inventory,store,configStore,driver,adoption,hits,
   get cfg(){return cfg},
   destroyOriginal(){rmSync(folder,{recursive:true,force:true});
     rmSync(plugins,{recursive:true,force:true})},
   cleanup(){rmSync(root,{recursive:true,force:true})}};
}
test('historical WorkBuddy imported accounts recover exact public names into owner vault once and survive source deletion',async()=>{
 const rig=testRig('cn');
 try{
  const found=await rig.inventory.scan();
  const source=found.accounts.find(a=>a.providerId===rig.source);
  assert(source);
  const adopted=await rig.adoption.adopt({providerId:rig.source,
   accountId:source.accountId,consent:true});
  assert.equal(adopted.state,'stored_unverified');
  const account=rig.cfg.accounts[0],key='NATIVE_ROUTER_WB_'+account.id.slice(4).toUpperCase();
  const original=JSON.parse(rig.store.get(key));
  assert.equal(original.nickname,'Synthetic');
  delete original.nickname; // emulate rc.80/81 data already missing its nickname
  rig.store.set(key,JSON.stringify(original));
  const lookup=createWorkbuddyVaultInventory({home:rig.root});
  assert.equal(lookup.ownedPublicName(rig.own,account.id),'Synthetic');
  assert.equal(lookup.ownedPublicName('own_workbuddy-global',account.id),'');
  assert.equal(lookup.ownedPublicName(rig.own,'wbp_'+'a'.repeat(24)),'');
  let lookups=0,writes=0;
  const ownerVault={
   async resolve(ref){return {value:rig.store.get(ref)}},
   async set(ref,value){writes++;rig.store.set(ref,value)},
   async unset(ref){rig.store.delete(ref)},
  };
  const fixture=async(url,init)=>{
   if(url.includes('/v3/config'))return new Response(JSON.stringify({code:0,data:{
    models:[{id:'hy4-preview-f',name:'Fixture model',credits:'x0.00 credits'}]}}),{status:200});
   if(url.includes('/v2/plugin/account')||url.includes('/v2/plugin/login/account'))
    return new Response(JSON.stringify({code:12151,data:{}}),{status:200});
   if(url.includes('/billing/meter/'))
    return new Response(JSON.stringify({code:0,data:{Response:{Data:{Accounts:[]}}}}),{status:200});
   throw Error('Unexpected route');
  };
  const driver=createWorkBuddyDriver({ownedRegion:'cn',ownedVault:ownerVault,
   makeCredentialRef:x=>x,fetchImpl:fixture,
   ownedIdentityLookup:id=>{lookups++;return lookup.ownedPublicName(rig.own,id)}});
  await Promise.all([driver.listModels({account}),driver.refreshAccountStatus({account})]);
  assert.equal(lookups,1,'two concurrent work flows share one public source lookup');
  assert.equal(writes,1,'the sanitized public nickname is persisted exactly once');
  assert.equal(JSON.parse(rig.store.get(key)).nickname,'Synthetic');
  assert.equal(driver.accountSnapshot(account).accountName,'Synthetic');
  rig.destroyOriginal();
  assert.equal(lookup.ownedPublicName(rig.own,account.id),'');
  const driverAfterUninstall=createWorkBuddyDriver({ownedRegion:'cn',ownedVault:ownerVault,
   makeCredentialRef:x=>x,fetchImpl:fixture,
   ownedIdentityLookup:()=>{throw Error('original source is completely gone')}});
  await driverAfterUninstall.refreshAccountStatus({account});
  assert.equal(driverAfterUninstall.accountSnapshot(account).accountName,'Synthetic');
  assert.equal(writes,1,'uninstalled original plugin cannot cause a second handoff');
 }finally{rig.cleanup()}
});
test('WorkBuddy reward-only success cannot be counted as verified daily sign-in',async()=>{
 const r=testRig('cn',{benefitCampaign:true,dailyActive:false});
 try{
  const from=(await r.inventory.scan()).accounts.find(x=>x.providerId===r.source);
  await r.adoption.adopt({providerId:r.source,accountId:from.accountId,consent:true});
  r.destroyOriginal();
  const reply=await r.driver.checkIn({account:r.cfg.accounts[0],date:'2026-11-23'});
  assert.equal(reply.state,'no_task');
  assert.equal(reply.confirmed,undefined);
  assert.equal(reply.benefitClaimedCount,1);
  assert.equal(r.hits.filter(url=>url.includes('/v2/billing/meter/daily-checkin')).length,0);
  assert.equal(r.hits.filter(url=>url.includes('/billing/meter/claim-compensation')).length,1);
 }finally{r.cleanup()}
});
test('WorkBuddy activity adapter operates after confirmed daily sign-in without reposting sign-in',async()=>{
 const r=testRig('cn',{benefitCampaign:true});
 try{
  const found=(await r.inventory.scan()).accounts.find(x=>x.providerId===r.source);
  await r.adoption.adopt({providerId:r.source,accountId:found.accountId,consent:true});
  const account=r.cfg.accounts[0];
  const daily=await r.driver.checkIn({account,date:'2026-11-23',includeActivities:false});
  assert.equal(daily.confirmed,true);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,0,
    'daily check-in must use the durable reward ledger');
  const claims=[];
  const rewards=await r.driver.claimActivities({account,date:'2026-11-23',
   beforeClaim:offer=>{claims.push({kind:offer.kind,stage:'begin'});return true},
   onOutcome:(offer,state)=>claims.push({kind:offer.kind,stage:state})});
  assert.equal(rewards.confirmed,1);
  assert.deepEqual(claims,[{kind:'compensation',stage:'begin'},
   {kind:'compensation',stage:'confirmed'}]);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,1);
  assert.equal(r.hits.filter(x=>x.includes('/v2/billing/meter/daily-checkin')).length,1);
 }finally{r.cleanup()}
});

test('WorkBuddy uncertain gift accepted by provider is later reconciled from official claimed status, without duplicate POST',async()=>{
 const r=testRig('cn',{benefitCampaign:true,benefitPostAmbiguous:true});
 try{
  const source=(await r.inventory.scan()).accounts.find(x=>x.providerId===r.source);
  await r.adoption.adopt({providerId:r.source,accountId:source.accountId,consent:true});
  const account=r.cfg.accounts[0],store=createActivityClaimStore({path:null});
  const doClaim=()=>r.driver.claimActivities({account,date:'2026-11-23',
   beforeClaim:(offer,meta)=>store.begin(account,offer,meta),
   onOutcome:(offer,state,meta)=>store.finish(account,offer,state,meta),
   onObserved:(offer,state,meta)=>store.finish(account,offer,state,meta),
   previousReceipt:offer=>store.receipt(account,offer)});
  const first=await doClaim();
  assert.equal(first.pending,1);
  assert.equal(store.summary(account).unconfirmed,1);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,1);
  await doClaim();
  assert.equal(store.summary(account).confirmed,1,
    'after a network error the real claimed status completes the pending ledger');
  assert.equal(store.receipt(account,{kind:'compensation',credit:160}).proof,
    'official_wallet_delta');
  assert.equal(store.summary(account).unconfirmed,0);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,1,
    'only one remote compensation POST is ever allowed');
 }finally{r.cleanup()}
});

test('WorkBuddy claimed checkbox without actual wallet increase remains uncredited and cannot be resubmitted',async()=>{
 const r=testRig('cn',{benefitCampaign:true,benefitWalletUnchanged:true});
 try{
  const source=(await r.inventory.scan()).accounts.find(x=>x.providerId===r.source);
  await r.adoption.adopt({providerId:r.source,accountId:source.accountId,consent:true});
  const account=r.cfg.accounts[0],store=createActivityClaimStore({path:null});
  const probe=()=>r.driver.claimActivities({account,date:'2026-11-23',
    beforeClaim:(offer,meta)=>store.begin(account,offer,meta),
    onOutcome:(offer,state,meta)=>store.finish(account,offer,state,meta),
    onObserved:(offer,state,meta)=>store.finish(account,offer,state,meta),
    previousReceipt:offer=>store.receipt(account,offer)});
  const first=await probe();
  assert.equal(first.confirmed,0);
  assert.equal(first.pending,1);
  assert.equal(store.summary(account).unconfirmed,1);
  await probe();
  assert.equal(store.summary(account).confirmed,0,
    'already claimed vendor task is not proof of credited points');
  assert.equal(store.receipt(account,{kind:'compensation',credit:160})?.proof,undefined);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,1);
 }finally{r.cleanup()}
});

test('WorkBuddy unconfirmed daily POST is not resent even when direct check-in is repeated',async()=>{
 const r=testRig('cn',{dailyClaimError:true});
 try{
  const from=(await r.inventory.scan()).accounts.find(x=>x.providerId===r.source);
  await r.adoption.adopt({providerId:r.source,accountId:from.accountId,consent:true});
  r.destroyOriginal();
  const a=r.cfg.accounts[0];
  const first=await r.driver.checkIn({account:a,date:'2026-11-23'});
  assert.equal(first.state,'pending_confirmation');
  assert.equal(first.confirmed,undefined);
  assert.equal((await r.driver.checkIn({account:a,date:'2026-11-23'})).state,'pending_confirmation');
  assert.equal(r.hits.filter(url=>url.includes('/v2/billing/meter/daily-checkin')).length,1);
 }finally{r.cleanup()}
});
test('WorkBuddy independently collects eligible compensation in opt-in check-in once',async()=>{
 const r=testRig('cn',{benefitCampaign:true});
 try{
  const found=await r.inventory.scan();
  const id=found.accounts.find(x=>x.providerId==='workbuddy-cn')?.accountId;
  assert(id);
  const result=await r.adoption.adopt({providerId:'workbuddy-cn',accountId:id,consent:true});
  assert.equal(result.state,'stored_unverified');
  r.destroyOriginal();
  const account=r.cfg.accounts[0],day='2026-11-23';
  const first=await r.driver.checkIn({account,date:day});
  assert.equal(first.confirmed,true);
   assert.match(first.message,/活动权益/);
   assert.equal(first.benefitClaimedCount,1);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,1);
  const second=await r.driver.checkIn({account,date:day});
  assert.equal(second.confirmed,true);
  assert.equal(r.hits.filter(x=>x.includes('/billing/meter/claim-compensation')).length,1);
  assert.equal(r.driver.accountSnapshot(account).benefits.find(x=>x.kind==='compensation').claimed,true);
 }finally{r.cleanup()}
});
for(const region of ['cn','global']){
 test('WorkBuddy '+region+' independent identity survives original plugin uninstall',async()=>{
  const r=testRig(region);
  try{
   const found=await r.inventory.scan();
   const rows=found.accounts.filter(x=>x.providerId===r.source);
   assert.equal(rows.length,1);
   assert.match(rows[0].accountId,/^local_[a-f0-9]{20}$/);
   assert.equal(rows[0].loginVerified,false);
   assert.equal((await r.adoption.adopt({providerId:r.source,
    accountId:rows[0].accountId})).state,'consent_required');
   assert.equal(r.store.size,0);
   const imported=await r.adoption.adopt({providerId:r.source,
     accountId:rows[0].accountId,consent:true});
   assert.equal(imported.state,'stored_unverified');
   assert.equal(imported.originalUnchanged,true);
   assert.equal(imported.modelCatalogVerified,true);
   assert.equal(r.cfg.routes.length,0,'Independent login may not auto-create chains');
   assert.equal(imported.accountId,workbuddyOwnedId(r.source,rows[0].accountId));
   assert.equal(r.cfg.accounts.length,1);
    assert.equal(r.cfg.accounts[0].providerId,r.own);
    assert.equal(r.cfg.accounts[0].displayName,'Synthetic');   assert.doesNotMatch(JSON.stringify(r.cfg),/FAKE_WORKBUDDY/);
   assert.equal(r.store.size,1);
   r.destroyOriginal();
   assert.equal((await r.inventory.scan()).accounts.filter(x=>x.providerId===r.source).length,0);
   const router=createNativeRouterAdapter({configStore:r.configStore,
    channelDrivers:new Map([[r.own,r.driver]])});
   const directId='direct:'+r.own+':'+(region==='cn'?'hy4-preview-f':'default-model');
   assert.ok((await router.listModels()).some(x=>x.id===directId));
   const originalAccount=r.cfg.accounts[0];
   const realCatalog=await r.driver.listModels({account:originalAccount});
    assert.ok(realCatalog.some(m=>m.id===(region==='cn'?'hy4-preview-f':'default-model')));
    const freeModel=realCatalog.find(x=>x.id===(region==='cn'?'hy4-preview-f':'default-model'));
    assert.equal(freeModel.upstreamFreeLabel,true,'official WorkBuddy x0.00 credits must survive into owned driver');
    assert.ok(freeEvidence(freeModel,r.own));
    assert.equal(realCatalog.find(x=>x.id==='synthetic-premium')?.upstreamFreeLabel,undefined,
      'paid official model must not be auto-whitelisted as free');
   const events=[];
   for await(const event of router.stream({
     model:directId,
     messages:[{role:'user',content:[{type:'text',text:'test'}]}],
   }))events.push(event);
   assert.ok(events.some(x=>x.type==='text-delta'&&x.text.includes('independent workbuddy')));
   assert.ok(r.hits.some(x=>x.includes('/v3/config')));
   assert.ok(r.hits.some(x=>x.includes('/v2/chat/completions')));
   assert.equal(router.getStatus().metrics.successfulTurns,1);
   const checkedIn=await r.driver.checkIn({account:originalAccount,date:'2026-11-18'});
   assert.equal(checkedIn.confirmed,true);
   assert.equal(checkedIn.date,'2026-11-18');
   assert.equal((await r.driver.checkIn({account:originalAccount,date:'2026-11-18'})).confirmed,true);
   assert.equal(r.hits.filter(x=>x.includes('/daily-checkin')).length,1);
   assert.equal((await r.adoption.adopt({providerId:r.source,
    accountId:rows[0].accountId,consent:true})).state,'already_owned');
  }finally{r.cleanup()}
 });
}
test('owned WorkBuddy refresh uses official MIT X-Refresh-Token contract and persists rotated token across restart',async()=>{
 const region='cn',id='wbp_'+'d'.repeat(24);
 const record={accessToken:'FAKE_EXPIRED_WB_ACCESS',refreshToken:'FAKE_WB_REFRESH_OLD',
  domain:'www.workbuddy.cn',uid:'synthetic',expiresAt:Math.floor(Date.now()/1000)-120};
 const credentialName='NATIVE_ROUTER_WB_'+id.slice(4).toUpperCase();
 const saved=new Map([[credentialName,JSON.stringify(record)]]),outbound=[];
 const vault={
  resolve:async name=>({value:saved.get(name)}),
  set:async(name,value)=>{saved.set(name,value)},
  unset:async name=>{saved.delete(name)},
 };
 const fetchImpl=async(url,init={})=>{
  outbound.push(String(url));
  if(String(url).endsWith('/v2/plugin/auth/token/refresh')){
   assert.equal(init.headers?.['x-refresh-token'],'FAKE_WB_REFRESH_OLD');
   assert.equal(init.headers?.['x-auth-refresh-source'],'workbuddy');
   assert.equal(init.body,undefined);
   return new Response(JSON.stringify({code:0,data:{
    accessToken:'FAKE_NEW_WB_ACCESS',refreshToken:'FAKE_NEW_WB_REFRESH',expiresIn:7200
   }}),{status:200,headers:{'content-type':'application/json'}});
  }
  assert.equal(init.headers?.authorization,'Bearer FAKE_NEW_WB_ACCESS');
  return new Response(JSON.stringify({code:0,data:{models:[{id:'hy4flash-free',name:'Synthetic'}]}}),
   {status:200,headers:{'content-type':'application/json'}});
 };
 const account={id,providerId:'own_workbuddy-cn',credentialRef:'driver:own_workbuddy-cn:'+id};
 const make=()=>createWorkBuddyDriver({ownedRegion:region,ownedVault:vault,
  makeCredentialRef:x=>x,fetchImpl});
 const d1=make();assert.equal((await d1.listModels({account}))[0].id,'hy4flash-free');
 assert.ok(outbound.some(x=>x.includes('/token/refresh')));
 assert.equal(JSON.parse(saved.get(credentialName)).accessToken,'FAKE_NEW_WB_ACCESS');
 assert.equal(JSON.parse(saved.get(credentialName)).refreshToken,'FAKE_NEW_WB_REFRESH');
 const oldCount=outbound.length;
 const d2=make();assert.equal((await d2.listModels({account}))[0].id,'hy4flash-free');
 assert.equal(outbound.length,oldCount+1);
 assert.equal(outbound.at(-1).endsWith('/v3/config'),true);
});

test('incomplete official WorkBuddy SSE is rejected with only safe structural diagnostics',async()=>{
 const id='wbp_'+'f'.repeat(24),key='NATIVE_ROUTER_WB_'+id.slice(4).toUpperCase();
 const account={id,providerId:'own_workbuddy-cn',credentialRef:'driver:own_workbuddy-cn:'+id};
 const vault={resolve:async name=>({value:name===key?JSON.stringify({
   accessToken:'FAKE_'+'PRIVATE_SESSION_NOT_TO_EXPOSE',  domain:'www.workbuddy.cn',expiresAt:Math.floor(Date.now()/1000)+3600}):''})};
 const respond=async(text)=>{
  const driver=createWorkBuddyDriver({ownedRegion:'cn',ownedVault:vault,
   makeCredentialRef:x=>x,fetchImpl:async()=>new Response(text,{status:200,
    headers:{'content-type':'text/event-stream'}})});
  return assert.rejects(driver.generate({account,model:'official-free',options:{
   messages:[{role:'user',content:'OK'}],maxTokens:32}}),e=>{
    assert.equal(e.code,'TRUNCATED');
    assert.equal(e.safeStreamPhase,'FINISH_FRAME_MISSING_DONE');
    assert.doesNotMatch(JSON.stringify({code:e.code,phase:e.safeStreamPhase}),/FAKE_PRIVATE_SESSION/);
    return true;
  });
 };
 await respond('data: '+JSON.stringify({choices:[{delta:{content:'partial'},finish_reason:'stop'}]})+'\n\n');
});

test('WorkBuddy vault refuses malicious file ids, wrong region and disabled source package',async()=>{
 const r=testRig('cn');
 try{
  assert.equal(await r.inventory.readCredential('workbuddy-global','local_00000000000000000000'),null);
  assert.equal((await r.adoption.adopt({
   providerId:'workbuddy-cn',accountId:'local_00000000000000000000',
   consent:true})).state,'source_missing_or_changed');
  assert.equal(r.store.size,0);
 }finally{r.cleanup()}
});

test('WorkBuddy global catalogs keep exact UID and never prefer a free duplicate over a positive official multiplier',async()=>{
 const rig=testRig('global');try{
  const source=(await rig.inventory.scan()).accounts.find(a=>a.providerId===rig.source);
  await rig.adoption.adopt({providerId:rig.source,accountId:source.accountId,consent:true});
  const account=rig.cfg.accounts[0],uids=[];
  const driver=createWorkBuddyDriver({ownedRegion:'global',ownedVault:{resolve:async k=>({value:rig.store.get(k)})},makeCredentialRef:x=>x,
   fetchImpl:async(url,opts)=>{uids.push(opts.headers['x-user-id']);const cli=opts.headers['user-agent'].startsWith('CLI/');return new Response(JSON.stringify({code:0,data:{models:[{id:'conflict',name:'Conflict',credits:cli?'x0.00 credits':'x0.79 credits'},{id:'paid',credits:'x0.25 credits'},{id:'zero',credits:'x0.00 credits'}]}}))}});
  const rows=await driver.listModels({account});assert.deepEqual(uids,['FAKE_UID_global','FAKE_UID_global']);
  assert.equal(rows.find(m=>m.id==='conflict').pricingConflict,true);assert.equal(freeEvidence(rows.find(m=>m.id==='conflict'),rig.own),null);
  assert.equal(rows.find(m=>m.id==='paid').costMultiplier,0.25);assert.equal(rows.find(m=>m.id==='zero').costMultiplier,0);
 }finally{rig.cleanup()}
});

test('WorkBuddy verified identity summary counts subjects rather than duplicate authorization records',async()=>{
 const providerId='own_workbuddy-cn',ids=['a','b','c'].map(c=>'wbp_'+c.repeat(24));
 const accounts=ids.map(id=>({id,providerId,credentialRef:'driver:'+providerId+':'+id,enabled:true}));
 const records=new Map(ids.map((id,i)=>['NATIVE_ROUTER_WB_'+id.slice(4).toUpperCase(),JSON.stringify({accessToken:'TEST_'+i,domain:'www.workbuddy.cn',uid:i===2?'other':'same',nickname:'Local label '+i,expiresAt:Math.floor(Date.now()/1000)+3600})]));
 let rejectThird=true;const driver=createWorkBuddyDriver({ownedRegion:'cn',makeCredentialRef:x=>x,ownedVault:{resolve:async key=>({value:records.get(key)})},fetchImpl:async(url,opts)=>{
  const uid=opts.headers['x-user-id'];
  if(url.endsWith('/v2/plugin/account')||url.endsWith('/v2/plugin/login/account'))return new Response(JSON.stringify({code:0,data:{uid:uid==='other'&&rejectThird?'wrong':uid,nickname:'Same visible label'}}));
  if(url.endsWith('/v2/billing/meter/get-user-resource'))return new Response(JSON.stringify({code:0,data:{Response:{Data:{Accounts:[]}}}}));
  return new Response('{}',{status:404});
 }});
 let cfg=normalizeConfig({providers:[{id:providerId,protocol:'native-channel',enabled:true}],accounts});
 const center=createAccountCenter({configStore:{get:()=>cfg,replace:x=>(cfg=normalizeConfig(x))},drivers:new Map([[providerId,driver]])});
 try{
  for(const account of accounts)await driver.refreshAccountStatus({account});
  assert.deepEqual(center.workbuddyIdentitySummary(providerId),{configuredRecords:3,enabledRecords:3,confirmedRecords:2,distinctConfirmedSubjects:1,unconfirmedRecords:1});
  assert.equal(center.list().accounts[2].profileState,'cached');
  assert.equal(center.list().accounts[0].profileState,'verified');
  rejectThird=false;await driver.refreshAccountStatus({account:accounts[2]});
  assert.deepEqual(center.workbuddyIdentitySummary(providerId),{configuredRecords:3,enabledRecords:3,confirmedRecords:3,distinctConfirmedSubjects:2,unconfirmedRecords:0});
  assert.doesNotMatch(JSON.stringify(center.list()),/TEST_[012]|verifiedSubjects|identitySalt|"group":/);
 }finally{center.stop()}
});
