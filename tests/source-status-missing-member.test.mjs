import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {sourceAccountOpaqueId} from '../src/source-account-ref.mjs';
import {createSourceCheckinCenter} from '../src/source-checkins.mjs';
import {sourceModelEligible,privateSourceAccountRoutable} from '../src/source-model-eligibility.mjs';

test('successful read-only source status missing a member removes stale online auth proof immediately',async()=>{
 const id=sourceAccountOpaqueId('loomy','missing-source-member-01');
 let reply=[{accountId:'missing-source-member-01',authVerified:true}];
 const configStore={get:()=>normalizeConfig({
  providers:[{id:'own_loomy',protocol:'native-channel',enabled:true}],
  accounts:[{id,providerId:'own_loomy',
   credentialRef:'driver:own_loomy:'+id,enabled:true}]})};
 const pack={
  listAccounts:async()=>({state:'ready',accounts:[{providerId:'loomy',id:'missing-source-member-01',enabled:true}]}),
  readSourceStatuses:async()=>({state:'ready',accounts:reply})};
 const center=createSourceCheckinCenter({sourcePack:pack,configStore,
  store:{blocked:false,all:()=>[],append:x=>x},
  now:()=>Date.parse('2026-11-21T06:05:00Z')});
 await center.refresh();
 assert.equal(center.snapshot()[0].connectionState,'online');
 const account={id,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id,enabled:true};
 assert.equal(sourceModelEligible('loomy',{sourceRows:center.snapshot()}),true);
 assert.equal(privateSourceAccountRoutable(account,null,
  center.snapshot()[0].connectionState==='online'),true);
 reply=[];await center.refresh({force:true});
 assert.equal(sourceModelEligible('loomy',{sourceRows:center.snapshot()}),false,
  'missing upstream source identity must no longer advertise its models');
 assert.equal(privateSourceAccountRoutable(account,null,
  center.snapshot()[0].connectionState==='online'),false,
  'stale source health must not authorize AutoFree private model generation');
 assert.equal(center.snapshot()[0].connectionState,'not_checked',
  'read-only source responded successfully but omitted this account, so old auth cannot remain online');
 center.stop();
});

test('other active private member remains online after sibling disappears from a complete source status response',async()=>{
 const id1=sourceAccountOpaqueId('loomy','member-one');
 const id2=sourceAccountOpaqueId('loomy','member-two');
 let entries=[{accountId:'member-one',authVerified:true},{accountId:'member-two',authVerified:true}];
 const configStore={get:()=>normalizeConfig({
  providers:[{id:'own_loomy',protocol:'native-channel'}],
  accounts:[{id:id1,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id1},
   {id:id2,providerId:'own_loomy',credentialRef:'driver:own_loomy:'+id2}]})};
 const sourcePack={
  listAccounts:async()=>({state:'ready',accounts:[
   {id:'member-one',providerId:'loomy',enabled:true},
   {id:'member-two',providerId:'loomy',enabled:true}]}),
  readSourceStatuses:async()=>({state:'ready',accounts:entries})};
 const center=createSourceCheckinCenter({sourcePack,configStore,
  store:{blocked:false,all:()=>[],append:x=>x},
  now:()=>Date.parse('2026-11-21T06:05:00Z')});
 await center.refresh();
 assert.equal(center.snapshot().filter(x=>x.connectionState==='online').length,2);
 entries=[{accountId:'member-one',authVerified:true}];
 await center.refresh({force:true});
 const byId=new Map(center.snapshot().map(x=>[x.id,x.connectionState]));
 assert.equal(byId.get(id1),'online');
 assert.equal(byId.get(id2),'not_checked');
 center.stop();
});
