import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.mjs';
import {createRoutingEngine} from '../src/router.mjs';
import {UpstreamError} from '../src/failure.mjs';
import {createAccountPool} from '../src/accounts.mjs';
import {sample} from './fixtures.mjs';

function rig(extra={},request=async({model,account})=>({model,account:account.id})){
 const config=normalizeConfig({...sample,...extra});
 const events=[],pool=createAccountPool();
 return {config,events,pool,engine:createRoutingEngine({getConfig:()=>config,pool,request,onEvent:evt=>events.push(evt)})};
}
test('normal route uses first provider and an eligible account',async()=>{
 const {engine}=rig();
 const x=await engine.execute('daily',{sessionId:'s1'});
 assert.equal(x.model,'gpt-like');
 assert.ok(['a1','a2'].includes(x.account));
});
test('free mode never silently falls back to paid model',async()=>{
 const cfg=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'free'}]});
 const calls=[];
 const engine=createRoutingEngine({getConfig:()=>cfg,request:async row=>{calls.push(row);return{model:row.model}}});
 const x=await engine.execute('daily');
 assert.equal(x.model,'local-model');
 assert.ok(calls.every(row=>row.model!=='gpt-like'));
});
test('free mode with zero explicitly free tiers fails closed',async()=>{
 const cfg=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'free',
   tiers:[{providerId:'alpha',model:'gpt-like',free:false}]}]});
 const engine=createRoutingEngine({getConfig:()=>cfg,request:async()=>{throw Error('should not run')}});
 await assert.rejects(()=>engine.execute('daily'),e=>e.code==='ERR_FREE_EXHAUSTED');
});
test('429 on account triggers another account without generating a partial response',async()=>{
 const tried=[];
 const {engine,pool}=rig({},async({account,model})=>{
   tried.push(account.id);
   if(tried.length===1)throw new UpstreamError('HTTP 429',{status:429});
   return{model,accountId:account.id};
 });
 const result=await engine.execute('daily',{sessionId:'task'});
 assert.equal(result.model,'gpt-like');
 assert.equal(tried.length,2);
 assert.notEqual(tried[0],tried[1]);
 assert.ok(pool.status().exhausted.some(x=>x.accountId===tried[0]));
});
test('paid tier fallback after both accounts are rate-limited',async()=>{
 const attempts=[];
 const {engine}=rig({},async row=>{
   attempts.push(row.model);
   if(row.model==='gpt-like')throw new UpstreamError('rate limited',{status:429});
   return {model:row.model};
 });
 const response=await engine.execute('daily');
 assert.equal(response.model,'local-model');
 assert.deepEqual(attempts,['gpt-like','gpt-like','local-model']);
});
test('pinned model does not fall through to another model',async()=>{
 const attempts=[];
 const config=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'pinned'}]});
 const engine=createRoutingEngine({getConfig:()=>config,request:async row=>{
   attempts.push(row.model);throw new UpstreamError('quota',{status:402});
 }});
 await assert.rejects(()=>engine.execute('daily'),/quota/);
 assert.deepEqual(attempts,['gpt-like','gpt-like']);
});
test('account authorization failures rotate accounts; caller cancellation does not retry',async()=>{
 const calls=[],config=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'pinned'}]});
 const engine=createRoutingEngine({getConfig:()=>config,request:async row=>{
   calls.push(row.account.id);throw new UpstreamError('Unauthorized',{status:401});
 }});
 await assert.rejects(()=>engine.execute('daily'),/Unauthorized/);
 assert.deepEqual(calls.sort(),['a1','a2'].sort());
 const ctl=new AbortController();ctl.abort();
 await assert.rejects(()=>engine.execute('daily',{signal:ctl.signal}),e=>e.code==='CANCELLED');
 assert.equal(calls.length,2);
});
test('tool-required requests cannot use text-only upstream',async()=>{
 const config=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'pinned',
   tiers:[{providerId:'local',model:'local-model',free:true}]}]});
 const engine=createRoutingEngine({getConfig:()=>config,request:async()=>{throw Error('must not request')}});
 await assert.rejects(()=>engine.execute('daily',{needTools:true}),e=>e.code==='ERR_NO_TOOL_CAPABLE_ROUTE');
});
test('account availability respects explicit tier account selection',async()=>{
 const config=normalizeConfig({...sample,routes:[{...sample.routes[0],tiers:[
   {providerId:'alpha',model:'gpt-like',accountIds:['a2']}]}]});
 const used=[],engine=createRoutingEngine({getConfig:()=>config,request:async row=>{used.push(row.account.id);return 'ok'}});
 assert.equal(await engine.execute('daily'),'ok');
 assert.deepEqual(used,['a2']);
});

test('account weights 3:1 influence initial selection while each session remains sticky',async()=>{
 const cfg=normalizeConfig({...sample,accounts:[
  {...sample.accounts[0],weight:3},{...sample.accounts[1],weight:1},sample.accounts[2]],
  routes:[{...sample.routes[0],mode:'pinned'}]});
 const seen=[];
 const engine=createRoutingEngine({getConfig:()=>cfg,request:async row=>row.account.id});
 for(let i=0;i<4;i++)seen.push(await engine.execute('daily',{sessionId:'new-'+i}));
 assert.deepEqual(seen,['a1','a1','a1','a2']);
 // Affinity wins over new weighted placement for a session that already succeeded.
 assert.equal(await engine.execute('daily',{sessionId:'new-0'}),'a1');
 assert.equal(await engine.execute('daily',{sessionId:'new-3'}),'a2');
});

test('per-chain quota exhaustion cooldown uses configured duration',async()=>{
 let clock=1000;
 const cfg=normalizeConfig({...sample,routes:[{...sample.routes[0],mode:'pinned',exhaustionCooldownMs:1500}]});
 const pool=createAccountPool({now:()=>clock});
 const engine=createRoutingEngine({getConfig:()=>cfg,pool,request:async row=>{
  if(row.account.id==='a1')throw new UpstreamError('quota',{status:402});
  return 'healthy';
 }});
 assert.equal(await engine.execute('daily',{sessionId:'q1'}),'healthy');
 assert.equal(pool.isReady(cfg.accounts[0],'gpt-like'),false);
 clock=2499;assert.equal(pool.isReady(cfg.accounts[0],'gpt-like'),false);
 clock=2500;assert.equal(pool.isReady(cfg.accounts[0],'gpt-like'),true);
});
