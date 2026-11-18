import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash,createPublicKey,verify} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {signCodeArtsRequest,createCodeArtsPkce,newCodeArtsDPoPKey,signCodeArtsDPoP} from '../src/channels/codearts-crypto.mjs';
import {createCodeArtsDriver} from '../src/channels/codearts.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

const fakeEnv={
 CODEARTS_ACCOUNT_IDS:'ALPHA,BETA',
 CODEARTS_ALPHA_AK:'AK-ALPHA',CODEARTS_ALPHA_SK:'SK-ALPHA',
 CODEARTS_ALPHA_TOKEN:'STS-ALPHA',CODEARTS_ALPHA_EXPIRES_AT:'2030-01-01T00:00:00Z',
 CODEARTS_BETA_AK:'AK-BETA',CODEARTS_BETA_SK:'SK-BETA',
 CODEARTS_BETA_TOKEN:'STS-BETA',CODEARTS_BETA_EXPIRES_AT:'2030-01-01T00:00:00Z',
};
const time=Date.parse('2026-11-17T03:04:05Z');
test('CodeArts SHA-256 PKCE contains verifier, challenge, Huawei-required method',()=>{
 const {verifier,challenge,method}=createCodeArtsPkce(size=>Buffer.alloc(size,0x42));
 assert.equal(method,'SHA-256');
 assert.equal(challenge,createHash('sha256').update(verifier).digest('base64url'));
 assert.ok(verifier.length>=43);
});
test('CodeArts DPoP ES256 JWT verifies and signs low-S P-256',()=>{
 const privateKey=newCodeArtsDPoPKey();
 const jwt=signCodeArtsDPoP(privateKey,'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens',{now:time});
 const [header,payload,sig]=jwt.split('.');
 const hd=JSON.parse(Buffer.from(header,'base64url').toString('utf8'));
 const pl=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
 assert.equal(hd.alg,'ES256');assert.equal(hd.typ,'dpop+jwt');
 assert.equal(pl.iat,Math.floor(time/1000));assert.equal(pl.htm,'POST');
 assert.equal(pl.htu,'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens');
 assert.equal(hd.jwk.d,undefined,'public DPoP proof header must not include private d');
 const sigBuffer=Buffer.from(sig,'base64url');
 assert.equal(sigBuffer.length,64);
 assert.equal(verify('sha256',Buffer.from(header+'.'+payload),{
   key:createPublicKey({key:hd.jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},sigBuffer),true);
 const s=BigInt('0x'+sigBuffer.subarray(32).toString('hex'));
 assert.ok(s<=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n/2n);
 assert.notEqual(signCodeArtsDPoP(privateKey,'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens'),jwt);
});
test('Huawei SDK HMAC signs exact request method/path/body/security token and signed headers',()=>{
 const payload='{"model":"glm-test","messages":[{"role":"user","content":"测试"}]}';
 const credential={accessKeyId:'AK-ALPHA',secretAccessKey:'SK-ALPHA',securityToken:'STS-ALPHA'};
 const s=signCodeArtsRequest('https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions',{
   method:'POST',headers:{'content-type':'application/json','x-auth-token':credential.securityToken},
   body:payload,credential,now:time});
 assert.equal(s.headers['x-sdk-date'],'20261117T030405Z');
 assert.equal(s.headers['x-security-token'],'STS-ALPHA');
 assert.ok(s.signedHeaders.includes('host'));
 assert.ok(s.signedHeaders.includes('x-auth-token'));
 assert.ok(s.signedHeaders.includes('x-sdk-content-sha256'));
 assert.equal(s.headers['x-sdk-content-sha256'],createHash('sha256').update(payload).digest('hex'));
 assert.match(s.headers.authorization,/^SDK-HMAC-SHA256 Access=AK-ALPHA, SignedHeaders=.+, Signature=[a-f0-9]{64}$/);
 const sig=/Signature=([a-f0-9]{64})$/.exec(s.headers.authorization)[1];
 const pieces=s.signedHeaders.map(name=>name+':'+(name==='host'?'snap-access.cn-north-4.myhuaweicloud.com':s.headers[name])+'\n').join('');
 const sha=txt=>createHash('sha256').update(txt).digest('hex');
 const canonical=['POST','/api/v2/chat/completions/','',pieces,
   s.signedHeaders.join(';'),sha(payload)].join('\n');
 const expected=createHmac('sha256',credential.secretAccessKey).update(
   'SDK-HMAC-SHA256\n20261117T030405Z\n'+sha(canonical)).digest('hex');
 assert.equal(sig,expected);
 assert.notEqual(signCodeArtsRequest('https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions',{
   method:'POST',body:payload+' ',credential,now:time}).headers.authorization,s.headers.authorization);
});
async function rig({env=fakeEnv,fetchImpl,endpoint,now=()=>time}={}){
 let snapshot=normalizeConfig({providers:[{id:'codearts',name:'CodeArts',protocol:'native-channel',models:[]}],accounts:[],routes:[]});
 const store={get:()=>structuredClone(snapshot),replace:x=>(snapshot=normalizeConfig(x))};
 const driver=createCodeArtsDriver({env,fetchImpl,endpoint,now});
 const drivers=new Map([['codearts',driver]]);
 const adapter=createNativeRouterAdapter({configStore:store,channelDrivers:drivers});
 const center=createAccountCenter({configStore:store,adapter,drivers});
 return {driver,center,adapter,store,get cfg(){return snapshot}};
}
test('CodeArts user-provisioned multi-account discover and import only public env profile names',async()=>{
 const a=await rig({fetchImpl:async()=>{throw Error('unexpected upstream call')}});
 const listed=await a.center.discover('codearts');
 assert.equal(listed.candidates.length,2);
 assert.deepEqual(listed.candidates.map(x=>x.id),['ca_ALPHA','ca_BETA']);
 assert.doesNotMatch(JSON.stringify(listed),/AK-ALPHA|STS-ALPHA|SK-BETA|CODEARTS_ALPHA/);
 assert.equal(a.cfg.accounts.length,0);
 const imported=await a.center.importCandidate('codearts','ca_BETA');
 assert.equal(imported.id,'ca_BETA');
 assert.equal(imported.enabled,true);
 assert.equal(a.cfg.accounts[0].credentialRef,'driver:codearts:ca_BETA');
 assert.equal(a.cfg.accounts[0].autoCheckin,false);
 await assert.rejects(()=>a.center.importCandidate('codearts','ca_BETA'),e=>e.status===409);
});
test('CodeArts empty or malformed env profiles cannot be imported',async()=>{
 const a=await rig({env:{CODEARTS_ACCOUNT_IDS:'ALPHA,INVALID-NAME',CODEARTS_ALPHA_AK:'a'},
 fetchImpl:async()=>{throw Error('unexpected')}});
 assert.equal((await a.center.discover('codearts')).candidates.length,0);
 await assert.rejects(()=>a.center.importCandidate('codearts','ca_ALPHA'),e=>e.status===409);
});
test('CodeArts expired temporary credentials fail before any network request',async()=>{
 let count=0;
 const env={...fakeEnv,CODEARTS_ALPHA_EXPIRES_AT:'2020-01-01T00:00:00Z'};
 const a=await rig({env,fetchImpl:async()=>{count++;return new Response('ok')}});
 await a.center.discover('codearts');
 const account=await a.center.importCandidate('codearts','ca_ALPHA');a.center.setEnabled(account.id,true);
 assert.equal((await a.center.verify('ca_ALPHA')).state,'expired');
 assert.equal(count,0);
});
test('CodeArts direct native signed catalog and chat work across accounts over real loopback TCP',async t=>{
 const hits=[];
 const http=createServer(async (req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   hits.push({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')});
   if(req.url==='/v1/model/builtin'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({count:3,builtinModels:[{model_id:'glm-a',model_name:'GLM A',enable:true},{model_id:'glm-b',enable:true},{model_id:'retired',enable:false}] }));return;
   }
   if(req.url==='/api/v2/chat/completions'){
     res.writeHead(200,{'content-type':'text/event-stream'});
     res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'id1',
      function:{name:'read',arguments:'{"file":"safe.txt"}'}}]},finish_reason:'tool_calls'}]})+
      '\n\ndata: [DONE]\n\n');return;
   }
   res.writeHead(404).end();
 });
 http.listen(0,'127.0.0.1');await once(http,'listening');
 t.after(()=>{http.closeAllConnections();http.close()});
 const r=await rig({endpoint:'http://127.0.0.1:'+http.address().port,fetchImpl:fetch});
 const candidates=await r.center.discover('codearts');
 for(const c of candidates.candidates){const imported=await r.center.importCandidate('codearts',c.id);r.center.setEnabled(imported.id,true)}
 assert.equal((await r.center.verify('ca_ALPHA')).state,'online');
 assert.equal((await r.center.verify('ca_BETA')).state,'online');
 const ids=(await r.adapter.listModels()).map(x=>x.id);
 assert.ok(ids.includes('direct:codearts:glm-a'));
 assert.ok(ids.includes('direct:codearts:glm-b'));
 assert.ok(!ids.includes('direct:codearts:retired'));
 assert.ok(hits.filter(x=>x.url==='/v1/model/builtin').every(x=>x.headers['agent-type']==='PromptCenter'));
 assert.ok(hits.every(x=>x.headers['x-language']==='zh-cn'));

 const seen=[];
 for await(const event of r.adapter.stream({model:'direct:codearts:glm-a',
   messages:[{role:'user',content:'hello'}],
   tools:[{name:'read',parameters:{type:'object',properties:{file:{type:'string'}}}}]}))seen.push(event);
 assert.equal(seen.find(x=>x.type==='tool-call-delta').name,'read');
 const req=hits.find(x=>x.url==='/api/v2/chat/completions');
 assert.match(req.headers.authorization,/SDK-HMAC-SHA256 Access=AK-ALPHA/);
  assert.match(req.headers['x-snap-traceid'],/^[a-f0-9]{32}$/);
  assert.equal(req.headers['app-id'],'CodeAgent3.0');
 assert.equal(req.headers['x-security-token'],'STS-ALPHA');
 assert.equal(req.headers['x-auth-token'],'STS-ALPHA');
 assert.doesNotMatch(JSON.stringify(r.cfg),/AK-ALPHA|SK-ALPHA|STS-ALPHA/);
 assert.equal(await r.center.logout('ca_ALPHA').then(x=>x.revokedUpstream),false);
});

