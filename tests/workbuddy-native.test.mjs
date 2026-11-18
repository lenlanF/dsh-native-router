import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkBuddyDriver} from '../src/channels/workbuddy.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const jwt=(exp,more={})=>'hdr.'+Buffer.from(JSON.stringify({sub:'test-user',exp,...more})).toString('base64url')+'.sig';
const sse=(reply)=>'data: '+JSON.stringify(reply)+'\n\ndata: [DONE]\n\n';
const tools=[{name:'read',description:'read dummy',parameters:{type:'object',properties:{file:{type:'string'}},required:['file']}}];
function fixture(t,{status=200,expiresAt=Date.parse('2026-11-18T10:00:00Z'),domain='www.codebuddy.cn',
  refreshToken='sample-refresh',alias=false,alternate=false,fetchImpl}={}){
 const base=process.platform==='win32'&&existsSync('E:\\Temp')?'E:\\Temp':tmpdir();
 const dir=mkdtempSync(join(base,'dsh-native-wb-test-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const local=join(dir,'AppData','Local'),roaming=join(dir,'AppData','Roaming');
 const folder=join(local,'CodeBuddyExtension','Data','Public','auth');
 mkdirSync(folder,{recursive:true});
 const file=join(folder,'workbuddy-desktop.info');
 const oldToken=jwt(Math.round(expiresAt/1000),{padding:'x'.repeat(300)});
 const authFile={auth:{accessToken:oldToken,refreshToken,expiresAt,lastRefreshTime:Date.parse('2026-11-17T01:00:00Z'),
  uin:'123456',nickname:'虚构验收账号',domain}};
 writeFileSync(file,JSON.stringify(authFile,null,2),'utf8');
 if(alias){writeFileSync(join(folder,'workbuddy-desktop-ai.info'),
   JSON.stringify({...authFile,auth:{...authFile.auth,lastRefreshTime:Date.parse('2026-11-16T01:00:00Z')}}),'utf8')}
 const calls=[];
 const fetchStub=fetchImpl??(async(url,options)=>{
   calls.push({url,method:options.method,headers:options.headers,body:options.body});
   if(url.endsWith('/v3/config'))return new Response(JSON.stringify({code:0,data:{models:[
     {id:'glm-test',name:'GLM Test',supportsToolCall:true},
     {id:'image-only',supportsToolCall:false}]}}),{status,headers:{'content-type':'application/json'}});
   if(url.endsWith('/v2/chat/completions')){
     const payload=JSON.parse(options.body);
     return new Response(sse({choices:[{delta:payload.tools?.length?
       {tool_calls:[{index:0,id:'tool_1',function:{name:'read',arguments:'{"file":"demo.txt"}'}}]}:
       {content:'模型响应已完成'},finish_reason:payload.tools?.length?'tool_calls':'stop'}],
       usage:{prompt_tokens:21,completion_tokens:3,total_tokens:24}}),
       {headers:{'content-type':'text/event-stream'}});
   }
   throw Error('Unexpected WorkBuddy endpoint: '+url);
 });
 const env={USERPROFILE:dir,LOCALAPPDATA:local,APPDATA:roaming};
 const manifestPath=join(dir,'private','sources.json');
 const driver=createWorkBuddyDriver({env,now:()=>Date.parse('2026-11-17T02:00:00Z'),
   manifestPath,fetchImpl:fetchStub,...(alternate?{allowTestEndpoint:()=> 'https://unit-test.example'}:{})});
 let cfg=normalizeConfig({providers:[{id:'workbuddy',name:'WorkBuddy',protocol:'native-channel',models:[]}],
   accounts:[],routes:[]});
 const configStore={path:join(dir,'private','config.json'),get:()=>structuredClone(cfg),
   replace:x=>(cfg=normalizeConfig(x))};
 const drivers=new Map([['workbuddy',driver]]);
 const adapter=createNativeRouterAdapter({configStore,channelDrivers:drivers});
 const center=createAccountCenter({configStore,adapter,drivers});
 return {dir,file,folder,manifestPath,env,oldToken,calls,driver,center,adapter,configStore,
   get cfg(){return cfg}};
}
async function imported(f){
 const found=await f.center.discover('workbuddy');
 assert.equal(found.imported,0);
 assert.equal(found.candidates.length,1);
 const candidate=found.candidates[0];
 const added=await f.center.importCandidate('workbuddy',candidate.id);
 return {candidate,added};
}
test('WorkBuddy discovery reads only authorized fixture auth files; does not leak or write token',async t=>{
 const f=fixture(t,{alias:true});
 const original=readFileSync(f.file,'utf8'),oldHash=hash(original);
 assert.equal(existsSync(f.manifestPath),false);
 const found=await f.driver.discover();
 assert.equal(found.length,1,'newest auth file wins over stale alias');
 assert.ok(found[0].id.startsWith('wb_'));
 assert.equal(found[0].label,'虚构验收账号');
 assert.doesNotMatch(JSON.stringify(found),/accessToken|refreshToken|\.info|sample-refresh|test-user|123456/);
 assert.equal(existsSync(f.manifestPath),false);
 assert.equal(hash(readFileSync(f.file,'utf8')),oldHash);
 assert.ok(f.oldToken.length>180);
});
test('Workbench: discover, explicit consent, disabled import, enable, remote model list and tool calls',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>f.center.importCandidate('workbuddy','wb_'+'0'.repeat(20)),e=>e.status===409);
 const {added}=await imported(f);
 assert.equal(added.enabled,false);
 assert.equal(f.cfg.accounts.length,1);
 const saved=readFileSync(f.manifestPath,'utf8');
 assert.ok(saved.includes('workbuddy-desktop.info'));
 assert.doesNotMatch(saved,/sample-refresh|accessToken|eyJ|\.sig|test-user/);
 assert.equal(f.cfg.accounts[0].autoCheckin,false);
 await assert.rejects(()=>f.center.verify(added.id),e=>e.status===409);
 f.center.setEnabled(added.id,true);
 const verified=await f.center.verify(added.id,{login:true});
 assert.equal(verified.state,'online');
 const list=await f.adapter.listModels();
 assert.ok(list.some(m=>m.id==='direct:workbuddy:glm-test'));
 assert.ok(!list.some(m=>m.id==='direct:workbuddy:image-only'));
 const events=[];
 for await(const event of f.adapter.stream({model:'direct:workbuddy:glm-test',
   messages:[{role:'user',content:'read demo'}],tools}))events.push(event);
 assert.equal(events.some(x=>x.type==='tool-call-delta'),true);
 assert.equal(events.find(x=>x.type==='tool-call-delta').name,'read');
 assert.equal(f.calls.find(c=>c.url.endsWith('/v2/chat/completions')).headers.authorization,'Bearer '+f.oldToken);
 assert.equal(readFileSync(f.file,'utf8').includes(f.oldToken),true);
});
test('Workbench: text completion, read-only desktop auth and local unbind without logging out desktop app',async t=>{
 const f=fixture(t),original=hash(readFileSync(f.file));
 const {added}=await imported(f);f.center.setEnabled(added.id,true);
 // A direct call without a configured chain proves login/session readiness.
 const result=await f.driver.generate({account:f.cfg.accounts[0],model:'glm-test',
   options:{messages:[{role:'user',content:'hello'}]}});
 assert.equal(result.text,'模型响应已完成');
 const removed=await f.center.logout(added.id);
 assert.equal(removed.detached,true);
 assert.equal(removed.revokedUpstream,false);
 assert.equal(f.cfg.accounts.length,0);
 assert.equal(hash(readFileSync(f.file)),original);
});
test('WorkBuddy auth metadata never selects arbitrary off-platform host',async t=>{
 const f=fixture(t,{domain:'https://attacker.invalid'});
 const {added}=await imported(f);f.center.setEnabled(added.id,true);
 assert.equal((await f.center.verify(added.id)).state,'online');
 assert.ok(f.calls.every(c=>c.url.startsWith('https://copilot.tencent.com/')));
});
test('WorkBuddy provider rejects vanished/replaced accounts before network access',async t=>{
 const f=fixture(t);const {added}=await imported(f);f.center.setEnabled(added.id,true);
 writeFileSync(f.file,JSON.stringify({auth:{accessToken:jwt(1790000000),uin:'attacker-account'}}),'utf8');
 await assert.rejects(()=>f.driver.listModels({account:f.cfg.accounts[0]}),/changed; reimport|required/);
 assert.equal(f.calls.length,0);
});
test('WorkBuddy remote unauthorized result is expired, not online',async t=>{
 const f=fixture(t,{status:401,refreshToken:''});
 const {added}=await imported(f);f.center.setEnabled(added.id,true);
 assert.equal((await f.center.verify(added.id)).state,'expired');
});
test('WorkBuddy SSE partial tool call rejects before any DSH event',async t=>{
 const f=fixture(t,{fetchImpl:async(url)=>{
   if(url.endsWith('/v2/chat/completions'))return new Response(
     'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'partial',function:{name:'read',arguments:'{"file":"'}}]}}]})+'\n\n',
     {headers:{'content-type':'text/event-stream'}});
   return new Response(JSON.stringify({data:{models:[{id:'glm-test'}]}}),{status:200});
 }});
 const {added}=await imported(f);f.center.setEnabled(added.id,true);
 await assert.rejects(()=>f.driver.generate({account:f.cfg.accounts[0],model:'glm-test',
   options:{tools,messages:[{role:'user',content:'read'}]}}),e=>e.code==='TRUNCATED');
});
test('WorkBuddy refresh does not overwrite desktop files and caches new token in RAM only',async t=>{
 const old=Date.parse('2026-11-16T12:00:00Z');
 const newAccess=jwt(Math.round(Date.parse('2026-11-18T12:00:00Z')/1000));
 const calls=[];
 const f=fixture(t,{expiresAt:old,fetchImpl:async(url,opts)=>{
   calls.push({url,auth:opts.headers.authorization});
   if(url.endsWith('/v2/plugin/auth/token/refresh'))return new Response(
     JSON.stringify({code:0,data:{accessToken:newAccess,refreshToken:'new-placeholder',expiresIn:7200}}),
     {headers:{'content-type':'application/json'}});
   if(url.endsWith('/v3/config'))return new Response(JSON.stringify({data:{models:[{id:'glm-test'}]}}),
     {headers:{'content-type':'application/json'}});
   throw Error('Unexpected call');
 }});
 const {added}=await imported(f);const original=hash(readFileSync(f.file));
 f.center.setEnabled(added.id,true);
 assert.equal((await f.center.verify(added.id)).state,'online');
 assert.ok(calls.some(x=>x.url.endsWith('/v2/plugin/auth/token/refresh')));
 assert.equal(calls.find(x=>x.url.endsWith('/v3/config')).auth,'Bearer '+newAccess);
 assert.equal(hash(readFileSync(f.file)),original);
 assert.doesNotMatch(readFileSync(f.manifestPath,'utf8'),/new-placeholder/);
});
test('Damaged WorkBuddy metadata refuses to reset the account source manifest',async t=>{
 const f=fixture(t);const {added}=await imported(f);
 writeFileSync(f.manifestPath,'{"version":1,"entries":','utf8');
 await assert.rejects(()=>f.driver.logout({account:{id:added.id,credentialRef:'driver:workbuddy:'+added.id}}),
   /manifest damaged/);
 assert.equal(readFileSync(f.manifestPath,'utf8'),'{"version":1,"entries":');
});

test('Interrupted import reconciles identical source reference without copying credentials',async t=>{
 const f=fixture(t);
 const scanned=await f.driver.discover();
 const id=scanned[0].id;
 const direct=await f.driver.importCandidate({candidateId:id,consent:true});
 assert.equal(direct.id,id);
 assert.equal(f.cfg.accounts.length,0,'simulate process interruption after metadata write');
 const retry=await f.center.discover('workbuddy');
 assert.equal(retry.candidates[0].id,id);
 const added=await f.center.importCandidate('workbuddy',id);
 assert.equal(added.id,id);
 assert.equal(f.cfg.accounts.length,1);
 assert.equal(f.cfg.accounts[0].enabled,false);
 const data=JSON.parse(readFileSync(f.manifestPath,'utf8'));
 assert.equal(Object.keys(data.entries).length,1);
});
