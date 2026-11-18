import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {sample} from './fixtures.mjs';
function createUiRig(drivers=new Map(),embeddedPreview=null,embeddedStatus={state:'disabled',reason:''},sourceRpcOverrides={},hostProviders=[],hostModelResult){
  let cfg=normalizeConfig(sample),sequence=0,effectFn,component;
  const hooks=[];
  const react={
    Fragment:'fragment',
    createElement(type,props,...children){return {type,props:{...props,children:children.length===1?children[0]:children},children}},
    useState(initial){
      const pos=sequence++;
      if(!(pos in hooks))hooks[pos]=initial;
      return [hooks[pos],v=>{hooks[pos]=typeof v==='function'?v(hooks[pos]):v}];
    },
    useEffect(fn){if(!effectFn)effectFn=fn},
    useCallback(fn){return fn},
  };
  const configStore={get:()=>structuredClone(cfg),replace:v=>(cfg=normalizeConfig(v))};
  const accountCenter=createAccountCenter({configStore,drivers,env:{NATIVE_ROUTER_TEST_KEY:'x',LOCAL_TEST_KEY:'x'},
    vault:{resolve:async()=>({value:'x'})},
    fetchImpl:async()=>new Response('{"data":[]}',{status:200})});
  const checkinCenter=createCheckinCenter({configStore,accountCenter,
    store:{all:()=>[],append:()=>{throw Error('never sign in unsupported adapters')}}});
  const mutations=[];
  const response=content=>({ok:true,status:200,json:async()=>content});
  const fetch=async (url,options={})=>{
    const key=url.split('/plugins/dsh-native-router')[1];
    if(url==='/api/dsh-native-router/channel-pack'){
      assert.equal(JSON.parse(options.body).method,'native-router-channel-pack');
      const input=JSON.parse(options.body),method=input.payload?.method;
      mutations.push({kind:'source-rpc',method,payload:input.payload?.payload});
      let value={};
      if(method==='account.create')value={accountId:'qoder-new',loginUrl:'https://login.example.test/authorize'};
      else if(method==='login.poll')value={done:true,success:true};
      else if(method==='account.refresh')value={success:true};
      else if(method==='credits.status')value={accounts:[{accountId:'qoder-01',
        status:{active:true,todayCheckedIn:false}}]};
      else if(method==='credits.claimAll')value={results:[{accountId:'qoder-01',outcome:{kind:'claimed'}}]};
      else throw Error('Unexpected upstream method '+method);
      if(typeof sourceRpcOverrides[method]==='function')
        return sourceRpcOverrides[method]({input,value,response});
      return response({type:'server-response',rpcId:input.rpcId,result:{ok:true,value}});
    }
    if(key==='/config'){
      if(options.method==='POST'){const next=configStore.replace(JSON.parse(options.body));mutations.push({kind:'save'});return response({ok:true,config:next})}
      return response({ok:true,config:configStore.get()});
    }
    if(key==='/status')return response({ok:true,embeddedPack:embeddedStatus,sessionReuse:{hostProviders}});
    if(key==='/channels/embedded/account-remove'){
      const input=JSON.parse(options.body);mutations.push({kind:'upstream-delete',...input});
      if(embeddedPreview)embeddedPreview.accounts=embeddedPreview.accounts.filter(row=>
        row.id!==input.accountId||row.providerId!==input.providerId);
      return response({ok:true,result:{state:'removed',removed:true}});
    }
    if(key==='/channels/accounts')return response({ok:true,...accountCenter.list(),
      sessionReuse:{hostProviders},...(embeddedPreview?{embeddedAccounts:embeddedPreview}:{})});
    if(key==='/channels/adopt/preview'){
       mutations.push({kind:'adoption-preview'});
       return response({ok:true,result:{state:'ready',ownPackState:'mounted',plugins:[
        {providerId:'workbuddy',name:'WorkBuddy',installed:true,version:'5.24.10'},
        {providerId:'lingxi',name:'Lingxi',installed:true,version:'0.5.9'},
        {providerId:'loomy',name:'Loomy',installed:true,version:'0.5.3'},
        {providerId:'zcode-start-plan',name:'ZCode Start Plan',installed:true,version:'1.0.3'},
       ],accounts:[
        {providerId:'qoder',accountId:'qoder-test',label:'Qoder Test',portable:true},
        {providerId:'workbuddy',accountId:'wb-private',label:'WorkBuddy private',portable:false}]}});
     }
     if(key==='/channels/adopt'){
       const input=JSON.parse(options.body);
       mutations.push({kind:'adoption',...input});
       return response({ok:true,result:{state:'stored_unverified',providerId:input.providerId,
         activation:'requires_original_stop_and_host_restart',originalAccountUnchanged:true}});
     }
if(key==='/host/models'){
      const input=JSON.parse(options.body);mutations.push({kind:'host-model-query',providerId:input.providerId});
      return response({ok:true,result:hostModelResult??{state:'ready',providerId:input.providerId,
        models:[{id:'wb-native-flash',name:'WorkBuddy Native Flash'}],loginVerified:false}});
    }
    if(key==='/channels/embedded/models'){
      const input=JSON.parse(options.body);mutations.push({kind:'models',...input});
      return response({ok:true,result:{state:'ready',providerId:input.providerId,
        models:[{id:'source-test',name:'Source Model',upstreamFreeLabel:true}]}});
    }
    if(key==='/channels/embedded/account-state'){
      const input=JSON.parse(options.body);mutations.push({kind:'upstream-toggle',...input});
      const row=embeddedPreview?.accounts?.find(x=>x.id===input.accountId&&x.providerId===input.providerId);
      if(row)row.enabled=input.enabled;
      return response({ok:true,result:{state:'updated',changed:true,enabled:input.enabled}});
    }
    if(key==='/checkins')return response({ok:true,...checkinCenter.snapshot()});
    if(key==='/channels/accounts/action'){
      const input=JSON.parse(options.body);mutations.push(input);
      if(input.action==='refresh-all')return response({ok:true,...await accountCenter.refreshAll()});
      if(input.action==='login')return response({ok:true,result:await accountCenter.verify(input.accountId,{login:true})});
      if(input.action==='refresh')return response({ok:true,result:await accountCenter.verify(input.accountId)});
      if(input.action==='enable')return response({ok:true,result:accountCenter.setEnabled(input.accountId,input.enabled)});
      return response({ok:false,error:'unsupported in UI test'});
    }
    throw Error('Unexpected fetch '+url);
  };
  let mod;
  const code=readFileSync(new URL('../client.js',import.meta.url),'utf8');
  const browser={__ModuleLoader__:{load:input=>{mod=input}},confirm:()=>true,URL};
  vm.runInNewContext(code,{window:browser,fetch,console,structuredClone,Date,JSON,URL});
  const plugin=mod.factory(name=>name==='react'?react:undefined);
  plugin.apply({slots:{inject(_id,register){register();return()=>{}},
    register(_meta,comp){component=comp;return()=>{}}},effect(){}});
  function expand(node){
    if(Array.isArray(node))return node.map(expand);
    if(node===null||node===undefined||typeof node!=='object')return node;
    if(typeof node.type==='function')return expand(node.type(node.props));
    return {...node,children:expand(node.children)};
  }
  function flatten(node){
    if(Array.isArray(node))return node.flatMap(flatten);
    if(node===null||node===undefined)return [];
    if(typeof node!=='object')return [String(node)];
    return flatten(node.children);
  }
  function find(tree,type,label){
    const found=[];
    function visit(node){
      if(Array.isArray(node)){node.forEach(visit);return}
      if(!node||typeof node!=='object')return;
      if(node.type===type&&flatten(node).join('')===label)found.push(node);
      visit(node.children);
    }
    visit(tree);
    return found;
  }
  function render(){sequence=0;return expand(component())}
  return {render,init:async()=>{render();effectFn();for(let i=0;i<60&&!hooks[0];i++)await new Promise(resolve=>setTimeout(resolve,1));if(!hooks[0])throw Error('Configuration was not loaded')},find,flatten,mutations,get cfg(){return cfg}};
}
test('dashboard distinguishes WorkBuddy native DSH provider routes from authenticated account sessions',async()=>{
 const hostProviders=[
  {providerId:'workbuddy',family:'workbuddy-native-plugin-route',accountAccess:'plugin-managed-or-unknown',loginVerified:false},
  {providerId:'workbuddy-global',family:'workbuddy-native-plugin-route',accountAccess:'plugin-managed-or-unknown',loginVerified:false},
 ];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},hostProviders);await rig.init();
 const overview=rig.flatten(rig.render()).join(' ');
 assert.match(overview,/渠道与聚合路由运行总览/);
 assert.match(overview,/WorkBuddy 国内原生路由/);
 assert.match(overview,/WorkBuddy 国际原生路由/);
 assert.match(overview,/路由已注册 · 登录未核实/);
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  const channels=rig.flatten(rig.render()).join(' ');
  assert.match(channels,/宿主原生渠道/);
  assert.match(channels,/WorkBuddy · 国际/);
  assert.doesNotMatch(channels,/已连接验证/);
});
test('host-owned WorkBuddy model can be selected into DSH failover without importing account credentials',async()=>{
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[
  {providerId:'workbuddy-global',family:'workbuddy-native-plugin-route',accountAccess:'plugin-managed-or-unknown',loginVerified:false},
 ]);
 await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  await rig.find(rig.render(),'button','查看模型')[0].props.onClick();
  assert.ok(rig.mutations.some(x=>x.kind==='host-model-query'&&x.providerId==='workbuddy-global'));
  assert.match(rig.flatten(rig.render()).join(' '),/WorkBuddy Native Flash/);
  rig.find(rig.render(),'button','加入故障切换')[0].props.onClick();
  assert.match(rig.flatten(rig.render()).join(' '),/宿主故障切换/);
  await rig.find(rig.render(),'button','保存配置')[0].props.onClick();
  assert.ok(rig.cfg.hostFailover.priority.some(r=>r.provider==='workbuddy-global'&&r.model==='wb-native-flash'));
  assert.equal(rig.cfg.accounts.some(a=>a.providerId==='workbuddy-global'),false);
  assert.ok(!rig.mutations.some(x=>x.action==='login'||x.action==='logout'));
});
test('reuse tab imports an existing host model into an actually selectable aggregate route without shadow login',async()=>{
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[
  {providerId:'workbuddy-global',family:'workbuddy-native-plugin-route',
   accountAccess:'plugin-managed-or-unknown',loginVerified:false},
 ]);
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 await rig.find(rig.render(),'button','查看模型')[0].props.onClick();
 const page=rig.render();
 assert.equal(rig.find(page,'button','接入聚合路由').length,1);
 rig.find(page,'button','接入聚合路由')[0].props.onClick();
 assert.equal(rig.cfg.providers.some(p=>p.id==='workbuddy-global'),false,
  'a UI draft must not mutate the saved host config');
 await rig.find(rig.render(),'button','保存配置')[0].props.onClick();
 const provider=rig.cfg.providers.find(p=>p.id==='workbuddy-global');
 assert.equal(provider.protocol,'dsh-host');
 assert.deepEqual(provider.models,['wb-native-flash']);
 const route=rig.cfg.routes.find(r=>r.id==='host_workbuddy-global');
 assert.ok(route&&route.enabled);
 assert.equal(route.tiers[0].model,'wb-native-flash');
 assert.ok(!rig.cfg.accounts.some(a=>a.providerId==='workbuddy-global'),
  'no duplicate DSH account must be created');
 assert.ok(!rig.mutations.some(x=>x.action==='login'||x.action==='logout'));
});
test('an installed host provider with empty model directory supports a manually verified model ID without a shadow account',async()=>{
 const host=[{providerId:'deepseek-official',family:'dsh-provider-route',loginVerified:false}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},host,
  {state:'unavailable',providerId:'deepseek-official',models:[]});
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 await rig.find(rig.render(),'button','查看模型')[0].props.onClick();
 let page=rig.render();
 assert.match(rig.flatten(page).join(' '),/原插件未发布模型目录/);
 assert.equal(rig.find(page,'button','按 ID 接入')[0].props.disabled,true);
 const findManual=node=>{
  if(Array.isArray(node))return node.map(findManual).find(Boolean);
  if(!node||typeof node!=='object')return null;
  if(node.type==='input'&&node.props.placeholder==='从原插件复制 ID')return node;
  return findManual(node.children);
 };
 const input=findManual(page);
 assert.ok(input,'manual host model input should be accessible even when no source model directory exists');
 input.props.onChange({target:{value:'deepseek-chat'}});
 page=rig.render();
 assert.equal(rig.find(page,'button','按 ID 接入')[0].props.disabled,false);
 rig.find(page,'button','按 ID 接入')[0].props.onClick();
 await rig.find(rig.render(),'button','保存配置')[0].props.onClick();
 assert.ok(rig.cfg.providers.some(x=>x.id==='deepseek-official'&&x.models.includes('deepseek-chat')));
 assert.ok(rig.cfg.routes.some(x=>x.tiers.some(t=>t.model==='deepseek-chat')));
 assert.equal(rig.cfg.accounts.some(x=>x.providerId==='deepseek-official'),false);
});
test('source login tab distinguishes host reuse from independent source login',async()=>{
 const pack={state:'mounted',channelCount:1,channels:['loomy'],skippedProviders:['workbuddy']};
 const rig=createUiRig(new Map(),{state:'ready',accounts:[]},pack,{},[
  {providerId:'workbuddy',family:'workbuddy-native-plugin-route',loginVerified:false},
 ]);
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 const text=rig.flatten(rig.render()).join(' ');
 assert.match(text,/可自主授权 1 个/);
 assert.match(text,/宿主已有 1 个同名原渠道 · 自主登录仍可用/);
 assert.equal(rig.find(rig.render(),'button','发起扫码\/网页登录').length,1);
 await rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.onClick();
 const mutation=rig.mutations.find(x=>x.kind==='source-rpc'&&x.method==='account.create');
 assert.equal(mutation.payload.provider,'loomy');
 assert.ok(!rig.mutations.some(x=>x.kind==='source-rpc'&&x.payload?.provider==='workbuddy'));
});
test('reuse adoption tab requires deliberate account selection, never auto-copies credentials or accepts private-only sessions',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','本机登录态')[0].props.onClick();
 assert.ok(!rig.mutations.some(x=>x.kind?.startsWith('adoption')),
  'opening the reuse tab must not read or copy credentials');
 const page=rig.render();
 await rig.find(page,'button','检查原插件账号')[0].props.onClick();
 assert.equal(rig.mutations.filter(x=>x.kind==='adoption-preview').length,1);
 const buttons=rig.find(rig.render(),'button','接管到本插件');
 assert.equal(buttons.length,1);
 assert.equal(buttons[0].props.disabled,false);
 const blocked=rig.find(rig.render(),'button','暂不能迁移');
 assert.equal(blocked.length,1);
 assert.equal(blocked[0].props.disabled,true);
 const cardText=rig.flatten(rig.render()).join(' ');
 assert.match(cardText,/Lingxi/);
 assert.match(cardText,/ZCode Start Plan/);
 assert.match(cardText,/WorkBuddy/);
 assert.match(cardText,/Loomy/);
 await buttons[0].props.onClick();
 const imported=rig.mutations.filter(x=>x.kind==='adoption');
 assert.equal(imported.length,1);
 assert.deepEqual(imported[0],{kind:'adoption',providerId:'qoder',
  accountId:'qoder-test',consent:true});
 assert.ok(!JSON.stringify(rig.mutations).includes('Bearer'));
 assert.match(rig.flatten(rig.render()).join(' '),/授权副本已保存/);
 assert.match(rig.flatten(rig.render()).join(' '),/已接管 · 待验证/);
});
test('real client render: channel account page exposes login, refresh, logout and enable controls',async()=>{
  const rig=createUiRig();await rig.init();
  let page=rig.render();
  const button=rig.find(page,'button','渠道账号')[0];
  assert.ok(button,'渠道账号 tab should exist');
  button.props.onClick();
   rig.find(rig.render(),'button','查看待接入渠道')[0].props.onClick();
   page=rig.render();
  const text=rig.flatten(page).join(' ');
  assert.match(text,/华为云 CodeArts/);
  assert.match(text,/腾讯 WorkBuddy/);
  assert.match(text,/账号状态/);
  assert.ok(rig.find(page,'button','登录/校验').length>=1);
  assert.ok(rig.find(page,'button','刷新').length>=1);
  assert.ok(rig.find(page,'button','退出/解绑').length>=1);
  assert.ok(rig.find(page,'button','停用').length>=1);
});
test('real client render: login button triggers account authentication probe, not a fake success',async()=>{
  const rig=createUiRig();await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  let page=rig.render();
  const login=rig.find(page,'button','登录/校验')[0];
  await login.props.onClick();
  assert.ok(rig.mutations.some(m=>m.action==='login'));
  page=rig.render();
  assert.match(rig.flatten(page).join(' '),/已连接验证/);
});
test('real client render: daily check-in page displays per-channel statuses and disabled unsupported actions',async()=>{
  const rig=createUiRig();await rig.init();
  rig.find(rig.render(),'button','每日签到')[0].props.onClick();
  let page=rig.render();
  const texts=rig.flatten(page).join(' ');
  assert.match(texts,/今日签到/);
  assert.match(texts,/华为云 CodeArts/);
  assert.match(texts,/待适配/);
  const actions=rig.find(page,'button','立即签到');
  assert.equal(actions.length,3);
  assert.ok(actions.every(x=>x.props.disabled===true));
});