test('CodeArts stream truncation never exposes a half-written tool call to the DSH host',async t=>{
 const http=createServer(async(req,res)=>{
   if(req.url==='/v1/model/builtin'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({builtinModels:[{model_id:'glm-a',enable:true}]}));return;
   }
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{
     index:0,id:'half',function:{name:'read',arguments:'{"file":"'}}]}}]})+'\n\n');
 });
 http.listen(0,'127.0.0.1');await once(http,'listening');
 t.after(()=>{http.closeAllConnections();http.close()});
 const r=await rig({endpoint:'http://127.0.0.1:'+http.address().port,fetchImpl:fetch});
 await r.center.discover('codearts');
 const a=await r.center.importCandidate('codearts','ca_ALPHA');r.center.setEnabled(a.id,true);
 const events=[];
 await assert.rejects(async()=>{
   for await(const event of r.adapter.stream({model:'direct:codearts:glm-a',
     messages:[{role:'user',content:'read'}],tools:[{name:'read',
       parameters:{type:'object',properties:{file:{type:'string'}}}}]}))events.push(event);
 },error=>error.code==='TRUNCATED');
 assert.equal(events.filter(x=>x.type==='tool-call-delta').length,0);
});
test('CodeArts configured model cannot be treated as a verified free benefit without discovery',async()=>{
 let payload=null;
 const http=createServer(async(req,res)=>{
   if(req.url==='/v1/model/builtin'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({builtinModels:[{model_id:'glm-a'}]}));return;
   }
   const chunks=[];for await(const c of req)chunks.push(c);
   payload={headers:req.headers,body:Buffer.concat(chunks).toString('utf8')};
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{content:'ready'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 try{
   const r=await rig({endpoint:'http://127.0.0.1:'+http.address().port,fetchImpl:fetch});
   await r.center.discover('codearts');
   const a=await r.center.importCandidate('codearts','ca_ALPHA');r.center.setEnabled(a.id,true);
   const result=await r.driver.generate({account:r.cfg.accounts[0],model:'glm-a',options:{
     messages:[{role:'user',content:'hi'}]}});
   assert.equal(result.text,'ready');
   assert.equal(payload.headers.maas_type,undefined,'benefit entitlement may not be guessed');
 }finally{http.closeAllConnections();http.close()}
});
