// Shared read-only presentation rules. This module never performs I/O, persists
// credentials, or infers an account identity from a nickname.
const nameSensitive=/\b(?:bearer|wps_sid|access_token|refresh_token|password|client_secret)\b/i;
const opaqueName=/^(?:sp|pr|wb|ca)_[a-f0-9]{20,}$/i;
const generatedName=/^(?:账号\s*\d+|account\s*#?\d+|id:.+|.+\s*·\s*独立账号)$/iu;
export function publicAccountName(...sources){
  for(const source of sources){    if(!source||typeof source!=='object')continue;
    for(const key of ['displayName','accountName','username','userName','nickname','label']){
      const value=source[key];
      if(typeof value!=='string')continue;
      const name=value.trim();
      if(!name||name.length>120||name===source.id||name===source.accountId||
        nameSensitive.test(name)||opaqueName.test(name)||generatedName.test(name)||
        /^[A-Za-z0-9_.~+-]{48,}$/.test(name))continue;
      if(/^\d{11}$/.test(name))return name.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2');
      return name;    }
  }
  return '';
}
// Only read allowlisted public fields from an exact-account credential.
// Never return the original payload, user ID, token or a plain phone number.
export function credentialPublicIdentity(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {};
  const label=publicAccountName({
    accountName:payload.account_name??payload.user_name??payload.accountName,
    username:payload.username,displayName:payload.display_name,
    nickname:payload.nickname,
  });
  const phone=typeof payload.phone==='string'&&/^\d{11}$/.test(payload.phone)?
    payload.phone.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2'):'';
  return {...(label?{accountName:label}:{}),
    ...(phone?{maskedPhone:phone}:{})};
}
export function publicBalance(...sources){
  for(const source of sources){
    if(!source||typeof source!=='object')continue;
    const amount=source.balance;
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)continue;
    const unit=typeof source.balanceUnit==='string'&&source.balanceUnit.trim().length<=24?
      source.balanceUnit.trim():'';
    const checkedAt=Number.isFinite(source.balanceCheckedAt)&&source.balanceCheckedAt>0?
      source.balanceCheckedAt:Number.isFinite(source.checkedAt)&&source.checkedAt>0?
      source.checkedAt:null;
    return {balance:amount,...(unit?{balanceUnit:unit}:{}),
      ...(checkedAt?{balanceCheckedAt:checkedAt}:{}),balanceState:'available'};
  }
  const state=sources.find(x=>x?.balanceState==='not_supported')?'not_supported':
    sources.find(x=>x?.balanceState==='not_returned')?'not_returned':'not_checked';
  return {balanceState:state};
}
// Explicit upstream day evidence only; date-less historical success is NOT
// today's success. Check-in history is not inferred from a balance change.
export function upstreamCheckedInToday(status,today){
  if(!status||typeof status!=='object'||!/^\d{4}-\d{2}-\d{2}$/.test(today))return null;
  if(status.todayCheckedIn===true)return true;
  const dates=Array.isArray(status.checkinDates)?status.checkinDates:[];
  const claimed=dates.some(row=>typeof row==='string'?row===today:
    row&&row.date===today&&['claimed','completed','success','checked'].includes(
      String(row.status??'claimed').toLowerCase()));
  if(claimed||status.lastCheckinDate===today&&
    ['claimed','already','completed','success'].includes(
      String(status.lastCheckinOutcome??'').toLowerCase()))return true;
  return status.todayCheckedIn===false?false:null;
}
export const CHECKIN_CONFIRMATION_TIMEOUT_MS=20*60*1000;
export function checkinDisplayState({recent,now=Date.now(),pending=false,
  implemented=true,confirmed=false,claimable=false,noTask=false}={}){
  if(pending)return 'running';
  if(confirmed||recent?.state==='success')return 'success';
  if(!implemented)return 'unsupported';
  if(expiredCheckinConfirmation(recent,now))return 'failed';
  if(noTask)return 'no_task';
  if(claimable)return 'not_run';
  return recent?.state??'not_run';
}
export function expiredCheckinConfirmation(recent,now=Date.now()){
  return recent?.state==='pending_confirmation'&&Number.isFinite(recent.at)&&
    now-recent.at>CHECKIN_CONFIRMATION_TIMEOUT_MS;
}
