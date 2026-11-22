// MiMo Desktop membership login through a one-shot isolated Chromium profile.
// Reuses our in-process browser CDP authorization, not a commercial API key.
// The owner initiates sign-in; passToken is privately imported into DSH vault.
// Protocol informed by MIT decolua/9router src/lib/mimoLoginSession.js.
import {createBrowserLoginFlow} from './browser-login.mjs';

// Every region authenticates the member at the human-facing Xiaomi Account
// sign-in origin. The selected cluster is verified separately by the owned
// membership transport; opening `/api/user/xiaomi/me` only shows a JSON API
// response and cannot start an interactive account login.
const XIAOMI_SIGN_IN='https://account.xiaomi.com/';
export const MIMO_LOGIN_REGIONS=Object.freeze({
 cn:XIAOMI_SIGN_IN,sgp:XIAOMI_SIGN_IN,ams:XIAOMI_SIGN_IN,
 ru:XIAOMI_SIGN_IN,in:XIAOMI_SIGN_IN,
});
function sessionField(value){
 return typeof value==='string'&&value.length>0&&value.length<=4096
   &&!/[;\r\n\u0000-\u001f]/.test(value);
}
export function mimoCookieFromCdp(rows){
 if(!Array.isArray(rows))return '';
 const selected=new Map();
 for(const item of rows){
  const domain=String(item?.domain??'').toLowerCase().replace(/^\./,'');
  if(domain!=='xiaomi.com'&&domain!=='account.xiaomi.com')continue;
  if(!['passToken','userId','cUserId'].includes(item?.name)
    ||!sessionField(item.value))continue;
  selected.set(item.name,item.value);
 }
 if(!selected.get('passToken')||selected.get('passToken').length<8)return '';
 return [...selected].map(([key,value])=>key+'='+value).join('; ');
}
export function parseMimoLoginCookie(header,region='cn'){
 if(typeof header!=='string'||!Object.hasOwn(MIMO_LOGIN_REGIONS,region))return null;
 const values=new Map();
 for(const part of header.split(';')){
  const at=part.indexOf('=');
  if(at<=0)continue;
  values.set(part.slice(0,at).trim(),part.slice(at+1).trim());
 }
 if(!sessionField(values.get('passToken'))||values.get('passToken').length<8)return null;
 const userId=values.get('userId')??'',cUserId=values.get('cUserId')??'';
 if(userId&&!sessionField(userId)||cUserId&&!sessionField(cUserId))return null;
 return {region,passToken:values.get('passToken'),userId,cUserId};
}
export function createMimoDesktopLoginFlow({
 onSession,onRollback,verifySession,logger,flowFactory=createBrowserLoginFlow,
}={}){
 if(typeof onSession!=='function')throw Error('MiMo owned session callback required');
 let active=null;
 const status=()=>active?.status()??{status:'idle',account:null,at:0};
 return {
  async start({region='cn'}={}){
   if(active?.busy)return status();
   if(!Object.hasOwn(MIMO_LOGIN_REGIONS,region))
    throw Error('Unsupported MiMo Desktop account cluster');
   active=flowFactory({logger,loginUrl:MIMO_LOGIN_REGIONS[region],
    extractCookie:mimoCookieFromCdp,rollbackAccount:onRollback,
    validateCookie:verifySession?async cookie=>{
      const session=parseMimoLoginCookie(cookie,region);
      return !!session&&await verifySession(session)===true;
    }:undefined,
    addAccount:async({cookie})=>{
      const session=parseMimoLoginCookie(cookie,region);
      if(!session)throw Error('MiMo Desktop login session incomplete');
      const account=await onSession(session);
      return {account};
    }});
   return active.start();
  },
  status,
  cancel:()=>active?.cancel()??status(),
 };
}
