import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeConfig} from '../src/config.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {sample} from './fixtures.mjs';
function createUiRig(drivers=new Map(),embeddedPreview=null,embeddedStatus={state:'disabled',reason:''},sourceRpcOverrides={},hostProviders=[],hostModelResult,confirmFn=()=>true,accountSnapshot,activitySnapshot){  let cfg=normalizeConfig(sample),sequence=0,effectFn,tabEffectFn,component;
  const hooks=[];
  const react={
    Fragment:'fragment',
    createElement(type,props,...children){return {type,props:{...props,children:children.length===1?children[0]:children},children}},
    useState(initial){
      const pos=sequence++;
      if(!(pos in hooks))hooks[pos]=initial;
      return [hooks[pos],v=>{hooks[pos]=typeof v==='function'?v(hooks[pos]):v}];
    },
    useEffect(fn){if(!effectFn)effectFn=fn;else tabEffectFn=fn},
    useCallback(fn){return fn},
    useRef(value){const pos=sequence++;if(!(pos in hooks))hooks[pos]={current:value};return hooks[pos]},
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
      else if(method==='login.sendSms')value={msgid:'simulated-message'};
      else if(method==='login.submitSms')value={done:true};
      else if(method==='login.poll')value={done:true,success:true};
      else if(method==='account.refresh')value={success:true};      else if(method==='credits.status')value={accounts:[{accountId:'qoder-01',
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
    if(key==='/models/autofree'||key==='/models/autofree/refresh'){
      if(key.endsWith('/refresh'))mutations.push({kind:'autofree-refresh'});
      return response({ok:true,result:{state:'ready',models:[],catalog:[],unknownPricing:0}});
    }
    if(key==='/channels/adopt/verify'){
      mutations.push({kind:'adoption-verify'});
      return response({ok:true,attempted:0,results:[]});
    }
    if(key==='/channels/embedded/account-remove'){
      const input=JSON.parse(options.body);mutations.push({kind:'upstream-delete',...input});
      if(embeddedPreview)embeddedPreview.accounts=embeddedPreview.accounts.filter(row=>
        row.id!==input.accountId||row.providerId!==input.providerId);
      return response({ok:true,result:{state:'removed',removed:true}});
    }
    if(key==='/channels/accounts')return response(accountSnapshot??{ok:true,...accountCenter.list(),
      sessionReuse:{hostProviders},...(embeddedPreview?{embeddedAccounts:embeddedPreview}:{})});    if(key==='/channels/adopt/preview'){
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
if(key==='/host/catalog'){
      mutations.push({kind:'host-catalog'});
      return response({ok:true,providers:[
        {id:'native-router',name:'聚合路由',state:'ready',
          models:[{id:'autofree',name:'AutoFree'}]},
        {id:'workbuddy',name:'WorkBuddy',state:'ready',
          models:[{id:'hy4-free',name:'Hy4 · x0.00',freeHint:'WorkBuddy x0.00'}]},
        {id:'lingxi',name:'Lingxi',state:'ready',
          models:[{id:'lingxi-flash',name:'DeepSeek Flash'}]},
      ]});
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
    if(key==='/checkins/action'){
      const input=JSON.parse(options.body);mutations.push({kind:'manual-channel-checkin',...input});
      return response({ok:true,result:{providerId:input.providerId,attempted:1,results:[]}});
    }
    if(key==='/activities/action'){
      const input=JSON.parse(options.body);mutations.push({kind:'manual-channel-activity',...input});
      return response({ok:true,result:{providerId:input.providerId,attempted:1,results:[]}});
    }
    if(key==='/checkins')return response({ok:true,...checkinCenter.snapshot()});
    if(key==='/activities')return response(activitySnapshot??{ok:true,
      channels:[],summary:{channelCount:0,activityCount:0,validCount:0,completedCount:0}});
    if(key==='/activities/refresh'){
      assert.equal(options.method,'POST');
      mutations.push({kind:'activities-official-refresh'});
      return response(activitySnapshot??{ok:true,channels:[],summary:{}});
    }
     if(key==='/channels/qwenwork/login'){
       const action=JSON.parse(options.body)?.action;
       mutations.push({kind:'qwen-device',action});
       return response({ok:true,result:action==='start'?{status:'waiting',at:1000,
         loginUrl:'https://gateway.qwenwork.cn/device/selectAccounts?challenge=TEST_PUBLIC_CHALLENGE'}:
         action==='cancel'?{status:'canceled'}:{status:'waiting'}});
     }
     if(key==='/channels/accounts/models'){
      const input=JSON.parse(options.body);mutations.push({action:'model-catalog',accountId:input.accountId});
      return response({ok:true,result:{state:'ready',freeCount:1,models:[{
        id:'free-model',name:'Hy4 flash x0.00',free:true,evidence:'WorkBuddy 目录标记 x0.00',
      }]}});
    }
    if(key==='/channels/accounts/action'){
      const input=JSON.parse(options.body);mutations.push(input);
      if(input.action==='refresh-all')return response({ok:true,...await accountCenter.refreshAll()});
      if(input.action==='login')return response({ok:true,result:await accountCenter.verify(input.accountId,{login:true})});
      if(input.action==='refresh')return response({ok:true,result:await accountCenter.verify(input.accountId)});
      if(input.action==='model-test')return response({ok:true,result:{
        state:'verified',modelId:input.modelId??'free-model',responsePreview:'OK',
      }});
      if(input.action==='enable')return response({ok:true,result:accountCenter.setEnabled(input.accountId,input.enabled)});
      return response({ok:false,error:'unsupported in UI test'});
    }
    throw Error('Unexpected fetch '+url);
  };
  let mod;
  const code=readFileSync(new URL('../client.js',import.meta.url),'utf8');
  const browser={__ModuleLoader__:{load:input=>{mod=input}},confirm:confirmFn,URL};
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
  return {render,init:async()=>{render();effectFn();for(let i=0;i<60&&!hooks[0];i++)await new Promise(resolve=>setTimeout(resolve,1));if(!hooks[0])throw Error('Configuration was not loaded')},
   async flushTabEffect(){render();tabEffectFn?.();for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,1))},
   find,flatten,mutations,get cfg(){return cfg}};
}
test('channel activity page shows a separate five-column table per provider and only official reward facts',async()=>{
 const expiry=Date.parse('2026-11-27T00:00:00Z');
 const snapshot={ok:true,channels:[
  {id:'workbuddy-cn',name:'WorkBuddy 国内',accountCount:1,activities:[
   {id:'wb:gift',accountName:'官方账号甲',name:'官方活动赠送积分',
    rewardAmount:160,rewardUnit:'积分',validity:'valid',endAt:expiry,
    progress:'自动执行中'},
   {id:'wb:compensation',accountName:'官方账号甲',name:'官方补偿积分',
    rewardAmount:null,rewardUnit:null,validity:'completed',endAt:null,
    progress:'官方确认已领取'}]},
  {id:'doubao',name:'豆包',accountCount:1,activities:[]},
 ],summary:{channelCount:2,activityCount:2,validCount:1,completedCount:1}};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],undefined,()=>true,null,snapshot);
 await rig.init();
 const nav=rig.find(rig.render(),'button','渠道活动')[0];
 assert.ok(nav,'activity catalog has its own top-level page');
 nav.props.onClick();
 const page=rig.render(),text=rig.flatten(page).join(' ');
 assert.match(text,/WorkBuddy 国内 · 2 项/);
 assert.match(text,/豆包 · 0 项/);
 assert.match(text,/活动名称.*免费奖励.*是否有效.*到期时间.*执行状态/);
 assert.match(text,/官方活动赠送积分.*160 积分.*有效 · 可自动执行/);
 assert.match(text,/官方补偿积分.*官方未公布.*已完成/);
 assert.match(text,/暂无官方已核实到账的免费活动/);
 assert.doesNotMatch(text,/活动明细组成|消费充值|邀请码任务/);
 const tables=[];
 const visit=node=>{if(Array.isArray(node))return node.forEach(visit);
  if(!node||typeof node!=='object')return;
  if(node.type==='table')tables.push(node);visit(node.children)};
 visit(page);
  assert.equal(tables.length,2,'each channel must render its own accessible table');
  for(const label of ['活动名称','免费奖励','是否有效','到期时间','执行状态'])
    assert.ok(uiNodes(page,node=>node.type==='td'&&node.props?.['data-label']===label).length,
      'compact activity cards must identify '+label);
 const refresh=rig.find(page,'button','刷新官方活动')[0];
 assert.ok(refresh&&!refresh.props.disabled);
 await refresh.props.onClick();
 assert.ok(rig.mutations.some(x=>x.kind==='activities-official-refresh'));
});

test('account workspace keeps cached account name and balance visible with provenance labels, quick filters and accessible navigation',async()=>{
 const id='sp_'+'b'.repeat(24),when=Date.parse('2026-11-23T04:00:00Z');
 const snapshot={ok:true,channels:[
  {id:'own_loomy',name:'Loomy',adapterReady:true,protocol:'native-channel'},
  {id:'own_doubao',name:'豆包',adapterReady:true,protocol:'native-channel'},
 ],pools:[],accounts:[{
  id,providerId:'own_loomy',configuredEnabled:true,enabled:true,
  connectionState:'recently_verified',nickname:'准确的账户名称',
  profileState:'cached',balance:480.5,balanceUnit:'积分',
  balanceCheckedAt:when,balanceState:'cached',balanceStale:true,
  expiringPoints:60,expiringAt:Date.now()+2*86400000,
  runtimeMode:'owned',modelTestAvailable:false,
 },{
  id:'db_'+'c'.repeat(28),providerId:'own_doubao',
  nickname:'豆包登录账号',balance:0,balanceUnit:'积分',
  connectionState:'online',configuredEnabled:true,enabled:true,
 }]};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],undefined,
  ()=>true,snapshot);
 await rig.init();
 let root=rig.render();
 const headings=rig.find(root,'button','渠道账号');
 assert.ok(headings.length===1);headings[0].props.onClick();
 root=rig.render();
 const text=rig.flatten(root).join(' ');
 assert.match(text,/准确的账户名称/);
 assert.match(text,/480.5 积分/);
 assert.match(text,/上次记录 ·/);
 assert.match(text,/上次识别 ·/);
 assert.match(text,/豆包登录账号/);
 assert.match(text,/高级模型测试/);
 assert.ok(rig.find(root,'button','只读刷新账号数据').length);
 const groups=[];
 const scan=node=>{if(Array.isArray(node))return node.forEach(scan);
  if(!node||typeof node!=='object')return;
  if(node.type==='details'&&node.props?.className==='dnr-channel-group')groups.push(node);
  scan(node.children)};
 scan(root);
 assert.equal(groups.length,2);
 assert.equal(groups[0].props.open,true,'first channel is initially expanded');
 assert.equal(groups[1].props.open,false,'secondary channels are progressive disclosures');
 const filter=rig.find(root,'button','有余额或积分')[0];
 assert.ok(filter);
 filter.props.onClick();
 root=rig.render();
 assert.match(rig.flatten(root).join(' '),/准确的账户名称/);
  const compact=uiNodes(root,node=>node.type==='select'
    &&node.props?.['aria-label']==='选择设置页面')[0];
  assert.ok(compact,'DSH embedded pane exposes a native compact module picker');
  assert.equal(uiNodes(compact,node=>node.type==='option').length,10,
    'all modules stay accessible without a second sidebar');
  const toolbar=uiNodes(root,node=>node.props?.className==='dnr-toolbar')[0];
  const main=uiNodes(root,node=>node.props?.className==='dnr-main')[0];
  const body=uiNodes(root,node=>node.props?.className==='dnr-page-body')[0];
  assert.ok(toolbar&&main&&body);
  assert.ok(main.children.indexOf(toolbar)<main.children.indexOf(body),
    'save controls are BEFORE the long account content, never bottom overlay');
});

