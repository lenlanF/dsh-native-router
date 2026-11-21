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
test('configured native models never suppress live channel model discovery and readable multiplier labels',async()=>{
 const cfg=normalizeConfig({...rows,providers:[{id:'codearts',name:'CodeArts',protocol:'native-channel',models:['configured-old']}]});
 const calls=[];
 const driver={generate:async()=>({text:'ok',finishReason:'stop',toolCalls:[]}),
  listModels:async({account})=>{
   calls.push(account.id);
   if(account.id==='ca_ALPHA')throw Error('expired account');
   return [{id:'new-online-model',name:'New Live Model · x0.00'},
    {id:'configured-old',name:'Configured Model'}];
  }};
 const catalog=createCatalog({getConfig:()=>cfg,channelDrivers:new Map([['codearts',driver]])});
 const list=await catalog.list();
 assert.deepEqual(calls,['ca_ALPHA','ca_BETA']);
 assert.ok(list.some(row=>row.id==='direct:codearts:configured-old'));
 const fresh=list.find(row=>row.id==='direct:codearts:new-online-model');
 assert.ok(fresh,'a stale configured roster cannot hide models newly listed by a working login');
 assert.equal(fresh.name,'CodeArts · New Live Model · x0.00');
 assert.equal(list.filter(row=>row.id==='direct:codearts:configured-old').length,1);
 assert.equal((await catalog.list()).length,list.length);
 assert.equal(calls.length,2,'cached model lists do not trigger duplicate remote discovery');
});
test('model discovery respects a verified dynamic upstream catalog and avoids duplicate private-channel scans',async()=>{
 const cfg=normalizeConfig({...rows,providers:[{id:'codearts',name:'CodeArts',protocol:'native-channel',models:['manual']} ]});
 let called=0;
 const driver={generate:async()=>{},listModels:async()=>{called++;return [{id:'extra'}]}};
 const upstream={refresh:async()=>{},effectiveConfig:()=>cfg,
  snapshot:()=>({catalog:[{providerId:'codearts',model:'upstream',name:'Cloud Live · x1.20',kind:'owned-source'}]})};
 const list=await createCatalog({getConfig:()=>cfg,channelDrivers:new Map([['codearts',driver]]),
  autoFreePool:upstream}).list();
 assert.ok(list.some(row=>row.id==='direct:codearts:manual'));
 assert.equal(list.find(row=>row.id==='direct:codearts:upstream').name,'CodeArts · Cloud Live · x1.20');
 assert.equal(called,0,'do not query a source twice after its isolated pack returned a fresh directory');
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
