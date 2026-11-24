// A source login reference is NOT an independent takeover. The exact owned
// provider + account-ID + driver reference identifies our private vault/pool.
// This is an ownership boundary, NOT a claim that online auth already passed.
import {SOURCE_PACK_PROVIDERS} from './embedded-pack.mjs';
const privateAccountIds=[
  ['own_workbuddy-cn',/^wbp_[a-f0-9]{24}$/],
  ['own_workbuddy-global',/^wbp_[a-f0-9]{24}$/],
  ['own_lingxi',/^pr_[a-f0-9]{28}$/],
  ['own_mimo_desktop',/^sp_[a-f0-9]{24}$/],
  ['own_doubao',/^db_[a-f0-9]{28}$/],
  ['own_meoo_web',/^mw_[a-f0-9]{28}$/],
  ['own_qwenwork',/^qw_[a-f0-9]{28}$/],
  ['own_aws_quick',/^aq_[a-f0-9]{28}$/],
];
export function runtimeOwnership(account){
  if(!account||typeof account!=='object')return 'unknown';
  const provider=String(account.providerId??'');
  const id=String(account.id??'');
  const ref=String(account.credentialRef??'');
  if(provider.startsWith('own_')&&ref==='driver:'+provider+':'+id){
    const match=privateAccountIds.find(([name])=>name===provider);
    if(match?.[1].test(id))return 'owned';
    // Source-pack accounts are owned only for a known built-in native adapter;
    // a fabricated own_* provider or an old host ref cannot claim autonomy.
    if(SOURCE_PACK_PROVIDERS.includes(provider.slice(4))
      &&/^sp_[a-f0-9]{24}$/.test(id))return 'owned';
    return 'unverified_binding';
  }
  if(ref.startsWith('driver:')||ref.startsWith('host:'))return 'linked';
  return 'direct';
}
