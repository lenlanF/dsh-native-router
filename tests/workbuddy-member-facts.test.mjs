import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkBuddyMemberReader,parseWorkBuddyCredits,
 parseWorkBuddyProfile,parseWorkBuddyBenefit,workBuddyBillingBase
} from '../src/channels/workbuddy-members.mjs';

const valid={access:'header.payload.sig',refresh:'private',
 accountId:'uin-1',uid:'member-1',domain:'www.workbuddy.cn'};
const payload=x=>new Response(JSON.stringify({code:0,data:x}),{status:200,
 headers:{'content-type':'application/json'}});
const personal=()=>({Response:{Data:{Accounts:[
 {CapacityType:4,PackageName:'月基础积分',
  CycleCapacitySizePrecise:'500.00',CapacityRemainPrecise:'500.00',
  CycleCapacityRemainPrecise:'81.23',CycleEndTime:'2026-11-30T23:59:59Z'},
 {CapacityType:1,PackageName:'活动赠送积分',
  CapacitySizePrecise:'100.0',CycleCapacityRemainPrecise:'40.75',
  ExpiredTime:'2026-12-05T00:00:00Z'}
]}}});
test('WorkBuddy personal billing uses exact cycle balances, not misleading pool capacity',()=>{
 const info=parseWorkBuddyCredits({data:personal()},{now:Date.parse('2026-11-23T00:00:00Z')});
 assert.equal(info.balance,121.98);
 assert.equal(info.balanceUnit,'积分');
 assert.deepEqual(info.quotaWindows.map(w=>w.left),[81.23,40.75]);
 assert.equal(info.quotaWindows[0].kind,'monthly');
 assert.equal(info.quotaWindows[0].endAt,Date.parse('2026-12-01T00:00:00Z'));
 assert.equal(info.quotaWindows[1].kind,'grant');
 assert.equal(info.expiringPoints,undefined,'eight-day-out gifts are not due within seven days');
 const approaching=parseWorkBuddyCredits({data:personal()},{now:Date.parse('2026-11-27T00:00:00Z')});
 assert.equal(approaching.expiringPoints,81.23,'only officially dated near-expiry credits aggregate');
 assert.equal(approaching.expiringAt,Date.parse('2026-12-01T00:00:00Z'));
 const later=parseWorkBuddyCredits({data:personal()},{now:Date.parse('2026-11-29T00:00:00Z')});
 assert.equal(later.expiringPoints,121.98,'when both expire within seven days count each wallet bucket once');
});
test('WorkBuddy enterprise usage reads limit minus USED credit, never empty personal balance',()=>{
 const info=parseWorkBuddyCredits({data:{Data:{limitNum:5000,credit:1234,
  cycleResetTime:'2026-12-01T00:00:00Z'}}},{enterprise:true});
 assert.equal(info.balance,3766);
 assert.equal(info.quotaWindows[0].left,3766);
 assert.equal(info.quotaWindows[0].total,5000);
 assert.equal(info.quotaWindows[0].used,1234);
 assert.equal(parseWorkBuddyCredits({data:personal()},{enterprise:true}),null);
});
test('WorkBuddy confirmed empty personal package differs from unreadable and enterprise',()=>{
 const empty=parseWorkBuddyCredits({data:{Response:{Data:{Accounts:[]}}}});
 assert.equal(empty.balance,0);
 assert.equal(empty.quotaState,'no_active_package');
 assert.equal(parseWorkBuddyCredits({data:{Response:{Data:{Accounts:[{
  CapacityType:4,CycleCapacityRemainPrecise:'unknown'}]}}}}),null);
});
test('WorkBuddy profile enforces exact UID binding and masks a phone login',()=>{
 assert.deepEqual(parseWorkBuddyProfile({data:{uid:'member-1',nickname:'工作账号昵称'}},valid),
  {accountName:'工作账号昵称',authVerified:true});
 assert.deepEqual(parseWorkBuddyProfile({data:{uid:'another-person',nickname:'别人的名字'}},valid),{});
 assert.equal(parseWorkBuddyProfile({data:{uid:'member-1',
  preferred_username:'13812345678'}},valid).accountName,'138****5678');
});
test('WorkBuddy credit readers route personal, enterprise and owner domains correctly',async()=>{
 assert.equal(workBuddyBillingBase({domain:'www.codebuddy.ai'},'global'),'https://www.codebuddy.ai');
 assert.equal(workBuddyBillingBase({domain:'attacker.invalid'},'global'),'https://www.workbuddy.ai');
 const requests=[];
 const reader=createWorkBuddyMemberReader({now:()=>Date.parse('2026-11-23T00:00:00Z'),
  fetchImpl:async(url,options)=>{
   requests.push({url,options});
   if(url.endsWith('/v2/plugin/account'))return payload({uid:'member-1',nickname:'独立官方名称'});
   if(url.endsWith('/v2/billing/meter/get-user-resource'))
    return payload(personal());
   if(url.endsWith('/billing/meter/compensation-status'))
    return payload({active:true,claimed:false,credit_num:600});
   if(url.endsWith('/billing/meter/check-gift-claimed'))
    return payload({active:false,claimed:false});
   if(url.endsWith('/billing/meter/claim-compensation'))
    return payload({});
   throw Error('Unexpected endpoint');
  }});
 const [profile,credits,benefits]=await Promise.all([
  reader.profile(valid,'cn'),reader.credits(valid,'cn'),reader.benefits(valid,'cn'),
 ]);
 assert.equal(profile.accountName,'独立官方名称');
 assert.equal(credits.balance,121.98);
 assert.equal(benefits.filter(x=>x.active&&!x.claimed).length,1);
 assert(requests.every(x=>x.options.headers.authorization==='Bearer '+valid.access));
 assert(requests.every(x=>x.options.headers['x-user-id']==='member-1'),
  'billing requires the official UID, not the unrelated UIN');
 assert(requests.every(x=>x.options.headers['x-product']==='WorkBuddy'));
 assert(requests.every(x=>x.options.headers['x-ide-version']==='5.8.3'));
 assert(requests.every(x=>x.options.headers['accept-language']==='zh-CN'));
 assert.equal(requests.filter(x=>x.options.method==='POST').length,3);
 assert.equal(requests.filter(x=>x.url.includes('/claim-')).length,0,
  'read-only account refresh cannot claim a promotion');
 assert(requests.every(x=>x.url.startsWith('https://www.codebuddy.cn/')));
});
test('WorkBuddy activity claim requires live eligible status and verifies post-claim',async()=>{
 let claimed=false,posts=0;
 const reader=createWorkBuddyMemberReader({fetchImpl:async(url,options)=>{
  if(url.endsWith('/billing/meter/compensation-status'))
   return payload({active:true,claimed,credit_num:200});
  if(url.endsWith('/billing/meter/check-gift-claimed'))
   return payload({active:false,claimed:false});
  if(url.endsWith('/billing/meter/claim-compensation')){claimed=true;posts++;return payload({})}
  throw Error('Unexpected endpoint');
 }});
 assert.equal((await reader.claimBenefit(valid,'cn','compensation')).confirmed,true);
 assert.equal((await reader.claimBenefit(valid,'cn','compensation')).state,'no_task');
 assert.equal(posts,1);
 await assert.rejects(reader.claimBenefit({...valid,enterprise:'team-1'},'cn','compensation'));
});
test('WorkBuddy benefit parsing never treats missing active/claimed as claimable',()=>{
 assert.equal(parseWorkBuddyBenefit({data:{active:true}},'gift'),null);
 assert.deepEqual(parseWorkBuddyBenefit({data:{active:true,claimed:false,credit_num:80}},'gift'),
  {kind:'gift',active:true,claimed:false,credit:80});
});

