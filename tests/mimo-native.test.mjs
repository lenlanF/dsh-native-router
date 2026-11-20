import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMimoDriver} from '../src/channels/mimo.mjs';
import {createConfigStore} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';

function fixtures(){
 const secrets=new Map(),calls=[];
 const vault={
  set:async(key,value)=>{secrets.set(key,value)},
  unset:async key=>{secrets.delete(key)},
  resolve:async key=>{if(!secrets.has(key))throw Error('not found');return {value:secrets.get(key)}},
 };
 let engine=null,engineEnabled=true;
 const fetchImpl=async(url,options={})=>{
  calls.push({url,method:options.method||'GET',auth:options.headers?.authorization,body:options.body});
  if(url.endsWith('/models'))return new Response(JSON.stringify({data:[{id:'mimo-v2-flash',name:'MiMo Flash'},
   {id:'mimo-desktop/mimo-auto'},{id:'mimo-desktop/asr'}]}),{
   status:200,headers:{'content-type':'application/json'}});
  if(url.endsWith('/chat/completions')){
   const body=JSON.parse(options.body);
   assert.equal(body.stream,true);
   assert.equal(body.messages.at(-1).content,'你好');
   return new Response('data: '+JSON.stringify({choices:[{delta:{content:'这是 MiMo 原生回复'},finish_reason:'stop'}]})+
    '\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
  }
  throw Error('Unwanted HTTP '+url);
 };
 const driver=createMimoDriver({vault,fetchImpl,
  localKeyReader:()=>({kind:'api',key:'sk-local-mimo-test-key',baseUrl:'https://api.xiaomimimo.com/v1'}),
  findDesktop:async()=>[{pid:1234}],
  engineResolver:async()=>engineEnabled?{baseUrl:'http://127.0.0.1:3456/v1',
    token:'engine-capability',models:['mimo-desktop/mimo-auto']}:null
 });
 return {driver,secrets,calls,vault,stopEngine:()=>{engineEnabled=false}};
}
const account=row=>({id:row.id,providerId:'own_mimo',credentialRef:row.credentialRef});
const chatOptions={messages:[{role:'user',content:'你好'}]};

test('MiMo local key discovery requires explicit consent, then owns its credential',async()=>{
 const {driver,secrets,calls}=fixtures();
 const candidates=await driver.discover();
 assert.equal(candidates.length,2);
 assert.deepEqual([...secrets.keys()],[],'discovery cannot write a credential');
 const direct=await driver.importCandidate({candidateId:candidates[0].id,consent:true});
 assert.equal(direct.providerId,'own_mimo');
 assert.equal(secrets.size,1);
 const models=await driver.listModels({account:account(direct)});
 assert(models.some(m=>m.id==='mimo-v2-flash'));
 const done=await driver.generate({account:account(direct),model:'mimo-v2-flash',options:chatOptions});
 assert.equal(done.text,'这是 MiMo 原生回复');
 assert.equal(done.finishReason,'stop');
 assert(calls.some(c=>c.auth==='Bearer sk-local-mimo-test-key'));
 await driver.logout({account:account(direct)});
 assert.equal(secrets.size,0);
 await assert.rejects(driver.generate({account:account(direct),model:'mimo-v2-flash',options:chatOptions}),/credential/i);
});
test('MiMo SSO engine route is valid only while the official desktop engine runs',async()=>{
 const {driver,stopEngine,calls}=fixtures();
 const candidates=await driver.discover();
 const engine=await driver.importCandidate({candidateId:candidates[1].id,consent:true});
 const models=await driver.listModels({account:account(engine)});
 assert(models.some(x=>x.id==='mimo-desktop/mimo-auto'));
 assert(!models.some(x=>x.id==='mimo-desktop/asr'));
 const done=await driver.generate({account:account(engine),model:'mimo-desktop/mimo-auto',options:chatOptions});
 assert.equal(done.text,'这是 MiMo 原生回复');
 assert(calls.some(c=>c.auth==='Bearer engine-capability'));
 stopEngine();
 const status=await driver.refresh({account:account(engine)});
 assert.equal(status.state,'client_required');
});
test('MiMo independently entered key never appears in config or public account snapshot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'router-mimo-test-'));
 try{
  const path=join(dir,'config.json'),store=createConfigStore({path});
  const {driver}=fixtures();
  const drivers=new Map([['own_mimo',driver]]);
  const center=createAccountCenter({configStore:store,drivers,autoVerifyMs:9999999});
  assert.equal(center.ensureMimoProvider().state,'created');
  const added=await center.addMimoCredential({apiKey:'sk-sealed-private-test-key'});
  assert.equal(added.providerId,'own_mimo');
  assert.equal(center.list().accounts.length,1);
  const text=readFileSync(path,'utf8');
  assert(!text.includes('sk-sealed-private-test-key'));
  assert(text.includes('driver:own_mimo:'));
  await assert.rejects(driver.generate({account:{
    ...center.find(added.id).account,providerId:'other-channel'},model:'mimo-v2-flash',options:chatOptions}),/binding/i);
  center.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('MiMo environment key works without a desktop client or local auth file',async()=>{
 const keys=new Map();
 const vault={set:async(k,v)=>keys.set(k,v),resolve:async k=>({value:keys.get(k)})};
 const driver=createMimoDriver({vault,env:{MIMO_API_KEY:'sk-environment-mi-mo',MIMO_BASE_URL:'https://api.xiaomimimo.com/v1'},
  findDesktop:async()=>[],fetchImpl:async()=>new Response(JSON.stringify({data:[{id:'mimo-v2-flash'}]}),{status:200})});
 const candidates=await driver.discover();
 assert.equal(candidates.length,1);
 assert.equal(candidates[0].source,'mimo-environment-key');
 assert.equal(keys.size,0,'discovery must remain read-only');
 await assert.rejects(driver.importCandidate({candidateId:candidates[0].id,consent:false}),/approval/i);
 const owned=await driver.importCandidate({candidateId:candidates[0].id,consent:true});
 assert.equal((await driver.listModels({account:account(owned)}))[0].id,'mimo-v2-flash');
 assert.equal(keys.size,1);
});
test('MiMo manual API Key rejects non-HTTPS and malformed credentials',async()=>{
 const {driver}=fixtures();
 await assert.rejects(driver.addCredential({apiKey:'short'}),/invalid/i);
 await assert.rejects(driver.addCredential({apiKey:'sk-long-demo-value',baseUrl:'http://example.com/v1'}),/HTTPS/i);
 await assert.rejects(driver.addCredential({apiKey:'sk-long-demo-value',baseUrl:'https://user:pass@api.xiaomimimo.com/v1'}),/HTTPS/i);
});
