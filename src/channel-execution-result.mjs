// A channel action being accepted is not proof of an official reward credit.
// Summaries are computed only from the public, account-bound DSH snapshots.
// Never surface account identifiers, unverified balances or model responses.
const beijingDay=at=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(at));
const isSameDay=(at,day)=>Number.isSafeInteger(at)&&at>0&&beijingDay(at)===day;
function creditedRewards(row,day,startedAt){
  const inRun=at=>isSameDay(at,day)&&at>=startedAt;
  if(!row||typeof row!=='object')return 0;
  const gifts=(Array.isArray(row.benefits)?row.benefits:[]).filter(offer=>
    offer?.claimed===true&&offer.rewardVerified===true
    &&offer.rewardProof==='official_wallet_delta'
    &&Number.isFinite(offer.credit)&&offer.credit>0
    &&inRun(offer.rewardVerifiedAt)).length;
  const raccoon=String(row.providerId||'').replace(/^own_/,'')==='raccoon'
    &&row.sourceAccount===true
    &&row.activityRewardProof==='official_daily_grant_bill'
    &&Number.isFinite(row.activityRewardAmount)&&row.activityRewardAmount>0
    &&row.activityRewardUnit==='积分'
    &&inRun(row.activityRewardVerifiedAt)?1:0;
  return gifts+raccoon;
}
export function summarizeChannelExecution({before=[],after=[],results=[],today,startedAt=0}={}){
  const day=typeof today==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(today)
    ?today:beijingDay(Date.now());
  const beforeMap=new Map(before.filter(row=>typeof row?.id==='string')
    .map(row=>[row.id,row]));
  const afterMap=new Map(after.filter(row=>typeof row?.id==='string')
    .map(row=>[row.id,row]));
  let confirmedSignins=0,newlyCreditedRewards=0,pendingAccounts=0,
    failedAccounts=0,noTaskAccounts=0,clientRequiredAccounts=0;
  const seen=new Set();
  for(const result of results){
    if(typeof result?.accountId!=='string'||seen.has(result.accountId))continue;
    seen.add(result.accountId);
    const current=afterMap.get(result.accountId);
    const prev=beforeMap.get(result.accountId);
    if(current?.checkinState==='success'&&current.lastConfirmedDate===day)
      confirmedSignins++;
    newlyCreditedRewards+=Math.max(0,creditedRewards(current,day,startedAt)-creditedRewards(prev,day,startedAt));
    const state=result.record?.state??result.state;
    if(state==='pending_confirmation'||result.activities?.state==='pending_confirmation'
      ||Number(result.activities?.pending)>0)pendingAccounts++;
    else if(['failed','unavailable','account_changed','blocked'].includes(state)
      ||['failed','unavailable','blocked'].includes(result.activities?.state))
      failedAccounts++;
    else if(state==='client_required'||result.activities?.state==='client_required')clientRequiredAccounts++;
    else if(['no_task','unsupported','disabled'].includes(state))
      noTaskAccounts++;
  }
  return {attempted:results.length,confirmedSignins,newlyCreditedRewards,
    pendingAccounts,failedAccounts,noTaskAccounts,clientRequiredAccounts,
    verification:'official-receipt-only'};
}
