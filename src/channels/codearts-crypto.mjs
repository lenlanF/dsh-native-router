// Native Huawei Cloud SDK-HMAC-SHA256 signing.
// Signed payload, timestamp and headers must stay byte-identical to the sent request.
import {createHash,createHmac,generateKeyPairSync,createPrivateKey,sign,randomBytes} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const HMAC='SDK-HMAC-SHA256';
const CURVE_ORDER=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
function sdkTimestamp(at){
 const date=new Date(at);
 if(!Number.isFinite(date.getTime()))throw Error('Invalid SDK timestamp');
 return date.toISOString().replace(/[-:]|\.\d{3}/g,'');
}
function canonicalUri(pathname){
 const path=(pathname||'/').split('/').map(value=>encodeURIComponent(decodeURIComponent(value))).join('/');
 return path.endsWith('/')?path:path+'/';
}
function canonicalQuery(search){
 const params=new URLSearchParams(search.startsWith('?')?search.slice(1):search),rows=[];
 for(const key of [...new Set(params.keys())].sort()){
  for(const val of params.getAll(key).sort())rows.push(encodeURIComponent(key)+'='+encodeURIComponent(val));
 }
 return rows.join('&');
}
export function signCodeArtsRequest(url,{method='POST',headers={},body='',credential,now=Date.now()}={}){
 const target=new URL(url);
 if(target.protocol!=='https:'&&!(['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&target.protocol==='http:'))
  throw Error('CodeArts signing requires HTTPS or loopback testing');
 if(!credential||!credential.accessKeyId||!credential.secretAccessKey||!credential.securityToken)
  throw Error('CodeArts signing requires temporary AK, SK and security token');
 const date=sdkTimestamp(now),payload=typeof body==='string'?body:JSON.stringify(body);
 const all=new Map();
 for(const [key,value]of Object.entries(headers)){
  const name=String(key).toLowerCase();
  if(name==='authorization'||name==='host'||!name.match(/^[a-z0-9_-]+$/))throw Error('Unsafe pre-signed CodeArts header');
  all.set(name,String(value).trim().replace(/\s+/g,' '));
 }
 all.set('x-sdk-date',date);
 all.set('x-security-token',credential.securityToken);
 all.set('x-sdk-content-sha256',hash(Buffer.from(payload,'utf8')));
 all.set('host',target.host);
 const names=[...all.keys()].sort();
 const canonicalHeaders=names.map(name=>name+':'+all.get(name)+'\n').join('');
 const canonical=[method.toUpperCase(),canonicalUri(target.pathname),canonicalQuery(target.search),canonicalHeaders,
  names.join(';'),hash(Buffer.from(payload,'utf8'))].join('\n');
 const signature=createHmac('sha256',credential.secretAccessKey).update(
   HMAC+'\n'+date+'\n'+hash(canonical)).digest('hex');
 const output=Object.fromEntries([...all.entries()].filter(([k])=>k!=='host'));
 output.authorization=HMAC+' Access='+credential.accessKeyId+', SignedHeaders='+names.join(';')+', Signature='+signature;
 return {method:method.toUpperCase(),headers:output,body:payload,signedHeaders:names};
}
export function createCodeArtsPkce(random= randomBytes){
 const verifier=Buffer.from(random(64)).toString('base64url');
 return {verifier,challenge:createHash('sha256').update(verifier).digest('base64url'),method:'SHA-256'};
}
export function newCodeArtsDPoPKey(){
 const {privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const key=privateKey.export({format:'jwk'});
 return {kty:key.kty,crv:key.crv,x:key.x,y:key.y,d:key.d};
}
export function signCodeArtsDPoP(key,url,{now=Date.now(),method='POST'}={}){
 if(key?.kty!=='EC'||key?.crv!=='P-256'||![key.x,key.y,key.d].every(x=>typeof x==='string'&&x.length))
  throw Error('CodeArts DPoP requires a P-256 private key');
 const target=new URL(url);
 if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)))
  throw Error('Invalid CodeArts DPoP target');
 const header={alg:'ES256',typ:'dpop+jwt',jwk:{kty:'EC',crv:'P-256',x:key.x,y:key.y}};
 const payload={htm:method.toUpperCase(),htu:target.href,iat:Math.floor(now/1000),jti:randomBytes(16).toString('hex')};
 const input=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
 const raw=sign('sha256',Buffer.from(input),{key:createPrivateKey({key,format:'jwk'}),dsaEncoding:'ieee-p1363'});
 let sig=raw;
 const high=BigInt('0x'+raw.subarray(32).toString('hex'));
 if(high>CURVE_ORDER/2n){
   sig=Buffer.concat([raw.subarray(0,32),Buffer.from((CURVE_ORDER-high).toString(16).padStart(64,'0'),'hex')]);
 }
 return input+'.'+sig.toString('base64url');
}
