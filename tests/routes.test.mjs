import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {registerRouterRoutes} from '../src/routes.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {sample} from './fixtures.mjs';

function harness(embeddedPack){
  let state=normalizeConfig(sample),invalidations=0;
  const routes=new Map();
  const ctx={get(name){if(name==='webServer')return{register({path,handler}){routes.set(path,handler);return()=>routes.delete(path)}}}};
  const configStore={get:()=>structuredClone(state),replace(value){state=normalizeConfig(value);return structuredClone(state)}};
  const cleanup=registerRouterRoutes(ctx,{configStore,adapter:{
    invalidateCatalog(){invalidations++},
    getStatus:()=>({providers:state.providers.length,accounts:state.accounts.length,routes:state.routes.length}),
  },accountCenter:{list:()=>({channels:[],accounts:[],pools:[]})},embeddedPack});
  async function hit(method,path,{body,origin='http://localhost',address='127.0.0.1'}={}){
    const req=new EventEmitter();req.method=method;req.socket={remoteAddress:address};req.headers={origin,host:'localhost'};
    const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},end(raw){this.value=JSON.parse(raw)}};
    const handler=routes.get('/plugins/dsh-native-router'+path);
    const pending=handler(req,res);
    if(method==='POST'){queueMicrotask(()=>{
      req.emit('data',Buffer.from(JSON.stringify(body)));
      req.emit('end');
    })}
    await pending;
    return res;
  }
  return {routes,hit,cleanup,configStore,get invalidations(){return invalidations}};
}
test('settings API gives only configured references, never raw secrets',async()=>{
 const h=harness();
 const result=await h.hit('GET','/config');
 assert.equal(result.statusCode,200);
 assert.equal(result.value.config.accounts[0].credentialRef,'env:NATIVE_ROUTER_TEST_KEY');
 assert.equal(result.headers['cache-control'],'no-store');
 h.cleanup();assert.equal(h.routes.size,0);
});
test('local config POST updates model catalog with validated provider and routing entries',async()=>{
 const h=harness(),body=h.configStore.get();
 body.routes[0].name='Daily alternatives';
 const res=await h.hit('POST','/config',{body});
 assert.equal(res.statusCode,200);
 assert.equal(res.value.restartRequired,true);
 assert.equal(h.invalidations,1);
 assert.equal((await h.hit('GET','/config')).value.config.routes[0].name,'Daily alternatives');
 h.cleanup();
});
test('cross-origin, remote callers and secret-bearing config are rejected without mutation',async()=>{
 const h=harness(),body=h.configStore.get();
 const remote=await h.hit('POST','/config',{body,address:'192.168.1.2'});
 assert.equal(remote.statusCode,403);
 const badOrigin=await h.hit('POST','/config',{body,origin:'https://example.com'});
 assert.equal(badOrigin.statusCode,403);
 body.accounts[0].apiKey='DO_NOT_PERSIST';
 const badConfig=await h.hit('POST','/config',{body});
 assert.equal(badConfig.statusCode,400);
 assert.equal(h.invalidations,0);
 assert.equal((await h.hit('GET','/status')).value.accounts,3);
 h.cleanup();
});
test('safe upstream account preview is loopback only and cannot expose credentials',async()=>{
 const fake={status:()=>({state:'mounted'}),listAccounts:async()=>({state:'ready',
  accounts:[{id:'wb-1',providerId:'workbuddy',nickname:'Public Name',enabled:true,connectionState:'not_checked'}]})};
 const h=harness(fake);
 const remote=await h.hit('GET','/channels/accounts',{address:'192.168.1.2'});
 assert.equal(remote.statusCode,403);
 const local=await h.hit('GET','/channels/accounts');
 assert.equal(local.statusCode,200);
 assert.equal(local.value.embeddedAccounts.accounts[0].id,'wb-1');
 assert.equal(local.value.embeddedAccounts.accounts[0].connectionState,'not_checked');
 assert.equal((await h.hit('GET','/status')).value.embeddedPack.state,'mounted');
 h.cleanup();
});

