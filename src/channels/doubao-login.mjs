// Doubao Work owns its own cookie filters; Chromium CDP orchestration is shared
// with the MiMo Desktop membership login. No commercial API-Key routes.
import {hasSession} from './doubao-upstream.mjs';
import {createBrowserLoginFlow} from './browser-login.mjs';
export {findBrowser} from './browser-login.mjs';
const SKIP_COOKIE=/^LARK_SUITE_|^feishu_dpop_keypair$/;
export function headerFromCookies(cookies) {
  if (!Array.isArray(cookies)) return ''
  return cookies.filter(cookie => {
    const domain = String(cookie?.domain ?? '').toLowerCase().replace(/^\./,'')
    return domain === 'doubao.com' || domain.endsWith('.doubao.com')
  }).filter(cookie => /^[a-zA-Z0-9_.$-]{1,80}$/.test(String(cookie?.name ?? ''))
    && typeof cookie.value === 'string' && cookie.value.length > 0
    && cookie.value.length <= 4096 && !/[;\s\r\n]/.test(cookie.value)
    && !SKIP_COOKIE.test(cookie.name))
    .map(cookie => cookie.name+'='+cookie.value)
    .join('; ')
}
export function createLoginFlow(options={}){
 return createBrowserLoginFlow({...options,loginUrl:'https://www.doubao.com/chat/',
   extractCookie:cookies=>{
    const header=headerFromCookies(cookies);
    return hasSession(header)?header:'';
   }});
}