test('built-in account panel can inspect explicit free evidence and run a real-model adapter test without a browser',async()=>{
 const id='wbp_'+'b'.repeat(24);
 const snapshot={ok:true,channels:[{id:'own_workbuddy-cn',name:'WorkBuddy CN',
  adapterReady:true,referenceOnly:false,protocol:'native-channel'}],pools:[],
  accounts:[{id,providerId:'own_workbuddy-cn',configuredEnabled:true,enabled:true,
   connectionState:'online',nickname:'Test owned account',
   runtimeMode:'owned',modelTestAvailable:true,credentialKind:'driver'}]};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],undefined,()=>true,snapshot);
 await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const page=rig.render();
 assert.ok(rig.find(page,'button','读取本账号模型及费率').length);
 await rig.find(page,'button','读取本账号模型及费率')[0].props.onClick();
 assert.ok(rig.mutations.some(r=>r.action==='model-catalog'&&r.accountId===id));
 const selected=rig.find(rig.render(),'button','发送真实免费测试')[0];
 assert.ok(selected&&!selected.props.disabled);
 await selected.props.onClick();
 assert.ok(rig.mutations.some(r=>r.action==='model-test'&&r.modelId==='free-model'
  &&r.accountId===id),'UI sends the specific zero-price model to own plugin backend');
});

test('one-click safe live-model batch uses only enabled verified accounts and shows result counts',async()=>{
 const id='wbp_'+'d'.repeat(24);
 const snapshot={ok:true,channels:[{id:'own_workbuddy-cn',name:'WorkBuddy CN',
  adapterReady:true,protocol:'native-channel'}],pools:[],accounts:[{
  id,providerId:'own_workbuddy-cn',configuredEnabled:true,enabled:true,
  connectionState:'online',runtimeMode:'owned',modelTestAvailable:true,
 }]};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],undefined,()=>true,snapshot);
 await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const button=rig.find(rig.render(),'button','一键实测全部账号的免费模型')[0];
 assert.ok(button&&!button.props.disabled);
 await button.props.onClick();
 const called=rig.mutations.filter(r=>r.action==='model-test'&&r.accountId===id);
 assert.equal(called.length,1,'each account sends at most one bounded actual free test');
 assert.match(rig.flatten(rig.render()).join(' '),/真实模型实测 1\/1 · 成功 1/);
});

