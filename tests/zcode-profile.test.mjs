import test from 'node:test';
import assert from 'node:assert/strict';
import {readZcodePublicProfile} from '../src/channels/zcode-profile.mjs';
const credential={user_id:'test-subject',zai_access_token:'test-oauth-value'};
test('ZCode profile returns only the exact authorized subject public name',async()=>{
 const value=await readZcodePublicProfile({credential,fetchImpl:async(url,opts)=>{
  assert.equal(url,'https://chat.z.ai/api/oauth/userinfo');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  return new Response(JSON.stringify({sub:'test-subject',name:'Demo user',access_token:'not-returned'}));
 }});assert.deepEqual(value,{accountName:'Demo user'});
});
test('ZCode profile fails closed for wrong subject, missing scoped OAuth token or rejection',async()=>{
 assert.equal(await readZcodePublicProfile({credential,fetchImpl:async()=>new Response(JSON.stringify({sub:'other',name:'Other'}))}),null);
 assert.equal(await readZcodePublicProfile({credential:{user_id:'test-subject'},fetchImpl:async()=>{throw Error('must not call')}}),null);
 assert.equal(await readZcodePublicProfile({credential,fetchImpl:async()=>new Response('',{status:403})}),null);
 assert.equal(await readZcodePublicProfile({credential,fetchImpl:async()=>new Response(JSON.stringify({sub:'test-subject',user_id:'foreign-subject',name:'Wrong user'}))}),null);
 assert.deepEqual(await readZcodePublicProfile({credential,fetchImpl:async()=>new Response(JSON.stringify({sub:'test-subject',user_id:'test-subject',preferred_username:'Real member'}))}),{accountName:'Real member'});
 assert.equal(await readZcodePublicProfile({credential,fetchImpl:async()=>new Response(JSON.stringify({sub:'test-subject',name:'test-subject'}))}),null);
});