test('explicit upstream model query is origin/loopback restricted and does not affect router config',async()=>{
 const calls=[];
 const embeddedPack={
  status:()=>({state:'mounted',channelCount:13,channels:['loomy']}),
  listAccounts:async()=>({state:'ready',accounts:[]}),
  listModels:async id=>{calls.push(id);return {state:'ready',providerId:id,models:[{id:'m1',name:'Model 1'}]}},
  changeAccountEnabled:async input=>{calls.push(input);return {state:'updated',changed:true,enabled:input.enabled}},
 };
 const h=harness(embeddedPack);
 const body={providerId:'loomy'};
 const remote=await h.hit('POST','/channels/embedded/models',{body,address:'192.168.1.5'});
 assert.equal(remote.statusCode,403);
 const cross=await h.hit('POST','/channels/embedded/models',{body,origin:'https://malicious.example'});
 assert.equal(cross.statusCode,403);
 assert.equal(calls.length,0,'rejected requests must never reach source pack');
 const result=await h.hit('POST','/channels/embedded/models',{body});
 assert.equal(result.statusCode,200);
 assert.equal(result.value.result.models[0].id,'m1');
 assert.deepEqual(calls,['loomy']);
 assert.equal(h.invalidations,0);
 h.cleanup();
});
test('upstream account changes require exact explicit boolean and never bypass same-origin',async()=>{
 const changes=[];
 const embeddedPack={
  status:()=>({state:'mounted'}),
  listAccounts:async()=>({state:'ready',accounts:[]}),
  changeAccountEnabled:async input=>{changes.push(input);return {state:'updated',changed:true,enabled:input.enabled}},
 };
 const h=harness(embeddedPack);
 const body={providerId:'workbuddy',accountId:'workbuddy-01',enabled:false};
 assert.equal((await h.hit('POST','/channels/embedded/account-state',{body,address:'10.0.0.8'})).statusCode,403);
 assert.equal((await h.hit('POST','/channels/embedded/account-state',{body,origin:'https://example.com'})).statusCode,403);
 assert.equal((await h.hit('POST','/channels/embedded/account-state',{body:{...body,enabled:'false'}})).statusCode,400);
 assert.deepEqual(changes,[]);
 const result=await h.hit('POST','/channels/embedded/account-state',{body});
 assert.equal(result.statusCode,200);
 assert.equal(result.value.result.state,'updated');
 assert.deepEqual(changes,[body]);
 h.cleanup();
});
test('unavailable upstream pack fails closed for account changes and model discovery',async()=>{
 const h=harness();
 assert.equal((await h.hit('POST','/channels/embedded/models',{body:{providerId:'loomy'}})).statusCode,503);
 assert.equal((await h.hit('POST','/channels/embedded/account-state',{body:{providerId:'loomy',accountId:'loomy-01',enabled:true}})).statusCode,409);
 h.cleanup();
});
test('source deletion is denied unless same-origin local and explicitly acknowledged',async()=>{
 const calls=[];
 const h=harness({removeSourceAccount:async arg=>{calls.push(arg);return {state:'removed',removed:true}}});
 const body={providerId:'qoder',accountId:'q-1',acknowledgedSourceCredentialDeletion:true};
 assert.equal((await h.hit('POST','/channels/embedded/account-remove',{body,origin:'https://evil.example'})).statusCode,403);
 assert.equal((await h.hit('POST','/channels/embedded/account-remove',{body,address:'192.0.2.1'})).statusCode,403);
 assert.equal((await h.hit('POST','/channels/embedded/account-remove',{body:{providerId:'qoder',accountId:'q-1'}})).statusCode,400);
 assert.equal(calls.length,0);
 const okay=await h.hit('POST','/channels/embedded/account-remove',{body});
 assert.equal(okay.statusCode,200);
 assert.deepEqual(calls,[{providerId:'qoder',accountId:'q-1'}]);
 h.cleanup();
});
test('source account deletion fails closed when native source references remain',async()=>{
 const h=harness({removeSourceAccount:async()=>({state:'referenced',removed:false})});
 const result=await h.hit('POST','/channels/embedded/account-remove',{body:{
  providerId:'qoder',accountId:'q-1',acknowledgedSourceCredentialDeletion:true,
 }});
 assert.equal(result.statusCode,409);
 assert.match(result.value.error,/先移除/);
 h.cleanup();
});
test('settings frontend registers as a native DSH settings section',()=>{
 const source=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 let definition;
 const savedWindow=globalThis.window;
 globalThis.window={__ModuleLoader__:{load:mod=>{definition=mod}}};
 try{new Function(source)()}finally{globalThis.window=savedWindow}
 assert.equal(definition.id,'dsh-native-router');
 const React={createElement:()=>({}),useState:()=>{},useEffect:()=>{},useCallback:()=>{}};
 const plugin=definition.factory(name=>name==='react'?React:undefined);
 let created=false;
 const ctx={slots:{inject(_name,fn){fn();return()=>{}},register(_options,_component){created=true;return()=>{}}},effect(){}};
 plugin.apply(ctx);
 assert.equal(created,true);
});
