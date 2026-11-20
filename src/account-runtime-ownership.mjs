// A source login reference is NOT an independent takeover. The exact owned
// provider + account-ID + driver reference identifies our private vault/pool.
// This is an ownership boundary, NOT a claim that online auth already passed.
const privateAccountIds=[
  ['own_workbuddy-cn',/^wbp_[a-f0-9]{24}$/],
  ['own_workbuddy-global',/^wbp_[a-f0-9]{24}$/],
  ['own_lingxi',/^pr_[a-f0-9]{28}$/],
];
export function runtimeOwnership(account){
  if(!account||typeof account!=='object')return 'unknown';
  const provider=String(account.providerId??'');
  const id=String(account.id??'');
  const ref=String(account.credentialRef??'');
  if(provider.startsWith('own_')&&ref==='driver:'+provider+':'+id){
    const match=privateAccountIds.find(([name])=>name===provider);
    if(match?.[1].test(id))return 'owned';
    // Owned private channel-pack accounts are opaque, never raw login IDs.
    if(/^sp_[a-f0-9]{20,}$/.test(id))return 'owned';
    return 'unverified_binding';
  }
  if(ref.startsWith('driver:')||ref.startsWith('host:'))return 'linked';
  return 'direct';
}
