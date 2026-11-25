import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {createEmbeddedChannelPack,SOURCE_PACK_PROVIDERS} from '../src/embedded-pack.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('12 permitted MIT channels pin the selected account; restricted ZCode never resolves credentials',async()=>{
 const dir=mkdtempSync('E:\\Temp\\dsh-native-router-isolated-');
 const rows=SOURCE_PACK_PROVIDERS.flatMap(provider=>[
  {id:provider+'-a',provider,enabled:true,credentialRef:'REF_'+provider+'_A'},
  {id:provider+'-b',provider,enabled:true,credentialRef:'REF_'+provider+'_B'},
 ]);
 const accesses=[];
 const creds={
  async resolve(ref){accesses.push(ref);return {value:JSON.stringify({selected:ref})}},
  async set(){throw Error('No credential updates during model inference')},
  async unset(){throw Error('No original logout')},
 };
 const pool={
  listAllAccounts:async()=>rows.map(x=>({...x})),
  listAccountsByProvider:p=>rows.filter(x=>x.provider===p),
  async getAvailableAccount(p,model,exclude){
   const row=rows.find(x=>x.provider===p&&x.enabled&&!exclude?.has(x.id));
   if(!row)return null;
   const credential=await creds.resolve(row.credentialRef);
   return {entry:row,credential:JSON.parse(credential.value)};
  },
 };
 let publishedPool=null;
 const scope={
  credentials:creds,
  get:k=>k==='accountPool'?publishedPool:k==='credentials'?creds:undefined,
  llm:{
   listProviders:async()=>['native-router'],
   stream(input){return (async function*(){
     const value=await pool.getAvailableAccount(input.provider,input.model);
     yield {type:'block-start',index:0,blockType:'text'};
     yield {type:'text-delta',index:0,text:value.credential.selected};
     yield {type:'block-end',index:0};
     yield {type:'finish',reason:{kind:'stop'}};
   })()},
  },
 };
 const config={embeddedPack:{enabled:true}};
 const env={
  DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE:'1',
  DSH_OPENAI_GATEWAY_ENABLED:'0',
  DSH_REASONING_LOOP_AUTO_RESUME:'0',
  DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE:'1',
  DSH_HOME:dir,DSH_CHANNEL_PACK_STATE_DIR:dir,
  DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT:'1',
 };
 const bridge=createEmbeddedChannelPack({ctx:{inject(_deps,cb){cb(scope)}},
  getConfig:()=>config,env,loadPack:async()=>({apply(){publishedPool=pool}})});
 try{
  bridge.attach();await tick();await tick();
  assert.equal(bridge.status().state,'mounted');
  assert.equal(bridge.status().exactAccountGate,'ready');
  for(const providerId of SOURCE_PACK_PROVIDERS){
   const request={providerId,sourceAccountId:providerId+'-b',model:'test-model',
    messages:[{role:'user',content:[{type:'text',text:'hello'}]}],tools:[]};
   if(providerId==='zcode'){
    const before=accesses.length;
    await assert.rejects(bridge.streamNative(request),{code:'OFFICIAL_CLIENT_ONLY'});
    assert.equal(accesses.length,before);continue;
   }
   const output=[];
   for await(const event of await bridge.streamNative(request))output.push(event);
   assert.equal(output.find(x=>x.type==='text-delta').text,'REF_'+providerId+'_B',providerId);
   assert.equal(accesses.at(-1),'REF_'+providerId+'_B',providerId);
   const outside=await pool.getAvailableAccount(providerId,'test-model');
   assert.equal(outside.entry.id,providerId+'-a','outside guard stays unmodified '+providerId);
  }
  assert.equal(rows.filter(x=>x.enabled).length,26);
 }finally{bridge.dispose();rmSync(dir,{recursive:true,force:true})}
});
