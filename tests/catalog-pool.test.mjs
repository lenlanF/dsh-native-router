import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../src/catalog.mjs';
import {normalizeConfig} from '../src/config.mjs';

const rows=normalizeConfig({providers:[{id:'codearts',name:'CodeArts',protocol:'native-channel'}],
 accounts:[{id:'ca_ALPHA',providerId:'codearts',credentialRef:'driver:codearts:ca_ALPHA'},
  {id:'ca_BETA',providerId:'codearts',credentialRef:'driver:codearts:ca_BETA'}],routes:[]});
test('native provider model catalog continues after first account expires and unions working peers',async()=>{
 const called=[];
 const driver={generate:async()=>({text:'ok',finishReason:'stop',toolCalls:[]}),
  listModels:async({account})=>{
   called.push(account.id);
   if(account.id==='ca_ALPHA')throw Error('Expired');
   return [{id:'glm-from-beta'},{id:'same-model'}];
  }};
 const cat=createCatalog({getConfig:()=>rows,channelDrivers:new Map([['codearts',driver]])});
 const found=await cat.list();
 assert.deepEqual(called,['ca_ALPHA','ca_BETA']);
 assert.ok(found.some(x=>x.id==='direct:codearts:glm-from-beta'));
 assert.equal((await cat.list()).length,found.length,'model catalog should cache successful peer results');
 assert.equal(called.length,2);
});
test('native provider discovery merges models of multiple valid accounts without duplicates',async()=>{
 const driver={generate:async()=>({text:'',finishReason:'stop',toolCalls:[]}),
  listModels:async({account})=>account.id==='ca_ALPHA'?
    [{id:'glm-alpha'},{id:'shared'}]:[{id:'glm-beta'},{id:'shared'}]};
 const list=await createCatalog({getConfig:()=>rows,channelDrivers:new Map([['codearts',driver]])}).list();
 assert.deepEqual(list.map(x=>x.id).sort(),[
  'direct:codearts:glm-alpha','direct:codearts:glm-beta','direct:codearts:shared']);
});
test('model catalog does not perform discovery for disabled peers',async()=>{
 const cfg=normalizeConfig({...rows,accounts:rows.accounts.map(x=>({...x,enabled:x.id==='ca_BETA'}))});
 const calls=[];
 const driver={generate:async()=>({text:'',finishReason:'stop',toolCalls:[]}),
  listModels:async({account})=>{calls.push(account.id);return [{id:'model'}]}};
 const listed=await createCatalog({getConfig:()=>cfg,channelDrivers:new Map([['codearts',driver]])}).list();
 assert.equal(listed.length,1);assert.deepEqual(calls,['ca_BETA']);
});
test('generic OpenAI credential discovery survives first account auth failure',async()=>{
 const config=normalizeConfig({providers:[{id:'generic',name:'Generic',protocol:'openai-chat',baseUrl:'https://api.example.invalid/v1'}],
  accounts:[{id:'g1',providerId:'generic',credentialRef:'env:KEY_G1'},
   {id:'g2',providerId:'generic',credentialRef:'env:KEY_G2'}],routes:[]});
 const requests=[];
 const catalog=createCatalog({getConfig:()=>config,credentialOptions:{env:{KEY_G1:'bad',KEY_G2:'good'}},
  fetchImpl:async(url,options)=>{
   requests.push(options.headers.authorization);
   return options.headers.authorization==='Bearer bad'?new Response('',{status:401}):
     new Response(JSON.stringify({data:[{id:'working'}]}),{status:200});
  }});
 const listed=await catalog.list();
 assert.equal(listed[0].id,'direct:generic:working');
 assert.deepEqual(requests,['Bearer bad','Bearer good']);
});