test('upstream read-only account preview shows source states without falsely enabling login actions',async()=>{
 const preview={state:'ready',accounts:[{id:'wb-9',providerId:'workbuddy',nickname:'Test WorkBuddy',
  enabled:true,connectionState:'not_checked'},{id:'lm-8',providerId:'loomy',nickname:'Test Loomy',
  enabled:false,connectionState:'not_checked'}]};
 const rig=createUiRig(new Map(),preview);await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 const page=rig.render(),label=rig.flatten(page).join(' ');
 assert.match(label,/来源账号 2 个/);
 assert.match(label,/Test WorkBuddy/);
 assert.match(label,/Test Loomy/);
 assert.match(label,/登录状态未知 · 仅查看/);
 assert.ok(rig.find(page,'button','停用来源账号').every(x=>x.props.disabled),
   'source controls must be disabled when pack is not mounted');
  assert.equal(rig.find(page,'button','登录/校验').length,0,
    'source preview never creates new login buttons; own configured account actions live on the account tab');
});

test('mounted upstream channel controls query models explicitly and require confirmation for toggle',async()=>{
 const preview={state:'ready',accounts:[{id:'loomy-01',providerId:'loomy',nickname:'Test source account',
  enabled:true,connectionState:'not_checked'}]};
 const source={state:'mounted',channelCount:13,channels:['loomy','workbuddy']};
 const rig=createUiRig(new Map(),preview,source);await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 let page=rig.render();
 assert.match(rig.flatten(page).join(' '),/已在 DSH 内挂载/);
 assert.equal(rig.find(page,'button','查询模型').length,1);
 assert.equal(rig.find(page,'button','停用来源账号').length,1);
 assert.ok(!rig.mutations.some(x=>x.kind==='models'),'model queries cannot be automatic');
 await rig.find(page,'button','查询模型')[0].props.onClick();
 assert.ok(rig.mutations.some(x=>x.kind==='models'&&x.providerId==='workbuddy'));
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/来源标记免费 · 未核实/);
 rig.find(page,'button','停用来源账号')[0].props.onClick();
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.ok(rig.mutations.some(x=>x.kind==='upstream-toggle'&&x.accountId==='loomy-01'&&x.enabled===false));
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/来源池已停用/);
});
test('WorkBuddy onboarding: a registered driver is offered as disabled provider, not a fake logged-in account',async()=>{
 const rig=createUiRig(new Map([['workbuddy',{
   generate:async()=>({text:'mock',finishReason:'stop',toolCalls:[]}),
   discover:async()=>[],
   refresh:async()=>({state:'expired',message:'not authenticated'}),
 }]]));
 await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  rig.find(rig.render(),'button','查看待接入渠道')[0].props.onClick();
 let page=rig.render();
 assert.match(rig.flatten(page).join(' '),/原生驱动已就绪/);
 const add=rig.find(page,'button','配置此渠道');
 assert.equal(add.length,1);
 add[0].props.onClick();
 page=rig.render();
 assert.ok(rig.find(page,'button','保存配置').length>=1);
 assert.equal(rig.cfg.providers.some(x=>x.id==='workbuddy'),false,'draft must not mutate config before save');
 await rig.find(page,'button','保存配置')[0].props.onClick();
 assert.equal(rig.cfg.providers.find(x=>x.id==='workbuddy').enabled,false);
 assert.equal(rig.cfg.accounts.length,3);
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 page=rig.render();
 assert.ok(rig.find(page,'button','扫描本机授权账号').length>=1,
   'scan is only offered after user intentionally creates the channel');
});

