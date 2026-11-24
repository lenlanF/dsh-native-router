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
  {id:'own_mimo_desktop',name:'小米 MiMo Desktop · 自有会话',auth:'本插件自主网页登录 / 已有 Desktop 会话一次性接管；非 MiMo Claw 免费体验',referenceCheckin:false},
  {id:'own_meoo_web',name:'秒悟网页版 · 自有会员会话',auth:'独立浏览器登录或 Cookie；官方用户、动态模型和积分核验',referenceCheckin:false},
   {id:'own_qwenwork',name:'千问办公 · 独立会员账号',auth:'本插件设备码 PKCE 授权、原生 COSY 签名及动态倍率',referenceCheckin:false},
   {id:'own_aws_quick',name:'Amazon Quick · 自有会员账号',auth:'独立 OAuth PKCE / 一次性本机 Quick 凭据接管；四档动态模型、真实小时额度',referenceCheckin:false},
]);
export const referenceChannel=(id)=>REFERENCE_CHANNELS.find(c=>c.id===id)??null;
// A registered route is not an available login when its private vault or
// in-process source bridge is unavailable. Never render a usable channel by
// inference from a constructor method alone.
const driverReady=driver=>driver?.runtimeReady!==false&&
 (driver?.isSourceBridge!==true||driver.runtimeReady===true);
export function publicChannelMeta(provider,driver){
  const reference=referenceChannel(provider.id);
  const generic=['openai-chat','anthropic-messages'].includes(provider.protocol);
   const sourceReady=driverReady(driver);
  return {
    id:provider.id,name:provider.name,protocol:provider.protocol,
    authMethod:provider.protocol==='dsh-host'?'沿用宿主原插件登录态（本插件不保存凭据）':
      driver?.authMethod??(reference?.auth??'凭据引用 / API Key'),
    adapterReady:(typeof driver?.generate==='function'&&sourceReady)||generic||provider.protocol==='dsh-host',
    // The third-party project's advertised check-in support is NOT a capability
    // implemented by this plugin.
    checkinAvailable:typeof driver?.checkIn==='function',
    discoveryAvailable:typeof driver?.discover==='function'&&sourceReady,
    loginAvailable:sourceReady&&(typeof driver?.login==='function'||
      typeof driver?.startLogin==='function')||generic,
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
       adapterReady:typeof drivers.get(c.id)?.generate==='function'&&driverReady(drivers.get(c.id)),
       loginAvailable:driverReady(drivers.get(c.id))&&(
         typeof drivers.get(c.id)?.login==='function'||
         typeof drivers.get(c.id)?.startLogin==='function'),
      refreshAvailable:typeof drivers.get(c.id)?.refresh==='function',
      logoutAvailable:typeof drivers.get(c.id)?.logout==='function',
      checkinAvailable:typeof drivers.get(c.id)?.checkIn==='function',
       discoveryAvailable:typeof drivers.get(c.id)?.discover==='function'&&driverReady(drivers.get(c.id)),
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
