import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeConfig} from '../src/config.mjs';
import {createPrivateOwnedAdoption} from '../src/private-owned-adoption.mjs';
import {createPrivateOwnedDriver,PRIVATE_PROVIDERS,ownedPrivateId} from '../src/channels/private-owned.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';

const fakeSourceId=provider=>'local_'+createHash('sha256').update(provider).digest('hex').slice(0,20);
const payloads={
 lingxi:'FAKE_LINGXI_WPS_SID',
 loomy:'FAKE_LOOMY_SESSION',
 'zcode-start-plan':JSON.stringify({zcode_jwt:'FAKE_ZCODE_JWT',device_mid:'FAKE_DEVICE_UUID'}),
};
function response(data,{status=200,contentType='application/json'}={}){
 return new Response(typeof data==='string'?data:JSON.stringify(data),{status,
  headers:{'content-type':contentType}});
}
function loomySse(){
 return [
  'data: '+JSON.stringify({choices:[{index:0,delta:{content:'loomy independent'},
   finish_reason:null}]}),
  'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]}),
  'data: [DONE]',
  '',
 ].join('\n\n');
}
function lingxiSse(){
 return 'data: '+JSON.stringify({code:'Success',choices:[
  {text:'lingxi independent',finish_reason:'stop'}]})+'\n\n';
}
function zcodeSse(){
 const row=[
  {type:'message_start',message:{usage:{input_tokens:2}}},
  {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'zcode independent'}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},
  {type:'message_stop'}
 ];
 return row.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('');
}
function rig(providerId){
 const sourceId=fakeSourceId(providerId),secret=payloads[providerId];
 const map=new Map();
 let cfg=normalizeConfig({});
 const configStore={get:()=>structuredClone(cfg),replace:value=>{
  cfg=normalizeConfig(value);return structuredClone(cfg);
 }};
 let sourceActive=true;
 const inventory={
  async readCredential(provider,account){
   if(!sourceActive||provider!==providerId||account!==sourceId)return null;
   return {providerId,accountId:sourceId,secret};
  },
 };
 const vault={
  async resolve(ref){const token=map.get(ref);return token?{value:token}:undefined},
  async set(ref,value){if(map.has(ref))throw Error('duplicate private ref');map.set(ref,value)},
  async unset(ref){map.delete(ref)},
 };
 const visits=[];
 const fetchImpl=async (url,init={})=>{
  const name=String(url);
  visits.push({url:name,method:init.method??'GET'});
  const credentialHeader=init.headers?.authorization??init.headers?.Authorization;
  if(providerId==='loomy'){
   assert.equal(credentialHeader,'Bearer '+secret);
   if(name.endsWith('/models'))return response({data:[{id:'spark-x2.6'}]});
   if(name.endsWith('/chat/completions'))return response(loomySse(),{
    contentType:'text/event-stream'});
  }
  if(providerId==='lingxi'){
   assert.ok((init.headers?.cookie??'').includes(secret));
   if(name.endsWith('/sessions/plans'))return response({data:{models:[{key:'qwen3.8_flash',name:'Qwen Flash'}],plans:[{id:'agent-mode-not-a-model'}]}});
   if(name.endsWith('/cowork/sessions'))return response({data:{session_id:'session-test'}});
   if(name.endsWith('/credits/runs'))return response({data:{run_id:'run-test'}});
   if(name.endsWith('/chat/completions'))return response(lingxiSse(),{
    contentType:'text/event-stream'});
  }
  if(providerId==='zcode-start-plan'){
   assert.equal(credentialHeader,'Bearer '+JSON.parse(secret).zcode_jwt);
   if(name.endsWith('/v1/messages'))return response(zcodeSse(),{
    contentType:'text/event-stream'});
  }
  throw Error('Unexpected URL from owned driver: '+name);
 };
 const adoption=createPrivateOwnedAdoption({inventory,configStore,vault,
  makeCredentialRef:x=>x});
 const driver=createPrivateOwnedDriver({providerId,vault,makeCredentialRef:x=>x,fetchImpl});
 return {adoption,driver,sourceId,map,visits,vault,configStore,
  get cfg(){return cfg},removeOriginal(){sourceActive=false}};
}
for(const providerId of Object.keys(PRIVATE_PROVIDERS)){
 test('self-owned '+providerId+' model completes after original plugin is removed and no token reaches persisted config',async()=>{
  const r=rig(providerId);
  const missingConsent=await r.adoption.adopt({providerId,accountId:r.sourceId});
  assert.equal(missingConsent.state,'consent_required');
  assert.equal(r.map.size,0);
  const imported=await r.adoption.adopt({providerId,accountId:r.sourceId,consent:true});
  assert.equal(imported.state,'stored_unverified');
  assert.equal(imported.originalUnchanged,true);
  assert.equal(r.cfg.accounts.length,1);
  const ownedId=PRIVATE_PROVIDERS[providerId].ownedId;
  assert.equal(r.cfg.accounts[0].providerId,ownedId);
  assert.equal(r.cfg.providers.find(x=>x.id===ownedId).protocol,'native-channel');
  assert.doesNotMatch(JSON.stringify(r.cfg),/FAKE_LINGXI|FAKE_LOOMY|FAKE_ZCODE|FAKE_DEVICE/);
  assert.equal(r.map.size,1);
  const identity=ownedPrivateId(providerId,r.sourceId);
  assert.equal(r.cfg.accounts[0].id,identity);
  r.removeOriginal();
  const checkedModels=await r.driver.listModels({account:r.cfg.accounts[0]});
  assert.deepEqual(checkedModels.map(m=>m.id),['qwen3.8_flash']);
  const adapter=createNativeRouterAdapter({configStore:r.configStore,
   channelDrivers:new Map([[ownedId,r.driver]]),vault:{
    resolve:async()=>{throw Error('must not read original plugin')}}});
  const catalog=await adapter.listModels();
  const ownRoute='chain:private_'+providerId;
  assert.ok(catalog.some(x=>x.id===ownRoute));
  assert.ok(catalog.some(x=>x.id.startsWith('direct:'+ownedId+':')));
  const tokens=[];
  for await(const event of adapter.stream({model:ownRoute,
    messages:[{role:'user',content:[{type:'text',text:'ping'}]}]})){
   tokens.push(event);
  }
  assert.ok(tokens.some(x=>x.type==='text-delta'&&x.text.includes(' independent')));
  assert.deepEqual(tokens.at(-1),{type:'finish',reason:{kind:'stop'}});
  assert.equal(adapter.getStatus().metrics.successfulTurns,1);
  assert.equal((await r.adoption.adopt({providerId,accountId:r.sourceId,consent:true})).state,
   'already_owned');
  assert.equal(r.map.size,1);
 });
}
test('private adoption fails closed when authorization not found or secrets manager missing',async()=>{
 const r=rig('lingxi');
 r.removeOriginal();
 assert.equal((await r.adoption.adopt({providerId:'lingxi',accountId:r.sourceId,consent:true})).state,
  'source_missing_or_changed');
 assert.equal(r.map.size,0);
 assert.equal((await r.adoption.adopt({providerId:'workbuddy',accountId:r.sourceId,consent:true})).state,
  'unsupported');
 const broken=createPrivateOwnedAdoption({inventory:{readCredential:async()=>null},
  configStore:r.configStore,vault:{resolve:async()=>null},makeCredentialRef:x=>x});
 assert.equal((await broken.adopt({providerId:'lingxi',accountId:r.sourceId,consent:true})).state,
  'credentials_unavailable');
});
