import test from 'node:test';
import assert from 'node:assert/strict';
import {createAwsQuickDriver,AWS_QUICK_ID} from '../src/channels/aws-quick.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {startFakeQuick} from './helpers/aws-quick-fake-quick.mjs';

function createRig(server,{wrongMember=false,quotaUnavailable=false,invalid=0}={}){
 const records=new Map(),calls=[];
 let cfg=normalizeConfig({});
 const vault={
  async resolve(k){if(!records.has(k))throw Error('Missing');return {value:records.get(k)}},
  async set(k,v){records.set(k,v)},
  async unset(k){records.delete(k)},
 };
 const respond=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(input,init={})=>{
  const url=new URL(String(input));
  calls.push({host:url.host,path:url.pathname,method:init.method,
   authorizationPresent:!!init.headers?.Authorization});
  if(url.pathname.endsWith('/integration/quick-work/user-info')){
   assert.equal(init.method,'POST');
   assert.equal(init.headers?.Authorization,'Bearer access-token-fixture-0123456');
   if(invalid)return respond({message:'Unauthorized'},401);
   return respond({email:wrongMember?'foreign@example.com':'quick-owner@example.com',
    displayName:'Quick Personal',userArn:'arn:aws:quicksight:us-east-1:123456789012:user/test/quick-owner',
    awsAccountId:'123456789012'});
  }
  if(url.pathname.endsWith('/integration/quick-work/qbs-event')){
   assert.equal(init.method,'POST');
   assert.equal(JSON.parse(init.body).eventType,'getAvailableEntitlementUnits');
   if(quotaUnavailable)return respond({errorMessage:'quota out'},503);
   return respond({eventResponse:{getAvailableEntitlementUnitsResponse:{
    entitlements:[{unitType:'AGENT',numMinsProvisioned:600,
      numMinsAvailable:180,overageAllowed:false}],
    subscriptionMetadata:{subscriptionType:'QUICK_LITE',
      freeTrialMetadata:{status:'ACTIVE',expiryDate:1893456000000}}}}});
  }
  throw Error('Unexpected external request '+url.pathname);
 };
 const session={
  provider:'social',stage:'prod',
  tenant_url:'http://127.0.0.1:'+server.port,
  ws_host:server.wsHost,
  actor_arn:'arn:aws:quicksight:us-east-1:123456789012:user/test/quick-owner',
  aws_account_id:'123456789012',email:'quick-owner@example.com',
  jwt:'id-token-fixture-012345678901',
  usable_until:Math.floor(Date.now()/1000)+3600,
  tokens:{access_token:'access-token-fixture-0123456',
   refresh_token:'refresh-token-fixture-0123456',
   id_token:'id-token-fixture-012345678901'},
  client:{client_id:'public-client-1',client_secret:'synthetic-test',
   issuer_url:'https://oidc.us-east-1.amazonaws.com'},
  user_info:{email:'quick-owner@example.com',
   user_arn:'arn:aws:quicksight:us-east-1:123456789012:user/test/quick-owner',
   aws_account_id:'123456789012',display_name:'Quick Personal'},
 };
 const driver=createAwsQuickDriver({vault,fetchImpl,allowTestLoopback:true,
  getAccounts:()=>cfg.accounts});
 const configStore={get:()=>structuredClone(cfg),replace(value){
  cfg=normalizeConfig(value);return structuredClone(cfg);
 }};
 const center=createAccountCenter({configStore,drivers:new Map([[AWS_QUICK_ID,driver]])});
 return {driver,records,calls,session,center,configStore,
  get cfg(){return cfg}};
}
const own=r=>({id:r.id,providerId:AWS_QUICK_ID,credentialRef:r.credentialRef});
test('Amazon Quick MIT protocol creates a self-owned member and does a full genuine fake-bidi WebSocket turn without Magpie or outpost',async()=>{
 const fake=await startFakeQuick();
 const r=createRig(fake);
 try{
  const receipt=await r.driver.stageSession(r.session);
  assert.equal(receipt.providerId,AWS_QUICK_ID);
  assert.match(receipt.id,/^aq_[a-f0-9]{28}$/);
  assert.equal(r.records.size,1);
  const account=own(receipt);
  const member=await r.driver.refreshAccountStatus({account});
  assert.equal(member.state,'online');
  assert.equal(member.authVerified,true);
  const facts=r.driver.accountSnapshot(account);
  assert.equal(facts.accountName,'Quick Personal');
  assert.equal(facts.balance,3,'180 minutes is 3 remaining member hours');
  assert.equal(facts.balanceUnit,'h');
  assert.equal(facts.quotaWindows[0].total,10);
  const catalog=await r.driver.listModels({account});
  assert.deepEqual(catalog.map(x=>x.id),['fast','balanced','smart','advanced']);
  assert(catalog.every(x=>!('billingRate' in x)));
  const result=await r.driver.generate({account,model:'fast',
   options:{messages:[{role:'user',content:'Hi Quick'}]}});
  assert.match(result.text,/echo:/);
  assert.equal(result.finishReason,'stop');
  assert(result.usage?.completion_tokens>0);
  assert.equal(fake.state.userMessages.length,1);
  assert.equal(fake.state.userMessages[0].payload.agent_mode,'fast');
  assert.equal(r.driver.accountSnapshot(account).modelInferenceVerifiedModel,'fast');
  assert.equal(r.calls.filter(x=>x.path.includes('/chat/completions')).length,0);
  await r.driver.logout({account});
  assert.equal(r.records.size,0);
  await assert.rejects(r.driver.generate({account,model:'fast',
   options:{messages:[{role:'user',content:'Again'}]}}),/Amazon Quick/i);
 }finally{await r.driver.dispose();r.center.stop();await fake.close()}
});
test('Amazon Quick existing login is once adopted into DSH and routed through the real native DSH adapter',async()=>{
 const fake=await startFakeQuick(),r=createRig(fake);
 try{
  const staged=await r.driver.stageSession(r.session,{stageRollback:true});
  const saved=await r.center.commitAwsQuickAccount(staged);
  assert.equal(saved.stored,true);
  assert.equal(r.cfg.providers[0].id,AWS_QUICK_ID);
  assert.equal(r.cfg.providers[0].protocol,'native-channel');
  assert.equal(r.cfg.accounts.length,1);
  assert.doesNotMatch(JSON.stringify(r.cfg),/access-token|refresh-token|id-token|quick-owner@example.com/);
  assert.equal((await r.center.verify(saved.id)).state,'online');
  const adapter=createNativeRouterAdapter({configStore:r.configStore,
   channelDrivers:new Map([[AWS_QUICK_ID,r.driver]])});
  const events=[];
  for await(const e of adapter.stream({model:'direct:own_aws_quick:fast',
   messages:[{role:'user',content:'Hello'}]}))events.push(e);
  assert.equal(events.at(-1)?.type,'finish');
  assert.equal(events.some(e=>e.type==='text-delta'&&/echo/.test(e.text)),true);
  assert.equal(r.center.list().accounts[0].nickname,'Quick Personal');
  await r.center.logout(saved.id);
  assert.equal(r.records.size,0);
  assert.equal(r.cfg.accounts.length,0);
 }finally{await r.driver.dispose();r.center.stop();await fake.close()}
});
test('Amazon Quick identity switch and forged tenant are rejected before retaining any member secret',async()=>{
 const fake=await startFakeQuick(),r=createRig(fake,{wrongMember:true});
 try{
  await assert.rejects(r.driver.stageSession(r.session),/Amazon Quick/);
  assert.equal(r.records.size,0);
  const bad={...r.session,tenant_url:'https://evil.example.org',
   ws_host:'evil.example.org'};
  await assert.rejects(r.driver.stageSession(bad),/Amazon Quick/);
  assert.equal(r.records.size,0);
 }finally{await r.driver.dispose();r.center.stop();await fake.close()}
});
test('Amazon Quick quota outage is not a fabricated zero balance or false logout',async()=>{
 const fake=await startFakeQuick(),r=createRig(fake,{quotaUnavailable:true});
 try{
  const receipt=await r.driver.stageSession(r.session);
  const status=await r.driver.refreshAccountStatus({account:own(receipt)});
  assert.equal(status.authVerified,true);
  const facts=r.driver.accountSnapshot(own(receipt));
  assert.equal(facts.balanceState,'unavailable');
  assert.equal('balance' in facts,false);
 }finally{await r.driver.dispose();r.center.stop();await fake.close()}
});
test('Amazon Quick transaction rollback is exact and stale cancel cannot delete an already committed account',async()=>{
 const fake=await startFakeQuick(),r=createRig(fake);
 try{
  const saved=await r.driver.stageSession(r.session,{stageRollback:true});
  await r.center.commitAwsQuickAccount(saved);
  await r.driver.rollbackCandidate({account:saved});
  assert.equal(r.records.size,1,'completed receipt is no longer authorized to roll back');
  const next=await r.driver.stageSession({...r.session,display_name:'Other Label'},
   {stageRollback:true});
  await r.driver.rollbackCandidate({account:{...next,rollbackToken:'unknown'}});
  assert.equal(r.records.size,1,'unrelated receipt never revokes credentials');
 }finally{await r.driver.dispose();r.center.stop();await fake.close()}
});
