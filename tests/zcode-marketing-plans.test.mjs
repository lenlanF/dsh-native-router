import test from 'node:test';
import assert from 'node:assert/strict';
import {parseZcodeMarketingPlans,mergeZcodeClaimablePlans} from '../src/zcode-marketing-plans.mjs';

const envelope=deliveries=>({code:0,data:{server_time:1793369478,language:'zh-CN',deliveries}});
const start='zcode-v3-start-plan-1030-wk';
const button=id=>({action:{type:'claim_zcode_plan',args:{plan_id:id}}});
const banner=(id=start)=>({campaign_id:'test',priority:50,resource_position:'banner',
 banner:{buttons:[{action:{type:'close'}},button(id)],
  background:{type:'bundle',args:{zcode_plan:{plan_id:id,name:'ZCode gift',
    priority:101,entitlements:[{show_name:'GLM-5.3-Flash',unit_type:'token',
      grant_units:500000000}]}}}}});
test('marketing reader extracts official explicit Start Plan banner and no other actions',()=>{
 const rows=parseZcodeMarketingPlans(envelope([banner(),{resource_position:'popup',
  popup:{buttons:[{action:{type:'open_url',args:{url:'https://elsewhere'}}}]}}]));
 assert.deepEqual(rows,[{planId:start,priority:101,name:'ZCode gift',
   grantUnits:500000000,unitType:'token'}]);
 assert.equal(JSON.stringify(rows).includes('campaign_id'),false);
});
test('marketing reader requires matching plan ID and does not trust arbitrary campaign text',()=>{
 const mismatched=banner();mismatched.banner.buttons=[button('zcode-v3-start-plan-other')];
 const invalid=banner();invalid.banner.buttons=[button('coding-plan-paid')];
 const arbitrary={resource_position:'banner',banner:{buttons:[{action:{type:'copy_text',
    args:{text:start}}}],background:{args:{zcode_plan:{plan_id:start}}}}};
 assert.deepEqual(parseZcodeMarketingPlans(envelope([mismatched,invalid,arbitrary])),[]);
});
test('popup and duplicate banners deduplicate plan and retain exact unknown grant provenance',()=>{
 const raw=envelope([{resource_position:'popup',popup:{
  buttons:[button('zcode-v3-start-plan-popup')],
  hero:{args:{zcode_plan:{plan_id:'zcode-v3-start-plan-popup',name:'More trial'}}}}},banner()]);
 const rows=parseZcodeMarketingPlans(raw);
 assert.equal(rows.length,2);
 assert.equal(rows[0].planId,start);
 assert.deepEqual(rows[1],{planId:'zcode-v3-start-plan-popup',priority:0,name:'More trial'});
 assert.deepEqual(mergeZcodeClaimablePlans(rows,rows),rows);
});
test('preview and marketing merge only Start Plan entitlements, never a purchased account package',()=>{
 const rows=mergeZcodeClaimablePlans([{planId:start,priority:2,amount:10},
   {planId:'paid-premium-monthly'}],[{planId:start,priority:8},
   {planId:'zcode-v3-start-plan-later',priority:4}]);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.find(row=>row.planId===start),{planId:start,priority:2,amount:10});
});
test('failed marketing and preview are unknown, not a confirmed empty list',()=>{
 assert.equal(parseZcodeMarketingPlans({code:401,data:{deliveries:[]}}),null);
 assert.equal(parseZcodeMarketingPlans({code:0,data:{}}),null);
 assert.equal(mergeZcodeClaimablePlans(null,null),null);
 assert.equal(mergeZcodeClaimablePlans([],null),null);
 assert.deepEqual(mergeZcodeClaimablePlans(null,[],{marketingAuthoritative:true}),[],
   'official modern marketing feed proves empty even if deprecated preview is unavailable');
 assert.deepEqual(mergeZcodeClaimablePlans([],[],{marketingAuthoritative:true}),[]);
 assert.equal(mergeZcodeClaimablePlans(null,[]),null);
 assert.deepEqual(mergeZcodeClaimablePlans([],[]),[]);
 assert.equal(mergeZcodeClaimablePlans([{planId:'paid'}],null),null);
 assert.equal(mergeZcodeClaimablePlans(null,[{planId:start}])[0].planId,start);
});
test('parser bounds invalid shape and skips unsafe ID or mismatched metadata',()=>{
 assert.equal(parseZcodeMarketingPlans(envelope(Array(33).fill(null))),null);
 assert.deepEqual(parseZcodeMarketingPlans(envelope([banner('../../../etc/passwd')])),[]);
 assert.deepEqual(parseZcodeMarketingPlans(envelope([banner('zcode-v3-start-plan-'+('x'.repeat(200)))])),[]);
 const stale=banner();stale.banner.background.args.zcode_plan.entitlements[0].unit_type='credit';
 assert.equal(parseZcodeMarketingPlans(envelope([stale]))[0].grantUnits,undefined);
});
