import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeConfig} from '../src/config.mjs';
import {createPrivatePackAdoption} from '../src/private-pack-adoption.mjs';
import {createSourceChannelDriver} from '../src/source-channel-driver.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';

function fixture(original){
 const provider=original==='loomy'?'loomy':'zcode',own='own_'+provider;
 const accountId='local_'+createHash('sha256').update(original).digest('hex').slice(0,20);
 const session=original==='loomy'
  ?JSON.stringify({access_token:'FAKE_LOOMY_SECRET',userid:'mock-user'})
  :JSON.stringify({zcode_jwt:'FAKE_ZCODE_JWT',device_mid:'FAKE_UUID'});
 let cfg=normalizeConfig({embeddedPack:{enabled:true},providers:[
  {id:original,name:original,protocol:'dsh-host',models:[provider==='loomy'?'spark-x2.6':'GLM-5.3-Flash']}],
  routes:[{id:'existing',name:'Existing',mode:'priority',
   tiers:[{providerId:original,model:provider==='loomy'?'spark-x2.6':'GLM-5.3-Flash'}]}]});
 const configStore={get:()=>structuredClone(cfg),replace:value=>(cfg=normalizeConfig(value))};
 const rows=[],stored=new Map(),writes=[];
 const credentials={
  resolve:async key=>stored.has(key)?{value:stored.get(key)}:undefined,
  set:async(key,value)=>{assert.equal(stored.has(key),false);stored.set(key,value);writes.push('credential')},
  unset:async key=>stored.delete(key),
 };
 const pool={store:{kind:'file'},listAllAccounts:async()=>[...rows],
  addAccount:async row=>{rows.push(row);writes.push('account')}};
 let originalRunning=true;
 let originalAvailable=true;
 const inventory={readCredential:async(_provider,_account)=>{
  if(!originalAvailable||_provider!==original||_account!==accountId)return null;
  return {providerId:original,accountId,secret:session};
 }};
 const ownPack={
  status:()=>({state:'mounted',skippedProviders:originalRunning?[provider]:[],
   channels:originalRunning?[]:[provider]}),
  ownedAdoptionContext:()=>({pool,credentials}),
  listAccounts:async()=>({state:'ready',accounts:rows.map(row=>({
   id:row.id,providerId:row.provider,nickname:row.nickname,enabled:row.enabled}))}),
  listModels:async() =>({state:'ready',models:[{
   id:provider==='loomy'?'spark-x2.6':'GLM-5.3-Flash'}]}),
  streamNative:async arg=>{
   assert.equal(arg.providerId,provider);
   assert.equal(rows.length,1);
   assert.equal(stored.get(rows[0].credentialRef).includes(original==='loomy'?'FAKE_LOOMY_SECRET':'FAKE_ZCODE_JWT'),true);
   async function* stream(){
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text:'upstream MIT '+provider};
    yield {type:'block-end',index:0};
    yield {type:'finish',reason:{kind:'stop'}};
   }
   return stream();
  },
 };
 const adoption=createPrivatePackAdoption({inventory,configStore,ownedPack:ownPack,makeCredentialRef:x=>x});
 return {original,provider,own,accountId,inventory,stored,rows,writes,adoption,
  pack:ownPack,configStore,get cfg(){return cfg},
  stopOriginal(){originalRunning=false;originalAvailable=false}};
}
for(const original of ['loomy','zcode-start-plan']){
 test(original+' owner-approved migration uses pinned MIT channel pack after original plugin removal',async()=>{
  const f=fixture(original);
  assert.equal((await f.adoption.adopt({providerId:original,accountId:f.accountId})).state,'consent_required');
  assert.equal(f.writes.length,0);
  const first=await f.adoption.adopt({providerId:original,accountId:f.accountId,consent:true});
  assert.equal(first.state,'stored_unverified');
  assert.equal(first.activation,'requires_original_stop_and_host_restart');
  assert.equal(f.writes.length,2);
  assert.equal(f.rows.length,1);
  assert.equal(f.rows[0].provider,f.provider);
  assert.equal(f.cfg.accounts[0].providerId,f.own);
  assert.doesNotMatch(JSON.stringify(f.cfg),/FAKE_LOOMY_SECRET|FAKE_ZCODE_JWT|FAKE_UUID/);
  assert.deepEqual(f.cfg.providers.map(x=>x.id),[original,f.own]);
  assert.equal(f.cfg.routes.find(x=>x.id==='existing').tiers.length,2);
  const driver=createSourceChannelDriver({providerId:f.provider,accountProviderId:f.own,embeddedPack:f.pack});
  assert.equal(driver.runtimeReady,false);
  f.stopOriginal();
  assert.equal(driver.runtimeReady,true);
  const router=createNativeRouterAdapter({configStore:f.configStore,
   channelDrivers:new Map([[f.own,driver]]),vault:{resolve:()=>{throw Error('Original vault must not be used')}}});
  assert.ok((await router.listModels()).some(x=>x.id==='chain:owned_'+f.provider));
  const events=[];
  for await(const event of router.stream({model:'chain:owned_'+f.provider,
   messages:[{role:'user',content:[{type:'text',text:'test'}]}]}))events.push(event);
  assert.ok(events.some(x=>x.type==='text-delta'&&x.text.includes('MIT '+f.provider)));
  assert.equal(router.getStatus().metrics.successfulTurns,1);
  assert.equal((await f.adoption.adopt({providerId:original,accountId:f.accountId,consent:true})).state,'already_owned');
  assert.equal(f.writes.length,2);
 });
}
