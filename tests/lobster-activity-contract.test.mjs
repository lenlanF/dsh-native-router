import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../vendor/channel-pack/pack-native.js',import.meta.url),'utf8');
const extract=(name,next)=>source.slice(source.indexOf('async function '+name+'('),source.indexOf('async function '+next+'('));
const statusFn=extract('fetchLobsteraiCheckinStatus','fetchLoomyCheckinStatus');
const claimFn=extract('claimLobsteraiDailyCheckin','fetchLobsteraiCreditBalance');
const slot={slotState:'available',activityCode:'fixture',configRevision:1};
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
