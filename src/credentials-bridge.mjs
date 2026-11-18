// DSH Host Credentials capability discovered at runtime, not from the NPM tree.
// Source plugins and original account files stay untouched. A missing Host
// service is a stable, inspectable readiness failure, never a fake login.
const usable=x=>x&&typeof x.resolve==='function'&&typeof x.set==='function'&&typeof x.unset==='function';
const unavailable=()=>Object.assign(new Error('DSH Host Credentials service is not ready'),
 {code:'CREDENTIALS_UNAVAILABLE'});
export function createHostCredentialBridge({ctx,provided}={}){
 let injected=null,disposed=false,callback=null;
 const get=()=>{
  if(usable(provided))return provided;
  if(disposed)return null;
  if(usable(injected))return injected;
  try{
   const service=ctx?.get?.('credentials',false)??ctx?.credentials;
   return usable(service)?service:null;
  }catch{return null}
 };
 const vault={
  resolve:(...args)=>{const service=get();if(!service)throw unavailable();return service.resolve(...args)},
  set:(...args)=>{const service=get();if(!service)throw unavailable();return service.set(...args)},
  unset:(...args)=>{const service=get();if(!service)throw unavailable();return service.unset(...args)},
 };
 if(!usable(provided)&&typeof ctx?.inject==='function'){
  callback=scope=>{
   if(disposed)return;
   let service;
   try{service=scope?.get?.('credentials',false)??scope?.credentials}catch{}
   if(usable(service))injected=service;
   scope?.effect?.(()=>()=>{if(injected===service)injected=null});
  };
  try{ctx.inject(['credentials'],callback)}catch{callback=null}
 }
 const status=()=>({state:get()?'ready':'unavailable',available:!!get()});
 const dispose=()=>{
  if(disposed)return;disposed=true;injected=null;
  if(callback&&typeof ctx?.registry?.delete==='function')
   try{ctx.registry.delete(callback)}catch{}
 };
 return {vault,status,dispose};
}
