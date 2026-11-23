import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {auditInstalledDsh} from '../tools/audit-installed-state-readonly.mjs';
const day=Date.parse('2026-11-23T08:00:00Z');
const account=(id,provider)=>({id,providerId:provider,
 credentialRef:'driver:'+provider+':'+id,enabled:true,autoCheckin:true});
const bind=a=>createHash('sha256').update(a.providerId+'\0'+a.id+'\0'+a.credentialRef).digest('hex');
test('installed-state audit reads true per-account bindings, redacts names/IDs/secrets and has no writes',()=>{
 const base=process.platform==='win32'?'E:\\Temp':tmpdir();
 const root=mkdtempSync(join(base,'dsh-audit-readonly-'));
 const files=new Map();
 const save=(file,content)=>{
  const target=join(root,file);
  mkdirSync(dirname(target),{recursive:true});
  const raw=JSON.stringify(content);
  files.set(target,raw);
  writeFileSync(target,raw);
 };
 try{
  const a=account('alpha','own_loomy'),b=account('beta','own_doubao');
  save('profiles/desktop/node_modules/dsh-native-router/package.json',
    {version:'1.0.0-rc.94'});
  save('plugins/dsh-native-router/config.json',{providers:[{id:'own_loomy'},
    {id:'own_doubao'}],accounts:[a,b],routes:[],checkin:{
      autoEnabled:false,autoSourceAccounts:true}});
  save('plugins/dsh-native-router/account-public-facts.json',{version:1,
    rows:[{binding:bind(a),name:'REAL_SENSITIVE_NAME_123',balance:800,
      balanceUnit:'',balanceCheckedAt:day-1000},
      {binding:'0'.repeat(64),name:'OTHER_ACCOUNT_DO_NOT_JOIN',balance:500,
        balanceUnit:'积分',balanceCheckedAt:day-1000}]});
  save('plugins/dsh-native-router/account-verification.json',{version:1,
    checks:[{id:'alpha',binding:bind(a),state:'online',
      checkedAt:day-1000,verifiedAt:day-1000},
      {id:'beta',binding:bind(b),state:'expired',
      checkedAt:day-2000,verifiedAt:null}]});
  save('plugins/dsh-native-router/checkins.json',{version:1,
    history:[{accountId:'alpha',date:'2026-11-23',state:'success',
      message:'SECRET_BEARER_MUST_STAY_PRIVATE'}]});
  save('plugins/dsh-native-router/reward-claims.json',{version:1,
    receipts:[{key:'a'.repeat(64),binding:bind(a),kind:'gift',
      state:'pending_confirmation',at:day}]});
  const result=auditInstalledDsh({dshHome:root,now:day});
  assert.equal(result.installedVersion,'1.0.0-rc.94');
  assert.equal(result.accounts.configured,2);
  assert.equal(result.accounts.named,1);
  assert.equal(result.accounts.balanceReported,1);
  assert.equal(result.accounts.balanceUnitMissing,1);
  assert.equal(result.accounts.balanceUnreported,1);
  assert.equal(result.accounts.onlineProbeRecent,1);
  assert.equal(result.accounts.expiredProbeRecent,1);
  assert.equal(result.accounts.modelProofUnverified,2);
  assert.equal(result.todayCheckins.byState.success,1);
  assert.equal(result.rewardReceipts.pending,1);
  assert.equal(result.globalAutomaticActivitiesEnabled,false);
  assert.equal(result.readOnly,true);
  assert.equal(result.liveOfficialAPIQueried,false);
  const text=JSON.stringify(result);
  for(const marker of ['REAL_SENSITIVE_NAME_123','OTHER_ACCOUNT_DO_NOT_JOIN',
    'SECRET_BEARER_MUST_STAY_PRIVATE','driver:','alpha','beta'])
    assert.doesNotMatch(text,new RegExp(marker.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')));
  for(const [file,value]of files)
    assert.equal(readFileSync(file,'utf8'),value,'must never change installed state');
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('missing or damaged installed metadata yields a diagnostic, never invented success',()=>{
 const base=process.platform==='win32'?'E:\\Temp':tmpdir();
 const root=mkdtempSync(join(base,'dsh-audit-damaged-'));
 try{
   const initial=auditInstalledDsh({dshHome:root,now:day});
   assert.equal(initial.accounts.configured,0);
   assert.equal(initial.installedVersion,'missing');
   const place=join(root,'plugins','dsh-native-router');
   mkdirSync(place,{recursive:true});
   writeFileSync(join(place,'config.json'),'{invalid');
   const damaged=auditInstalledDsh({dshHome:root,now:day});
   assert.equal(damaged.configStatus,'invalid');
   assert.equal(damaged.accounts.configured,0);
 }finally{rmSync(root,{recursive:true,force:true})}
});
