import test from 'node:test';
import assert from 'node:assert/strict';
import {createMimoDesktopLoginFlow,mimoCookieFromCdp,parseMimoLoginCookie,MIMO_LOGIN_REGIONS}
 from '../src/channels/mimo-desktop-login.mjs';
import {createMimoDesktopDriver} from '../src/channels/mimo-desktop.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

const validCookie=[
 {domain:'.account.xiaomi.com',name:'passToken',value:'mimo-membership-pass-synthetic-123456'},
 {domain:'account.xiaomi.com',name:'userId',value:'owner-id-11'},
 {domain:'.xiaomi.com',name:'cUserId',value:'encrypted-c-11'},
];
test('MiMo Chrome capture only takes exact Xiaomi account-domain membership cookies',()=>{
 const extra=[
   {domain:'account.xiaomi.com.evil.test',name:'passToken',value:'evil'},
   {domain:'evilxiaomi.com',name:'userId',value:'other'},
   {domain:'mimo-server-cn.xiaomimimo.com',name:'access_token',value:'commercial-key'},
   {domain:'account.xiaomi.com',name:'passToken',value:'bad\r\nHeader:secret'},
 ];
 const exported=mimoCookieFromCdp([...extra,...validCookie]);
 assert.match(exported,/passToken=mimo-membership-pass-synthetic/);
 assert.match(exported,/userId=owner-id-11/);
 assert.doesNotMatch(exported,/commercial-key|Header|evil|other/);
 assert.equal(mimoCookieFromCdp(extra),'');
 assert.equal(parseMimoLoginCookie('passToken=x\r\nfoo:bar'),null);
});
test('MiMo member browser can independently capture each region and never prompts for API key',async()=>{
 const values=[];
 const flow=createMimoDesktopLoginFlow({
  onSession:async session=>{
    values.push(session);
    return {id:'sp_example',providerId:'own_mimo_desktop'};
  },
  flowFactory:options=>{
    assert.equal(typeof options.extractCookie,'function');
    return {
      busy:false,
      async start(){
        const cookie=options.extractCookie(validCookie);
        const account=(await options.addAccount({cookie})).account;
        return {status:'done',account};
      },
      status(){return {status:'done',account:{id:'sp_example',providerId:'own_mimo_desktop'}}},
      cancel(){return {status:'canceled'}},
    };
  },
 });
 for(const region of Object.keys(MIMO_LOGIN_REGIONS))await flow.start({region});
 assert.deepEqual(values.map(x=>x.region),Object.keys(MIMO_LOGIN_REGIONS));
 assert(values.every(x=>x.passToken==='mimo-membership-pass-synthetic-123456'));
 assert.equal(flow.status().status,'done');
 assert.equal(flow.cancel().status,'canceled');
 await assert.rejects(()=>flow.start({region:'fake'}),/Unsupported/);
});
function fixture({rejectSave=false}={}){
 const record=new Map(),vault={
  async resolve(k){return record.get(k)},
  async set(k,value){record.set(k,{value})},
  async unset(k){record.delete(k)},
 };
 let browser;
 const driver=createMimoDesktopDriver({
  vault,readCurrentSession:async()=>null,
  transport:{probe:async()=>({state:'online',authVerified:true})},
  loginFactory:({onSession})=>{
   const status={status:'idle'};
   browser={async save(){
    status.status='done';
    status.account=await onSession({region:'cn',
      passToken:'browser-sso-owner-session-12345',userId:'subscriber1',cUserId:'trusted'})},
   };
   return {start:async()=>({status:'waiting'}),status:()=>status,
     cancel:()=>({status:'canceled'})};
  },
 });
 let state=normalizeConfig({});
 const configStore={get:()=>structuredClone(state),
  replace:value=>{
   if(rejectSave)throw Error('Simulated config write failure');
   state=normalizeConfig(value);
  }};
 const center=createAccountCenter({configStore,drivers:new Map([['own_mimo_desktop',driver]])});
 return {center,browser,record,get state(){return state}};
}
test('MiMo independent membership login commits account and provider after actual callback only',async()=>{
 const h=fixture();
 await h.center.startMimoLogin({region:'cn'});
 assert.equal(h.state.providers.length,0);
 assert.equal(h.record.size,0);
 await h.browser.save();
 const done=await h.center.pollMimoLogin();
 assert.equal(done.status,'done');
 assert.equal(done.account.providerId,'own_mimo_desktop');
 assert.equal(h.state.accounts.length,1);
 assert.equal(h.state.providers[0].protocol,'native-channel');
 assert.equal(h.record.size,1);
 assert.doesNotMatch(JSON.stringify(h.state),/browser-sso-owner-session-12345/);
 assert.equal((await h.center.pollMimoLogin()).account.alreadyOwned,true);
});
test('MiMo browser account receipt rolls back private token if config write fails',async()=>{
 const h=fixture({rejectSave:true});
 await h.center.startMimoLogin({region:'cn'});
 await h.browser.save();
 await assert.rejects(h.center.pollMimoLogin(),/Simulated config write failure/);
 assert.equal(h.record.size,0);
 assert.equal(h.state.accounts.length,0);
});
