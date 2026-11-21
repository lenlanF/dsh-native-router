// Channel model discovery must not depend on a separate daily sign-in
// status refresh after a self-owned account has passed real authentication.
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