test('dashboard shows original WorkBuddy routes, which enter directly without a second import step',async()=>{
 const hosts=[
  {providerId:'workbuddy',family:'workbuddy-native-plugin-route',loginVerified:false},
  {providerId:'workbuddy-global',family:'workbuddy-native-plugin-route',loginVerified:false},
 ];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},hosts);await rig.init();
 const overview=rig.flatten(rig.render()).join(' ');
  assert.match(overview,/WorkBuddy 国内/);
  assert.match(overview,/WorkBuddy 国际/);
  assert.match(overview,/已接入/);
  assert.doesNotMatch(overview,/账号来源 · 分别核验/); rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','宿主路由与模型')[0].props.onClick();
 const page=rig.render();
 assert.match(rig.flatten(page).join(' '),/宿主原生渠道 · 自动接入/);
 assert.match(rig.flatten(page).join(' '),/WorkBuddy 国际/);
 assert.equal(rig.find(page,'button','接入聚合路由').length,0);
});
test('host channel click shows the original full model list on the right, not at page bottom',async()=>{
 const host=[{providerId:'workbuddy-global',family:'workbuddy-native-plugin-route',
   accountAccess:'plugin-managed-or-unknown',loginVerified:false}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},host);await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','宿主路由与模型')[0].props.onClick();
 const selected=rig.find(rig.render(),'button','WorkBuddy 国际已接入')[0];
 assert.ok(selected,'selectable original provider exists in left pane');
 await selected.props.onClick();
 assert.ok(rig.mutations.some(x=>x.kind==='host-model-query'&&x.providerId==='workbuddy-global'));
 const view=rig.flatten(rig.render()).join(' ');
 assert.match(view,/WorkBuddy Native Flash/);
 assert.match(view,/模型目录 · WorkBuddy 国际/);
 assert.equal(rig.find(rig.render(),'button','加入故障切换').length,0);
 assert.equal(rig.find(rig.render(),'button','接入聚合路由').length,0);
 assert.equal(rig.cfg.accounts.some(x=>x.providerId==='workbuddy-global'),false);
 assert.equal(rig.cfg.routes.some(x=>x.id.startsWith('host_')),false);
});
test('unavailable original provider model catalog cannot invent a model, but original route remains registered',async()=>{
 const host=[{providerId:'deepseek-official',family:'dsh-provider-route',loginVerified:false}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},host,
  {state:'unavailable',providerId:'deepseek-official',models:[]});
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','宿主路由与模型')[0].props.onClick();
 const selected=rig.find(rig.render(),'button','deepseek-official已接入')[0];
 assert.ok(selected);
 await selected.props.onClick();
 assert.match(rig.flatten(rig.render()).join(' '),/未提供可读取的模型目录/);
 assert.equal(rig.find(rig.render(),'button','按 ID 接入').length,0);
 assert.equal(rig.cfg.providers.some(x=>x.id==='deepseek-official'),false);
 assert.equal(rig.cfg.routes.some(x=>x.tiers.some(t=>t.model==='deepseek-chat')),false);
});
test('source login tab distinguishes host reuse from independent source login',async()=>{
 const pack={state:'mounted',rpcReady:true,channelCount:1,channels:['loomy'],skippedProviders:['workbuddy']};
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
test('adoption view puts owner-approved account transfer first, plus same-page bulk verification',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 await rig.flushTabEffect();
 const page=rig.render();
 assert.match(rig.flatten(page).join(' '),/接管原插件账号 · 迁入本插件/);
 assert.equal(rig.find(page,'button','可扫码').length,0,
   'Source listing must not claim to have a functional QR action');
 assert.equal(rig.find(page,'button','批量验证已接管账号').length,1);
 assert.equal(rig.mutations.filter(x=>x.kind==='adoption-preview').length,1,
   'adoption inventory must be read automatically on opening this tab');
 assert.equal(rig.mutations.some(x=>x.kind==='adoption'),false,
   'automatic metadata read must not copy credentials');
 const approved=rig.find(rig.render(),'button','接管到本插件');
 assert.equal(approved.length,1);
 const blocked=rig.find(rig.render(),'button','暂不能接管');
 assert.equal(blocked.length,1);
 assert.equal(blocked[0].props.disabled,true);
 await approved[0].props.onClick();
 const adopted=rig.mutations.filter(x=>x.kind==='adoption');
 assert.deepEqual(adopted,[{kind:'adoption',providerId:'qoder',accountId:'qoder-test',consent:true}]);
 assert.doesNotMatch(JSON.stringify(rig.mutations),/Bearer/);
 assert.match(rig.flatten(rig.render()).join(' '),/授权副本已保存/);
  assert.match(rig.flatten(rig.render()).join(' '),/已接管/);
  assert.doesNotMatch(rig.flatten(rig.render()).join(' '),/已接管 · 待验证/);
});
test('real client render: channel account page exposes login, refresh, logout and enable controls',async()=>{
  const rig=createUiRig();await rig.init();
  let page=rig.render();
  const button=rig.find(page,'button','渠道账号')[0];
  assert.ok(button,'渠道账号 tab should exist');
  button.props.onClick();
   assert.equal(rig.find(rig.render(),'button','查看待接入渠道').length,0);   page=rig.render();
  const text=rig.flatten(page).join(' ');
  assert.match(text,/华为云 CodeArts/);
  assert.match(text,/腾讯 WorkBuddy/);
  assert.match(text,/账号状态/);
   assert.ok(rig.find(page,'button','刷新账户资料').length>=1);
   assert.ok(rig.find(page,'button','解绑').length>=1);  assert.ok(rig.find(page,'button','停用').length>=1);
});
test('real client render: login button triggers account authentication probe, not a fake success',async()=>{
  const rig=createUiRig();await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  let page=rig.render();
   const login=rig.find(page,'button','刷新账户资料')[0];await login.props.onClick();
   assert.ok(rig.mutations.some(m=>m.action==='refresh'));
  page=rig.render();
 assert.match(rig.flatten(page).join(' '),/鉴权通过/);
});
test('only verified sign-in executors expose channel auto switch and manual run',async()=>{
 const driver={checkIn:async()=>({state:'no_task'})};
 const rig=createUiRig(new Map([['alpha',driver],['local',driver]]));await rig.init();
 rig.find(rig.render(),'button','每日积分任务')[0].props.onClick();
 let page=rig.render(),text=rig.flatten(page).join(' ');
 assert.match(text,/今日积分任务/);
 assert.match(text,/alpha.*支持签到 2 个账号/);
 assert.match(text,/local.*支持签到 1 个账号/);
 assert.equal(rig.find(page,'button','手动执行本渠道').length,2);
 assert.equal(rig.find(page,'button','执行积分任务').length,0);
 assert.doesNotMatch(text,/华为云 CodeArts/);
 assert.match(text,/本渠道自动签到与免费活动/);
 const open=rig.find(page,'button','查看账号')[0];
 assert.ok(open);open.props.onClick();
 page=rig.render();text=rig.flatten(page).join(' ');
 assert.match(text,/alpha · 账号签到明细/);
 assert.equal(rig.find(page,'button','执行积分任务').length,2);
 rig.find(page,'button','收起明细')[0].props.onClick();
 assert.equal(rig.find(rig.render(),'button','执行积分任务').length,0);
});


test('upstream read-only account preview shows source states without falsely enabling login actions',async()=>{
 const preview={state:'ready',accounts:[{id:'wb-9',providerId:'workbuddy',nickname:'Test WorkBuddy',
  enabled:true,connectionState:'not_checked'},{id:'lm-8',providerId:'loomy',nickname:'Test Loomy',
  enabled:false,connectionState:'not_checked'}]};
 const rig=createUiRig(new Map(),preview);await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 const page=rig.render(),label=rig.flatten(page).join(' ');
  assert.match(label,/来源池共 2 条记录/);
 assert.match(label,/Test WorkBuddy/);
 assert.match(label,/Test Loomy/);
  assert.match(label,/尚未校验/);
 assert.ok(rig.find(page,'button','停用来源账号').every(x=>x.props.disabled),
   'source controls must be disabled when pack is not mounted');
  assert.equal(rig.find(page,'button','登录/校验').length,0,
    'source preview never creates new login buttons; own configured account actions live on the account tab');
});

test('mounted upstream channel controls query models explicitly and require confirmation for toggle',async()=>{
 const preview={state:'ready',accounts:[{id:'loomy-01',providerId:'loomy',nickname:'Test source account',
  enabled:true,connectionState:'not_checked'}]};
 const source={state:'mounted',rpcReady:true,channelCount:13,channels:['loomy','workbuddy']};
 const rig=createUiRig(new Map(),preview,source);await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 let page=rig.render();
 assert.match(rig.flatten(page).join(' '),/自主登录已就绪/);
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
test('WorkBuddy onboarding: approved provider activates directly without pretending account is logged in',async()=>{
 const rig=createUiRig(new Map([['workbuddy',{
   generate:async()=>({text:'mock',finishReason:'stop',toolCalls:[]}),
   discover:async()=>[],
   refresh:async()=>({state:'expired',message:'not authenticated'}),
 }]]));
 await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
   assert.equal(rig.find(rig.render(),'button','查看待接入渠道').length,0); let page=rig.render();
   assert.match(rig.flatten(page).join(' '),/腾讯 WorkBuddy \/ CodeBuddy .*适配器就绪 · 账号待验证/); const add=rig.find(page,'button','配置此渠道');
 assert.equal(add.length,1);
 add[0].props.onClick();
 page=rig.render();
 assert.ok(rig.find(page,'button','保存配置').length>=1);
 assert.equal(rig.cfg.providers.some(x=>x.id==='workbuddy'),false,'draft must not mutate config before save');
 await rig.find(page,'button','保存配置')[0].props.onClick();
 assert.equal(rig.cfg.providers.find(x=>x.id==='workbuddy').enabled,true);
 assert.equal(rig.cfg.accounts.some(x=>x.providerId==='workbuddy'),false,
   'Registering native provider does not invent a logged-in account');
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
   assert.equal(rig.find(rig.render(),'button','查看待接入渠道').length,0); let page=rig.render();
 const text=rig.flatten(page).join(' ');
 assert.match(text,/华为云 CodeArts/);
   assert.match(text,/华为云 CodeArts .*适配器就绪 · 账号待验证/); assert.ok(rig.find(page,'button','配置此渠道').length>=1);
 assert.equal(rig.cfg.accounts.length,3,'channel opening cannot create accounts silently');
});
test('isolated source account console explicitly runs upstream login, poll, refresh and guarded logout',async()=>{
 const preview={state:'ready',accounts:[{id:'qoder-01',providerId:'qoder',nickname:'Qoder test',
   enabled:true,refreshable:true,connectionState:'not_checked'}]};
 const source={state:'mounted',rpcReady:true,channelCount:13,channels:['qoder','workbuddy']};
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
test('Loomy login offers an explicit backup route, never silently sends a message',async()=>{
 const status={state:'mounted',rpcReady:true,channelCount:13,channels:['loomy']};
 const rig=createUiRig(new Map(),{state:'ready',accounts:[]},status);
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 assert.equal(rig.find(rig.render(),'button','发送官方短信验证码').length,0);
 await rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.onClick();
 const page=rig.render();
 const action=rig.find(page,'button','发送官方短信验证码')[0];
 assert.ok(action);
 assert.equal(action.props.disabled,true);
 assert.equal(rig.find(page,'button','核验短信并完成登录')[0].props.disabled,true);
 assert.deepEqual(rig.mutations.filter(row=>row.kind==='source-rpc').map(row=>row.method),
  ['account.create']);
 const phone='139'+'0'.repeat(8),code='7'.repeat(6);
 const findInput=(tree,label)=>{
   let found;
   const scan=node=>{
     if(Array.isArray(node)){node.forEach(scan);return}
     if(!node||typeof node!=='object')return;
     if(node.type==='input'&&node.props['aria-label']===label)found=node;
     scan(node.children);
   };
   scan(tree);return found;
 };
 findInput(rig.render(),'Loomy 手机号').props.onChange({target:{value:phone}});
 let ready=rig.render();
 assert.equal(rig.find(ready,'button','发送官方短信验证码')[0].props.disabled,false);
 await rig.find(ready,'button','发送官方短信验证码')[0].props.onClick();
 assert.equal(rig.mutations.at(-1).method,'login.sendSms');
 assert.equal(rig.mutations.at(-1).payload.phone,phone);
 findInput(rig.render(),'Loomy 短信验证码').props.onChange({target:{value:code}});
 ready=rig.render();
 assert.equal(rig.find(ready,'button','核验短信并完成登录')[0].props.disabled,false);
 await rig.find(ready,'button','核验短信并完成登录')[0].props.onClick();
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').at(-1).method,'login.submitSms');
  assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').at(-1).payload.code,code);
  assert.equal(rig.find(rig.render(),'button','核验短信并完成登录').length,0);
 assert.equal(rig.cfg.accounts.length,3,'model account configuration must not be forged by source login');
});
test('other independent source logins never show the Loomy-only backup option',async()=>{
 const status={state:'mounted',rpcReady:true,channelCount:13,channels:['qoder']};
 const rig=createUiRig(new Map(),{state:'ready',accounts:[]},status);
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 await rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.onClick();
 assert.equal(rig.find(rig.render(),'button','发送官方短信验证码').length,0);
});
test('Loomy can reauthorize an existing owned account without creating a duplicate',async()=>{
 const preview={state:'ready',accounts:[{id:'loomy-owned-existing',providerId:'loomy',
   nickname:'Loomy Test',enabled:true,refreshable:false,connectionState:'expired'}]};
 const status={state:'mounted',rpcReady:true,channelCount:13,channels:['loomy']};
 const rig=createUiRig(new Map(),preview,status);await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 let page=rig.render();
 const action=rig.find(page,'button','短信重新授权现有账号')[0];
 assert.ok(action,'existing Loomy account must offer reauthentication even without refresh tokens');
 assert.equal(action.props.disabled,false);
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0);
 await action.props.onClick();
 page=rig.render();
 const summary=rig.flatten(page).join(' ');
 assert.match(summary,/现有 Loomy 账号 · 原账号重新授权/);
 assert.equal(rig.find(page,'button','发送官方短信验证码').length,1);
 assert.equal(rig.find(page,'button','检查登录结果').length,0);
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0,
  'switching reauthentication mode must not create an account or send a message');
 assert.equal(rig.cfg.accounts.length,3);
});
test('source checkin reads per-account status; bulk claim requires explicit choice and fresh recheck',async()=>{
 const source={state:'mounted',rpcReady:true,channelCount:13,channels:['qoder','workbuddy']};
 const rig=createUiRig(new Map(),{state:'ready',accounts:[]},source);await rig.init(); rig.find(rig.render(),'button','每日积分任务')[0].props.onClick();
 let page=rig.render();
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0);
 const claimButton=rig.find(page,'button','批量领取（该渠道所有账号）')[0];
 assert.equal(claimButton.props.disabled,true,'bulk claim must require an explicit status check');
  await rig.find(page,'button','重新同步来源状态')[0].props.onClick(); assert.deepEqual(rig.mutations.filter(row=>row.kind==='source-rpc').map(row=>row.method),['credits.status']);
 page=rig.render();
  assert.match(rig.flatten(page).join(' '),/来源报告.*尚未签到/); assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.disabled,false);
 await rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.onClick();
 assert.deepEqual(rig.mutations.filter(row=>row.kind==='source-rpc').map(row=>row.method),
   ['credits.status','credits.claimAll']);
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/claimed · 尚未复核/);
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.disabled,true);
  assert.match(rig.flatten(page).join(' '),/已在下方同步各账号状态/); const select=rig.find(page,'select','qoderworkbuddy')[0];
 assert.ok(select);
 select.props.onChange({target:{value:'workbuddy'}});
 page=rig.render();
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）')[0].props.disabled,true);
  assert.match(rig.flatten(page).join(' '),/不提供可验证的每日签到领取操作/);});
