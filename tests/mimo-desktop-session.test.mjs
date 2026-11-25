import test from 'node:test';
import assert from 'node:assert/strict';
import {createMimoDesktopSessionTransport} from '../src/channels/mimo-desktop-session.mjs';
const own={region:'cn',passToken:'owner-desktop-private-pass-123',userId:'account-101'};
function fixture({invalidRedirect=false,auth=0,expectedModel='mimo-v2.6-pro',
   membership={planCode:'plus',planTier:2,percent:77.5,nextResetTime:'2026-11-30T00:00:00Z'},
   missingMembership=false,malformedMembership=false,
   allowance={percent:70,resetDate:'2026-12-05'}}={}){
 const calls=[];let handshakes=0;
 const fetchImpl=async(url,init={})=>{
  calls.push({url,init});
  if(url.includes('/pass/serviceLogin')){
   handshakes++;
   assert.match(init.headers.Cookie,/passToken=owner-desktop/);
   return new Response('&&&START&&&'+JSON.stringify({code:0,ssecurity:'test',
    location:invalidRedirect?'https://evil.example.com/secret':'https://account.xiaomi.com/callback?sid=mimopc',
    nonce:111222333444}),{status:200});
  }
  if(url.includes('/callback')){
   assert.equal(init.redirect,'manual');
   assert.equal(init.headers.Cookie,undefined,'signed SSO phase must not send original passToken');
   const headers=new Headers();
   headers.append('set-cookie','serviceToken=private-service-session-123; HttpOnly; Secure');
   headers.append('set-cookie','mimopc_ph=private-ph-12; Secure');
   return new Response('done',{status:200,headers});
  }
  assert.ok(url.startsWith('https://mimo-server-cn.xiaomimimo.com/'));
  assert.equal(init.headers.Cookie?.includes('private-service-session-123'),true);
  assert.equal(init.headers.Cookie?.includes('owner-desktop-private-pass'),false);
   if(url.endsWith('/api/user/xiaomi/me'))
    return new Response(JSON.stringify({code:0,data:{userId:'account-101',nickName:'真实小米账户'}}),{status:200});
   if(url.endsWith('/api/user/xiaomi/subscription/self'))
    return missingMembership?new Response('',{status:404}):
     new Response(JSON.stringify(malformedMembership?{code:0,data:{}}:
       {code:0,data:{current:membership}}),{status:200});
    if(url.endsWith('/api/user/usage'))
      return new Response(JSON.stringify({code:0,data:allowance}),{status:200});
    assert.ok(url.endsWith('/api/route/chat/completions'));
  assert.equal(init.method,'POST');
  assert.equal(JSON.parse(init.body).model,'xiaomi/'+expectedModel);
  if(auth&&handshakes===1)return new Response('',{status:401});
  return new Response('data: '+JSON.stringify({
   choices:[{delta:{content:'MIMO DESKTOP OK'},finish_reason:'stop'}]})
   +'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 return {calls,fetchImpl,transport:createMimoDesktopSessionTransport({fetchImpl}),
  get handshakes(){return handshakes}};
}
test('real Desktop passToken SSO path (mock server) verifies account and performs independent model inference',async()=>{
 const rig=fixture();
 const probe=await rig.transport.probe({session:own});
 assert.equal(probe.state,'online');
 assert.equal(probe.authVerified,true);
 const reply=await rig.transport.generate({session:own,model:'mimo-v2.6-pro',
  options:{messages:[{role:'user',content:'你好'}]}});
 assert.equal(reply.text,'MIMO DESKTOP OK');
 assert.equal(reply.finishReason,'stop');
 assert.equal(rig.handshakes,1,'SSO should be cached for the same adopted account');
 assert.equal(rig.calls.filter(x=>x.url.includes('/api/route/chat/completions')).length,1);
 assert.equal(JSON.stringify(reply).includes(own.passToken),false);
});
test('MiMo model-directory identity probe does not depend on slow quota endpoints',async()=>{
 const rig=fixture();
 const profile=await rig.transport.probe({session:own,includeQuota:false});
 assert.equal(profile.authVerified,true);
 assert.equal(profile.accountName,'真实小米账户');
 assert.equal('membershipState' in profile,false);
 assert.equal('usageState' in profile,false);
 assert.equal(rig.calls.filter(x=>x.url.endsWith('/api/user/xiaomi/me')).length,1);
 assert.equal(rig.calls.filter(x=>x.url.endsWith('/api/user/xiaomi/subscription/self')||x.url.endsWith('/api/user/usage')).length,0);
});
test('MiMo Desktop exposes official member quota separate from API Token Plan',async()=>{
 const rig=fixture();
 const profile=await rig.transport.probe({session:own});
 assert.equal(profile.state,'online');
 assert.equal(profile.accountName,'真实小米账户');
 assert.equal(profile.membershipState,'active');
 assert.equal(profile.membershipPlanName,'plus');
 assert.equal(profile.membershipPercentRemaining,77.5);
 assert.equal(profile.membershipResetAt,Date.parse('2026-11-30T00:00:00Z'));
 assert.equal(profile.balanceState,'not_supported');
 assert(rig.calls.some(c=>c.url.endsWith('/api/user/xiaomi/subscription/self')));
 assert(!rig.calls.some(c=>c.url.includes('token-plan-')||c.url.includes('/v1/platform/')));
});
test('MiMo no active Desktop subscription is not the same as zero API wallet',async()=>{
 const rig=fixture({membership:null});
 const profile=await rig.transport.probe({session:own});
 assert.equal(profile.state,'online');
 assert.equal(profile.membershipState,'not_subscribed');
 assert.equal('membershipPercentRemaining' in profile,false);
 assert.equal('balance' in profile,false);
});
test('MiMo quota API unavailable and null percentage never become a false 0% label',async()=>{
 const unavailable=await fixture({missingMembership:true}).transport.probe({session:own});
 assert.equal(unavailable.state,'online');
 assert.equal(unavailable.membershipState,'not_supported');
 assert.equal('membershipPercentRemaining' in unavailable,false);
 const unknown=await fixture({membership:{planCode:'plus',percent:null}}).transport.probe({session:own});
 assert.equal(unknown.state,'online');
 assert.equal(unknown.membershipState,'active');
 assert.equal('membershipPercentRemaining' in unknown,false);
 const malformed=await fixture({malformedMembership:true}).transport.probe({session:own});
 assert.equal(malformed.state,'online');
 assert.equal(malformed.membershipState,'unavailable');
});
test('MiMo naturally refreshed free seven-day member allowance is visible without a paid API key',async()=>{
 const rig=fixture({membership:null,allowance:{percent:70,resetDate:'2026-12-05'}});
 const profile=await rig.transport.probe({session:own});
 assert.equal(profile.state,'online');
 assert.equal(profile.membershipState,'not_subscribed');
 assert.equal(profile.usageState,'available');
 assert.equal(profile.usagePercentRemaining,70);
 assert.equal(profile.usageResetAt,Date.parse('2026-12-05T00:00:00+08:00'));
 assert(rig.calls.some(x=>x.url.endsWith('/api/user/usage')));
 assert(!rig.calls.some(x=>x.url.includes('/v1/')));
});
test('MiMo free weekly allowance is fetched concurrently despite slow subscription metadata',async()=>{
 const rig=fixture({membership:null,allowance:{percent:84,resetDate:'2026-12-08'}});
 let subscriptionFinished=false,usageStartedBeforeSubscription=false;
 const delayed=async(url,init)=>{
  if(url.endsWith('/api/user/xiaomi/subscription/self')){
   await new Promise(resolve=>setTimeout(resolve,110));
   subscriptionFinished=true;
  }
  if(url.endsWith('/api/user/usage'))
   usageStartedBeforeSubscription=!subscriptionFinished;
  return rig.fetchImpl(url,init);
 };
 const remote=createMimoDesktopSessionTransport({fetchImpl:delayed});
 const info=await remote.probe({session:own});
 assert.equal(info.authVerified,true);
 assert.equal(info.membershipState,'not_subscribed');
 assert.equal(info.usageState,'available');
 assert.equal(info.usagePercentRemaining,84);
 assert.equal(usageStartedBeforeSubscription,true,
  'a slow subscription must not delay or starve seven-day free quota');
});
test('MiMo epoch reset is preserved when formatted reset date is absent',async()=>{
 const resetAt=Date.parse('2026-12-05T00:00:00+08:00');
 const data=await fixture({allowance:{percent:70,resetDate:null,resetAt}}).transport.probe({session:own});
 assert.equal(data.usageState,'available');
 assert.equal(data.usagePercentRemaining,70);
 assert.equal(data.usageResetAt,resetAt);
});
test('MiMo no active cycle is distinct from an actual zero-percent remaining quota',async()=>{
 const free=await fixture({allowance:{percent:100,resetDate:null}}).transport.probe({session:own});
 assert.equal(free.usageState,'no_cycle');
 assert.equal('usagePercentRemaining' in free,false);
 const exhausted=await fixture({allowance:{percent:0,resetDate:'2026-12-05'}}).transport.probe({session:own});
 assert.equal(exhausted.usageState,'available');
 assert.equal(exhausted.usagePercentRemaining,0);
 const malformed=await fixture({allowance:{percent:null,resetDate:'2026-12-05'}}).transport.probe({session:own});
 assert.equal(malformed.usageState,'unavailable');
});
test('all advertised MiMo V2.6 member models use only private desktop session and account-service endpoint',async()=>{
 for(const model of ['mimo-v2.6-pro','mimo-v2.6-flash','mimo-v2.6-pro-ultraspeed']){
  const rig=fixture({expectedModel:model});
  const result=await rig.transport.generate({session:own,model,
   options:{messages:[{role:'user',content:'Hi'}]}});
  assert.equal(result.text,'MIMO DESKTOP OK');
  assert.equal(rig.handshakes,1);
  assert.ok(rig.calls.every(call=>
    new URL(call.url).hostname==='account.xiaomi.com'||
    new URL(call.url).hostname==='mimo-server-cn.xiaomimimo.com'));
  assert.equal(rig.calls.some(x=>x.url.includes('api.xiaomimimo.com/v1')),false,
   'cloud API key endpoint is forbidden for membership login');
 }
 const invalid=fixture();
 await assert.rejects(()=>invalid.transport.generate({session:own,model:'mimo-x-pro-preview'}),
  e=>e.code==='MODEL');
 assert.equal(invalid.calls.length,0,'retired preview cannot consume a member request');
});
test('Desktop SSO never follows arbitrary challenge redirect with credentials',async()=>{
 const rig=fixture({invalidRedirect:true});
 await assert.rejects(()=>rig.transport.generate({session:own,model:'mimo-v2.6-pro',
  options:{messages:[{role:'user',content:'hi'}]}}),/MiMo Desktop session/);
 assert.equal(rig.calls.length,1);
});
test('MiMo Desktop 401 invalidates session cookie and independently retries SSO once',async()=>{
 const rig=fixture({auth:401});
 const result=await rig.transport.generate({session:own,model:'mimo-v2.6-pro',
  options:{messages:[{role:'user',content:'hi'}]}});
 assert.equal(result.text,'MIMO DESKTOP OK');
 assert.equal(rig.handshakes,2);
});
test('invalid secret, unknown model and incomplete SSE fail without releasing partial content',async()=>{
 const rig=fixture();
 await assert.rejects(()=>rig.transport.generate({session:{...own,passToken:'bad\r\nInjected'},model:'mimo-v2.6-pro'}));
 await assert.rejects(()=>rig.transport.generate({session:own,model:'other',
  options:{messages:[{role:'user',content:'hi'}]}}));
 assert.equal(rig.calls.length,0);
 const noDone=createMimoDesktopSessionTransport({fetchImpl:async(url,init)=>{
  if(url.includes('serviceLogin'))return new Response('&&&START&&&'+JSON.stringify({code:0,ssecurity:'a',
   nonce:123,location:'https://account.xiaomi.com/callback'}));
  if(url.includes('callback'))return new Response('',{headers:{'set-cookie':'serviceToken=x'}});
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:'partial'},finish_reason:'stop'}]})+'\n\n',
   {headers:{'content-type':'text/event-stream'}});
 }});
 await assert.rejects(()=>noDone.generate({session:own,model:'mimo-v2.6-pro',
  options:{messages:[{role:'user',content:'hi'}]}}),/MiMo Desktop session|DONE/);
});