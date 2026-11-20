import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDoubaoDriver} from '../src/channels/doubao.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createConfigStore} from '../src/config.mjs';
const COOKIE_A='sessionid=unit-testing-session-account-A-abcdefghijklmn; uid_tt=123456789; sessionid_ss=other123';
const COOKIE_B='sessionid=unit-testing-session-account-B-abcdefghijklmn; uid_tt=987654321; sessionid_ss=other456';

function mock(){
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
   return data({user_id_str:'user-1',screen_name:'豆包测试用户'});
  if(url.pathname==='/alice/slot/action_bar_v3/brief_list')
   return data({entry_list:[{action_bar_key:'coco_deep_thinking',active_switch_conf:{
    menu_conf_v2:{model_list:{item_list:[
     {model_item_key:'0',name:'豆包 快速',default_mode:'1',tag_list:[{text:'0.00x'}]},
     {model_item_key:'5',name:'工作任务 Pro',default_mode:'3'}]}}}}]});
  if(url.pathname==='/alice/commerce/sale/subscription/quota/summary/')
   return data({window_limit_section:{window_limit_groups:[{feature_group_name:'主套餐',
    window_limits:[{window_type:4,total_amount:'100',used_amount:'20',used_percent:20}]}]}});
  if(url.pathname==='/alice/user/launch')return data({ug_campaign_info:{campaign_group_code:'daily'}});
  if(url.pathname==='/alice/ug/campaign/v3/detail')return data({campaign_code:'daily',tasks:[{
   task_key:'daily_check_in',task_kind:'daily_signin',checked_in_today:false}]});
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

test('Doubao direct Cookie stays private and each account is bound to itself',async()=>{
 const {driver,stored,calls}=mock();
 const a=await driver.addCookie({cookie:COOKIE_A});
 const b=await driver.addCookie({cookie:COOKIE_B});
 assert.notEqual(a.id,b.id);
 assert.equal(stored.size,2);
 const status=await driver.refresh({account:account(a)});
 assert.equal(status.state,'online');
 assert.equal(driver.accountSnapshot(account(a)).balance,80);
 const models=await driver.listModels({account:account(a)});
 assert.deepEqual(models.map(x=>x.id),['0']);
 const done=await driver.generate({account:account(a),model:'0',options});
 assert.equal(done.text,'豆包原生回答');
 assert(calls.every(x=>!x.cookie||x.cookie.startsWith(COOKIE_A)),'no cross-account cookie');
 await assert.rejects(driver.generate({account:{...account(a),id:b.id},model:'0',options}),/binding/i);
 await driver.logout({account:account(a)});
 assert.equal(stored.size,1);
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
test('Doubao cookie injection and fake sessions fail closed',async()=>{
 const {driver}=mock();
 await assert.rejects(driver.addCookie({cookie:'uid_tt=foo'}),/Cookie/i);
 await assert.rejects(driver.addCookie({cookie:'sessionid=foo\r\nAuthorization:Bearer secret'}),/Cookie/i);
});
