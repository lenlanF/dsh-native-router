import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createConfigStore,normalizeConfig} from '../src/config.mjs';
const COOKIE_A='sessionid=unit-testing-session-account-A-abcdefghijklmn; uid_tt=123456789; sessionid_ss=other123';
const COOKIE_B='sessionid=unit-testing-session-account-B-abcdefghijklmn; uid_tt=987654321; sessionid_ss=other456';

function mock({extraQuota=false,invalidQuota=false,modelUnavailable=false}={}){
 const stored=new Map(),calls=[];
 const vault={
  set:async(k,v)=>{stored.set(k,v)},
  unset:async k=>stored.delete(k),
  resolve:async k=>{if(!stored.has(k))throw Error('missing');return {value:stored.get(k)}},
 };
 const fetchImpl=async(input,opts={})=>{
  const url=new URL(String(input)),cookie=opts.headers?.Cookie??opts.headers?.cookie??'';
  calls.push({path:url.pathname,cookie,body:opts.body,url:String(input)});
  const data=payload=>new Response(JSON.stringify({code:0,data:payload}),{
   status:200,headers:{'content-type':'application/json'}});
  if(url.pathname==='/passport/account/info/v2/')
   return data({user_id_str:cookie.includes('unit-testing-session-account-B')?'user-2':'user-1',
    screen_name:'豆包测试用户'});
   if(url.pathname==='/alice/slot/action_bar_v3/brief_list'&&modelUnavailable)
     return new Response('',{status:503});
   if(url.pathname==='/alice/slot/action_bar_v3/brief_list')
   return data({entry_list:[{action_bar_key:'coco_deep_thinking',active_switch_conf:{
    menu_conf_v2:{model_list:{item_list:[
     {model_item_key:'0',name:'豆包 快速',default_mode:'1',tag_list:[{text:'0.00x'}]},
     {model_item_key:'5',name:'工作任务 Pro',default_mode:'3'}]}}}}]});
   if(url.pathname==='/alice/commerce/sale/subscription/quota/summary/')
    return data({current_subscription:{display:{product_name:'豆包会员'}},
     window_limit_section:{window_limit_groups:[{feature_group_name:'主套餐',
      window_limits:[{window_type:4,total_amount:invalidQuota?'不限':'100',
       used_amount:invalidQuota?'未知':'20',used_percent:20}]}]},
     ...(extraQuota?{incentive_quota_section:{window_limit_groups:[{feature_group_name:'每周',
       window_limits:[{window_type:2,total_amount:'20',used_amount:'8'}]}]}}:{})});
  if(url.pathname==='/alice/user/launch')return data({ug_campaign_info:{campaign_group_code:'daily'}});
  if(url.pathname==='/alice/ug/campaign/v3/detail')return data({campaign_code:'daily',tasks:[{
   task_key:'daily_check_in',task_kind:'daily_signin',checked_in_today:false},
   {campaign_code:'activity-one',task_kind:'share_event',title:'参加积分活动',task_status:0}]});
  if(url.pathname==='/chat/completion'){
   assert.equal(opts.method,'POST');
   const body=JSON.parse(opts.body);
   assert.equal(body.option.model_config.model_item_key,'0');
    return new Response('event: SSE_ACK\ndata: {"ack_client_meta":{"conversation_id":"chat-1"}}\n\n'+
     'event: STREAM_MSG_NOTIFY\ndata: {"message":{"content_block":[{"content":{"text_block":{"text":"豆包原生回答"}}}]}}\n\n'+
     'event: SSE_REPLY_END\ndata: {}\n\n',{
       status:200,headers:{'content-type':'text/event-stream'}});

  }
  throw Error('unexpected Doubao endpoint: '+url.pathname);
 };
 const driver=createDoubaoDriver({vault,fetchImpl});
 return {driver,stored,calls};
}
const account=(receipt)=>({id:receipt.id,providerId:'own_doubao',credentialRef:receipt.credentialRef});
const options={messages:[{role:'user',content:'你好'}]};

