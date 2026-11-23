import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshSession} from '../src/channels/aws-quick-vendor/lib/oauth.mjs';
import {createAwsQuickDriver} from '../src/channels/aws-quick.mjs';
import {startFakeQuick} from './helpers/aws-quick-fake-quick.mjs';
const baseAccount=fake=>({
 provider:'social',stage:'prod',
 tenant_url:'http://127.0.0.1:'+fake.port,ws_host:fake.wsHost,
 actor_arn:'arn:aws:quicksight:us-east-1:123456789012:user/test/quick-owner',
 aws_account_id:'123456789012',email:'quick-owner@example.com',
 jwt:'id-token-fixture-012345678901',
 usable_until:Math.floor(Date.now()/1000)+3600,
 tokens:{access_token:'access-token-fixture-0123456',
  refresh_token:'refresh-token-fixture-0123456',
  id_token:'id-token-fixture-012345678901'},
 client:{client_id:'public-client',client_secret:'fake-secret',
  issuer_url:'https://oidc.us-east-1.amazonaws.com'},
 user_info:{email:'quick-owner@example.com',
  user_arn:'arn:aws:quicksight:us-east-1:123456789012:user/test/quick-owner',
  aws_account_id:'123456789012',display_name:'Quick Owner'},
});
const mockFetch=async(url,init={})=>{
 if(!String(url).endsWith('/user-info'))throw Error('Unexpected cloud URL');
 assert.equal(init.headers?.Authorization,'Bearer access-token-fixture-0123456');
 return new Response(JSON.stringify({
  email:'quick-owner@example.com',
  userArn:'arn:aws:quicksight:us-east-1:123456789012:user/test/quick-owner',
  awsAccountId:'123456789012',displayName:'Quick Owner'}));
};
const makeVault=()=>{
 const data=new Map();
 return {data,
  async resolve(key){return {value:data.get(key)}},
  async set(key,value){data.set(key,value)},
  async unset(key){data.delete(key)},
 };
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('untrusted OIDC discovery token endpoint cannot exfiltrate Quick refresh tokens',async()=>{
 const urls=[];
 const fakeOriginal=['sample','refresh','rotation'].join('-');
 const fakeRotated=['sample','new','rotation'].join('-');
 const sess={
  client:{issuer_url:'https://oidc.eu-west-3.amazonaws.com',
   client_id:'unit-test-client',client_secret:'unit-test-secret'},
  region:'eu-west-3',
  tenant_url:'https://cell001.dp.appintegrations.eu-west-3.prod.plato.ai.aws.dev',
   tokens:{refresh_token:fakeOriginal,access_token:'old-unit-token'},
  user_info:{email:'quick-owner@example.com'},
 };
 const fetchImpl=async(url,init={})=>{
  const s=String(url);urls.push(s);
  if(s.endsWith('/.well-known/openid-configuration'))
   return new Response(JSON.stringify({token_endpoint:'https://attacker.example/token'}));
  if(s==='https://oidc.eu-west-3.amazonaws.com/token'){
   assert.equal(JSON.parse(init.body).refreshToken,fakeOriginal);
   return new Response(JSON.stringify({accessToken:['sample','access','rotation'].join('-'),
    refreshToken:fakeRotated,idToken:['sample','jwt'].join('-'),expiresIn:3600}));
  }
  throw Error('Disallowed request '+s);
 };
 const rotated=await refreshSession(sess,{fetchImpl});
 assert(urls.includes('https://oidc.eu-west-3.amazonaws.com/token'));
 assert.equal(rotated.tokens.refresh_token,fakeRotated);
});
test('Amazon Quick pasted OAuth callback persists only after account-center explicit commit, cancel after commit cannot delete it',async()=>{
 const fake=await startFakeQuick(),vault=makeVault(),identity=baseAccount(fake);
 let complete;
 const loginFactory=async()=>({
  url:'https://quick.aws.com/sn?qwSurface=safe',
  done:new Promise(resolve=>{complete=resolve}),
  cancel(){},submit:async()=>{},
 });
 const driver=createAwsQuickDriver({vault,fetchImpl:mockFetch,
  allowTestLoopback:true,loginFactory});
 try{
  const started=await driver.startLogin();
  assert.equal(started.status,'waiting');
  assert.equal(vault.data.size,0);
  assert.equal(started.loginUrl.includes('refresh_token'),false);
  complete(identity);
  await tick();await tick();
  const status=await driver.pollLogin();
  assert.equal(status.status,'done');
  assert(status.account?.id?.startsWith('aq_'));
  assert.equal(vault.data.size,1);
  driver.completeCandidate({account:status.account});
  await driver.cancelLogin();
  assert.equal(vault.data.size,1,'late cancel after committed member must not revoke own vault');
 }finally{await driver.dispose();await fake.close()}
});
test('Amazon Quick canceled pending browser grant has no orphaned owner credential after late token receipt',async()=>{
 const fake=await startFakeQuick(),vault=makeVault();
 let complete;
 const driver=createAwsQuickDriver({vault,fetchImpl:mockFetch,
  allowTestLoopback:true,loginFactory:async()=>({
   url:'https://quick.aws.com/sn?qwSurface=safe',
   done:new Promise(resolve=>{complete=resolve}),cancel(){},
   submit:async()=>{},
  })});
 try{
  assert.equal((await driver.startLogin()).status,'waiting');
  assert.equal((await driver.cancelLogin()).status,'canceled');
  complete(baseAccount(fake));
  await tick();await tick();await tick();
  assert.equal(vault.data.size,0);
  assert.equal((await driver.pollLogin()).status,'canceled');
 }finally{await driver.dispose();await fake.close()}
});
test('Amazon Quick one-time local credential adoption copies to OWN private vault and never writes original client target',async()=>{
 const fake=await startFakeQuick(),vault=makeVault();
 const local=baseAccount(fake);
 local._raw={OriginalSourceMarker:'Desktop private'};
 local._credTarget='quickwork-unmodified-source';
 let reads=0;
 const driver=createAwsQuickDriver({vault,fetchImpl:mockFetch,
  allowTestLoopback:true,localSource:async()=>{reads++;return local}});
 try{
  const receipt=await driver.importLocal();
  assert.equal(reads,1,'local source read only after explicit import action');
  assert.equal(vault.data.size,1);
  const stored=JSON.stringify([...vault.data.values()][0]);
  assert.doesNotMatch(stored,/OriginalSourceMarker|quickwork-unmodified-source|_raw|_credTarget/);
  assert.equal(local._raw.OriginalSourceMarker,'Desktop private');
  await driver.logout({account:{id:receipt.id,providerId:receipt.providerId,
   credentialRef:receipt.credentialRef}});
  assert.equal(vault.data.size,0);
  assert.equal(local._credTarget,'quickwork-unmodified-source');
 }finally{await driver.dispose();await fake.close()}
});
