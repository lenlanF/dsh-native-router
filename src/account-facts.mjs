// Shared read-only presentation rules. This module never performs I/O, persists
// credentials, or infers an account identity from a nickname.
const nameSensitive=/\b(?:bearer|wps_sid|access_token|refresh_token|password|client_secret)\b/i;
const opaqueName=/^(?:sp|pr|wb|ca)_[a-f0-9]{20,}$/i;
const generatedName=/^(?:账号\s*\d+|account\s*#?\d+|.+\s*·\s*独立账号)$/iu;
export function publicAccountName(...sources){
  for(const source of sources){
    if(!source||typeof source!=='object')continue;
    for(const key of ['displayName','accountName','username','userName','nickname','label']){
      const value=source[key];
      if(typeof value!=='string')continue;
      const name=value.trim();
      if(!name||name.length>120||name===source.id||name===source.accountId||
        nameSensitive.test(name)||opaqueName.test(name)||generatedName.test(name))continue;
      return name;
    }
  }
  return '';
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
