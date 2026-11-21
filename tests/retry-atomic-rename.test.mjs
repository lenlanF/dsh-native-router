import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAtomicRename} from '../src/retry-atomic-rename.mjs';
test('atomic replace retries short Windows sharing locks then succeeds',()=>{
 let attempts=0;const waits=[];
 retryAtomicRename('tmp','target',{rename:(a,b)=>{
  assert.equal(a,'tmp');assert.equal(b,'target');
  attempts++;if(attempts<4)throw Object.assign(Error('sharing lock'),{code:'EPERM'});
 },sleep:ms=>waits.push(ms)});
 assert.equal(attempts,4);assert.deepEqual(waits,[30,60,120]);
});
test('atomic replace fails closed after bounded attempts',()=>{
 let attempts=0;
 assert.throws(()=>retryAtomicRename('tmp','target',{rename:()=>{
  attempts++;throw Object.assign(Error('busy'),{code:'EBUSY'});
 },sleep:()=>{}}),{code:'EBUSY'});
 assert.equal(attempts,4);
});
test('atomic replace does not retry permanent IO errors',()=>{
 let attempts=0;
 assert.throws(()=>retryAtomicRename('tmp','target',{rename:()=>{
  attempts++;throw Object.assign(Error('missing'),{code:'ENOENT'});
 },sleep:()=>{}}),{code:'ENOENT'});
 assert.equal(attempts,1);
});
