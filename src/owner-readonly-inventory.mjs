// One-time in-Host official account/model inventory. Read-only: no generation,
// claim, checkin, changes to credentials or external gateway.
const eligibleRate=row=>row?.priceSource==='codearts-official-credit-ratio'
  &&typeof row.costMultiplier==='number'&&Number.isFinite(row.costMultiplier)
  &&row.costMultiplier>=0&&row.costMultiplier<=100;
const workbuddy=new Set(['own_workbuddy-cn','own_workbuddy-global']);
function officialProof(account,status){
  if(status?.authVerified===true&&['ready','online'].includes(status?.state))
    return {authVerified:true,authProofType:'official_account_status'};
  // WorkBuddy's owner-managed driver has no refreshAccountStatus. Its refresh
  // calls signed official model endpoints with the EXACT account credentials
  // and returns online only after HTTP+JSON provider acceptance.
  if(workbuddy.has(account.providerId)&&status?.state==='online')
    return {authVerified:true,authProofType:'workbuddy_signed_remote_catalog'};
  // Independent Lingxi does GET /credits/balance and GET /tasks under a
  // scoped user cookie. A successful state=ready without usable data alone
  // is not enough. Do NOT mistake unknown/pending or a model list for auth.
  if(account.providerId==='own_lingxi'&&status?.state==='ready'
    &&(Number.isFinite(status.balance)&&status.balance>=0
      ||['claimed','claimable'].includes(status.taskStatus)))
    return {authVerified:true,authProofType:'lingxi_official_balance_or_daily_task'};
  return {authVerified:false,authProofType:'unconfirmed'};
}
export async function ownerReadOnlyInventory({account,driver,signal}={}){
  if(!account||!driver||typeof driver.listModels!=='function')
    return {state:'skipped',code:'OFFICIAL_READER_MISSING'};
  const readStatus=typeof driver.refreshAccountStatus==='function'
    ?({account,signal})=>driver.refreshAccountStatus({account,force:true,signal})
    :workbuddy.has(account.providerId)&&typeof driver.refresh==='function'
      ?({account,signal})=>driver.refresh({account,signal}):null;
  if(!readStatus)return {state:'skipped',code:'OFFICIAL_READER_MISSING'};
  if(signal?.aborted)return {state:'skipped',code:'CANCELLED'};
  let status;
  try{status=await readStatus({account,signal})}
  catch{return {state:'observed',code:'OFFICIAL_STATUS_UNAVAILABLE',authVerified:false}}
  if(signal?.aborted)return {state:'skipped',code:'CANCELLED'};
  const {authVerified,authProofType}=officialProof(account,status);
  let models;
  try{models=await driver.listModels({account,signal})}
  catch{return {state:'observed',code:'CATALOG_UNAVAILABLE',authVerified,authProofType}}
  if(signal?.aborted)return {state:'skipped',code:'CANCELLED'};
  if(!Array.isArray(models))return {state:'observed',code:'CATALOG_UNAVAILABLE',
    authVerified,authProofType};
  // Model catalogues may repeat one model through multiple upstream aliases.
  // Aggregate by actual model ID, not by rows or independent free signals.
  // An unknown/missing model ID is never an admissible inference candidate.
  const unique=new Map();
  for(const row of models){
    if(typeof row?.id!=='string'||!row.id.trim()||row.id.length>120)continue;
    const id=row.id.trim();
    const official=eligibleRate(row);
    const zero=official&&row.costMultiplier===0;
    const free=zero||row.freeAllowance==='zcode-start-plan-gift'
      ||row.freeAllowance==='loomy-daily-gift'
      ||row.upstreamFreeLabel===true||row.isFree===true||row.free===true;
    const entry=unique.get(id)??{official:false,zero:false,free:false};
    entry.official||=official;
    entry.zero||=zero;
    entry.free||=free;
    unique.set(id,entry);
  }
  // These are catalogue candidates only; they do not prove a completed model
  // response and never grant authority to bill or auto-claim.
  const entries=[...unique.values()];
  const exactZero=entries.filter(entry=>entry.zero).length;
  const distinctFree=entries.filter(entry=>entry.free).length;
  const result={state:'observed',code:authVerified?'OFFICIAL_ACCOUNT_AND_CATALOG':
    'OFFICIAL_ACCOUNT_UNCONFIRMED',authVerified,authProofType,
    advertisedCount:unique.size,
    officialFreeCandidates:Math.min(1000,distinctFree),
    exactOfficialZeroRateCount:exactZero,
    exactOfficialRateCount:entries.filter(entry=>entry.official).length,
    balanceObserved:status?.balanceState==='available'
      ||account.providerId==='own_lingxi'&&Number.isFinite(status?.balance)
        &&status.balance>=0};
  if(account.providerId==='own_zcode'){
    result.zcodePreviewStartPlans=Number.isInteger(status?.zcodePreviewStartPlans)
      ?status.zcodePreviewStartPlans:null;
    result.zcodeGiftConfirmed=authVerified&&status?.balanceState==='available'
      &&Number.isFinite(status.giftedBalance)&&status.giftedBalance>=1024
      &&[...unique.keys()].some(id=>/^glm[-.]5[-.]3[-.]flash$/i.test(id));
  }
  return result;
}