test('disabled channel pack exposes no source login, source checkin or bulk claim actions',async()=>{
 const rig=createUiRig();await rig.init();
  rig.find(rig.render(),'button','复用管理')[0].props.onClick();
  rig.find(rig.render(),'button','自主登录')[0].props.onClick();
  let page=rig.render();
  assert.equal(rig.find(page,'button','发起扫码/网页登录').length,0);
 rig.find(page,'button','每日积分任务')[0].props.onClick();
 page=rig.render();
 assert.equal(rig.find(page,'button','查询来源签到状态').length,0);
 assert.equal(rig.find(page,'button','批量领取（该渠道所有账号）').length,0);
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0);
});
test('upstream login suppresses unsafe authorization URLs instead of making them clickable',async()=>{
  const pack={state:'mounted',rpcReady:true,channelCount:13,channels:['workbuddy']};
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
  const pack={state:'mounted',rpcReady:true,channelCount:13,channels:['workbuddy']};
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
  const pack={state:'mounted',rpcReady:true,channelCount:13,channels:['workbuddy']};
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

test('narrow settings layout uses responsive channel pills instead of the 136px squeeze regression',async()=>{
 const host=[{providerId:'workbuddy-global'}, {providerId:'deepseek-account'},
   {providerId:'lingxi'}, {providerId:'minimax'}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},host);
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','宿主路由与模型')[0].props.onClick();
 const tree=rig.render(),nodes=[];
 const visit=node=>{
  if(Array.isArray(node))return node.forEach(visit);
  if(!node||typeof node!=='object')return;
  nodes.push(node);visit(node.children);
 };
 visit(tree);
 const layout=nodes.find(n=>typeof n.props?.style?.gridTemplateColumns==='string'
   &&n.props.style.gridTemplateColumns.includes('repeat(auto-fit'));
 assert.ok(layout,'Responsive 1/2-column layout required, never force a 136px column');
 assert.doesNotMatch(layout.props.style.gridTemplateColumns,/136px/);
 const channel=rig.find(tree,'button','WorkBuddy 国际已接入')[0];
 assert.ok(channel);
 assert.notEqual(channel.props.style.width,'100%');
 assert.equal(channel.props.style.display,'inline-flex');
 assert.ok(channel.props.style.minHeight>=34);
});
test('channel card Manage Account Pool opens a real provider-filtered account management view',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const page=rig.render(),managers=rig.find(page,'button','管理账号池');
 assert.ok(managers.length>0);
 managers[0].props.onClick();
 const screen=rig.flatten(rig.render()).join(' ');
 assert.match(screen,/渠道账号池/);
 assert.match(screen,/账号来源管理/);
 assert.match(screen,/返回渠道账号/);
 assert.ok(rig.find(rig.render(),'button','返回渠道账号')[0]);
 rig.find(rig.render(),'button','返回渠道账号')[0].props.onClick();
 assert.match(rig.flatten(rig.render()).join(' '),/全部渠道 · 账号状态/);
});
test('Agent-level failover offers the complete DSH provider/model selectors and persists chosen route only on save',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','宿主故障切换')[0].props.onClick();
 await rig.flushTabEffect();
 assert.ok(rig.mutations.some(m=>m.kind==='host-catalog'));
 let page=rig.render();
 assert.match(rig.flatten(page).join(' '),/Provider 3/);
 assert.match(rig.flatten(page).join(' '),/已发现模型 3/);
 const add=rig.find(page,'button','+ 从已发现模型添加候选')[0];
 assert.ok(add&&!add.props.disabled);
 add.props.onClick();
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/该 Provider 的模型/);
 assert.match(rig.flatten(page).join(' '),/DSH Provider/);
 // Find the provider's select by the enclosing label rather than relying
 // on relative order of model, mode and per-provider selectors.
 const findSelect=node=>{
  if(Array.isArray(node))return node.map(findSelect).find(Boolean);
  if(!node||typeof node!=='object')return null;
  if(node.type==='label'&&rig.flatten(node).join(' ').includes('DSH Provider'))
   return (node.children||[]).find?.(x=>x?.type==='select')||
      (node.children?.type==='select'?node.children:null);
  return findSelect(node.children);
 };
 const providerSelect=findSelect(page);
 assert.ok(providerSelect,'DSH Provider must be a real select control');
 providerSelect.props.onChange({target:{value:'lingxi'}});
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/DeepSeek Flash/);
 assert.equal(rig.cfg.hostFailover.priority.length,0,
  'Draft choice must not mutate saved Host rules');
 await rig.find(page,'button','保存配置')[0].props.onClick();
 assert.ok(rig.cfg.hostFailover.priority.some(row=>
  row.provider==='lingxi'&&row.model==='lingxi-flash'));
});
test('AutoFree manual model marking is owner-gated, never auto-generates chains and preserves price provenance',async()=>{
 const hosts=[{providerId:'workbuddy'},{providerId:'lingxi'}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},hosts);
 await rig.init();
 rig.find(rig.render(),'button','模型池')[0].props.onClick();
 await rig.flushTabEffect();
 let page=rig.render();
 const findInput=node=>{
  if(Array.isArray(node))return node.map(findInput).find(Boolean);
  if(!node||typeof node!=='object')return null;
  if(node.type==='input'&&node.props.placeholder==='未列在目录中时填写')return node;
  return findInput(node.children);
 };
 const input=findInput(page);assert.ok(input);
 input.props.onChange({target:{value:'my-confirmed-free-model'}});
 page=rig.render();
 const mark=rig.find(page,'button','指定此模型免费')[0];
 assert.ok(mark&&!mark.props.disabled);
 mark.props.onClick();
 assert.match(rig.flatten(rig.render()).join(' '),/人工免费/);
 assert.equal(rig.cfg.routes.length,sample.routes.length);
 await rig.find(rig.render(),'button','保存配置')[0].props.onClick();
 assert.ok(rig.cfg.freePool.models.some(row=>
  row.providerId==='workbuddy'&&row.model==='my-confirmed-free-model'&&row.free===true));
 assert.equal(rig.cfg.routes.length,sample.routes.length);
});

