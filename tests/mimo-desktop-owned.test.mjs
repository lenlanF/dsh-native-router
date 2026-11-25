import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMimoDesktopDriver,MIMO_DESKTOP_ID,readMimoDesktopSession}
 from '../src/channels/mimo-desktop.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

const loggedIn={region:'cn',passToken:'synthetic-pass-token-from-mi-desktop-12345',
 userId:'test-user-22',cUserId:'user-c-22'};
function harness({rejectReplace=false,authVerified=true,loginFactory,
  chatResult={text:'mimo desktop reply',reasoning:'',finishReason:'stop',toolCalls:[]}}={}){
 const records=new Map(),calls=[];
 const vault={
  async resolve(ref){return records.get(ref)},
  async set(ref,value){if(records.has(ref))throw Error('duplicate private credential');
   records.set(ref,{value})},
  async unset(ref){records.delete(ref)},
 };
 let local={...loggedIn},readerCalls=0,quota={};
 const transport={
  async probe({session,includeQuota=true}){
   calls.push({kind:'auth',session,includeQuota});
   return {state:authVerified?'online':'expired',authVerified,accountName:authVerified?'Xiaomi owner':'',...quota};
  },
  async generate({session,model,options}){
   calls.push({kind:'chat',session,model,options});
   return chatResult;
  },
 };
  let cfg=normalizeConfig({});
  const driver=createMimoDesktopDriver({vault,transport,
   ...(loginFactory?{loginFactory}:{}),getAccounts:()=>cfg.accounts,
   readCurrentSession:async()=>{readerCalls++;return local}});
 const configStore={get:()=>structuredClone(cfg),replace:value=>{
  if(rejectReplace)throw Error('Simulated disk write failure');
  cfg=normalizeConfig(value);return structuredClone(cfg);
 }};
 const center=createAccountCenter({configStore,drivers:new Map([[MIMO_DESKTOP_ID,driver]])});
 return {driver,center,records,calls,configStore,
  get cfg(){return cfg},
  get readerCalls(){return readerCalls},
  stopDesktop(){local=null},switchDesktopRegion(region){local={...loggedIn,region}},setQuota(value){quota=value}};
}
test('own MiMo Desktop is discovered read-only and imported into plugin vault on explicit consent',async()=>{
 const h=harness();
 const scan=await h.center.discover(MIMO_DESKTOP_ID);
 assert.equal(h.cfg.providers.length,0);
 assert.equal(h.records.size,0);
 assert.equal(scan.candidates.length,1);
 assert.match(scan.candidates[0].id,/^sp_[a-f0-9]{24}$/);
 assert.doesNotMatch(JSON.stringify(scan),/synthetic-pass-token|test-user-22/);
 const imported=await h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id);
 assert.equal(imported.providerId,MIMO_DESKTOP_ID);
 assert.equal(h.cfg.providers.length,1);
 assert.equal(h.cfg.providers[0].protocol,'native-channel');
 assert.deepEqual(h.cfg.routes,[],'must not create paid API routes or automatic model chains');
 assert.equal(h.cfg.accounts.length,1);
 assert.equal(h.records.size,1);
 assert.doesNotMatch(JSON.stringify(h.cfg),/synthetic-pass-token/);
 assert.equal((await h.center.verify(imported.id)).state,'online');
 assert.deepEqual(await h.driver.listModels({account:h.cfg.accounts[0]}),[
  {id:'mimo-v2.6-pro'},{id:'mimo-v2.6-flash'},{id:'mimo-v2.6-pro-ultraspeed'}]);
 assert.equal(h.calls.at(-1).includeQuota,false,'catalog needs an independent identity read, not a second quota probe');
 const previousReads=h.readerCalls;
 h.stopDesktop();
 const adapter=createNativeRouterAdapter({configStore:h.configStore,
  channelDrivers:new Map([[MIMO_DESKTOP_ID,h.driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'direct:own_mimo_desktop:mimo-v2.6-pro',
  messages:[{role:'user',content:'hello'}]}))events.push(event);
 assert.equal(events.find(e=>e.type==='text-delta').text,'mimo desktop reply');
 assert.equal(h.readerCalls,previousReads,'runtime must not read original Desktop after import');
 assert.equal(h.calls.at(-1).kind,'chat');
 assert.ok(h.driver.accountSnapshot(h.cfg.accounts[0]).modelInferenceVerifiedAt>0,
  'complete text reply may update the exact account inference proof');
 await h.center.logout(imported.id);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
});
test('MiMo new quota response cannot inherit a previous percentage or reset',async()=>{
 const h=harness(),scan=await h.center.discover(MIMO_DESKTOP_ID);
 const imported=await h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id);
 const account=h.cfg.accounts[0];
 h.setQuota({membershipState:'active',membershipPercentRemaining:80,membershipResetAt:Date.now()+10000,
   usageState:'available',usagePercentRemaining:75,usageResetAt:Date.now()+10000});
 assert.equal((await h.center.verify(imported.id)).state,'online');
 assert.equal(h.driver.accountSnapshot(account).membershipPercentRemaining,80);
 assert.equal(h.driver.accountSnapshot(account).usagePercentRemaining,75);
 h.setQuota({membershipState:'active',usageState:'no_cycle'});
 assert.equal((await h.center.verify(imported.id)).state,'online');
 const snapshot=h.driver.accountSnapshot(account);
 assert.equal(snapshot.membershipPercentRemaining,undefined);
 assert.equal(snapshot.usagePercentRemaining,undefined);
 assert.equal(snapshot.usageResetAt,undefined);
 assert.equal(snapshot.balanceState,'not_supported');
 h.center.stop();
});
test('MiMo late browser cancellation cannot erase an already committed independent session',async()=>{
 const h=harness();
 const discovered=await h.center.discover(MIMO_DESKTOP_ID);
 const receipt=await h.center.importCandidate(MIMO_DESKTOP_ID,discovered.candidates[0].id);
 const account=h.cfg.accounts[0],key=[...h.records.keys()][0];
 const previous=h.records.get(key).value;
 await h.driver.rollbackCandidate({account});
 assert.equal(h.records.get(key).value,previous);
 assert.equal((await h.driver.refresh({account})).state,'online');
 await h.driver.rollbackCandidate({account:{...account,
  credentialRef:'driver:own_mimo_desktop:sp_'+'f'.repeat(24)}});
 assert.equal(h.records.get(key).value,previous);
 const existing={...account,alreadyOwned:true};
 await h.driver.rollbackCandidate({account:existing});
 assert.equal(h.records.size,1);
 assert.equal(receipt.id,account.id);
 h.center.stop();
});
test('MiMo staged browser membership is canceled without leaving an uncommitted vault secret',async()=>{
 const loginFactory=({onSession})=>{
  let state={status:'idle',at:0,account:null};
  return {
   async start(){state={status:'done',at:1,account:await onSession(loggedIn)};return state},
   status(){return state},
   cancel(){state={status:'canceled',at:1,account:null};return state},
   dismissCompleted(){state={status:'canceled',at:1,account:null};return state},
  };
 };
 const h=harness({loginFactory});
 const initial=await h.center.startMimoLogin({region:'cn'});
 assert.equal(initial.status,'done');
 assert.equal(h.records.size,1,'simulated browser must really stage owned credentials');
 assert.equal(h.cfg.accounts.length,0);
 assert.equal((await h.center.cancelMimoLogin()).status,'canceled');
 assert.equal(h.records.size,0,'cancel must roll back the actual staged MiMo vault record');
 assert.equal((await h.center.pollMimoLogin()).status,'canceled');
 h.center.stop();
});
test('MiMo driver does not mark partial, empty or incomplete model replies as successful real inference',async()=>{
 for(const result of [
  {text:'partial content',finishReason:'length',toolCalls:[]},
  {text:' ',finishReason:'stop',toolCalls:[]},
  {text:'',finishReason:'tool_calls',toolCalls:[]},
 ]){
  const h=harness({chatResult:result});
  const scan=await h.center.discover(MIMO_DESKTOP_ID);
  await h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id);
  const account=h.cfg.accounts[0];
  await h.driver.generate({account,model:'mimo-v2.6-pro',options:{}});
  assert.equal(h.driver.accountSnapshot(account).modelInferenceVerifiedAt,null,
   'model success badge must require a fully completed useful response');
  h.center.stop();
 }
});
test('failed account metadata persistence rolls back newly owned MiMo secret',async()=>{
 const h=harness({rejectReplace:true});
 const scan=await h.center.discover(MIMO_DESKTOP_ID);
 await assert.rejects(()=>h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id),
  /Simulated disk write failure/);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
});
test('stale MiMo Desktop cookies do not become independently owned accounts',async()=>{
 const h=harness({authVerified:false});
 const scan=await h.center.discover(MIMO_DESKTOP_ID);
 assert.equal(scan.candidates.length,1,'read-only scan can show unverified candidate');
 await assert.rejects(()=>h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id),
  /credential is unavailable/);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
 h.center.stop();
});
test('MiMo independent session reading never scans unsupported desktop, never fabricates a candidate',async()=>{
 assert.equal(await readMimoDesktopSession({platform:'linux'}),null);
 const h=harness();h.stopDesktop();
 assert.deepEqual((await h.center.discover(MIMO_DESKTOP_ID)).candidates,[]);
});
test('identical MiMo membership can be imported in distinct regions and routed without cross-account confusion',async()=>{
 const h=harness(),ids=new Set();
 for(const region of ['cn','sgp','ams','ru','in']){
  h.switchDesktopRegion(region);
  const scanned=await h.center.discover(MIMO_DESKTOP_ID);
  assert.equal(scanned.candidates.length,1);
  const imported=await h.center.importCandidate(MIMO_DESKTOP_ID,scanned.candidates[0].id);
  assert.equal(imported.providerId,MIMO_DESKTOP_ID);
  assert(!ids.has(imported.id),'same member identity must not collapse regions');
  ids.add(imported.id);
 }
 assert.equal(h.cfg.accounts.length,5);
 assert.equal(h.records.size,5);
 h.stopDesktop();
 for(const account of h.cfg.accounts){
  assert.equal((await h.driver.refresh({account})).state,'online');
  await h.driver.generate({account,model:'mimo-v2.6-pro',options:{}});
 }
 assert.deepEqual(h.calls.filter(x=>x.kind==='chat').map(x=>x.session.region),
  ['cn','sgp','ams','ru','in']);
 assert.equal(h.readerCalls,10,'no desktop access during runtime after five imports');
 h.center.stop();
});

