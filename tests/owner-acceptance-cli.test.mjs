import test from 'node:test';
import assert from 'node:assert/strict';
import {requestOwnerAcceptance} from '../tools/owner-acceptance-cli.mjs';
const id='a'.repeat(32);
test('official headless client exchanges only owner-supplied loopback link, then uses cookie on fixed endpoint',async()=>{
 const calls=[];
 const result=await requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=fixture-login',action:'start',
  mode:'channel-activity',channel:'loomy',requestId:id,consent:true,
  fetchImpl:async(url,options)=>{calls.push({url:String(url),options});
   if(calls.length===1)return new Response(null,{status:303,headers:{'set-cookie':'dsh-auth-fixture=synthetic-session; HttpOnly'}});
   return Response.json({ok:true,result:{requestId:id,state:'running',mode:'channel-activity',channel:'loomy',
    accountCount:1,private:'DO_NOT_RETURN',accounts:[{slot:1,providerId:'own_loomy',state:'observed',nickname:'DO_NOT_RETURN'}]}},{status:202});
  }});
 assert.equal(calls.length,2);
 assert.equal(calls[0].options.redirect,'manual');
 assert.equal(calls[1].url,'http://127.0.0.1:4444/api/plugins/dsh-native-router/acceptance');
 assert.equal(calls[1].options.headers.cookie,'dsh-auth-fixture=synthetic-session');
 assert.deepEqual(JSON.parse(calls[1].options.body),{action:'start',requestId:id,mode:'channel-activity',consent:true,channel:'loomy'});
 assert.doesNotMatch(JSON.stringify(result),/synthetic-session|fixture-login|DO_NOT_RETURN/);
});
test('client refuses external destinations, missing consent and rejected authentication before execution',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return new Response(null,{status:401})};
 await assert.rejects(requestOwnerAcceptance({loginLink:'https://example.invalid/?token=x',fetchImpl}));
 await assert.rejects(requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=x',action:'start',mode:'free-models',fetchImpl}));
 assert.equal(calls,0);
 await assert.rejects(requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=x',fetchImpl}));
 assert.equal(calls,1);
});