test('source login is never enabled just because model package mounted without authenticated RPC',async()=>{
 const status={state:'mounted',rpcReady:false,channelCount:0,
   channels:[],modelAdapterReady:[],modelAdapterUnready:[],reason:''};
 const rig=createUiRig(new Map(),{state:'ready',accounts:[]},status);
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 const screen=rig.render(),text=rig.flatten(screen).join(' ');
 assert.match(text,/登录接口等待中/);
 assert.equal(rig.find(screen,'button','发起扫码\/网页登录').length,0);
 assert.equal(rig.mutations.filter(row=>row.kind==='source-rpc').length,0);
});

// Regress the real settings component tree, not just a claimed visual design.
function uiNodes(node,predicate,found=[]){
 if(Array.isArray(node)){for(const part of node)uiNodes(part,predicate,found);return found}
 if(!node||typeof node!=='object')return found;
 if(predicate(node))found.push(node);
 uiNodes(node.children,predicate,found);
 return found;
}
test('WorkBuddy-style page shell keeps all ten settings destinations, scoped themes and responsive nav',async()=>{
 const rig=createUiRig();await rig.init();
 let page=rig.render();
 const cssNode=uiNodes(page,node=>node.type==='style')[0];
 assert.ok(cssNode?.props?.dangerouslySetInnerHTML?.__html,'WorkBuddy-like scoped CSS must be mounted');
 const stylesheet=cssNode.props.dangerouslySetInnerHTML.__html;
 assert.match(stylesheet,/\.dnr-shell .*?\.dnr-layout/);
 assert.match(stylesheet,/var\(--dsw-alias-bg-layer-2/);
 assert.match(stylesheet,/@media \(max-width:760px\)/);
 assert.match(stylesheet,/@media \(max-width:520px\)/);
 assert.match(stylesheet,/:focus-visible/);
  assert.match(stylesheet,/prefers-reduced-motion/);
  assert.ok(stylesheet.includes('container:dnr-workspace / inline-size'),
    'layout follows the plugin pane, not global viewport');
  assert.ok(stylesheet.includes('@container dnr-workspace (max-width:850px)'));
  assert.ok(stylesheet.includes('.dnr-shell .dnr-layout{display:block;'),
    'one content column inside DSH');
  assert.ok(stylesheet.includes('.dnr-shell .dnr-toolbar .dnr-savebar{position:static;'),
    'save controls must not obscure account details');
  assert.ok(stylesheet.includes('.dnr-shell .dnr-rail{display:none}'),
    'compact mode hides the redundant second navigation');
 const nav=uiNodes(page,node=>node.type==='nav')[0];
 assert.equal(nav?.props?.['aria-label'],'聚合路由设置导航');
 const buttons=uiNodes(nav,node=>node.type==='button');
 assert.equal(buttons.length,10);
 assert.equal(new Set(buttons.map(b=>rig.flatten(b).join(''))).size,10);
 assert.equal(buttons.filter(b=>b.props['aria-current']==='page').length,1);
 rig.find(page,'button','模型链条')[0].props.onClick();
 page=rig.render();
 assert.equal(uiNodes(page,node=>node.props?.className==='dnr-nav-group').length,4);
 assert.match(rig.flatten(page).join(' '),/模型链条 · 仅手工维护/);
 assert.equal(uiNodes(page,node=>node.type==='button'&&node.props['aria-current']==='page')
   .map(x=>rig.flatten(x).join('')).join(''),'模型链条');
 assert.equal(rig.find(page,'button','保存配置').length,1);
 assert.equal(rig.find(page,'button','重新读取').length,1);
});
test('channels default to all and can switch to one channel without losing other providers',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 let screen=rig.render(),lines=rig.flatten(screen).join(' ');
 assert.match(lines,/alpha.*a1/);
 assert.match(lines,/local.*l1/);
 const chooser=uiNodes(screen,node=>node.type==='label'&&rig.flatten(node).join(' ').includes('筛选渠道（默认全部）'))[0];
 assert.ok(chooser,'provider picker must be present');
 const select=uiNodes(chooser,node=>node.type==='select')[0];assert.ok(select);
 assert.equal(select.props.value,'all');
 select.props.onChange({target:{value:'local'}});
 screen=rig.render();lines=rig.flatten(screen).join(' ');
 assert.match(lines,/local.*l1/);
 assert.doesNotMatch(lines,/alpha.*内部账号：a1/);
 uiNodes(screen,node=>node.type==='label'&&rig.flatten(node).join(' ').includes('筛选渠道（默认全部）'))
  .flatMap(node=>uiNodes(node,item=>item.type==='select'))[0].props.onChange({target:{value:'all'}});
 screen=rig.render();lines=rig.flatten(screen).join(' ');
 assert.match(lines,/alpha.*内部账号：a1/);
 assert.match(lines,/local.*内部账号：l1/);
});
test('all 13 owned sources show truthful per-channel readiness and allow direct manual login',async()=>{
 const ids=['codearts','buddy','workbuddy','lobsterai','qoder','qodercn',
  'trae','cline','loomy','raccoon','minimax','zcode','gemini'];
 const preview={state:'ready',accounts:[
  {id:'ca-one',providerId:'codearts',enabled:true,connectionState:'online'},
  {id:'ca-two',providerId:'codearts',enabled:true,connectionState:'not_checked'},
  {id:'qo-one',providerId:'qoder',enabled:false,connectionState:'online'}]};
 const status={state:'mounted',rpcReady:true,channelCount:13,channels:ids,
  modelAdapterReady:['codearts','qodercn'],modelAdapterUnready:['gemini']};
 const rig=createUiRig(new Map(),preview,status);await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 const page=rig.render();
 const all=uiNodes(page,node=>typeof node.props?.['data-source-provider']==='string');
 assert.equal(all.length,13,'the owned pool must show all available channels, even with no accounts');
 const get=id=>all.find(node=>node.props['data-source-provider']===id);
 assert.ok(get('qodercn')&&get('gemini')&&get('buddy'));
 assert.match(rig.flatten(get('codearts')).join(' '),/登记 2 个 \/ 官方鉴权 1 个/);
 assert.match(rig.flatten(get('qoder')).join(' '),/官方鉴权 0 个/);
 assert.match(rig.flatten(get('gemini')).join(' '),/尚无独立账号.*适配器异常/);
 assert.equal(rig.mutations.filter(x=>x.kind==='source-rpc').length,0,
  'opening the channel matrix must not create or poll an account');
 const authorize=uiNodes(get('qodercn'),node=>node.type==='button')
  .find(node=>rig.flatten(node).join('')==='自主登录');
 assert.ok(authorize&&!authorize.props.disabled);
 await authorize.props.onClick();
 const calls=rig.mutations.filter(x=>x.kind==='source-rpc');
 assert.deepEqual(calls.map(x=>x.method),['account.create']);
 assert.equal(calls[0].payload.provider,'qodercn');
  const pendingPage=rig.render();
  const pendingRows=uiNodes(pendingPage,node=>typeof node.props?.['data-source-provider']==='string');
  assert.equal(pendingRows.length,13);
  for(const row of pendingRows){
   const login=uiNodes(row,node=>node.type==='button')
    .find(node=>rig.flatten(node).join('')==='自主登录');
   assert.ok(login.props.disabled,'in-flight authorization cannot be overwritten');
  }
  assert.equal(rig.find(pendingPage,'button','发起扫码/网页登录')[0].props.disabled,true);
  const dismiss=rig.find(pendingPage,'button','结束本次授权跟踪')[0];
  assert.ok(dismiss&&!dismiss.props.disabled);
  await dismiss.props.onClick();
  assert.equal(rig.mutations.filter(x=>x.kind==='source-rpc').length,1,
    'dismissing only clears UI tracking; it does not delete an account');
  assert.equal(rig.find(rig.render(),'button','发起扫码/网页登录')[0].props.disabled,false);
});
test('source account actions are grouped and unsafe operations remain guarded',async()=>{ const preview={state:'ready',accounts:[{id:'q-01',providerId:'qoder',nickname:'A long source account label',
   enabled:true,refreshable:true,connectionState:'not_checked'}]};
 const source={state:'mounted',rpcReady:true,channelCount:13,channels:['qoder','workbuddy']};
 const rig=createUiRig(new Map(),preview,source);await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','自主登录')[0].props.onClick();
 const screen=rig.render();
 assert.equal(uiNodes(screen,node=>node.props?.className==='dnr-source-entry').length,1);
 const actions=uiNodes(screen,node=>node.props?.className==='dnr-action-list')[0];
 const labels=uiNodes(actions,node=>node.type==='button').map(b=>rig.flatten(b).join(''));
 assert.deepEqual(labels,['停用来源账号','刷新来源凭据','退出来源账号（尝试清凭据）']);
 const disclosures=uiNodes(screen,node=>node.props?.className==='dnr-disclosure');
 assert.equal(disclosures.length,0,'source safety actions should never be buried in generic config disclosures');
});
test('status refresh preserves unsubmitted provider edits and canceled reload keeps draft',async()=>{
 let confirmations=0;
 const rig=createUiRig(undefined,undefined,undefined,undefined,undefined,undefined,
   ()=>{confirmations++;return false});
 await rig.init();
 rig.find(rig.render(),'button','提供商')[0].props.onClick();
 let page=rig.render();
 const label=uiNodes(page,node=>node.type==='label'
   &&rig.flatten(node).join('').startsWith('显示名称'))[0];
 assert.ok(label,'provider editor must expose a visibly labelled name input');
 const input=uiNodes(label,node=>node.type==='input')[0];
 assert.ok(input);
 input.props.onChange({target:{value:'保留我的未保存渠道名称'}});
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/有未保存修改/);
 rig.find(page,'button','总览')[0].props.onClick();
 await rig.find(rig.render(),'button','刷新运行状态')[0].props.onClick();
 rig.find(rig.render(),'button','提供商')[0].props.onClick();
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/保留我的未保存渠道名称/);
 assert.match(rig.flatten(page).join(' '),/有未保存修改/);
 rig.find(page,'button','重新读取')[0].props.onClick();
 page=rig.render();
 assert.equal(confirmations,1,'discard must require positive confirmation');
 assert.match(rig.flatten(page).join(' '),/保留我的未保存渠道名称/);
 assert.equal(rig.mutations.filter(x=>x.kind==='save').length,0);
});
test('compact mobile navigation selects every major page while desktop sidebar remains complete',async()=>{
 const rig=createUiRig();await rig.init();
 let page=rig.render();
 const mobile=uiNodes(page,node=>node.props?.className==='dnr-mobile-nav')[0];
 assert.ok(mobile,'mobile navigation must exist');
 const select=uiNodes(mobile,node=>node.type==='select')[0];
 assert.equal(select?.props?.['aria-label'],'选择设置页面');
 assert.equal(uiNodes(mobile,node=>node.type==='option').length,10);
 assert.equal(uiNodes(mobile,node=>node.type==='optgroup').length,4);
 const css=uiNodes(page,node=>node.type==='style')[0].props.dangerouslySetInnerHTML.__html;
 assert.match(css,/@media \(max-width:760px\).*?\.dnr-shell \.dnr-rail\{display:none\}/s);
 assert.match(css,/@media \(max-width:760px\).*?\.dnr-shell \.dnr-mobile-nav\{display:flex/s);
 select.props.onChange({target:{value:'pool'}});
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/AutoFree · 动态免费模型池/);
 assert.equal(uiNodes(page,node=>node.type==='select'&&node.props?.['aria-label']==='选择设置页面')[0].props.value,'pool');
});
test('Meoo and Qwen native login panels expose user-initiated actions without leaking device secrets',async()=>{
  const rig=createUiRig();await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  let screen=rig.render();
  const labels=rig.flatten(screen).join(' ');
  assert.match(labels,/秒悟网页版 · 独立会员账号/);
  assert.match(labels,/千问办公 · 设备码 PKCE 独立账号/);
  assert.equal(rig.find(screen,'button','验证并导入').length,1);
  assert.equal(rig.find(screen,'button','申请独立设备授权').length,1);
  assert.equal(uiNodes(screen,node=>node.type==='a'&&String(node.props?.href||'').includes('qwenwork.cn')).length,0);
  await rig.find(screen,'button','申请独立设备授权')[0].props.onClick();
  assert.deepEqual(rig.mutations.filter(item=>item.kind==='qwen-device').map(item=>item.action),['start']);
  screen=rig.render();
  const link=uiNodes(screen,node=>node.type==='a'&&String(node.props?.href||'').includes('qwenwork.cn'))[0];
  assert.ok(link);
  assert.match(link.props.href,/^https:\/\/gateway\.qwenwork\.cn\/device\/selectAccounts\?/);
  assert.equal(link.props.target,'_blank');
  assert.equal(link.props.rel,'noopener noreferrer');
  assert.doesNotMatch(JSON.stringify(screen),/device_token|refresh_token|private-verifier/);
  await rig.find(screen,'button','取消授权')[0].props.onClick();
  assert.deepEqual(rig.mutations.filter(item=>item.kind==='qwen-device').map(item=>item.action),['start','cancel']);
});
test('overview uses complete deduplicated source chips ordered verified connected pending',async()=>{
 const hosts=[{providerId:'workbuddy',loginVerified:false},{providerId:'workbuddy-global',loginVerified:false}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},hosts);await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  await rig.find(rig.render(),'button','刷新账户资料')[0].props.onClick();
 rig.find(rig.render(),'button','总览')[0].props.onClick();
 const page=rig.render();
 const chips=uiNodes(page,node=>node.props?.className==='dnr-route-chip');
 assert.ok(chips.length>=13,'show all discovered reference and host sources');
 const states=chips.map(x=>x.props['data-state']);
 assert.equal(states[0],'verified');
 assert.deepEqual(states,[...states].sort((a,b)=>({verified:0,connected:1,pending:2}[a]-{verified:0,connected:1,pending:2}[b])));
 assert.equal(new Set(chips.map(x=>x.props.title)).size,chips.length);
 assert.doesNotMatch(rig.flatten(page).join(' '),/账号来源 · 分别核验/);
});
test('account names and verified source credits lead; technical ID is folded into account details',async()=>{
  const preview={state:'ready',accounts:[{id:'q01',providerId:'qoder',
    nickname:'Readable Qoder User',balance:83,balanceUnit:'积分',
    enabled:true,authorizationSource:'autonomous'}]};
  const inventory={ok:true,accounts:[
    {id:'a1',providerId:'alpha',nickname:'Alpha',enabled:true,configuredEnabled:true,
      connectionState:'not_checked',weight:1,credentialKind:'env',
      origin:{label:'环境变量凭据引用'}},
    {id:'sp_q01',providerId:'qoder',nickname:'Readable Qoder User',
      enabled:true,configuredEnabled:true,connectionState:'online',
      weight:1,credentialKind:'driver',sourceKind:'autonomous',managed:false,
      origin:{label:'本插件自主登录'},balance:83,balanceUnit:'积分'},
  ],channels:[{id:'alpha',name:'alpha',adapterReady:true,authMethod:'API Key'},
    {id:'qoder',name:'Qoder',adapterReady:true,authMethod:'自主登录'}],
    embeddedAccounts:preview,pools:[]};
  const rig=createUiRig(new Map(),preview,{state:'mounted'}, {}, [],
    undefined,()=>true,inventory);
  await rig.init();
  rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
  const page=rig.render(),lines=rig.flatten(page).join(' ');
  assert.match(lines,/Readable Qoder User/);
   assert.match(lines,/83 积分/);
  assert.equal((lines.match(/Readable Qoder User/g)||[]).length,1,
    'the raw pool and unified account must never appear as two account cards');
  assert.equal(rig.find(page,'button','查看待接入渠道').length,0);
  assert.equal(rig.find(page,'button','自主登录与复用').length,0);
  const disclosures=uiNodes(page,node=>node.type==='details');
  assert.ok(disclosures.some(node=>rig.flatten(node).join(' ').includes('内部账号：a1')),
    'technical ID should be folded into native details');
});
test('native account cards show real Xiaomi membership and Doubao quota windows without inventing wallet balances',async()=>{
 const inventory={ok:true,channels:[
  {id:'mimo_desktop',name:'小米 MiMo Desktop',adapterReady:true,authMethod:'会员自有登录'},
  {id:'doubao',name:'豆包工作',adapterReady:true,authMethod:'网页登录'}],
 accounts:[
  {id:'sp_333',providerId:'mimo_desktop',nickname:'真实小米昵称',enabled:true,configuredEnabled:true,
   connectionState:'online',weight:1,managed:true,runtimeMode:'owned',credentialKind:'driver',
   membershipState:'active',membershipPercentRemaining:77.5,membershipPlanName:'plus',balanceState:'not_supported'},
  {id:'db_333',providerId:'doubao',nickname:'真实豆包名称',enabled:true,configuredEnabled:true,
   connectionState:'online',weight:1,managed:true,runtimeMode:'owned',credentialKind:'driver',
   quotaWindows:[{kind:'package',label:'主套餐',total:100,used:20,left:80},
    {kind:'week',label:'每周',total:20,used:8,left:12}],
   balance:80,balanceUnit:'主套餐',balanceState:'available',planName:'豆包会员'}
 ],pools:[],embeddedAccounts:{state:'disabled',accounts:[]}};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],
   undefined,()=>true,inventory);
 await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const page=rig.render(),rendered=rig.flatten(page).join(' ');
 const cards=uiNodes(page,x=>x.props?.className==='dnr-account-card');
 assert.equal(cards.length,2);
 assert.match(rendered,/真实小米昵称/);
 assert.match(rendered,/真实豆包名称/);
 assert.match(rendered,/77\.5% 剩余/);
  assert.match(rendered,/80 主套餐/);
  assert.ok(!rendered.includes('80 / 100')&&!rendered.includes('12 / 20'));
 assert.doesNotMatch(rendered,/账号1|账号 1|余额待来源同步|余额：92/);
 assert.equal(rig.find(page,'button','刷新账户资料').length,2);
});
test('native account page renders WorkBuddy monthly grant and independent MiMo free rolling quota',async()=>{
 const inventory={ok:true,channels:[
  {id:'own_workbuddy-cn',name:'WorkBuddy 国内',adapterReady:true,authMethod:'独立会员'},
  {id:'own_mimo_desktop',name:'MiMo Desktop',adapterReady:true,authMethod:'独立会员'}],
 accounts:[
  {id:'wbp_abcdef',providerId:'own_workbuddy-cn',nickname:'WorkBuddy 正式会员',
   connectionState:'online',enabled:true,configuredEnabled:true,weight:1,
   runtimeMode:'owned',credentialKind:'driver',
    balance:121.98,balanceState:'available',balanceUnit:'积分',
    expiringPoints:81.23,expiringAt:Date.parse('2026-11-27T00:00:00Z'),
   quotaWindows:[{kind:'monthly',label:'月基础积分',left:81.23,total:500,used:418.77},
    {kind:'grant',label:'活动赠送',left:40.75,total:100,used:59.25}],
   benefits:[{kind:'compensation',active:true,claimed:false,credit:300}]},
  {id:'sp_mimo_fixture',providerId:'own_mimo_desktop',nickname:'MiMo 会员',
   connectionState:'online',enabled:true,configuredEnabled:true,weight:1,
   runtimeMode:'owned',credentialKind:'driver',
   membershipState:'not_subscribed',usageState:'available',usagePercentRemaining:70,
   usageResetAt:Date.parse('2026-12-05T00:00:00+08:00')},
 ],embeddedAccounts:{state:'disabled',accounts:[]},pools:[]};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],
  undefined,()=>true,inventory);
 await rig.init();rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const page=rig.render(),text=rig.flatten(page).join(' ');
 assert.match(text,/WorkBuddy 正式会员/);
 assert.match(text,/121\.98 积分/);
  assert.ok(text.includes('未来 7 天将过期积分 81.23 积分'));
  assert.ok(!text.includes('81.23 / 500')&&!text.includes('40.75 / 100'));
 assert.match(text,/可领取 补偿积分 · 300 积分/);
  assert.match(text,/MiMo 七日自然恢复额度/);
 assert.match(text,/70% 剩余/);
 assert.doesNotMatch(text,/官方未返回|账号1|账号 1|余额待来源同步/);
});
test('account UI renders partial official quota windows, account units and independent wallet beside membership',async()=>{
 const inventory={ok:true,channels:[
  {id:'own_aws_quick',name:'Amazon Quick',adapterReady:true,authMethod:'独立授权'},
  {id:'own_mimo_desktop',name:'MiMo Desktop',adapterReady:true,authMethod:'会员授权'},
  {id:'own_workbuddy-cn',name:'WorkBuddy',adapterReady:true,authMethod:'独立会员'}],
 accounts:[
  {id:'aq-public',providerId:'own_aws_quick',nickname:'Quick Personal',enabled:true,configuredEnabled:true,
   connectionState:'online',runtimeMode:'owned',credentialKind:'driver',
   quotaWindows:[{label:'Agent Hours',left:3,unit:'h'},
     {label:'Research Hours',total:10,used:4,unit:'h'}],balanceState:'unavailable'},
  {id:'mimo-public',providerId:'own_mimo_desktop',nickname:'MiMo Member',enabled:true,configuredEnabled:true,
   connectionState:'online',runtimeMode:'owned',credentialKind:'driver',
   membershipState:'active',membershipPercentRemaining:66,usageState:'available',
   usagePercentRemaining:80,balance:18.5,balanceUnit:'credits'},
  {id:'wb-public',providerId:'own_workbuddy-cn',nickname:'WorkBuddy Member',enabled:true,configuredEnabled:true,
   connectionState:'online',runtimeMode:'owned',credentialKind:'driver',
   balance:42,balanceUnit:'credits'},
 ],pools:[],embeddedAccounts:{state:'disabled',accounts:[]}};
 const rig=createUiRig(new Map(),null,{state:'disabled'}, {},[],undefined,()=>true,inventory);
 await rig.init();rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const view=rig.flatten(rig.render()).join(' ');
  assert.ok(!view.includes('Agent Hours')&&!view.includes('Research Hours'));
  assert.ok(view.includes('18.5 credits'),'independent wallet remains visible alongside membership');
 assert.match(view,/42 credits/,'WorkBuddy preserves official units rather than inventing points');
 assert.equal((view.match(/42 credits/g)||[]).length,1,'WorkBuddy total cannot be shown twice');
 assert.doesNotMatch(view,/NaN|undefined|42 积分/);
});