test('CodeArts custom account channel is configurable from the common account overview without fake OAuth success',async()=>{
 const rig=createUiRig(new Map([['codearts',{
   generate:async()=>({text:'mock',finishReason:'stop',toolCalls:[]}),
   refresh:async()=>({state:'pending',message:'test'}),
   discover:async()=>[{id:'ca_ALPHA',label:'CodeArts ALPHA',source:'environment'}],
 }]]));
 await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  rig.find(rig.render(),'button','查看待接入渠道')[0].props.onClick();
 let page=rig.render();
 const text=rig.flatten(page).join(' ');
 assert.match(text,/华为云 CodeArts/);
 assert.match(text,/原生驱动已就绪/);
 assert.ok(rig.find(page,'button','配置此渠道').length>=1);
 assert.equal(rig.cfg.accounts.length,3,'channel opening cannot create accounts silently');
});
test('isolated source account console explicitly runs upstream login, poll, refresh and guarded logout',async()=>{
 const preview={state:'ready',accounts:[{id:'qoder-01',providerId:'qoder',nickname:'Qoder test',
   enabled:true,refreshable:true,connectionState:'not_checked'}]};
 const source={state:'mounted',channelCount:13,channels:['qoder','workbuddy']};
 const rig=createUiRig(new Map(),preview,source);await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 let page=rig.render();
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0,
   'opening account overview must not automatically start OAuth or refresh');
  assert.equal(rig.find(page,'button','发起扫码/网页登录').length,1);
  await rig.find(page,'button','发起扫码/网页登录')[0].props.onClick();
 assert.deepEqual(rig.mutations.filter(row=>row.kind==='source-rpc').map(row=>row.method),['account.create']);
 page=rig.render();
 const link=rig.find(page,'a','打开授权链接（先核对域名）')[0];
  assert.ok(link,'safe link absent: '+rig.flatten(page).join(' | '));
  assert.equal(link.props.href,'https://login.example.test/authorize');
 assert.equal(link.props.rel,'noopener noreferrer');
 assert.match(rig.flatten(page).join(' '),/检查登录结果/);
 await rig.find(page,'button','检查登录结果')[0].props.onClick();
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').at(-1).method,'login.poll');
 page=rig.render();
 assert.doesNotMatch(rig.flatten(page).join(' '),/来源账号在线已验证/);
 await rig.find(page,'button','刷新来源凭据')[0].props.onClick();
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').at(-1).method,'account.refresh');
 page=rig.render();
  assert.equal(rig.find(page,'button','退出来源账号（尝试清凭据）').length,1);
  await rig.find(page,'button','退出来源账号（尝试清凭据）')[0].props.onClick();
  assert.equal(rig.mutations.filter(row=>row.kind==='upstream-delete').length,1);
 assert.equal(rig.mutations.filter(row=>row.kind==='upstream-delete')[0].acknowledgedSourceCredentialDeletion,true);
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').some(row=>row.method==='account.delete'),false);
});
test('source checkin reads per-account status; bulk claim requires explicit choice and fresh recheck',async()=>{
 const source={state:'mounted',channelCount:13,channels:['qoder','workbuddy']};
 const rig=createUiRig(new Map(),{state:'ready',accounts:[]},source);await rig.init();
 rig.find(rig.render(),'button','每日签到')[0].props.onClick();
 let page=rig.render();
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0);
 const claimButton=rig.find(page,'button','批量领取（该渠道所有账号）')[0];
 assert.equal(claimButton.props.disabled,true,'bulk claim must require an explicit status check');
 await rig.find(page,'button','查询来源签到状态')[0].props.onClick();
 assert.deepEqual(rig.mutations.filter(row=>row.kind==='source-rpc').map(row=>row.method),['credits.status']);
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/来源报告：今天尚未签到/);
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.disabled,false);
 await rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.onClick();
 assert.deepEqual(rig.mutations.filter(row=>row.kind==='source-rpc').map(row=>row.method),
   ['credits.status','credits.claimAll']);
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/claimed · 尚未复核/);
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.disabled,true);
 assert.match(rig.flatten(page).join(' '),/当前未查询这个渠道/);
 const select=rig.find(page,'select','qoderworkbuddy')[0];
 assert.ok(select);
 select.props.onChange({target:{value:'workbuddy'}});
 page=rig.render();
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.disabled,true);
 assert.match(rig.flatten(page).join(' '),/未提供每日签到领取/);
});
test('disabled channel pack exposes no source login, source checkin or bulk claim actions',async()=>{
 const rig=createUiRig();await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
  let page=rig.render();
  assert.equal(rig.find(page,'button','发起扫码/网页登录').length,0);
 rig.find(page,'button','每日签到')[0].props.onClick();
 page=rig.render();
 assert.equal(rig.find(page,'button','查询来源签到状态').length,0);
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）').length,0);
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0);
});
test('upstream login suppresses unsafe authorization URLs instead of making them clickable',async()=>{
  const pack={state:'mounted',channelCount:13,channels:['workbuddy']};
  for(const dangerous of ['javascript:alert(1)','http://evil.example/authorize',
    'https://user:password@login.example.test/authorize']){
    const rig=createUiRig(new Map(),{state:'ready',accounts:[]},pack,{
      'account.create':({input,response})=>response({
        type:'server-response',rpcId:input.rpcId,
        result:{ok:true,value:{accountId:'workbuddy-test',loginUrl:dangerous}},
      }),
    });
    await rig.init();
    rig.find(rig.render(),'button','复用管理')[0].props.onClick();
    rig.find(rig.render(),'button','自主登录')[0].props.onClick();
    await rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.onClick();
    const page=rig.render();
    assert.equal(rig.find(page,'a','打开授权链接（先核对域名）').length,0);
    assert.match(rig.flatten(page).join(' '),/未提供安全授权链接/);
  }
});
test('upstream raw error details and forged RPC identifiers are rejected without leaking secrets',async()=>{
  const pack={state:'mounted',channelCount:13,channels:['workbuddy']};
  const badResponses=[
    ({input,response})=>response({type:'server-response',rpcId:input.rpcId,
      result:{ok:false,error:{code:'channel-pack/handler-failed',message:'Bearer SECRET_TOKEN_XYZ'}}}),
    ({input,response})=>response({type:'server-response',rpcId:'forged-rpc-id',
      result:{ok:true,value:{accountId:'invalid',loginUrl:'https://example.com'}}}),
  ];
  for(const reply of badResponses){
    const rig=createUiRig(new Map(),{state:'ready',accounts:[]},pack,{'account.create':reply});
    await rig.init();
     rig.find(rig.render(),'button','复用管理')[0].props.onClick();
     rig.find(rig.render(),'button','自主登录')[0].props.onClick();
     await rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.onClick();
    const page=rig.render(),text=rig.flatten(page).join(' ');
    assert.doesNotMatch(text,/SECRET_TOKEN_XYZ|Bearer/);
    assert.equal(rig.find(page,'a','打开授权链接（先核对域名）').length,0);
    assert.match(text,/上游拒绝操作|响应校验失败/);
  }
});
test('malformed upstream JSON errors are not forwarded with secret-bearing parser messages',async()=>{
  const pack={state:'mounted',channelCount:13,channels:['workbuddy']};
  const rig=createUiRig(new Map(),{state:'ready',accounts:[]},pack,{
    'account.create':()=>({ok:true,status:200,json:async()=>{throw Error('SECRET_FROM_UNSAFE_JSON')}}),
  });
  await rig.init();
   rig.find(rig.render(),'button','复用管理')[0].props.onClick();
   rig.find(rig.render(),'button','自主登录')[0].props.onClick();
   await rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.onClick();
  const page=rig.render(),message=rig.flatten(page).join(' ');
  assert.doesNotMatch(message,/SECRET_FROM_UNSAFE_JSON/);
  assert.match(message,/上游 DSH 响应不是有效 JSON/);
  assert.equal(rig.find(page,'a','打开授权链接（先核对域名）').length,0);
});
