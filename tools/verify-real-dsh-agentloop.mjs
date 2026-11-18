import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm';
import {SessionStore} from '@deepseek-ai/dsh-session';
import {SessionProjectionRegistry} from '@deepseek-ai/dsh-session-projection';
import {AgentRegistry} from '@deepseek-ai/dsh-agent';
import {AgentLoop} from '@deepseek-ai/dsh-agent-loop';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {ToolsService} from '@deepseek-ai/dsh-tools';
import {attachHostFailover} from '../src/host-failover.mjs';
import {normalizeConfig} from '../src/config.mjs';

assert.ok(process.env.DSH_HOME?.startsWith('E:\\Temp\\dsh-native-router-isolated-'),
  'Real AgentLoop integration MUST use disposable E:\\Temp DSH HOME');
const scenario=process.env.DSH_NATIVE_ROUTER_AGENTLOOP_SCENARIO||'once';
assert.ok(['once','parallel','cancel','dispose'].includes(scenario),'unknown isolated test scenario');
const streamEntered=Promise.withResolvers();
const ctx=new Context();
const components=[];
async function mount(name,component,config){
 console.log('MOUNT',name);
 const fiber=ctx.plugin(component,config);
 await fiber;
 components.push([name,component]);
 console.log('MOUNTED',name);
 return fiber;
}
await mount('sessionProjections',SessionProjectionRegistry,{});
await mount('sessions',SessionStore,{});
const llm=new LlmRuntime(ctx);
await mount('agents',AgentRegistry,{});
await mount('systemPrompt',SystemPrompt,{});
await mount('tools',ToolsService,{});
let toolExecutions=0,inflightTools=0,maxConcurrentTools=0;
const toolDefinition={
 name:'record_once',description:'Record one synthetic local action',
 parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
 output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},
  render:(args,value)=>[{type:'text',text:'Synthetic recorded '+args.value}]},
  async execute(args,exec){
   assert.equal(exec.signal.aborted,false);
   inflightTools++;
   maxConcurrentTools=Math.max(maxConcurrentTools,inflightTools);
   try{
    if(scenario==='parallel')await new Promise(resolve=>setTimeout(resolve,35));
    toolExecutions++;
    return {ok:true};
   }finally{inflightTools--}
  },
};
const disposeTool=ctx.tools.register(toolDefinition);
const disposeExecutor=ctx.tools.setExecutor({
 describe:tools=>({schemas:tools.map(({name,description,parameters})=>({name,description,parameters})),
   knownNames:tools.map(x=>x.name)}),
 async execute({calls,signal,agent,log,toolSet}){
   const results=await Promise.all(calls.map(async call=>{
    const definition=ctx.tools.executable(call.name,agent,toolSet);
    assert.ok(definition,'DSH admitted tool must remain registered');
    const args=JSON.parse(call.arguments);
    // Synthetic executor contributes exact ToolService batch semantics,
    // including concurrent call ownership and durable Session event pairs.
    const value=await definition.execute(args,{signal,agent});
    const content=definition.output.render(args,value);
    const message=createToolResultMessage({callId:call.id,content,isError:false});
    assert.ok(log?.turn>0&&log?.step>0);
    agent.session.append('tool/call',{turn:log.turn,step:log.step,
     callId:call.id,name:call.name,arguments:call.arguments});
    agent.session.append('tool/result',{turn:log.turn,step:log.step,message},
     {surfaceOp:'append'});
    return {callId:call.id,result:{isError:false,value,content}};
   }));
   return {results,additionalContexts:[],concluded:false};
 },
});
await mount('agentLoop',AgentLoop,{agents:[],maxParallelToolCalls:2});
console.log('SERVICES',{agents:!!ctx.agents,sessions:!!ctx.sessions,tools:!!ctx.tools,loop:!!ctx.agentLoop});
const turns=[],events=[];
let primaryCalls=0;
ctx.on('agent/status',data=>events.push({name:'status',status:data.status}));
ctx.on('agent/request-error',async(data,next)=>{events.push({name:'request-error',code:data.failure?.code,turn:data.turn,step:data.step});return next()});
ctx.on('agent/error',data=>{events.push({name:'agent-error',error:String(data.error?.message??data.error),turn:data.turn,step:data.step})});
ctx.on('agent/pre-step',(data,next)=>{
 events.push({name:'pre-step',selection:data.modelSelection,turn:data.turn,step:data.step});
 return next();
});
const fakeAdapter={
 providerInfo:()=>({id:'alpha18-fake',name:'Synthetic 2-model AgentLoop provider'}),
 providerRetryPolicy:()=>undefined,
 imageRequestPricing:()=>undefined,imageRequestTarget:()=>undefined,
 async listModels(){return [{id:'primary',provider:'alpha18-fake'},
   {id:'backup',provider:'alpha18-fake'}]},
 async resolveModel(provider,model){return {provider,id:model,name:model,inputModalities:['text']}},
 async prepareCall(provider,model){return {model:await this.resolveModel(provider,model),stream:options=>this.stream(options)}},
  async* stream(options){
   turns.push(options.model);
   if(scenario==='cancel'||scenario==='dispose'){
    assert.equal(options.model,'primary','no retry should execute after a real Agent cancellation or disposal');
    streamEntered.resolve();
    if(!options.signal?.aborted)await new Promise(resolve=>{
     options.signal.addEventListener('abort',resolve,{once:true});
    });
    yield {type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message:'synthetic Agent cancelled'}}};
    return;
   }
   if(options.model==='primary'){
     primaryCalls++;
     if(primaryCalls===1){
       yield {type:'block-start',index:0,blockType:'tool-call'};
       yield {type:'tool-call-delta',index:0,id:'once-tool-1',name:'record_once',
         argumentsDelta:'{"value":"exactly-once"}'};
       yield {type:'block-end',index:0,block:{type:'tool-call',id:'once-tool-1',
         name:'record_once',arguments:'{"value":"exactly-once"}'}};
        if(scenario==='parallel'){
         yield {type:'block-start',index:1,blockType:'tool-call'};
         yield {type:'tool-call-delta',index:1,id:'once-tool-2',name:'record_once',
          argumentsDelta:'{"value":"independent-second-tool"}'};
         yield {type:'block-end',index:1,block:{type:'tool-call',id:'once-tool-2',
          name:'record_once',arguments:'{"value":"independent-second-tool"}'}};
        }
        yield {type:'finish',reason:{kind:'tool-calls'}};
     }else{
        assert.equal(options.messages.filter(x=>x.role==='tool').length,
          scenario==='parallel'?2:1,'committed tool results must remain in the original Session');
       yield {type:'finish',reason:{kind:'error',failure:{
         code:'SERVER',message:'synthetic secondary step failure',status:503}}};
     }
   }else{
     yield {type:'block-start',index:0,blockType:'text'};
     yield {type:'text-delta',index:0,text:'ALPHA18_REAL_AGENTLOOP_RECOVERED'};
     yield {type:'block-end',index:0,block:{type:'text',text:'ALPHA18_REAL_AGENTLOOP_RECOVERED'}};
     yield {type:'finish',reason:{kind:'stop'}};
   }
 },
};
const detach=llm.registerAdapter(['alpha18-fake'],fakeAdapter);
let cfg=normalizeConfig({hostFailover:{enabled:true,mode:'off',priority:[
 {provider:'alpha18-fake',model:'primary'},
 {provider:'alpha18-fake',model:'backup'},
]}});
const store={get:()=>structuredClone(cfg),replace:value=>(cfg=normalizeConfig(value),structuredClone(cfg))};
const bridge=attachHostFailover(ctx,{configStore:store});
try{
 const handle=await ctx.agents.create({sessionId:'alpha18-real-agent',agentOptions:{
  provider:'alpha18-fake',model:'primary',
 }});
 const agent=handle.agent;
 console.log('CREATED',agent.id,agent.status,agent.model.current());
 agent.followup(createUserMessage({content:[{type:'text',text:'Synthetic offline AgentLoop with failover'}],
  source:{kind:'user'}}));
  if(scenario==='cancel'||scenario==='dispose'){
   await Promise.race([streamEntered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Model did not start')),10000))]);
   assert.equal(agent.status,'running');
   if(scenario==='cancel')agent.cancel({kind:'user'});
   else{
    bridge.dispose();
    await handle.dispose();
   }
   await Promise.race([agent.whenIdle(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Abort did not drain')),10000))]);
   await new Promise(resolve=>setTimeout(resolve,35));
   assert.deepEqual(turns,['primary']);
   assert.equal(toolExecutions,0);
   assert.equal(store.get().hostFailover.switchLog.length,0);
   if(scenario==='dispose')assert.equal(ctx.agents.get(agent.id),undefined);
   console.log(JSON.stringify({result:'PASS',scenario,modelCalls:turns,toolExecutions,
    modelSwitches:0,cancellationOrUnloadQuiesced:true,realAccountCalls:0}));
   if(scenario==='cancel')await handle.dispose();
  }else{
   await Promise.race([agent.whenIdle(),new Promise((_,reject)=>setTimeout(()=>reject(Error('AgentLoop timeout')),10000))]);
   // Model retry can be enqueued between the last status and the final idle.
   await new Promise(resolve=>setTimeout(resolve,110));
   await Promise.race([agent.whenIdle(),new Promise((_,reject)=>setTimeout(()=>reject(Error('AgentLoop failover timeout')),10000))]);
   const history=agent.session.snapshotEvents();
   const faultSteps=events.filter(x=>x.name==='request-error');
   assert.equal(faultSteps.length,1);
   assert.deepEqual({turn:faultSteps[0].turn,step:faultSteps[0].step},{turn:1,step:2});
   assert.deepEqual(turns,['primary','primary','backup']);
   const expectedTools=scenario==='parallel'?2:1;
   assert.equal(toolExecutions,expectedTools,'Committed tool must run exactly once after failover');
   if(scenario==='parallel')assert.equal(maxConcurrentTools,2,
     'two DSH ToolService batch calls must actually overlap in the synthetic executor');
   assert.equal(store.get().hostFailover.switchLog.length,1);
   assert.ok(JSON.stringify(history).includes('ALPHA18_REAL_AGENTLOOP_RECOVERED'));
   assert.equal(history.filter(x=>x.type==='tool/call').length,expectedTools);
   assert.equal(history.filter(x=>x.type==='tool/result').length,expectedTools);
   assert.equal(history.filter(x=>x.type==='model/selection').length,1);
   console.log(JSON.stringify({result:'PASS',scenario,runtime:'public Cordis, AgentLoop, AgentRegistry, SessionStore, SessionProjectionRegistry, ToolsService, LlmRuntime',modelCalls:turns,
    committedSyntheticToolExecutions:toolExecutions,maximumParallelSyntheticTools:maxConcurrentTools,
    toolCallEvents:expectedTools,toolResultEvents:expectedTools,failoverAt:{turn:1,step:2},
    continuationAt:{turn:2,step:1},backupAnswered:true,modelSwitches:1,sameAgentAndSession:true,
    externalToolOperations:0,realAccountCalls:0}));
   await handle.dispose();
  }
}finally{
   disposeExecutor();
   disposeTool();
  bridge.dispose();
 detach();
 for(const [,cls] of components.reverse())try{ctx.registry.delete(cls)}catch{}
}
console.log('PASS real DSH AgentLoop');
process.exit(0);
