import test from 'node:test';
import assert from 'node:assert/strict';
import {startRaccoonAuthorizeFlow,exchangeRaccoonCode,raccoonAuthorizeUrl} from '../src/channels/raccoon-authorize.mjs';
test('Raccoon official browser authorize link has exact loopback callback, no legacy QR',async()=>{
 let calls=0;
 const flow=await startRaccoonAuthorizeFlow({fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'https://xiaohuanxiong.com/api/web/auth/v1/login_with_authorization_code');
  assert.deepEqual(JSON.parse(init.body),{authorization_code:'synthetic-code'});
  return Response.json({code:0,data:{access_token:'fixture-access',refresh_token:'fixture-refresh'}});
 }});
 try{
 const auth=new URL(flow.loginUrl),callback=new URL(auth.searchParams.get('redirect'));
 assert.equal(auth.origin,'https://xiaohuanxiong.com');assert.equal(auth.pathname,'/authorize');
 assert.equal(auth.searchParams.get('appname'),'DSH Native Router');
 assert.equal(callback.hostname,'127.0.0.1');assert.equal(callback.pathname,'/auth/callback');
 callback.searchParams.set('state','a'.repeat(64));callback.searchParams.set('code','synthetic-code');
 assert.equal((await fetch(callback)).status,400);assert.equal(calls,0);
 callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.append('code','duplicate');
 assert.equal((await fetch(callback)).status,400);assert.equal(calls,0);
 callback.searchParams.delete('code');callback.searchParams.set('code','synthetic-code');
 assert.equal((await fetch(callback,{method:'POST'})).status,400);assert.equal(calls,0);
 assert.equal((await fetch(callback,{headers:{origin:'https://wrong.invalid'}})).status,400);
 assert.equal((await fetch(callback)).status,200);
 assert.deepEqual(await flow.result,{access_token:'fixture-access',refresh_token:'fixture-refresh'});assert.equal(calls,1);
 }finally{flow.close()}
});
test('Raccoon refuses expired or incomplete authorization, without leaking body',async()=>{
 await assert.rejects(exchangeRaccoonCode('fixture',{fetchImpl:async()=>Response.json({code:200035,detail:'PRIVATE'},{status:400})}),/code_expired/);
 await assert.rejects(exchangeRaccoonCode('fixture',{fetchImpl:async()=>Response.json({code:0,data:{access_token:'only-access'}})}),/refresh_missing/);
 const flow=await startRaccoonAuthorizeFlow();flow.close();await assert.rejects(flow.result,/closed/);
 assert.throws(()=>raccoonAuthorizeUrl(80,'a'.repeat(64)));
});
