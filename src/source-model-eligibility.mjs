// Channel model discovery must not depend on a separate daily sign-in
// status refresh after a self-owned account has passed real authentication.
// An external/linked account with the same opaque source ID is NEVER allowed
// to borrow successful health evidence from this plugin's private pack.
export function privateSourceAccountRoutable(account,live,sourceOnline=false){
 if(!account||typeof account.id!=='string'||typeof account.providerId!=='string'
   ||account.enabled!==true||!live||live.id!==account.id
   ||live.providerId!==account.providerId||live.enabled!==true
   ||live.runtimeMode!=='owned'||live.origin?.kind!=='independent-owned'
   ||account.credentialRef!=='driver:'+account.providerId+':'+account.id)return false;
 if(live.connectionState==='online')return true;
 // A recent independently authenticated source may finish before AccountCenter
 // records its parallel probe. Explicit expiration, disablement and failures
 // always win over potentially older positive health signals.
 return sourceOnline===true&&['pending','not_checked','recently_verified']
   .includes(live.connectionState);
}

const canonical=id=>typeof id==='string'&&id.startsWith('own_')?id.slice(4):id;
export function sourceModelEligible(providerId,{accounts=[],sourceRows=[]}={}){
 if(typeof providerId!=='string'||!providerId||providerId.length>70)return false;
 const readOnly=(Array.isArray(sourceRows)?sourceRows:[]).some(row=>
   row?.providerId===providerId&&row.enabled===true
   &&row.connectionState==='online'&&row.sourceAccount===true);
 if(readOnly)return true;
 // Own CodeArts QR accounts may retain the historical public "codearts"
 // provider ID. Only the actual private runtime binding can authorize them.
 return (Array.isArray(accounts)?accounts:[]).some(row=>
   canonical(row?.providerId)===providerId&&row.enabled===true
   &&row.runtimeMode==='owned'&&row.origin?.kind==='independent-owned'
   &&row.connectionState==='online');
}
