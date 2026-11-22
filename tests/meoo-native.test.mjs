import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeooWebDriver,meooCookieFromCdp,meooModels,meooQuota,MEOO_WEB_ID}
 from '../src/channels/meoo-web.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {runtimeOwnership} from '../src/account-runtime-ownership.mjs';

const COOKIE_A='oneday_sid=demo-member-a-session-123; login_oneday_ticket=demo-member-a-ticket-123; oneday_sid.sig=test-signature';
const COOKIE_B='oneday_sid=demo-member-b-session-456; login_oneday_ticket=demo-member-b-ticket-456';
const streamOf=(text='秒悟回答')=>new Response(
 'data: '+JSON.stringify({type:'ui_event',data:{type:'ui:agent_synthesis_text_delta',data:{text:text.slice(0,2)}}})+'\n\n'+
 'data: '+JSON.stringify({type:'ui_event',data:{type:'ui:add_agent_message',data:{content:text}}})+'\n\n'+
 'data: '+JSON.stringify({type:'task_complete',text})+'\n\n',
 {headers:{'content-type':'text/event-stream'}});
function fixture({anonymous=false,broken=false,failConfig=false,foreignMember=false,changed=false}={}){
 const records=new Map(),calls=[];
 let cfg=normalizeConfig({});
 const vault={
  async resolve(key){return records.get(key)},
  async set(key,value){records.set(key,{value})},
  async unset(key){records.delete(key)},
 };
 const fetchImpl=async(input,opts={})=>{
  const url=new URL(input);
  const cookie=opts.headers?.cookie??'';
  calls.push({path:url.pathname,method:opts.method,cookie,body:opts.body,host:url.host,redirect:opts.redirect});
  assert.equal(url.origin,'https://meoo.com','no session token may be sent to a foreign origin');
  assert.equal(opts.redirect,'manual','upstream redirects must never leak owned Cookies');
  const user=cookie.includes('demo-member-b')?'member-B':'member-A';
  if(url.pathname==='/api/v1/user/me'){
   return new Response(JSON.stringify({code:0,data:anonymous?null:{
    id:foreignMember?'foreign-member':user,username:user==='member-A'?'真实秒悟甲':'真实秒悟乙'}}),
    {status:200,headers:{'content-type':'application/json'}});
  }
  if(url.pathname==='/api/mc/entitlement/get')
   return new Response(JSON.stringify({data:{userPointInfo:{account:{availableBalance:227,totalGranted:300}}}}));
  if(url.pathname==='/api/v1/agent/models')
   return new Response(JSON.stringify({data:{models:[{id:'meoo-quick',name:'秒悟 快速'},
    {id:'meoo-think',name:'秒悟 深思'}]}}));
  if(url.pathname==='/api/v1/project/list')return new Response(JSON.stringify({data:{list:[]}}));
  if(url.pathname==='/api/v1/project')return new Response(JSON.stringify({data:{url_id:'project-owned-123'}}));
  if(url.pathname==='/api/agent/query')return broken?new Response(
    'data: '+JSON.stringify({type:'ui_event',data:{type:'ui:agent_message_update',data:{text:'只有半截'}}})+'\n\n',
    {headers:{'content-type':'text/event-stream'}}):streamOf();
  if(url.pathname==='/api/agent/start'){
   const body=JSON.parse(opts.body??'{}');
   assert.equal(body.projectId,'project-owned-123');
   assert.equal(body.model,'meoo-quick');
   assert.equal(body.extraParams.llmMode,'meoo-quick');
   assert.match(body.message,/你好/);
   return new Response(JSON.stringify({code:0,data:{}}));
  }
  if(url.pathname==='/api/agent/stop')return new Response('{}');
  throw Error('Unexpected upstream request path');
 };
 const driver=createMeooWebDriver({vault,fetchImpl,getAccounts:()=>cfg.accounts,
  loginFactory:options=>({
   busy:false,async start(){return {status:'waiting',at:1}},
   status(){return {status:'idle'}},cancel(){return {status:'canceled'}},
   options,
  })});
 const configStore={get:()=>structuredClone(cfg),replace:value=>{
  if(failConfig)throw Error('Simulated DSH config persistence failure');
  cfg=normalizeConfig(value);return structuredClone(cfg);
 }};
 const center=createAccountCenter({configStore,
  drivers:new Map([[MEOO_WEB_ID,driver]])});
 return {driver,records,calls,center,configStore,get cfg(){return cfg},vault};
}
test('Meoo browser captures only exact signed meoo.com session cookies and rejects forged domains',()=>{
 const rows=[
  {domain:'.meoo.com',name:'oneday_sid',value:'member-session'},
  {domain:'meoo.com',name:'login_oneday_ticket',value:'member-ticket'},
  {domain:'.meoo.com',name:'oneday_sid.sig',value:'owner-sig'},
  {domain:'meoo.com.evil.test',name:'evil',value:'foreign'},
  {domain:'notmeoo.com',name:'oneday_sid',value:'other'},
  {domain:'meoo.com',name:'bad',value:'x\r\nAuthorization: Bearer STOLEN'},
 ];
 const cookie=meooCookieFromCdp(rows);
 assert.match(cookie,/oneday_sid=member-session/);
 assert.match(cookie,/login_oneday_ticket=member-ticket/);
 assert.match(cookie,/oneday_sid\.sig=owner-sig/);
 assert.doesNotMatch(cookie,/evil|other|STOLEN/);
 assert.equal(meooCookieFromCdp(rows.filter(row=>row.name!=='login_oneday_ticket')),'');
 assert.equal(meooCookieFromCdp([{domain:'meoo.com.evil.test',
  name:'login_oneday_ticket',value:'abc'},rows[0]]),'');
});
test('Meoo rejects anonymous HTTP 200 and malformed session before writing any DSH credentials',async()=>{
 const anonymous=fixture({anonymous:true});
 await assert.rejects(()=>anonymous.center.addMeooCookie({cookie:COOKIE_A}),/Meoo Web/);
 assert.equal(anonymous.records.size,0);
 assert.equal(anonymous.cfg.providers.length,0);
 await assert.rejects(()=>anonymous.driver.addCookie({cookie:'oneday_sid=abc'}),
  /Meoo Web/);
 assert.equal(anonymous.calls.filter(x=>x.path==='/api/v1/agent/models').length,0);
 anonymous.center.stop();
});
test('Meoo self-owned UID, credits, dynamic model catalog and full DSH route after original source disappears',async()=>{
 const h=fixture();
 const result=await h.center.addMeooCookie({cookie:COOKIE_A});
 assert.equal(result.providerId,MEOO_WEB_ID);
 assert.equal(h.cfg.providers[0].protocol,'native-channel');
 assert.equal(h.cfg.accounts.length,1);
 const account=h.cfg.accounts[0];
 assert.equal(runtimeOwnership(account),'owned');
 assert.doesNotMatch(JSON.stringify(h.cfg),/demo-member-a|oneday_sid|login_oneday_ticket/);
 assert.equal(h.records.size,1);
 assert.equal((await h.driver.refresh({account})).state,'online');
 assert.equal(h.driver.accountSnapshot(account).balance,227);
 assert.equal(h.driver.accountSnapshot(account).balanceUnit,'积分');
 const models=await h.driver.listModels({account});
 assert.deepEqual(models.map(m=>m.id),['meoo-quick','meoo-think']);
 const adapter=createNativeRouterAdapter({configStore:h.configStore,
   channelDrivers:new Map([[MEOO_WEB_ID,h.driver]])});
 const output=[];
 for await(const event of adapter.stream({model:'direct:own_meoo_web:meoo-quick',
  messages:[{role:'user',content:'你好'}]}))output.push(event);
 assert.equal(output.find(x=>x.type==='text-delta')?.text,'秒悟回答');
 assert.equal(output.at(-1)?.type,'finish');
 assert.equal(h.driver.accountSnapshot(account).modelInferenceVerifiedAt>0,true);
 const calls=h.calls.filter(x=>x.path==='/api/agent/start');
 assert.equal(calls.length,1);
 assert(calls.every(c=>c.cookie.includes('demo-member-a')));
 assert(h.calls.every(c=>c.host==='meoo.com'));
 const dumped=JSON.stringify(output);
 assert.doesNotMatch(dumped,/demo-member-a|login_oneday_ticket|oneday_sid/);
 await h.center.logout(result.id);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
 h.center.stop();
});
test('Meoo users are isolated and rotated sessions retain their own remote user ID',async()=>{
 const h=fixture();
 const a=await h.center.addMeooCookie({cookie:COOKIE_A});
 const b=await h.center.addMeooCookie({cookie:COOKIE_B});
 assert.notEqual(a.id,b.id);
 assert.equal(h.records.size,2);
 const changed=COOKIE_A.replace('demo-member-a-session-123','demo-member-a-rotated');
 const again=await h.center.addMeooCookie({cookie:changed});
 assert.equal(again.id,a.id);
 assert.equal(again.alreadyOwned,true);
 assert.equal(h.records.size,2);
 const all=h.cfg.accounts;
 assert.equal(all.length,2);
 const accB=all.find(x=>x.id===b.id);
 const models=await h.driver.listModels({account:accB});
 assert.equal(models.length,2);
 assert.equal(h.calls.at(-1).cookie.includes('demo-member-b'),true);
 h.center.stop();
});
test('Meoo cancellation restores only the exact staged credentials; new account rollbacks are transactional',async()=>{
 const h=fixture();
 const a=await h.center.addMeooCookie({cookie:COOKIE_A});
 const key=[...h.records.keys()][0],before=h.records.get(key).value;
 const staged=await h.driver.addCookie({cookie:COOKIE_A.replace('demo-member-a-session-123','demo-member-a-other'),
  stageRollback:true});
 assert.equal(staged.alreadyOwned,true);
 assert.equal(typeof staged.rollbackToken,'string');
 await h.driver.rollbackCandidate({account:staged});
 assert.equal(h.records.get(key).value,before);
 const separate=fixture({failConfig:true});
 await assert.rejects(()=>separate.center.addMeooCookie({cookie:COOKIE_A}),
  /Simulated DSH config persistence failure/);
 assert.equal(separate.records.size,0);
 assert.equal(separate.cfg.accounts.length,0);
 h.center.stop();separate.center.stop();
});
test('Meoo stale cancel without active rollback journal never deletes a committed credential',async()=>{
 const h=fixture();
 const result=await h.center.addMeooCookie({cookie:COOKIE_A});
 const key=[...h.records.keys()][0],original=h.records.get(key).value;
 await h.driver.rollbackCandidate({account:{id:result.id,providerId:'own_meoo_web',
  credentialRef:'driver:own_meoo_web:'+result.id}});
 assert.equal(h.records.get(key).value,original);
 assert.equal(h.cfg.accounts.length,1);
 h.center.stop();
});
test('Meoo incomplete SSE never marks real model success and refuses tool calls',async()=>{
 const h=fixture({broken:true});
 const receipt=await h.center.addMeooCookie({cookie:COOKIE_A});
 const account=h.cfg.accounts[0];
 await assert.rejects(()=>h.driver.generate({account,model:'meoo-quick',
  options:{messages:[{role:'user',content:'你好'}]}}),/Meoo Web/);
 assert.equal(h.driver.accountSnapshot(account).modelInferenceVerifiedAt,null);
 await assert.rejects(()=>h.driver.generate({account,model:'meoo-quick',
  options:{messages:[{role:'user',content:'你好'}],
   tools:[{name:'danger',description:'do not call',parameters:{type:'object'}}]}}),/Meoo Web/);
 assert.equal(h.calls.filter(x=>x.path==='/api/agent/start').length,1,
  'rejected tool calls must never incur another metered request');
 h.center.stop();
});
test('Meoo model rows and points never manufacture free credits or treat a public catalog as authentication',()=>{
 assert.deepEqual(meooModels({data:{models:[{id:'quick',name:'快'},{id:'quick'},
  {id:' contains space'},null]}}),[{id:'quick',name:'快'}]);
 assert.equal(meooQuota({data:{userPointInfo:{account:{availableBalance:0}}}}).balance,0);
 assert.equal(meooQuota({data:{}}),null);
});
