import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createNativeRouterAdapter} from '../src/adapter.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createAccountVerificationStore} from '../src/account-verification-store.mjs';
import {createPublicAccountFactsStore} from '../src/account-public-facts-store.mjs';
import {UpstreamError} from '../src/failure.mjs';

const provider={id:'own_workbuddy-cn',name:'Fixture native provider',protocol:'native-channel',enabled:true};
const account=n=>{const id='wbp_'+n.repeat(24);return {id,providerId:provider.id,credentialRef:'driver:'+provider.id+':'+id,enabled:true}};
function rig(generate){
 const a=account('a'),b=account('b');
 let cfg=normalizeConfig({providers:[provider],accounts:[a,b],
  routes:[{id:'fixture-chain',name:'Fixture chain',mode:'priority',enabled:true,
    tiers:[{providerId:provider.id,model:'fixture-model',free:true}],maxSwitches:0}]});
 const configStore={get:()=>structuredClone(cfg),replace:next=>{cfg=normalizeConfig(next)}};
 let clock=Date.now()-100;
 const verificationStore=createAccountVerificationStore();
 for(const row of cfg.accounts)verificationStore.set(row,{state:'online',at:clock});
 const drivers=new Map([[provider.id,{generate,listModels:async()=>[{id:'fixture-model'}]}]]);
 const adapter=createNativeRouterAdapter({configStore,channelDrivers:drivers});
 const center=createAccountCenter({configStore,adapter,drivers,verificationStore,now:()=>++clock});
 adapter.setInferenceObserver(center.observeRoutedInference);
 return {a,b,adapter,center,verificationStore,configStore,provider:cfg.providers[0]};
}
async function run(h,signal){const events=[];for await(const event of h.adapter.stream({
 model:'chain:fixture-chain',sessionId:'fixture-session',messages:[{role:'user',content:'test'}],signal}))events.push(event);return events}
test('actual route failure and successful fallback record the correct owned account only',async()=>{
 const calls=[];
 const h=rig(async({account})=>{calls.push(account.id);
  if(account.id.endsWith('a'.repeat(24)))throw new UpstreamError('fixture failure',{status:402,code:'QUOTA'});
  return {text:'private model response',finishReason:'stop',toolCalls:[]};
 });
 await run(h);
 assert.deepEqual(calls,[h.a.id,h.b.id]);
 assert.equal(h.verificationStore.getModelTest(h.a).state,'failed');
 assert.equal(h.verificationStore.getModelTest(h.b).state,'verified');
 assert.equal(h.verificationStore.getModelTest(h.b).modelId,'fixture-model');
 assert.doesNotMatch(JSON.stringify(h.verificationStore.get(h.b)),/private model response|driver:/);
 h.center.stop();
});
test('truncation, cancellation and changed bindings never become routed success proof',async()=>{
 const h=rig(async()=>({text:'partial',finishReason:'length',toolCalls:[]}));
 await run(h);assert.equal(h.verificationStore.getModelTest(h.a),null);
 const controller=new AbortController();controller.abort();
 assert.equal(h.center.observeRoutedInference({account:h.a,provider:h.provider,model:'fixture-model',
  output:{text:'OK',finishReason:'stop'},signal:controller.signal}),false);
 h.configStore.replace({...h.configStore.get(),accounts:[{...h.a,enabled:false},h.b]});
 assert.equal(h.center.observeRoutedInference({account:h.a,provider:h.provider,model:'fixture-model',
  output:{text:'OK',finishReason:'stop'}}),false);
 assert.equal(h.verificationStore.getModelTest(h.a),null);h.center.stop();
});
test('different model transient failure preserves earlier complete model evidence',()=>{
 const h=rig(async()=>({text:'OK',finishReason:'stop'}));
 const base={account:h.a,provider:h.provider};
 assert.equal(h.center.observeRoutedInference({...base,model:'healthy',output:{text:'OK',finishReason:'stop'}}),true);
 assert.equal(h.center.observeRoutedInference({...base,model:'other',failure:{code:'RATE_LIMIT'}}),false);
 assert.equal(h.verificationStore.getModelTest(h.a).state,'verified');
 assert.equal(h.center.observeRoutedInference({...base,model:'healthy',failure:{code:'STREAM_CLOSED'}}),true);
 assert.equal(h.verificationStore.getModelTest(h.a).state,'failed');h.center.stop();
});
test('migration of previous ONLINE proof performs one official read to hydrate missing observation',async()=>{
 const a=account('a'),cfg=normalizeConfig({providers:[provider],accounts:[a]});
 const clock=Date.now()-100;
 const store=createPublicAccountFactsStore({now:()=>clock});
 const verificationStore=createAccountVerificationStore();verificationStore.set(a,{state:'online',at:clock});
 const facts={nickname:'Synthetic member',profileCheckedAt:clock,balance:25,balanceUnit:'积分',balanceCheckedAt:clock};
 store.observe(a,facts);
 let calls=0;
 const driver={accountSnapshot:()=>facts,refreshAccountStatus:async()=>{calls++;return {state:'ready',authVerified:true}}};
 const center=createAccountCenter({configStore:{get:()=>cfg,replace:()=>{}},drivers:new Map([[provider.id,driver]]),
  publicFactsStore:store,verificationStore,now:()=>clock});
 await center.refreshReadOnly();assert.equal(calls,1);assert.equal(store.get(a).observation.balanceState,'available');
 await center.refreshReadOnly();assert.equal(calls,1);center.stop();
});