test('older non-CN rc.29 MiMo imported IDs continue to open their own stored region',async()=>{
 const h=harness(),session={...loggedIn,region:'sgp'};
 const legacyId='sp_'+createHash('sha256').update(
  'dsh-native-router:mimo-desktop\0'+session.userId+'\0'+session.passToken)
  .digest('hex').slice(0,24);
 h.records.set('NATIVE_ROUTER_MIMO_DESKTOP_'+legacyId.slice(3).toUpperCase(),
  {value:JSON.stringify(session)});
 const account={id:legacyId,providerId:MIMO_DESKTOP_ID,
  credentialRef:'driver:'+MIMO_DESKTOP_ID+':'+legacyId};
 assert.equal((await h.driver.refresh({account})).state,'online');
 assert.equal(h.calls.at(-1).session.region,'sgp');
 h.center.stop();
});

test('legacy overseas MiMo account cannot capture a newly authorized CN member',async()=>{
 const h=harness(),older={...loggedIn,region:'sgp'};
 const oldId='sp_'+createHash('sha256').update(
  'dsh-native-router:mimo-desktop\0'+older.userId+'\0'+older.passToken)
  .digest('hex').slice(0,24);
 h.records.set('NATIVE_ROUTER_MIMO_DESKTOP_'+oldId.slice(3).toUpperCase(),
  {value:JSON.stringify(older)});
 h.switchDesktopRegion('cn');
 const scanned=await h.center.discover(MIMO_DESKTOP_ID);
 assert.notEqual(scanned.candidates[0].id,oldId);
 const fresh=await h.center.importCandidate(MIMO_DESKTOP_ID,scanned.candidates[0].id);
 assert.notEqual(fresh.id,oldId);
 assert.equal(h.records.size,2);
 const oldAccount={id:oldId,providerId:MIMO_DESKTOP_ID,
  credentialRef:'driver:'+MIMO_DESKTOP_ID+':'+oldId};
 assert.equal((await h.driver.refresh({account:oldAccount})).state,'online');
 assert.equal((await h.driver.refresh({account:h.cfg.accounts[0]})).state,'online');
 assert.deepEqual(h.calls.filter(x=>x.kind==='auth').slice(-2).map(x=>x.session.region),
  ['sgp','cn']);
 h.center.stop();
});