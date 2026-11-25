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
test('headless inventory preserves safe quota and catalog state but redacts arbitrary strings',async()=>{
 let calls=0;const r=await requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=fixture-login',fetchImpl:async()=>++calls===1?new Response(null,{status:303,headers:{'set-cookie':'dsh-auth-fixture=synthetic-session'}}):Response.json({ok:true,result:{state:'complete',accounts:[{slot:1,providerId:'own_demo',state:'observed',membershipState:'not_subscribed',usageState:'no_cycle',catalogState:'empty',balanceState:'PRIVATE_FIXTURE'}]}})});
 assert.equal(r.accounts[0].membershipState,'not_subscribed');assert.equal(r.accounts[0].usageState,'no_cycle');assert.equal(r.accounts[0].catalogState,'empty');assert.equal(r.accounts[0].balanceState,'unknown');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_FIXTURE/);
});
test('headless inventory accepts only bounded numeric pricing summaries',async()=>{
 let calls=0;const r=await requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=fixture-login',fetchImpl:async()=>++calls===1?new Response(null,{status:303,headers:{'set-cookie':'dsh-auth-fixture=synthetic-session'}}):Response.json({ok:true,result:{state:'complete',accounts:[{slot:1,providerId:'codearts',state:'observed',knownRateCount:11,zeroRateCount:0,lowestMultiplier:0.003},{slot:2,providerId:'own_demo',state:'observed',lowestMultiplier:'PRIVATE_FIXTURE'}]}})});
 assert.equal(r.accounts[0].knownRateCount,11);assert.equal(r.accounts[0].zeroRateCount,0);assert.equal(r.accounts[0].lowestMultiplier,0.003);assert.equal(r.accounts[1].lowestMultiplier,undefined);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_FIXTURE/);
});
test('client refuses external destinations, missing consent and rejected authentication before execution',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return new Response(null,{status:401})};
 await assert.rejects(requestOwnerAcceptance({loginLink:'https://example.invalid/?token=x',fetchImpl}));
 await assert.rejects(requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=x',action:'start',mode:'free-models',fetchImpl}));
 assert.equal(calls,0);
 await assert.rejects(requestOwnerAcceptance({loginLink:'http://127.0.0.1:4444/?token=x',fetchImpl}));
 assert.equal(calls,1);
});