test('WorkBuddy never reports an expired monthly cycle or partial wallet as current total',()=>{
 const now=Date.parse('2026-11-25T00:00:00Z');const expired={CapacityType:4,CycleCapacityRemainPrecise:'500',CycleEndTime:'2026-11-24T00:00:00Z'};
 const active={CapacityType:1,CapacityRemainPrecise:'80',ExpiredTime:'2026-12-01T00:00:00Z'};
 assert.equal(parseWorkBuddyCredits({data:{Response:{Data:{Accounts:[expired,active]}}}},{now}),null);
 assert.equal(parseWorkBuddyCredits({data:{Response:{Data:{Accounts:[active,{CapacityType:1,CapacityRemainPrecise:'unknown'}]}}}},{now}),null);
 const allExpired=parseWorkBuddyCredits({data:{Response:{Data:{Accounts:[{...active,ExpiredTime:'2026-11-24T00:00:00Z'}]}}}},{now});assert.equal(allExpired.balance,0);assert.equal(allExpired.quotaState,'no_active_package');
});
test('WorkBuddy coded benefit and purchased package classify even without translated labels',()=>{
 const now=Date.parse('2026-11-28T04:00:00Z');
 const read=Accounts=>parseWorkBuddyCredits({data:{Accounts}},{now});
 const row=(PackageCode,CapacityRemain,extra={})=>({PackageCode,CapacityType:1,CapacityRemain,ExpiredTime:'2026-12-01 00:00:00',...extra});
 const gift=row('TCACA_code_007_nzdH5h4Nl0',35),paid=row('TCACA_code_009_0XmEQc2xOf',70);
 const r=read([gift,paid]);
 assert.equal(r.giftedBalance,35);assert.equal(r.ordinaryBalance,70);assert.equal(r.giftCreditState,'verified');
 assert.equal(r.giftExpiresAt,Date.parse('2026-11-30T16:00:00Z'));assert.equal(r.giftRouteState,'cost_bound_unverified');
 const conflicting=read([{...gift,PackageName:'充值积分'},paid]);
 assert.equal(conflicting.giftedBalance,0);assert.equal(conflicting.unclassifiedBalance,35);
 const near=read([{...gift,DeductionEndTime:String(now-1000)},paid]);
 assert.equal(near.balance,70);assert.equal(near.giftedBalance,0);
});
test('WorkBuddy explicit daily slice takes its own remaining balance, not the parent cycle amount',()=>{
 const now=Date.parse('2026-11-28T04:00:00Z');
 const row={CapacityType:4,PackageName:'月基础积分',CycleCapacityRemainPrecise:500,CycleCapacitySizePrecise:500,CycleEndTime:'2026-11-30 23:59:59',SlicePeriodUsageDetails:[{SlicePeriodStartTime:'2026-11-28 00:00:00',SlicePeriodEndTime:'2026-11-28 23:59:59',SlicePeriodCapacitySizePrecise:100,SlicePeriodCapacityRemainPrecise:12}]};
 const read=Accounts=>parseWorkBuddyCredits({data:{Accounts}},{now});
 const r=read([row]);assert.equal(r.balance,12);assert.equal(r.quotaWindows[0].kind,'daily');assert.equal(r.quotaWindows[0].endAt,Date.parse('2026-11-28T16:00:00Z'));
 assert.equal(r.expiringPoints,undefined,'daily renewal is shown separately from expiring gift credits');
 assert.equal(read([{...row,SlicePeriodUsageDetails:[{...row.SlicePeriodUsageDetails[0],SlicePeriodCapacityRemainPrecise:null}]}]),null);
 assert.equal(read([{...row,SlicePeriodUsageDetails:[...row.SlicePeriodUsageDetails,...row.SlicePeriodUsageDetails]}]),null);
});
