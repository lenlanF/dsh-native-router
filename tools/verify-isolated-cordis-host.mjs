import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {createEmbeddedChannelPack} from '../src/embedded-pack.mjs';
import {channelPackIsolationReason} from '../src/channel-pack-isolation.mjs';

// Standalone EMPTY-PROFILE acceptance smoke. To run, copy this file and the
// project's src/embedded-pack.mjs, source-account-ref.mjs,
// source-account-selection.mjs, channel-pack-isolation.mjs, vendor/channel-pack
// into a dedicated E:\\Temp\\dsh-native-router-isolated-* directory with
// real public @deepseek-ai runtime modules installed next to the test.
// Never use a production profile, credential, real account or API request.
if(channelPackIsolationReason(process.env))
 throw Error('Isolated DSH_HOME / source state directory required');
if(process.env.DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE!=='1'
 ||process.env.DSH_OPENAI_GATEWAY_ENABLED!=='0'
 ||process.env.DSH_REASONING_LOOP_AUTO_RESUME!=='0')
 throw Error('Channel pack must be explicitly isolated with its gateway and loop-resume off');

const ctx=new Context();
const observed={adapters:[],credentialReads:0,credentialWrites:0};
ctx.provide('credentials',{
 async resolve(){observed.credentialReads++;return undefined},
 async describe(){return undefined},
 async set(){observed.credentialWrites++;throw Error('No test credential writes')},
 async unset(){observed.credentialWrites++;throw Error('No test credential deletes')},
});
ctx.provide('commands',{register(){return ()=>{}}});
ctx.provide('llm',{
 listProviders(){return ['native-router']},
 registerAdapter(ids){observed.adapters.push(ids);return ()=>{}},
 registerModelDiscovery(){return ()=>{}},
 registerConfigurableProviders(){return ()=>{}},
});
// New native source login requires the Host's in-process Connection RPC.
// A local no-network route registry proves registration without a listener.
const routes=[];
ctx.provide('connection',{fetch:{register(route){
 if(typeof route?.path!=='string'||typeof route?.fetch!=='function')
  throw Error('Invalid private connection route');
 routes.push(route);
 return ()=>{const index=routes.indexOf(route);if(index>=0)routes.splice(index,1)};
}}});
const bridge=createEmbeddedChannelPack({ctx,env:process.env,
 getConfig:()=>({embeddedPack:{enabled:true}})});
let outcome;
try{
 const started=bridge.attach();
 assert.ok(['loading','waiting_host_services'].includes(started.state));
 let snapshot;
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){
  snapshot=bridge.status();
  if(['mounted','blocked','failed','host_disposed'].includes(snapshot.state))break;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.equal(snapshot?.state,'mounted',JSON.stringify(snapshot));
 assert.equal(observed.adapters.length,13,'all 13 private model adapters must register');
 assert.equal(new Set(observed.adapters.flat()).size,13,'model aliases must be unique');
 assert.equal(snapshot.rpcReady,true,'Owner login RPC must be ready');
 assert.ok(routes.length>=2,'Native pack must register its private RPC endpoints');
 assert.equal(snapshot.modelAdapterReady.length,13,'all private model adapters should report ready');
 // Self-owned source pool remains scoped and must never become the host pool.
 assert.equal(ctx.get('accountPool',false),undefined);
 const preview=await bridge.listAccounts();
 assert.equal(preview.state,'ready');
 assert.deepEqual(preview.accounts,[]);
 assert.equal(observed.credentialReads,0);
 assert.equal(observed.credentialWrites,0);
 if(process.env.DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT==='1')
  assert.ok(snapshot.experimentalMultiAccountProviders.includes('lobsterai'));
 outcome={node:process.version,providers:observed.adapters.length,
  accountCount:preview.accounts.length,credentialReads:observed.credentialReads,
  credentialWrites:observed.credentialWrites,
  experimentalMultiAccount:process.env.DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT==='1'};
}finally{
 bridge.dispose();
 await new Promise(resolve=>setTimeout(resolve,80));
 assert.equal(ctx.get('accountPool',false),undefined,
  'The plugin must dispose its own Cordis child Fiber/accountPool');
}
console.log(JSON.stringify({result:'PASS',...outcome,accountPoolAfterDispose:'absent'}));
process.exit(0);
