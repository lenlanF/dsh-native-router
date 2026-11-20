import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFromCookies} from '../src/channels/doubao-login.mjs';
import {chat} from '../src/channels/doubao-upstream.mjs';

const cookie='sessionid=unit-test-valid-session-1234567; uid_tt=12345678';
const response=body=>new Response(body,{status:200,
 headers:{'content-type':'text/event-stream'}});

test('isolated Doubao CDP rejects look-alike cookie domains and injection',()=>{
 const cookies=[
  {domain:'.doubao.com',name:'sessionid',value:'real-cookie'},
  {domain:'evil-doubao.com',name:'sessionid',value:'stolen-cookie'},
  {domain:'doubao.com.evil.tld',name:'sid_tt',value:'other-stolen'},
  {domain:'.doubao.com',name:'good',value:'bad\r\nInjected:yes'},
  {domain:'sub.doubao.com',name:'ttwid',value:'genuine'},
  {domain:'doubao.com',name:'LARK_SUITE_private',value:'private'},
 ];
 assert.equal(headerFromCookies(cookies),'sessionid=real-cookie; ttwid=genuine');
 assert.equal(headerFromCookies(null),'');
});

test('Doubao model output requires actual SSE_REPLY_END, not partial text',async()=>{
 const text='event: STREAM_MSG_NOTIFY\ndata: {"message":{"content_block":[{"content":{"text_block":{"text":"partial"}}}]}}\n\n';
 await assert.rejects(chat(cookie,{prompt:'hello',modelId:'0',
   fetchImpl:async()=>response(text)}),error=>{
   assert.equal(error.code,'TRUNCATED');return true;
 });
});

test('already cancelled Doubao request never calls upstream',async()=>{
 const controller=new AbortController();controller.abort();
 let calls=0;
 await assert.rejects(chat(cookie,{prompt:'hello',modelId:'0',signal:controller.signal,
   fetchImpl:async()=>{calls++;return response('')}
 }),error=>{assert.equal(error.code,'ABORTED');return true});
 assert.equal(calls,0);
});

test('SSE_REPLY_END without text is not a successful inference',async()=>{
 await assert.rejects(chat(cookie,{prompt:'hello',modelId:'0',
  fetchImpl:async()=>response('event: SSE_REPLY_END\ndata: {}\n\n')
 }),error=>{assert.equal(error.code,'EMPTY_REPLY');return true});
});
