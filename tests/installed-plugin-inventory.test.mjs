import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createInstalledPluginInventory} from '../src/installed-plugin-inventory.mjs';
import {createSessionReuse} from '../src/session-reuse.mjs';
import {createAccountAdoption} from '../src/account-adoption.mjs';
import {normalizeConfig} from '../src/config.mjs';

function setup(t){
 const base=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':process.cwd(),'native-source-scan-test-'));
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 const home=join(base,'user'),profileDir=join(home,'.dsh','profiles','desktop');
 const publicLoomyDir=join(base,'public','Loomy');
 const write=(path,data)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,data)};
 for(const packageName of ['dsh-connect-workbuddy','dsh-connect-lingxi',
   'dsh-connect-loomy','dsh-zcode-startplan']){
   write(join(profileDir,'node_modules',packageName,'package.json'),
    JSON.stringify({name:packageName,version:'1.2.3'}));
 }
 write(join(profileDir,'data','dsh-connect-lingxi','state.json'),
  JSON.stringify({accounts:[{id:'lingxi-original-1',enabled:true,
   wpsSid:'SECRET_LINGXI_SID',label:'PRIVATE_NAME'}]}));
 write(join(profileDir,'data','dsh-connect-loomy','state.json'),
  JSON.stringify({accounts:[],manualSession:''}));
 write(join(publicLoomyDir,'install-a','userData','auth-session.json'),
  JSON.stringify({session:'SECRET_LOOMY_SESSION',phone:'PRIVATE_PHONE'}));
 write(join(home,'.dsh','zcode-start-plan','accounts.db'),'mocked DB sentinel');
 const scanner=createInstalledPluginInventory({home,profileDir,publicLoomyDir,
  sqliteReader:async()=>[{id:'zcode-account-1',enabled:1,credential:'DO_NOT_EXPOSE'}]});
 return {base,home,profileDir,publicLoomyDir,scanner};
}
test('installed WorkBuddy, Lingxi, Loomy desktop and ZCode are differentiated without tokens or auth writes',async t=>{
 const f=setup(t);
 const original=readFileSync(join(f.profileDir,'data','dsh-connect-lingxi','state.json'));
 const result=await f.scanner.scan();
 assert.deepEqual(result.plugins.map(p=>p.installed),[true,true,true,true]);
 assert.deepEqual(Object.fromEntries(result.accounts.map(x=>[x.providerId,x.source])),{
  lingxi:'lingxi-private-state',loomy:'loomy-desktop-session',
  'zcode-start-plan':'zcode-private-sqlite'});
 assert.equal(result.detected,3);
 assert.equal(result.verified,0);
 assert.equal(result.portable,0);
 assert.ok(result.accounts.every(a=>a.portable===false&&a.loginVerified===false));
 assert.ok(result.accounts.every(a=>/^local_[a-f0-9]{20}$/.test(a.accountId)));
 assert.doesNotMatch(JSON.stringify(result),
   /SECRET_LINGXI|SECRET_LOOMY|DO_NOT_EXPOSE|PRIVATE_NAME|PRIVATE_PHONE|zcode-account-1/);
 assert.deepEqual(readFileSync(join(f.profileDir,'data','dsh-connect-lingxi','state.json')),original);
});
test('unavailable private DB is reported, not misclassified as an empty or logged-in pool',async t=>{
 const f=setup(t);
 const scanner=createInstalledPluginInventory({home:f.home,
  profileDir:f.profileDir,publicLoomyDir:f.publicLoomyDir,
  sqliteReader:async()=>{throw Error('SECRET_DO_NOT_LOG')}});
 const data=await scanner.scan();
 assert.equal(data.accounts.length,2);
 assert.ok(data.issues.some(x=>x.providerId==='zcode-start-plan'&&x.state==='unreadable'));
 assert.doesNotMatch(JSON.stringify(data),/SECRET_DO_NOT_LOG/);
});
test('manual reuse scan counts private authorizations without forging imported or authenticated DSH accounts',async t=>{
 const f=setup(t);
 let cfg=normalizeConfig({sessionReuse:{enabled:true}});
 const store={get:()=>structuredClone(cfg),replace:x=>(cfg=normalizeConfig(x))};
 const inventory=createSessionReuse({configStore:store,drivers:new Map(),
  installedInventory:f.scanner,embeddedPack:{status:()=>({state:'disabled'})}});
 const scanned=await inventory.scan();
 assert.equal(scanned.detectedPrivate,3);
 assert.equal(scanned.autoLinked,0);
 assert.equal(scanned.results.filter(x=>x.state==='private_authorization_unverified').length,3);
 assert.deepEqual(cfg.accounts,[]);
 assert.deepEqual(cfg.providers,[]);
 inventory.stop();
 const transfer=createAccountAdoption({configStore:store,
  originalSource:{portableAccounts:async()=>({state:'unavailable',accounts:[]})},
  ownedPack:{status:()=>({state:'disabled'})},installedInventory:f.scanner});
 const preview=await transfer.preview();
 assert.equal(preview.state,'ready');
 assert.equal(preview.accounts.length,3);
 assert.ok(preview.accounts.every(x=>!x.portable&&x.state==='private_authorization_unverified'));
 assert.equal((await transfer.adopt({providerId:'lingxi',
  accountId:preview.accounts[0].accountId,consent:true})).state,'unsupported');
});
