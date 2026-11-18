import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {registerRouterRoutes} from '../src/routes.mjs';
import {sample} from './fixtures.mjs';

function rig(drivers=new Map(),config=sample){
 let snapshot=normalizeConfig(config),dirty=0;
 const configStore={get:()=>structuredClone(snapshot),replace:v=>{dirty++;snapshot=normalizeConfig(v);return structuredClone(snapshot)}};
 const accountCenter=createAccountCenter({configStore,drivers,env:{NATIVE_ROUTER_TEST_KEY:'dummy',LOCAL_TEST_KEY:'dummy'},
  vault:{resolve:async()=>({value:'dummy'})},
  fetchImpl:async()=>new Response('{}',{status:200})});
 const checkinStore={history:[],all(){return structuredClone(this.history)},append(v){this.history.push(v);return v}};
 const checkinCenter=createCheckinCenter({configStore,accountCenter,store:checkinStore,
  now:()=>Date.parse('2026-11-17T02:07:00Z')});
 const handlers=new Map(),adapter={getStatus:()=>({healthy:true}),invalidateCatalog(){}};
 const ctx={webServer:{register({path,handler}){handlers.set(path,handler);return()=>handlers.delete(path)}}};
 const dispose=registerRouterRoutes(ctx,{configStore,adapter,accountCenter,checkinCenter});
 async function hit(method,path,body,{origin='http://localhost:8123',address='127.0.0.1',host='localhost:8123'}={}){
  const req=new EventEmitter();
  req.method=method;req.socket={remoteAddress:address};req.headers={origin,host};
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value},
    end(content){this.body=JSON.parse(content)}};
  const promise=handlers.get('/plugins/dsh-native-router'+path)(req,res);
  if(method==='POST')queueMicrotask(()=>{req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end')});
  await promise;
  return {code:res.statusCode,body:res.body};
 }
 return {hit,dispose,handlers,configStore,accountCenter,get dirty(){return dirty}};
}
test('channel endpoints provide accounts and route actions through validated host HTTP API',async()=>{
 const t=rig();
 const initial=await t.hit('GET','/channels/accounts');
 assert.equal(initial.code,200);
 assert.equal(initial.body.accounts.length,3);
 assert.ok(initial.body.channels.some(x=>x.id==='codearts'&&x.referenceOnly));
 const verified=await t.hit('POST','/channels/accounts/action',{action:'login',accountId:'a1'});
 assert.equal(verified.code,200);
 assert.equal(verified.body.result.state,'online');
 const switched=await t.hit('POST','/channels/accounts/action',{action:'enable',accountId:'a1',enabled:false});
 assert.equal(switched.body.result.enabled,false);
 assert.equal(t.configStore.get().accounts[0].enabled,false);
 const status=await t.hit('GET','/channels/accounts');
 assert.equal(status.body.accounts[0].connectionState,'disabled');
 t.dispose();assert.equal(t.handlers.size,0);
});
test('checkin API never reports success if no native channel checkin executor exists',async()=>{
 const t=rig();
 const snapshot=await t.hit('GET','/checkins');
 assert.equal(snapshot.code,200);
 assert.equal(snapshot.body.accounts[0].checkinState,'unsupported');
 const denied=await t.hit('POST','/checkins/action',{action:'run',accountId:'a1'});
 assert.equal(denied.code,501);
 assert.match(denied.body.error,/尚未实现/);
 t.dispose();
});
test('checkin API reports confirmed success only after channel adapter confirms server-side state',async()=>{
 const driver={checkIn:async({date})=>({confirmed:true,date,message:'服务器已确认今日签到'})};
 const t=rig(new Map([['alpha',driver]]));
 const r=await t.hit('POST','/checkins/action',{action:'run',accountId:'a1'});
 assert.equal(r.code,200);
 assert.equal(r.body.result.record.state,'success');
 const view=await t.hit('GET','/checkins');
 assert.equal(view.body.accounts.find(x=>x.id==='a1').checkinState,'success');
 assert.equal(view.body.history.length,1);
 t.dispose();
});
test('cross-origin, cross-port, and non-loopback account mutations are denied',async()=>{
 const t=rig();
 for(const opts of [
  {origin:'https://evil.example',host:'localhost:8123'},
  {origin:'http://localhost:8124',host:'localhost:8123'},
  {origin:'http://localhost:8123',host:'localhost:8123',address:'192.168.1.20'},
 ]){
   const response=await t.hit('POST','/channels/accounts/action',{action:'enable',accountId:'a1',enabled:false},opts);
   assert.equal(response.code,403);
 }
 assert.equal(t.dirty,0);
 t.dispose();
});
test('checkin endpoint refuses unexpected action names without running plugins',async()=>{
 const t=rig(new Map([['alpha',{checkIn:async()=>{throw Error('never execute')}}]]));
 const resp=await t.hit('POST','/checkins/action',{action:'force-all',accountId:'a1'});
 assert.equal(resp.code,400);
 t.dispose();
});

test('candidate import API requires preceding discovery and activates the native account immediately after approval',async()=>{
 const driver={
  discover:async()=>[{id:'cand01',label:'授权账号候选',source:'official-desktop'}],
  importCandidate:async()=>({id:'native-one',credentialRef:'driver:workbuddy:native-one'}),
 };
 const config={providers:[{id:'workbuddy',protocol:'native-channel',name:'WorkBuddy'}],accounts:[],routes:[]};
 const t=rig(new Map([['workbuddy',driver]]),config);
 const before=await t.hit('POST','/channels/import',{providerId:'workbuddy',candidateId:'cand01'});
 assert.equal(before.code,409);
 const discovered=await t.hit('POST','/channels/discover',{providerId:'workbuddy'});
 assert.equal(discovered.code,200);
 assert.equal(discovered.body.candidates[0].label,'授权账号候选');
 const imported=await t.hit('POST','/channels/import',{providerId:'workbuddy',candidateId:'cand01'});
 assert.equal(imported.code,200);
 assert.equal(imported.body.result.enabled,true);
 assert.equal(t.configStore.get().accounts[0].credentialRef,'driver:workbuddy:native-one');
 assert.equal((await t.hit('GET','/channels/accounts')).body.accounts[0].configuredEnabled,true);
 t.dispose();
});
