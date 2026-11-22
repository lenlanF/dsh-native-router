// Provider/channel identity and capability metadata. No credential scanning on import.
export const REFERENCE_CHANNELS=Object.freeze([
  {id:'codearts',name:'华为云 CodeArts',auth:'OAuth / AK-SK',referenceCheckin:true},
  {id:'workbuddy',name:'腾讯 WorkBuddy / CodeBuddy',auth:'浏览器授权 / 桌面端',referenceCheckin:true},
  {id:'buddy',name:'腾讯 CodeBuddy 独立账号',auth:'浏览器授权 / 自有渠道池',referenceCheckin:true},
  {id:'qoder',name:'Qoder',auth:'浏览器授权',referenceCheckin:true},
  {id:'qodercn',name:'Qoder 中国区',auth:'浏览器授权 / 自有渠道池',referenceCheckin:true},
  {id:'trae',name:'TRAE',auth:'设备码 / 浏览器授权',referenceCheckin:true},
  {id:'cline',name:'Cline 独立账号',auth:'浏览器授权 / 自有渠道池',referenceCheckin:false},
  {id:'raccoon',name:'Raccoon',auth:'浏览器授权',referenceCheckin:true},
  {id:'lobsterai',name:'LobsterAI',auth:'浏览器授权',referenceCheckin:false},
  {id:'minimax',name:'MiniMax',auth:'浏览器授权',referenceCheckin:false},
  {id:'gemini',name:'Gemini 自有 OAuth',auth:'浏览器 OAuth / 自有渠道池',referenceCheckin:false},
  {id:'zcode',name:'ZCode',auth:'浏览器授权',referenceCheckin:false},
  {id:'loomy',name:'讯飞 Loomy',auth:'微信扫码',referenceCheckin:false},
  {id:'own_mimo_desktop',name:'小米 MiMo 会员 · 自有会话',auth:'本插件自主网页登录 / 已有会话一次性接管；无需原客户端进程',referenceCheckin:false},
  {id:'own_doubao',name:'豆包工作会员 · 自有会话',auth:'本插件独立浏览器扫码 / Cookie；无需豆包客户端进程',referenceCheckin:true},
]);
export const referenceChannel=(id)=>REFERENCE_CHANNELS.find(c=>c.id===id)??null;
export function publicChannelMeta(provider,driver){
  const reference=referenceChannel(provider.id);
  const generic=['openai-chat','anthropic-messages'].includes(provider.protocol);
  const sourceReady=driver?.isSourceBridge!==true||driver.runtimeReady===true;
  return {
    id:provider.id,name:provider.name,protocol:provider.protocol,
    authMethod:provider.protocol==='dsh-host'?'沿用宿主原插件登录态（本插件不保存凭据）':
      driver?.authMethod??(reference?.auth??'凭据引用 / API Key'),
    adapterReady:(typeof driver?.generate==='function'&&sourceReady)||generic||provider.protocol==='dsh-host',
    // The third-party project's advertised check-in support is NOT a capability
    // implemented by this plugin.
    checkinAvailable:typeof driver?.checkIn==='function',
    discoveryAvailable:typeof driver?.discover==='function'&&sourceReady,
    loginAvailable:typeof driver?.login==='function'||generic,
    refreshAvailable:typeof driver?.refresh==='function'||generic,
    logoutAvailable:typeof driver?.logout==='function'||generic,
    referenceCheckin:reference?.referenceCheckin??false,
    referenceOnly:false,
  };
}
export function describeChannels(config,drivers=new Map()){
  const configured=config.providers.map(p=>publicChannelMeta(p,drivers.get(p.id)));
  const present=new Set(configured.map(p=>p.id));
  return [
    ...configured,
    ...REFERENCE_CHANNELS.filter(c=>!present.has(c.id)).map(c=>({
      id:c.id,name:c.name,protocol:null,authMethod:c.auth,
      adapterReady:typeof drivers.get(c.id)?.generate==='function'
        &&(drivers.get(c.id)?.isSourceBridge!==true||drivers.get(c.id)?.runtimeReady===true),
      loginAvailable:typeof drivers.get(c.id)?.login==='function',
      refreshAvailable:typeof drivers.get(c.id)?.refresh==='function',
      logoutAvailable:typeof drivers.get(c.id)?.logout==='function',
      checkinAvailable:typeof drivers.get(c.id)?.checkIn==='function',
      discoveryAvailable:typeof drivers.get(c.id)?.discover==='function'
        &&(drivers.get(c.id)?.isSourceBridge!==true||drivers.get(c.id)?.runtimeReady===true),
      referenceCheckin:c.referenceCheckin,referenceOnly:true,
    })),
  ];
}
export function automaticPools(config,checkStates=new Map()){
  return config.providers.map(p=>{
    const accounts=config.accounts.filter(a=>a.providerId===p.id),
      enabled=accounts.filter(a=>a.enabled&&p.enabled),
      verified=enabled.filter(a=>checkStates.get(a.id)?.state==='online');
    return {providerId:p.id,accountIds:enabled.map(a=>a.id),
      configured:accounts.length,enabled:enabled.length,verified:verified.length,
      mode:'automatic',rule:'同渠道已启用账号自动加入；具体链条可限定 accountIds',
      // Do not say free: cost metadata is not derived from a real billing API.
    };
  });
}
