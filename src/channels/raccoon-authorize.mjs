// Raccoon Work browser authorization. The legacy /login/mp confirmation
// route was retired; use the official /authorize loopback flow instead.
// Wire contract reference: eghrhegpe/dsh-connect-sensenova-token-plan,
// src/host/raccoon-authorize.ts (MIT; blob e93fc411b642f5127e732530d9f405afbd735666).
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
const BASE='https://xiaohuanxiong.com';
const CALLBACK='/auth/callback';
const fail=reason=>Object.assign(Error('Raccoon authorization '+reason),{code:'RACCOON_AUTH_'+reason.toUpperCase()});
function validCode(code){return typeof code==='string'&&code.length>0&&code.length<=4096&&!/[\x00-\x20\x7f]/.test(code)}
export function raccoonAuthorizeUrl(port,state){
 if(!Number.isInteger(port)||port<1024||port>65535||!(/^[a-f0-9]{64}$/).test(state))throw fail('invalid_callback');
 const url=new URL('/authorize',BASE);
 // Identify this integration truthfully in the official consent page.
 url.search=new URLSearchParams({login_source:'desktop',appname:'DSH Native Router',desktop_callback:'loopback',
   redirect:'http://127.0.0.1:'+port+CALLBACK,state}).toString();
 return url.href;
}
export async function exchangeRaccoonCode(code,{fetchImpl=fetch,signal,now=()=>Date.now()}={}){
 if(!validCode(code))throw fail('invalid_code');
 let response,body;
 try{
  response=await fetchImpl(BASE+'/api/web/auth/v1/login_with_authorization_code',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({authorization_code:code}),
   redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)
  });
  body=await response.json();
 }catch{throw fail('exchange_unavailable')}
 if(body?.code===200035)throw fail('code_expired');
 if(!response.ok||body?.code!==0)throw fail('exchange_rejected');
 const data=body.data,access=data?.access_token,refresh=data?.refresh_token;
 if(typeof access!=='string'||!access||access.length>32768)throw fail('invalid_token');
 let claims={};try{claims=JSON.parse(Buffer.from(access.split('.')[1]??'','base64url').toString('utf8'))}catch{}
 const iam=typeof claims?.iss==='string'&&claims.iss.endsWith('/iam');
 if(iam&&(claims.iss!=='xiaohuanxiong.com/iam'||typeof claims.sub!=='string'||!claims.sub.trim()||
   !Number.isFinite(claims.exp)||claims.exp*1000<=now()||!Number.isFinite(new Date(claims.exp*1000).getTime())))throw fail('invalid_token');
 if(!iam&&(typeof refresh!=='string'||!refresh))throw fail('refresh_missing');
 return {access_token:access,refresh_token:typeof refresh==='string'?refresh:'',
   ...(Number.isFinite(claims.exp)&&claims.exp>0?{expires_at:String(claims.exp*1000)}:{})};
}
export async function startRaccoonAuthorizeFlow({fetchImpl=fetch,timeoutMs=300000}={}){
 const state=randomBytes(32).toString('hex'),controller=new AbortController();
 let port=0,consumed=false,closed=false,timer,resolveCode,rejectCode;
 const codePromise=new Promise((resolve,reject)=>{resolveCode=resolve;rejectCode=reject});
 codePromise.catch(()=>{});
 const server=createServer({maxHeaderSize:8192},(req,res)=>{
  const answer=(status,message)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
   'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end(message)};
  if(closed||consumed)return answer(409,'Already used');
  const authority='127.0.0.1:'+port;
  if(req.method!=='GET'||req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==authority||
    (req.headers.origin!==undefined&&req.headers.origin!==BASE)||
    (req.headers['sec-fetch-dest']!==undefined&&req.headers['sec-fetch-dest']!=='document'))return answer(400,'Invalid callback');
  let url;
  try{url=new URL(req.url,'http://'+authority)}catch{return answer(400,'Invalid callback')}
  if(url.origin!=='http://'+authority||url.pathname!==CALLBACK||url.hash||
    [...url.searchParams.keys()].some(k=>k!=='state'&&k!=='code')||
    url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1)return answer(400,'Invalid callback');
  const incoming=url.searchParams.get('state')??'',code=url.searchParams.get('code');
  if(!/^[a-f0-9]{64}$/.test(incoming)||!timingSafeEqual(Buffer.from(incoming),Buffer.from(state))||!validCode(code))
    return answer(400,'Invalid state or code');
  consumed=true;answer(200,'Authorization received. Return to DSH Native Router.');server.close();resolveCode(code);
 });
 function close(){
  if(closed)return;closed=true;clearTimeout(timer);controller.abort();rejectCode(fail('closed'));
  server.closeAllConnections?.();server.close();
 }
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  port=server.address().port;
  const loginUrl=raccoonAuthorizeUrl(port,state);
  timer=setTimeout(()=>{rejectCode(fail('expired'));close()},Math.max(1000,Math.min(300000,timeoutMs)));
  timer.unref?.();
  const result=codePromise.then(code=>exchangeRaccoonCode(code,{fetchImpl,signal:controller.signal})).finally(()=>{
    clearTimeout(timer);closed=true;server.close();
  });
  result.catch(()=>{});
  return {loginUrl,result,close};
 }catch{close();throw fail('listener_unavailable')}
}
