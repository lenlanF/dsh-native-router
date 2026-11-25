import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateOwnedDriver} from '../src/channels/private-owned.mjs';

const id='pr_'+'c'.repeat(28);
const account={providerId:'own_lingxi',id,credentialRef:'driver:own_lingxi:'+id,enabled:true};
function rig({kdocs401=false,profileFailure=false,creditFailure=false,taskFailure=false,badProfileCode=false,creditData={total_balance:230,bonus_credits:[],purchased_credits:[]}}={}){
 const seen=[],mutations=[];
 const fetchImpl=async(url,opt={})=>{
  const u=new URL(String(url)),path=u.pathname;
  const method=opt.method??'GET';
  seen.push({host:u.host,path,method});
  if(method!=='GET'){mutations.push(path);throw Error('no POST allowed in read-only refresh')}
  if(u.hostname==='lingxi.kdocs.cn'&&kdocs401)
   return new Response('{}',{status:401});
  const ok=data=>new Response(JSON.stringify({code:'Success',data}),{status:200});
  if(path==='/api/public/v1/account/profile')
   return profileFailure?new Response('{}',{status:503})
    :badProfileCode?new Response(JSON.stringify({code:'UserUnauthorized',
       data:{id:'spoofed-id',name:'虚假的用户名'}}),{status:200})
    :ok({id:'official-wps-user-id',name:'官方 Lingxi 账号名'});
  if(path==='/api/aioffice/v1/sessions/plans')
   return ok({models:[{key:'official-free-flash',name:'Official Flash',multiplier:'x0.00'}]});
  if(path==='/api/public/v1/credits/balance')
   return creditFailure?new Response('{}',{status:503})
    :ok(creditData);
  if(path==='/api/public/v1/tasks')
   return taskFailure?new Response('{}',{status:503})
    :ok({tasks:[{task_key:'daily_check_in',status:'claimable'}]});
  throw Error('unrecognized Lingxi account endpoint '+path);
 };
 const driver=createPrivateOwnedDriver({providerId:'lingxi',
  vault:{resolve:async()=>({value:'SYNTHETIC-WPS-SESSION'})},
  fetchImpl,makeCredentialRef:x=>x});
 return {driver,seen,mutations};
}
test('official Lingxi account/profile GET hydrates real account name and authenticated balance without tasks POST',async()=>{
 const {driver,seen,mutations}=rig();
 const facts=await driver.refreshAccountStatus({account,force:true});
 assert.equal(facts.state,'ready');
 assert.equal(facts.authVerified,true,'official account identity plus credits is auth proof');
 assert.equal(facts.nickname,'官方 Lingxi 账号名');
 assert.equal(facts.balance,230);
 assert.equal(driver.accountSnapshot(account).nickname,'官方 Lingxi 账号名');
 assert.equal(seen.filter(x=>x.path.endsWith('/account/profile')).length,1);
 assert.equal(mutations.length,0);
 assert.doesNotMatch(JSON.stringify(facts),/SYNTHETIC-WPS-SESSION|official-wps-user-id/);
});
test('Lingxi account reads fall back from kdocs 401 to wps for the same credential, never conflate 401 with revoked login',async()=>{
 const {driver,seen}=rig({kdocs401:true});
 const facts=await driver.refreshAccountStatus({account,force:true});
 assert.equal(facts.state,'ready');
 assert.equal(facts.authVerified,true);
 assert.equal(facts.nickname,'官方 Lingxi 账号名');
 assert.equal(facts.balance,230);
 assert.ok(seen.some(x=>x.host==='lingxi.kdocs.cn'));
 assert.ok(seen.some(x=>x.host==='lingxi.wps.cn'));
});
test('Lingxi account model catalog reads the same official two-cluster identity without mutating creds',async()=>{
 const {driver,seen,mutations}=rig({kdocs401:true});
 const models=await driver.listModels({account});
 assert.deepEqual(models.map(m=>m.id),['official-free-flash']);
 assert.equal(models[0].upstreamFreeLabel,true);
 assert.ok(seen.some(x=>x.host==='lingxi.kdocs.cn'&&
   x.path==='/api/aioffice/v1/sessions/plans'));
 assert.ok(seen.some(x=>x.host==='lingxi.wps.cn'&&
   x.path==='/api/aioffice/v1/sessions/plans'));
 assert.equal(mutations.length,0);
});
test('Lingxi HTTP200 unauthorized profile cannot forge an identity even if credits remain valid',async()=>{
 const {driver}=rig({badProfileCode:true});
 const facts=await driver.refreshAccountStatus({account,force:true});
 assert.equal(facts.balance,230);
 assert.equal(facts.nickname,undefined);
 assert.equal(facts.authVerified,true,'wallet remains separately authenticated');
});
test('Lingxi profile unavailable does not destroy independently verified credits, name is not fabricated',async()=>{
 const {driver}=rig({profileFailure:true});
 const facts=await driver.refreshAccountStatus({account,force:true});
 assert.equal(facts.state,'ready');
 assert.equal(facts.balance,230);
 assert.equal(facts.authVerified,true);
 assert.equal(facts.nickname,undefined);
});
test('Lingxi profile alone confirms identity but does not fabricate credit or completed sign-in',async()=>{
 const {driver,mutations}=rig({creditFailure:true,taskFailure:true});
 const facts=await driver.refreshAccountStatus({account,force:true});
 assert.equal(facts.state,'ready');
 assert.equal(facts.authVerified,true);
 assert.equal(facts.nickname,'官方 Lingxi 账号名');
 assert.equal(facts.balance,undefined);
 assert.equal(facts.checkinOutcome,'unknown');
 assert.equal(mutations.length,0);
});
test('Lingxi official wallet refresh exposes separate bonus and non-gift balance, not a zero multiplier',async()=>{
 const {driver,mutations}=rig({creditData:{total_balance:230,bonus_credits:[{balance:100,expire_time:new Date(Date.now()+86400000).toISOString()}],purchased_credits:[{balance:130}]}});
 const row=await driver.refreshAccountStatus({account,force:true});assert.equal(row.giftedBalance,100);assert.equal(row.ordinaryBalance,130);assert.equal(row.giftRouteState,'cost_bound_unverified');assert.equal(mutations.length,0);
});
