import {createSourceChannelDriver} from '../source-channel-driver.mjs';

/**
 * Stable account namespace for one native DSH provider. The desktop driver
 * continues to own only wb_/ca_ refs; the other DSH Cordis plugin continues
 * to own only sp_ refs. This never copies or resets the original login.
 */
export function createLocalAndSourceDriver({providerId,local,sourcePack}={}){
 if(!providerId||!local||!sourcePack)throw Error('Local and existing DSH source drivers required');
 const source=createSourceChannelDriver({providerId,embeddedPack:sourcePack});
 const remote=a=>typeof a?.id==='string'&&a.id.startsWith('sp_')
   &&a.credentialRef==='driver:'+providerId+':'+a.id;
 const localMethod=(method,params)=>typeof local[method]==='function'?local[method](params):
   Promise.resolve({state:'client_required',message:'此原生渠道请使用已安装的官方程序登录'});
 return {
  supportsSourceRefs:true,
  authMethod:'本机原生授权 / 现有 DSH 渠道账户引用（优先复用）',
  get sourceReady(){return source.runtimeReady===true},
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
   ?{state:'pending',message:'当前账号引用原 DSH 渠道登录态；不启动新的登录流程'}
   :localMethod('login',{account,...context}),
  refresh:async({account,...context}={})=>remote(account)
   ?{state:'pending',message:'已复用现有 DSH 登录态；模型目录不等于远程登录验证'}
   :localMethod('refresh',{account,...context}),
  logout:async({account,...context}={})=>remote(account)
   ?{revokedUpstream:false,message:'仅解绑本插件账号；原 DSH 渠道登录态不变'}
   :localMethod('logout',{account,...context}),
  listModels:async({account,...context}={})=>remote(account)
   ?source.listModels({account,...context}):local.listModels({account,...context}),
  generate:async({account,...context}={})=>remote(account)
   ?source.generate({account,...context}):local.generate({account,...context}),
 };
}
