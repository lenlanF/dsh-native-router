import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const bundled=readFileSync(new URL('../vendor/channel-pack/pack-native.js',import.meta.url),'utf8');
const begin=bundled.indexOf('function registerAdapterIdempotent(llm, providers, adapter, warn) {');
const end=bundled.indexOf('// vendor/channel-pack/src/llm-adapter.ts',begin);
assert.ok(begin>=0&&end>begin,'Native registration owner implementation must exist');
// This extracts ONLY the deterministic adapter registration helper, not the
// source-pack application (which would create account stores/HTTP endpoints).
const register=new Function('wrapAdapterWithTokenLedger','withDeadModelPruning',
 'isDuplicateRegistrationError',bundled.slice(begin,end)+'\nreturn registerAdapterIdempotent;')(
 (_providers,adapter)=>adapter,(_providers,adapter)=>adapter,()=>false);
test('pinned source pack never overwrites a host-installed provider, but registers unrelated native login channels',()=>{
 const registered=[{id:'native-router'},{id:'workbuddy'}],writes=[];
 const host={
  listProviders:()=>registered,
  registerAdapter:(ids,adapter)=>{writes.push({ids,adapter});for(const id of ids)registered.push({id})},
 };
 register(host,['workbuddy'],{id:'old-should-not-install'});
 assert.equal(writes.length,0);
 register(host,['loomy'],{id:'source-loomy'});
 assert.deepEqual(writes.map(x=>x.ids),[['loomy']]);
 register(host,['workbuddy','codearts'],{id:'source-codearts'});
 assert.deepEqual(writes.map(x=>x.ids),[['loomy'],['codearts']]);
 assert.equal(registered.filter(x=>x.id==='workbuddy').length,1);
 assert.equal(registered.filter(x=>x.id==='codearts').length,1);
});
test('missing or malformed host provider inventory refuses native bundle adapter registration',()=>{
 let writes=0;
 const host={listProviders:()=>undefined,registerAdapter:()=>{writes++}};
 assert.throws(()=>register(host,['workbuddy'],{}),/Host provider inventory unavailable/);
 assert.equal(writes,0);
});
