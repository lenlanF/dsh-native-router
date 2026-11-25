import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../vendor/channel-pack/pack-native.js',import.meta.url),'utf8');
const extract=(name,next)=>source.slice(source.indexOf('async function '+name+'('),source.indexOf('async function '+next+'('));
const statusFn=extract('fetchLobsteraiCheckinStatus','fetchLoomyCheckinStatus');
const claimFn=extract('claimLobsteraiDailyCheckin','fetchLobsteraiCreditBalance');
const slot={slotState:'available',activityCode:'fixture',configRevision:1};
const readWithRefresh=()=>new Function('isLobsteraiRefreshable',extract('nativeRouterReadLobsterActivityStatus','fetchLobsteraiCheckinStatus')+';return nativeRouterReadLobsterActivityStatus;')(c=>Boolean(c.refresh_token));
function refreshFixture({diagnosticCode='LOBSTER_SLOT_AUTH',changed=false,failed=false,forbiddenAfter=false,eligible=true}={}){
 const entry={id:'fixture-account',credentialRef:'fixture-ref',enabled:true};
 const old={access_token:'fixture-old',refresh_token:'fixture-refresh'};
 let current=changed?{...old,access_token:'fixture-new'}:old,reads=0,refreshes=0;
 const deps={read:async credential=>{reads++;return credential.access_token===old.access_token?{diagnosticCode}:forbiddenAfter?{diagnosticCode:'LOBSTER_SLOT_FORBIDDEN'}:{active:true,claimable:true,todayCheckedIn:false}},
  stillBound:async e=>eligible&&e===entry,resolve:async()=>current,
  refresh:async()=>{refreshes++;if(failed)throw Error('private-fixture');current={...old,access_token:'fixture-new'};return true}};
 return {old,entry,deps,counts:()=>({reads,refreshes})};
}
test('LobsterAI official 401 status triggers one same-account renewal and one read-only retry',async()=>{
 const f=refreshFixture();const result=await readWithRefresh()(f.old,f.entry,f.deps);
 assert.equal(result.claimable,true);assert.deepEqual(f.counts(),{reads:2,refreshes:1});
});
test('LobsterAI 403 is not a token refresh request and an account change blocks renewal',async()=>{
 for(const options of [{diagnosticCode:'LOBSTER_SLOT_FORBIDDEN'},{eligible:false}]){
  const f=refreshFixture(options);const result=await readWithRefresh()(f.old,f.entry,f.deps);
  assert.equal(result.claimable,undefined);assert.deepEqual(f.counts(),{reads:1,refreshes:0});
 }
});
test('LobsterAI uses already rotated credentials, never repeats renewal after rejection, and redacts refresh failures',async()=>{
 const rotated=refreshFixture({changed:true});assert.equal((await readWithRefresh()(rotated.old,rotated.entry,rotated.deps)).claimable,true);assert.deepEqual(rotated.counts(),{reads:2,refreshes:0});
 const denied=refreshFixture({forbiddenAfter:true});assert.equal((await readWithRefresh()(denied.old,denied.entry,denied.deps)).diagnosticCode,'LOBSTER_SLOT_FORBIDDEN');assert.deepEqual(denied.counts(),{reads:2,refreshes:1});
 const failed=refreshFixture({failed:true});const result=await readWithRefresh()(failed.old,failed.entry,failed.deps);assert.equal(result.diagnosticCode,'LOBSTER_SLOT_REFRESH_FAILED');assert.doesNotMatch(JSON.stringify(result),/private-fixture/);assert.deepEqual(failed.counts(),{reads:1,refreshes:1});
});

test('generated LobsterAI status requires exact official check_in permission',async()=>{
 for(const [data,expected] of [
  [{claimedToday:false,actions:[]},{claimable:false}],
  [{claimedToday:false,actions:['check_in']},{claimable:true}],
  [{claimedToday:true,actions:[]},{todayCheckedIn:true,claimable:false}],
  [{actions:['check_in']},{diagnosticCode:'LOBSTER_CONTEXT_SHAPE'}],
  [null,{diagnosticCode:'LOBSTER_CONTEXT_READ'}]
 ]){
  const read=new Function('fetchLobsteraiActivitySlot','fetchLobsteraiActivityContext','sanitizingFetch',statusFn+';return fetchLobsteraiCheckinStatus;')(async()=>slot,async()=>data,()=>{});
  const result=await read({}, {}, 'fixture');
  for(const [k,v] of Object.entries(expected))assert.equal(result[k],v);
 }
});
test('generated LobsterAI claim rejects incomplete context before POST',async()=>{
 const claim=new Function('fetchLobsteraiActivitySlot','fetchLobsteraiActivityContext','sanitizingFetch',claimFn+';return claimLobsteraiDailyCheckin;')(async()=>slot,async()=>({actions:['check_in']}),()=>{throw Error('must not post')});
 assert.equal((await claim({}, {}, 'fixture')).diagnosticCode,'LOBSTER_CONTEXT_SHAPE');
});
test('LobsterAI activity slot diagnostic is preserved without any claim',async()=>{
 for(const diagnosticCode of ['LOBSTER_SLOT_AUTH','LOBSTER_SLOT_LIMIT','LOBSTER_SLOT_ENDPOINT','LOBSTER_SLOT_HTTP','LOBSTER_SLOT_RESPONSE','LOBSTER_SLOT_REJECTED','LOBSTER_SLOT_TRANSPORT']){
  const readSlot=async()=>({diagnosticCode});
  const forbidden=async()=>{throw Error('unexpected context or claim')};
  const status=new Function('fetchLobsteraiActivitySlot','fetchLobsteraiActivityContext','sanitizingFetch',statusFn+';return fetchLobsteraiCheckinStatus;')(readSlot,forbidden,forbidden);
  const claim=new Function('fetchLobsteraiActivitySlot','fetchLobsteraiActivityContext','sanitizingFetch',claimFn+';return claimLobsteraiDailyCheckin;')(readSlot,forbidden,forbidden);
  assert.equal((await status({}, {}, 'fixture')).diagnosticCode,diagnosticCode);
  assert.equal((await claim({}, {}, 'fixture')).diagnosticCode,diagnosticCode);
 }
});
test('generated LobsterAI HTTP reader classifies failures without revealing response bodies',async()=>{
 const start=source.indexOf('async function requestJson2(');
 const end=source.indexOf('function describeNonJsonResponse2(',start);
 const fn=new Function('lobsteraiAuthHeaders','LOBSTERAI_REQUEST_TIMEOUT_MS','UNPARSABLE_RESPONSE_MESSAGE2',source.slice(start,end)+';return requestJson2;')(()=>({}),1000,'invalid');
 for(const [status,code] of [[401,'LOBSTER_SLOT_AUTH'],[403,'LOBSTER_SLOT_FORBIDDEN'],[429,'LOBSTER_SLOT_LIMIT'],[404,'LOBSTER_SLOT_ENDPOINT'],[503,'LOBSTER_SLOT_HTTP']]){
  const result=await fn('https://example.invalid',{}, {},async()=>new Response('private-fixture',{status}));
  assert.equal(result.diagnosticCode,code);assert.doesNotMatch(JSON.stringify(result),/private-fixture/);
 }
 const failed=await fn('https://example.invalid',{}, {},async()=>{throw Error('private-fixture')});
 assert.equal(failed.diagnosticCode,'LOBSTER_SLOT_TRANSPORT');
 assert.doesNotMatch(JSON.stringify(failed),/private-fixture/);
});