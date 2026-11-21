import {createSourceChannelDriver} from '../source-channel-driver.mjs';

/**
 * Stable account namespace for one native DSH provider. The desktop driver
 * continues to own only wb_/ca_ refs; sp_ refs may belong either to
 * this plugin's private QR/OAuth pool or a separate legacy DSH source.
 * Provenance selects the authority; never fall back to an original plugin for
 * an explicitly self-owned login after its private pool becomes unavailable.
 */
export function createLocalAndSourceDriver({providerId,local,sourcePack,ownedPack,getAccountOrigin}={}){
 if(!providerId||!local||!sourcePack)throw Error('Local and existing DSH source drivers required');
 const source=createSourceChannelDriver({providerId,embeddedPack:sourcePack});
 const ownedSource=ownedPack?createSourceChannelDriver({providerId,embeddedPack:ownedPack}):null;
 const remote=a=>a?.providerId===providerId&&/^sp_[a-f0-9]{24}$/.test(a?.id??'')
   &&a.credentialRef==='driver:'+providerId+':'+a.id;
 const privateRef=a=>remote(a)&&getAccountOrigin?.(a)==='own-source-pack';
 const privateReady=a=>privateRef(a)&&ownedSource?.runtimeReady===true;
 const selected=a=>privateRef(a)?ownedSource:source;
 const checkedSource=a=>{
   const driver=selected(a);
   if(!driver)throw Error('本插件私有账号池尚未就绪；不会回退至其他插件授权');
   return driver;
 };
 const localMethod=(method,params)=>typeof local[method]==='function'?local[method](params):
   Promise.resolve({state:'client_required',message:'此原生渠道请使用已安装的官方程序登录'});
 return {
  supportsSourceRefs:true,
  authMethod:'本插件扫码自主登录 / 本机授权 / 现有 DSH 账号引用',
  get sourceReady(){return source.runtimeReady===true||ownedSource?.runtimeReady===true},
  isPrivateSourceBound:privateReady,
  accountSnapshot(account){
    return remote(account)?checkedSource(account).accountSnapshot?.(account)??{}:
      local.accountSnapshot?.(account)??{};
  },
  async refreshAccountStatus({account,...context}={}){
    if(remote(account)){
      if(!privateRef(account))return {state:'unavailable',authVerified:false};
      return checkedSource(account).refreshAccountStatus({account,...context});
    }
    return typeof local.refreshAccountStatus==='function'
      ?local.refreshAccountStatus({account,...context}):{state:'unavailable',authVerified:false};
  },
  async discover(){
   const found=typeof local.discover==='function'?await local.discover():[];
   const existing=source.runtimeReady===true
     ?await source.discover().catch(()=>[]):[];
   return [...found,...existing];
  },
  async importCandidate({candidateId,consent}={}){
   if(typeof candidateId==='string'&&candidateId.startsWith('sp_'))
    return source.importCandidate({candidateId,consent});
   return local.importCandidate({candidateId,consent});
  },
  login:async({account,...context}={})=>remote(account)
   ?{state:'pending',message:privateRef(account)?
     '扫码账号已保存在本插件独立账号池；请刷新鉴权，无需再次扫码':
     '当前账号是外部 DSH 登录引用；不启动新的登录流程'}
   :localMethod('login',{account,...context}),
  refresh:async({account,...context}={})=>remote(account)
   ?privateRef(account)?checkedSource(account).refresh({account,...context}):
     {state:'pending',message:'外部 DSH 登录引用尚未独立接管，不能以模型目录代替鉴权'}
   :localMethod('refresh',{account,...context}),
  logout:async({account,...context}={})=>remote(account)
   ?{revokedUpstream:false,message:privateRef(account)?
      '已解除本插件账号引用；内置账号池的原授权仍保留':
      '仅解绑本插件账号；外部 DSH 渠道登录态不变'}
   :localMethod('logout',{account,...context}),
  listModels:async({account,...context}={})=>remote(account)
   ?checkedSource(account).listModels({account,...context}):local.listModels({account,...context}),
  generate:async({account,...context}={})=>remote(account)
   ?checkedSource(account).generate({account,...context}):local.generate({account,...context}),
 };
}
