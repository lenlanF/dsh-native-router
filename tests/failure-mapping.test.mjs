import test from 'node:test';
import assert from 'node:assert/strict';
import {safeHostFailure,safeDshFailureFacts,classifyFailure,UpstreamError} from '../src/failure.mjs';

test('safe DSH machine-failure adaptation preserves only typed retry status, never upstream secrets',()=>{
 const cases=[
  [{code:'ACCOUNT_QUOTA'},'QUOTA',402],
  [{code:'RATE_LIMIT',retryAfterMs:120000},'RATE_LIMIT',429],
  [{code:'PROVIDER_NOT_READY'},'PROVIDER_NOT_READY',0],
  [{code:'ECONNRESET'},'TRANSPORT',0],
  [{cause:{code:'UND_ERR_SOCKET'}},'TRANSPORT',0],
  [{failure:{code:'SERVER',status:503}},'SERVER',503],
  [{failure:{code:'STREAM_CLOSED'}},'TRUNCATED',0],
  [{code:'BAD_UNKNOWN'},'UPSTREAM',0],
 ];
 for(const [fault,code,status] of cases){
  const err=Object.assign(Error('Bearer PRIVATE_TOKEN, device path C:\\Users\\Hidden'),fault);
  const safe=safeHostFailure(err);
  assert.equal(safe.code,code);
  assert.equal(safe.status,status);
  assert.equal(safe.message,'Original DSH plugin request failed');
  assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_TOKEN|Users|Hidden/);
  assert.equal(safeDshFailureFacts(err).code,code);
 }
});
test('retryable DSH errors use explicit machine evidence and avoid accidental paid/repeated invalid requests',()=>{
 assert.deepEqual(classifyFailure(safeHostFailure({code:'INVALID_REQUEST',status:503})),
  {code:'INVALID_REQUEST',retryable:false,scope:'request'});
 assert.equal(classifyFailure(safeHostFailure({code:'CONTEXT_WINDOW_EXCEEDED',status:503})).retryable,false);
 assert.equal(classifyFailure(safeHostFailure({code:'UNRECOGNIZED',message:'rate limit please'})).retryable,false);
 assert.equal(classifyFailure(safeHostFailure({code:'ACCOUNT_QUOTA'})).code,'QUOTA');
 assert.equal(classifyFailure(safeHostFailure({code:'RATE_LIMIT',retryAfterMs:120000})).cooldownMs,120000);
 assert.equal(safeHostFailure({code:'RATE_LIMIT',retryAfterMs:1e12}).retryAfterMs,86400000);
 assert.equal(classifyFailure(new UpstreamError('gateway timeout',{status:504})).code,'TIMEOUT');
});
