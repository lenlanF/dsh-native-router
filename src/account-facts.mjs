// Shared read-only presentation rules. This module never performs I/O, persists
// credentials, or infers an account identity from a nickname.
const nameSensitive=/\b(?:bearer|wps_sid|access_token|refresh_token|password|client_secret)\b/i;
const opaqueName=/^(?:sp|pr|wb|ca)_[a-f0-9]{20,}$/i;
const generatedName=/^(?:账号\s*#?\s*\d+|account\s*#?\s*\d+|id:.+|.+\s*[·•-]\s*(?:独立账号|本机账号\s*#?\d+|来源账号)|.+\s*本机账号\s*#?\d+|.+\s*账号\s*#?\d+|.+\s+来源账号)$/iu;
export function publicAccountName(...sources){
  for(const source of sources){
     if(!source||typeof source!=='object')continue;
     for(const key of ['displayName','display_name','nickname','nickName','nick_name','screenName','accountName','account_name','username','userName','user_name','preferred_username','loginName','login_name','accountLogin','login','email','name','accountLabel','account_label','label']){
      const value=source[key];
      if(typeof value!=='string')continue;
      const name=value.trim();
       if(!name||name.length>120||[source.id,source.accountId,source.account_id,source.userId,source.user_id,source.sub,source.uid].some(id=>typeof id==='string'&&name===id.trim())||
        nameSensitive.test(name)||opaqueName.test(name)||generatedName.test(name)||/^设备(?:\s|[:：]|[a-f0-9])/i.test(name)||
        /^[A-Za-z0-9_.~+-]{48,}$/.test(name))continue;
      if(/^\d{11}$/.test(name))return name.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2');
      return name;
    }  }
  return '';
}
// Only read allowlisted public fields from an exact-account credential.
// Never return the original payload, user ID, token or a plain phone number.
export function publicMaskedPhone(...sources){
  return sources.map(x=>x?.maskedPhone).find(x=>typeof x==='string'&&/^\d{3}\*{4}\d{4}$/.test(x))??'';
}
export function credentialPublicIdentity(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {};
  // Evaluate each public alias independently: empty strings and device labels
  // must never hide a later real name. Only exact-account profile objects
  // are considered, not arbitrary credential strings or opaque user IDs.
  const subjects=[payload.user_id,payload.userId,payload.sub,payload.uid].filter(x=>typeof x==='string'&&x.trim());
  if(new Set(subjects).size>1)return {};
  const subject=subjects[0];
  const profiles=[payload,payload.account,payload.profile,payload.user,payload.userInfo,payload.user_info]
    .filter(x=>x&&typeof x==='object'&&!Array.isArray(x))
    .filter(x=>!subject||x===payload||![x.id,x.user_id,x.userId,x.sub,x.uid].some(v=>typeof v==='string'&&v.trim()&&v!==subject));
  const label=publicAccountName(...profiles.map(x=>subject?{...x,user_id:subject}:x));
  const phoneValue=profiles.flatMap(x=>[x.phone,x.mobile]).find(x=>typeof x==='string'&&/^\d{11}$/.test(x));
  const phone=phoneValue?phoneValue.replace(/^(\d{3})\d{4}(\d{4})$/,'$1****$2'):'';
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
      ...(checkedAt?{balanceCheckedAt:checkedAt}:{}),
       ...(source.balanceState==='cached'?{balanceState:'cached',balanceStale:true}:{balanceState:'available'})};
  }
  const state=sources.find(x=>x?.balanceState==='unavailable')?'unavailable':
    sources.find(x=>x?.balanceState==='not_supported')?'not_supported':
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
