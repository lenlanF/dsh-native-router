// Public registration contract for future verified, provider-specific native adapters.
// Registration does not read local credentials, call the network, or create accounts.
const active=new Map(),subscribers=new Set();
const ID=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export function getNativeChannelDrivers(){return active}
export function onNativeChannelDriverChange(listener){
  if(typeof listener!=='function')throw Error('listener must be a function');
  subscribers.add(listener);
  return ()=>subscribers.delete(listener);
}
export function registerNativeChannelDriver(id,driver){
  if(typeof id!=='string'||!ID.test(id))throw Error('Invalid channel driver ID');
  if(!driver||typeof driver!=='object'||Array.isArray(driver))throw Error('Invalid native channel driver');
  const methods=['generate','listModels','login','refresh','logout','discover','importCandidate','checkIn'];
  if(!methods.some(method=>typeof driver[method]==='function'))throw Error('Native driver must expose at least one capability');
  if(active.has(id))throw Error('Native driver already registered: '+id);
  active.set(id,driver);
  for(const cb of subscribers)try{cb(id,'added')}catch{}
  let disposed=false;
  return ()=>{
    if(disposed)return;disposed=true;
    if(active.get(id)!==driver)return;
    active.delete(id);
    for(const cb of subscribers)try{cb(id,'removed')}catch{}
  };
}