test('Doubao member credits and activity refresh survive model catalog outage and never chat',async()=>{
 const {driver,calls}=mock({modelUnavailable:true,extraQuota:true});
 const receipt=await driver.addCookie({cookie:COOKIE_A}),owned=account(receipt);
 const before=calls.length;
 const proof=await driver.refreshAccountStatus({account:owned});
 assert.equal(proof.authVerified,true);
 assert.equal(proof.state,'online');
 const facts=driver.accountSnapshot(owned);
 assert.equal(facts.nickname,'豆包测试用户');
 assert.equal(facts.balance,80);
 assert.equal(facts.quotaWindows.length,2);
 assert.equal(facts.planName,'豆包会员');
 assert.equal(facts.activityTaskCount,1,'non-signin campaign must not be silently ignored');
 assert.equal(facts.activityTaskExecutionState,'requires_verified_executor');
 assert(calls.slice(before).some(x=>x.path==='/alice/ug/campaign/v3/detail'));
 assert.equal(calls.slice(before).filter(x=>x.path==='/alice/slot/action_bar_v3/brief_list').length,0);
 assert.equal(calls.filter(x=>x.path==='/chat/completion').length,0);
 assert.equal((await driver.refresh({account:owned})).state,'online',
  'member account information remains usable even if separately fetched model catalog fails');
});
test('Doubao saved member UID cannot be silently replaced by another login',async()=>{
 const {driver,stored}=mock();
 const receipt=await driver.addCookie({cookie:COOKIE_A}),owned=account(receipt);
 const [key,value]=[...stored][0],doc=JSON.parse(value);
 doc.uid='foreign-member';stored.set(key,JSON.stringify(doc));
 assert.equal((await driver.refreshAccountStatus({account:owned})).state,'expired');
 assert.equal(driver.accountSnapshot(owned).balance,undefined);
});
test('Doubao direct Cookie stays private and each account is bound to itself',async()=>{
 const {driver,stored,calls}=mock();
 const a=await driver.addCookie({cookie:COOKIE_A});
 const b=await driver.addCookie({cookie:COOKIE_B});
 const afterImport=calls.length;
 assert.notEqual(a.id,b.id);
 assert.equal(stored.size,2);
 const status=await driver.refresh({account:account(a)});
 assert.equal(status.state,'online');
 assert.equal(driver.accountSnapshot(account(a)).balance,80);
 const models=await driver.listModels({account:account(a)});
 assert.deepEqual(models.map(x=>x.id),['0']);
 const done=await driver.generate({account:account(a),model:'0',options});
 assert.equal(done.text,'豆包原生回答');
 assert(calls.slice(afterImport).every(x=>!x.cookie||x.cookie.startsWith(COOKIE_A)),
  'no cross-account cookie after independent imports');
 await assert.rejects(driver.generate({account:{...account(a),id:b.id},model:'0',options}),/binding/i);
 await driver.logout({account:account(a)});
 assert.equal(stored.size,1);
});
test('Doubao multiple independent quota windows stay separate and cannot be added as one wallet',async()=>{
 const {driver}=mock({extraQuota:true});
 const receipt=await driver.addCookie({cookie:COOKIE_A});
 const bound=account(receipt);
 assert.equal((await driver.refresh({account:bound})).state,'online');
 const row=driver.accountSnapshot(bound);
 assert.equal(row.nickname,'豆包测试用户');
 assert.equal(row.balance,80,'package quota must stay 80, not 80+12');
 assert.equal(row.balanceUnit,'主套餐');
 assert.equal(row.quotaWindows.length,2);
 assert.deepEqual(row.quotaWindows.map(w=>[w.kind,w.left]),[['package',80],['week',12]]);
 assert.equal(row.planName,'豆包会员');
 assert(Number.isFinite(row.quotaCheckedAt));
});
test('Doubao unknown numeric quota strings do not fabricate zero wallet amount',async()=>{
 const {driver}=mock({invalidQuota:true});
 const receipt=await driver.addCookie({cookie:COOKIE_A});
 const bound=account(receipt);
 assert.equal((await driver.refresh({account:bound})).state,'online');
 const row=driver.accountSnapshot(bound);
 assert.equal(row.quotaWindows.length,0);
 assert.equal(row.balanceState,'not_returned');
 assert.equal('balance' in row,false);
});
test('Doubao independent account provisioning never writes cookies to config',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'router-doubao-test-'));
 try{
  const cfg=createConfigStore({path:join(dir,'config.json')});
  const {driver}=mock();
  const center=createAccountCenter({configStore:cfg,drivers:new Map([['own_doubao',driver]])});
  const result=await center.addDoubaoCookie({cookie:COOKIE_A});
  assert.equal(result.providerId,'own_doubao');
  const serialized=readFileSync(cfg.path,'utf8');
  assert(!serialized.includes('sessionid'));
  assert(serialized.includes('driver:own_doubao'));
  assert.equal(center.ensureDoubaoProvider().state,'existing');
  assert.equal(center.list().accounts.length,1);
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('Doubao direct Cookie import has transaction-bound rollback on config write failure',async()=>{
 let cfg=normalizeConfig({});
 const configStore={get:()=>structuredClone(cfg),replace(){throw Error('Simulated failed metadata write')}};
 const h=mock(),center=createAccountCenter({configStore,drivers:new Map([['own_doubao',h.driver]])});
 await assert.rejects(()=>center.addDoubaoCookie({cookie:COOKIE_A}),/Simulated failed metadata write/);
 assert.equal(h.stored.size,0,'no orphaned private credential after failed metadata commit');
 assert.equal(cfg.accounts.length,0);
 center.stop();
});
test('Doubao stale cancel and unrelated receipt cannot delete committed account',async()=>{
 let cfg=normalizeConfig({});
 const configStore={get:()=>structuredClone(cfg),replace(value){cfg=normalizeConfig(value);return structuredClone(cfg)}};
 const h=mock(),center=createAccountCenter({configStore,drivers:new Map([['own_doubao',h.driver]])});
 const saved=await center.addDoubaoCookie({cookie:COOKIE_A}),key=[...h.stored.keys()][0];
 const original=h.stored.get(key);
 await h.driver.rollbackCandidate({account:{id:saved.id,providerId:'own_doubao',
  credentialRef:'driver:own_doubao:'+saved.id}});
 assert.equal(h.stored.get(key),original);
 const modified=COOKIE_A.replace('account-A-abcdefghijklmn','account-A-rotated-abcdefghijklmn');
 const staged=await h.driver.addCookie({cookie:modified,stageRollback:true});
 assert.equal(staged.id,saved.id);
 assert.notEqual(h.stored.get(key),original);
 await h.driver.rollbackCandidate({account:staged});
 assert.equal(h.stored.get(key),original,'exact rollback journal restores the old committed credential');
 assert.equal(center.list().accounts.length,1);
 center.stop();
});
test('Doubao Provider identity collision never leaves orphaned self-owned credential',async()=>{
 const state=normalizeConfig({});
 state.providers.push({id:'own_doubao',protocol:'openai-chat',name:'Foreign conflicting owner',
  baseUrl:'https://foreign.invalid/v1',models:[],enabled:true});
 const configStore={get:()=>structuredClone(state),
  replace(){throw Error('must not replace a foreign Provider')}};
 const h=mock(),center=createAccountCenter({configStore,
  drivers:new Map([['own_doubao',h.driver]])});
 await assert.rejects(()=>center.addDoubaoCookie({cookie:COOKIE_A}),/provider ID conflict/);
 assert.equal(h.stored.size,0);
 assert.equal(state.accounts.length,0);
 center.stop();
});
test('Doubao cookie injection and fake sessions fail closed',async()=>{
 const {driver}=mock();
 await assert.rejects(driver.addCookie({cookie:'uid_tt=foo'}),/Cookie/i);
 await assert.rejects(driver.addCookie({cookie:'sessionid=foo\r\nAuthorization:Bearer secret'}),/Cookie/i);
});