test('provider search filters by name ID and protocol and defaults every disclosure closed',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','提供商')[0].props.onClick();
 let page=rig.render();
 const initial=uiNodes(page,node=>node.props?.className==='dnr-disclosure');
 assert.equal(initial.length,rig.cfg.providers.length);
 assert.ok(initial.every(node=>node.props.open===false));
 const field=uiNodes(page,node=>node.type==='input'&&node.props?.['aria-label']==='筛选提供商')[0];
 assert.ok(field);
 field.props.onChange({target:{value:'local'}});
 page=rig.render();
 const filtered=uiNodes(page,node=>node.props?.className==='dnr-disclosure');
 assert.equal(filtered.length,1);
 assert.match(rig.flatten(filtered[0]).join(' '),/local/);
});
test('reuse host supports explicit safe model and pricing refresh, with metadata changes',async()=>{
 const hosts=[{providerId:'workbuddy',loginVerified:false}];
 const models={state:'ready',providerId:'workbuddy',models:[
   {id:'wb-standard',name:'WorkBuddy Standard',pricing:{input:0.01,output:0.03}}]};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},hosts,models);await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','宿主路由与模型')[0].props.onClick();
 const first=rig.find(rig.render(),'button','WorkBuddy 国内已接入')[0];
 assert.ok(first);await first.props.onClick();
 let page=rig.render();
 assert.match(rig.flatten(page).join(' '),/输入 0.01 \/ 输出 0.03/);
 const refresh=rig.find(page,'button','重新获取模型')[0];
 assert.ok(refresh&&!refresh.props.disabled);await refresh.props.onClick();
 assert.equal(rig.mutations.filter(m=>m.kind==='host-model-query').length,2);
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/本渠道变化：新增 0/);
 assert.ok(rig.find(page,'button','刷新全部模型与资费').length===1);
});
test('independent login is visible in channel account and local-session pages without original plugin',async()=>{
 const ownAccount={id:'sp_1234567890abcdef12345678',providerId:'own_loomy',
  nickname:'独立 Loomy 账号',managed:false,configuredEnabled:true,enabled:true,
  weight:1,connectionState:'online',credentialKind:'driver',origin:{label:'本插件独立账号池'}};
 const preview={state:'ready',accounts:[{id:'independent01',providerId:'loomy',
   nickname:'独立 Loomy 账号',enabled:true,balance:20,balanceUnit:'积分'}]};
 const data={accounts:[ownAccount],channels:[{id:'own_loomy',name:'Loomy · 自主登录',
   authMethod:'独立登录态',adapterReady:true,referenceOnly:true}],
   embeddedAccounts:preview,sessionReuse:{hostProviders:[],channels:[],results:[]},pools:[]};
 const rig=createUiRig(new Map(),preview,{state:'mounted',rpcReady:true,
   channels:['loomy']},{},[],undefined,()=>true,data);
 await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 let page=rig.render(),lines=rig.flatten(page).join(' ');
 assert.match(lines,/独立 Loomy 账号/);
 assert.match(lines,/Loomy · 自主登录/);
  assert.ok(rig.find(page,'button','管理来源授权池').length>0); assert.equal(rig.find(page,'button','校验').length,0,
   'ephemeral own-account inventory must not expose invalid config mutations');
  rig.find(page,'button','管理来源授权池')[0].props.onClick(); page=rig.render();
  assert.match(rig.flatten(page).join(' '),/来源授权池 · 自主登录与原授权接管/);
 rig.find(page,'button','本机登录态')[0].props.onClick();
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/已核验本机登录态 · 按渠道聚合/);
 assert.match(rig.flatten(page).join(' '),/独立 Loomy 账号/);
});
test('five member login paths are inside their own channels, not a second aggregate card',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','渠道账号')[0].props.onClick();
 const page=rig.render(),text=rig.flatten(page).join(' ');
 assert.doesNotMatch(text,/新增账号或重新登录 · 小米 \/ 豆包/);
 for(const [id,name] of [['own_mimo_desktop','小米'],['own_doubao','豆包'],
   ['own_meoo_web','秒悟'],['own_qwenwork','千问办公'],
   ['own_aws_quick','Amazon Quick']]){
   const channels=uiNodes(page,node=>node.type==='details'
     &&node.props?.className==='dnr-channel-group'
     &&rig.flatten(node).join(' ').includes('新增账号 / 重新登录'));
   assert.ok(channels.some(group=>rig.flatten(group).join(' ').includes(name)),
     'member login action must live under its own '+id+' channel');
 }
 assert.match(text,/新增账号 \/ 重新登录/);
 assert.equal(rig.mutations.some(x=>/login|cookie/.test(x.kind||'')),false,
   'opening account page never initiates an unsolicited OAuth or paid call');
});
test('host model allowlist checkboxes start with all and save exact model IDs',async()=>{
 const models=[{id:'flash',name:'Flash model'},{id:'pro',name:'Pro model'}];
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},
   [{providerId:'workbuddy'}],{state:'ready',providerId:'workbuddy',
     models,availableModels:models});
 await rig.init();
 rig.find(rig.render(),'button','复用管理')[0].props.onClick();
 rig.find(rig.render(),'button','宿主路由与模型')[0].props.onClick();
 let page=rig.render();
 const open=uiNodes(page,node=>node.type==='button'
   &&rig.flatten(node).join('').startsWith('WorkBuddy 国内'))[0];
 assert.ok(open);open.props.onClick();
 await new Promise(resolve=>setTimeout(resolve,10));
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/未指定，默认全部 2 个模型/);
 const flash=uiNodes(page,node=>node.type==='input'
   &&node.props?.['aria-label']==='允许宿主模型 flash')[0];
 assert.ok(flash);flash.props.onChange({target:{checked:true}});
 page=rig.render();
 assert.match(rig.flatten(page).join(' '),/仅允许已选中的 1 个模型/);
 assert.equal(rig.cfg.hostModelSelection?.workbuddy,undefined,
   'draft does not update live routing until Save');
 await rig.find(page,'button','保存配置')[0].props.onClick();
 assert.deepEqual(Array.from(rig.cfg.hostModelSelection.workbuddy),['flash']);
});
test('activity channel with an actual executor has a manual free-only action',async()=>{
 const snapshot={ok:true,channels:[{id:'loomy',name:'Loomy',accountCount:1,
   activityExecutorCount:1,activities:[]},
   {id:'gemini',name:'Gemini',accountCount:1,
     activityExecutorCount:0,activities:[]}],
   summary:{channelCount:2,activityCount:0,validCount:0,completedCount:0}};
 const rig=createUiRig(new Map(),null,{state:'disabled'},{},[],undefined,
   ()=>true,null,snapshot);await rig.init();
 rig.find(rig.render(),'button','渠道活动')[0].props.onClick();
 const page=rig.render();
 assert.equal(rig.find(page,'button','手动核验并领取免费活动').length,1);
 assert.doesNotMatch(rig.flatten(page).join(' '),/10000 积分/);
 await rig.find(page,'button','手动核验并领取免费活动')[0].props.onClick();
 assert.ok(rig.mutations.some(x=>x.kind==='manual-channel-activity'
   &&x.providerId==='loomy'));
});
test('notice errors render as dismissible nonblocking five-second toasts',async()=>{
 const rig=createUiRig();await rig.init();
 rig.find(rig.render(),'button','高级 JSON')[0].props.onClick();
 let page=rig.render();
 const editor=uiNodes(page,node=>node.type==='textarea'&&node.props?.['aria-label']==='完整路由配置 JSON')[0];
 assert.ok(editor);editor.props.onChange({target:{value:'not a JSON document'}});
 await rig.find(rig.render(),'button','保存配置')[0].props.onClick();
 page=rig.render();
 assert.ok(uiNodes(page,node=>node.props?.role==='alert').length>0);
 assert.ok(uiNodes(page,node=>node.props?.className==='dnr-toast').length>0);
 const css=uiNodes(page,node=>node.type==='style')[0].props.dangerouslySetInnerHTML.__html;
 assert.match(css,/\.dnr-toast-stack\{[^}]*pointer-events:none/s);
 const code=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 assert.match(code,/setTimeout\(\(\)=>setError\(''\),5000\)/);
 assert.match(code,/setTimeout\(\(\)=>setNotice\(''\),5000\)/);
 rig.find(page,'button','×')[0].props.onClick();
 assert.equal(uiNodes(rig.render(),node=>node.props?.className==='dnr-toast').length,0);
});