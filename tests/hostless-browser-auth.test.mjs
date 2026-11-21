import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCandidates,assertIsolatedCdpEndpoint} from '../src/channels/browser-login.mjs';
import {createMimoDesktopLoginFlow,MIMO_LOGIN_REGIONS} from '../src/channels/mimo-desktop-login.mjs';

test('independent sign-in never launches any original MiMo or DoubaoWork client, on any OS',()=>{
 for(const platform of ['win32','darwin','linux']){
  const candidates=browserCandidates(platform,{
   PROGRAMFILES:'D:\\Program\\Program Files',LOCALAPPDATA:'E:\\Temp'});
  assert(candidates.length>0);
  for(const path of candidates){
   assert.doesNotMatch(path,/xiaomi mimo|doubao|workbuddy|codearts|loomy|zcode|lingxi/i);
   assert.match(path,/chrome|chromium|edge|brave/i);
  }
 }
});
test('isolated membership login never sends CDP commands to a foreign debugger port',()=>{
 assert.equal(assertIsolatedCdpEndpoint('ws://127.0.0.1:38123/devtools/page/abc-001',38123),true);
 assert.equal(assertIsolatedCdpEndpoint('ws://localhost:38123/devtools/page/xyz',38123),true);
 for(const endpoint of [
  'ws://127.0.0.1:12345/devtools/page/abc',
  'ws://192.168.68.24:38123/devtools/page/abc',
  'wss://127.0.0.1:38123/devtools/page/abc',
  'ws://127.0.0.1:38123/devtools/browser/abc',
  'ws://127.0.0.1:38123/devtools/page/abc?session=unknown',
   'ws://127.0.0.1:38123@evil.example.invalid/devtools/page/abc', ]){
  assert.throws(()=>assertIsolatedCdpEndpoint(endpoint,38123));
 }
});
test('MiMo regions only open Xiaomi-owned HTTPS URLs, never local client endpoints',async()=>{
 for(const url of Object.values(MIMO_LOGIN_REGIONS)){
  const target=new URL(url);
  assert.equal(target.protocol,'https:');
  assert.match(target.hostname,/^mimo-server-(cn|sgp|ams|ru|in)\.xiaomimimo\.com$/);
  assert.equal(target.port,'');
 }
 const flow=createMimoDesktopLoginFlow({onSession:async()=>({id:'sp_test'}),
  flowFactory:({loginUrl,addAccount})=>({
   busy:false,
   start:async()=>({status:'waiting',loginUrl}),
   status:()=>({status:'waiting'}),cancel:()=>({status:'canceled'}),
  })});
 const status=await flow.start({region:'cn'});
 assert.equal(status.loginUrl,MIMO_LOGIN_REGIONS.cn);
});
