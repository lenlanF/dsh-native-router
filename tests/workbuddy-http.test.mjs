import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createWorkBuddyDriver} from '../src/channels/workbuddy.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

async function fixture(t,{partial=false}={}){
 const base=process.platform==='win32'&&existsSync('E:\\Temp')?'E:\\Temp':tmpdir();
 const root=mkdtempSync(join(base,'dsh-wb-http-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'workbuddy-desktop.info');
 const expiry=Math.round(Date.parse('2030-01-01T00:00:00Z')/1000);
 const token='header.'+Buffer.from(JSON.stringify({sub:'http-test',exp:expiry})).toString('base64url')+'.sig';
 writeFileSync(path,JSON.stringify({auth:{uin:'http-user',accessToken:token,expiresAt:expiry*1000}}));
 const hits=[];
 const server=createServer(async(req,res)=>{
   const chunks=[];
   for await(const piece of req)chunks.push(piece);
   const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null;
   hits.push({url:req.url,authorization:req.headers.authorization,body,headers:req.headers});
   if(req.url==='/v3/config'){
     res.writeHead(200,{'content-type':'application/json'});
     return res.end(JSON.stringify({data:{models:[{id:'glm-http',supportsToolCall:true}]}}));
   }
   if(req.url==='/v2/chat/completions'){
     res.writeHead(200,{'content-type':'text/event-stream'});
     if(partial){
       res.write('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,
         id:'bad-half',function:{name:'read',arguments:'{"file":"'}}]}}]})+'\n\n');
       return res.end();
     }
     res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,
       id:'tool_http',function:{name:'read',arguments:'{"file":"safe.txt"}'}}]},
       finish_reason:'tool_calls'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})
       +'\n\ndata: [DONE]\n\n');
   }
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close()});
 const endpoint='http://127.0.0.1:'+server.address().port;
 const driver=createWorkBuddyDriver({authFiles:[path],manifestPath:join(root,'sources.json'),
   allowTestEndpoint:()=>endpoint,fetchImpl:fetch});
 let current=normalizeConfig({providers:[{id:'workbuddy',name:'WorkBuddy',protocol:'native-channel',models:[]}],accounts:[],routes:[]});
 const store={get:()=>structuredClone(current),replace:value=>(current=normalizeConfig(value))};
 const drivers=new Map([['workbuddy',driver]]);
 const adapter=createNativeRouterAdapter({configStore:store,channelDrivers:drivers});
 const center=createAccountCenter({configStore:store,adapter,drivers});
 const discovered=await center.discover('workbuddy');
 const added=await center.importCandidate('workbuddy',discovered.candidates[0].id);
 center.setEnabled(added.id,true);
 return {hits,token,adapter,driver,store,authPath:path};
}
test('WorkBuddy direct native protocol works over a real loopback HTTP transport',async t=>{
 const r=await fixture(t);
 const models=await r.adapter.listModels();
 assert.ok(models.some(m=>m.id==='direct:workbuddy:glm-http'));
 const events=[];
 for await(const e of r.adapter.stream({model:'direct:workbuddy:glm-http',
   messages:[{role:'user',content:'Read safe.txt'}],
   tools:[{name:'read',parameters:{type:'object',properties:{file:{type:'string'}}}}]}))events.push(e);
 const call=events.find(e=>e.type==='tool-call-delta');
 assert.equal(call.name,'read');
 assert.equal(call.id,'tool_http');
 assert.equal(r.hits.filter(h=>h.url==='/v2/chat/completions').length,1);
 assert.equal(r.hits[0].authorization,'Bearer '+r.token);
 assert.equal(r.hits[1].body.tools[0].function.name,'read');
 assert.equal(r.hits[1].body.stream,true);
 assert.ok(events.some(e=>e.type==='finish'));
});
test('WorkBuddy real HTTP stream lacking DONE rejects partial tool calls without DSH emission',async t=>{
 const r=await fixture(t,{partial:true});
 const events=[];
 await assert.rejects(async()=>{
   for await(const e of r.adapter.stream({model:'direct:workbuddy:glm-http',messages:[{role:'user',content:'Read'}],
     tools:[{name:'read',parameters:{type:'object',properties:{file:{type:'string'}}}}]}))events.push(e);
 },e=>e.code==='TRUNCATED');
 assert.equal(events.some(e=>e.type==='tool-call-delta'),false);
});
