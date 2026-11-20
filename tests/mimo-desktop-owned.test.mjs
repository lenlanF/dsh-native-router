import test from 'node:test';
import assert from 'node:assert/strict';
import {createMimoDesktopDriver,MIMO_DESKTOP_ID,readMimoDesktopSession}
 from '../src/channels/mimo-desktop.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {normalizeConfig} from '../src/config.mjs';

const loggedIn={region:'cn',passToken:'synthetic-pass-token-from-mi-desktop-12345',
 userId:'test-user-22',cUserId:'user-c-22'};
function harness({rejectReplace=false}={}){
 const records=new Map(),calls=[];
 const vault={
  async resolve(ref){return records.get(ref)},
  async set(ref,value){if(records.has(ref))throw Error('duplicate private credential');
   records.set(ref,{value})},
  async unset(ref){records.delete(ref)},
 };
 let local={...loggedIn},readerCalls=0;
 const transport={
  async probe({session}){
   calls.push({kind:'auth',session});
   return {state:'online',authVerified:true,accountName:'Xiaomi owner'};
  },
  async generate({session,model,options}){
   calls.push({kind:'chat',session,model,options});
   return {text:'mimo desktop reply',reasoning:'',finishReason:'stop',toolCalls:[]};
  },
 };
 const driver=createMimoDesktopDriver({vault,transport,
  readCurrentSession:async()=>{readerCalls++;return local}});
 let cfg=normalizeConfig({});
 const configStore={get:()=>structuredClone(cfg),replace:value=>{
  if(rejectReplace)throw Error('Simulated disk write failure');
  cfg=normalizeConfig(value);return structuredClone(cfg);
 }};
 const center=createAccountCenter({configStore,drivers:new Map([[MIMO_DESKTOP_ID,driver]])});
 return {driver,center,records,calls,configStore,
  get cfg(){return cfg},
  get readerCalls(){return readerCalls},
  stopDesktop(){local=null}};
}
test('own MiMo Desktop is discovered read-only and imported into plugin vault on explicit consent',async()=>{
 const h=harness();
 const scan=await h.center.discover(MIMO_DESKTOP_ID);
 assert.equal(h.cfg.providers.length,0);
 assert.equal(h.records.size,0);
 assert.equal(scan.candidates.length,1);
 assert.match(scan.candidates[0].id,/^sp_[a-f0-9]{24}$/);
 assert.doesNotMatch(JSON.stringify(scan),/synthetic-pass-token|test-user-22/);
 const imported=await h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id);
 assert.equal(imported.providerId,MIMO_DESKTOP_ID);
 assert.equal(h.cfg.providers.length,1);
 assert.equal(h.cfg.providers[0].protocol,'native-channel');
 assert.deepEqual(h.cfg.routes,[],'must not create paid API routes or automatic model chains');
 assert.equal(h.cfg.accounts.length,1);
 assert.equal(h.records.size,1);
 assert.doesNotMatch(JSON.stringify(h.cfg),/synthetic-pass-token/);
 assert.equal((await h.center.verify(imported.id)).state,'online');
 assert.deepEqual(await h.driver.listModels({account:h.cfg.accounts[0]}),[
  {id:'mimo-x-pro-preview'},{id:'mimo-x-flash-preview'}]);
 const previousReads=h.readerCalls;
 h.stopDesktop();
 const adapter=createNativeRouterAdapter({configStore:h.configStore,
  channelDrivers:new Map([[MIMO_DESKTOP_ID,h.driver]])});
 const events=[];
 for await(const event of adapter.stream({model:'direct:own_mimo_desktop:mimo-x-pro-preview',
  messages:[{role:'user',content:'hello'}]}))events.push(event);
 assert.equal(events.find(e=>e.type==='text-delta').text,'mimo desktop reply');
 assert.equal(h.readerCalls,previousReads,'runtime must not read original Desktop after import');
 assert.equal(h.calls.at(-1).kind,'chat');
 await h.center.logout(imported.id);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
});
test('failed account metadata persistence rolls back newly owned MiMo secret',async()=>{
 const h=harness({rejectReplace:true});
 const scan=await h.center.discover(MIMO_DESKTOP_ID);
 await assert.rejects(()=>h.center.importCandidate(MIMO_DESKTOP_ID,scan.candidates[0].id),
  /Simulated disk write failure/);
 assert.equal(h.records.size,0);
 assert.equal(h.cfg.accounts.length,0);
});
test('MiMo independent session reading never scans unsupported desktop, never fabricates a candidate',async()=>{
 assert.equal(await readMimoDesktopSession({platform:'linux'}),null);
 const h=harness();h.stopDesktop();
 assert.deepEqual((await h.center.discover(MIMO_DESKTOP_ID)).candidates,[]);
});