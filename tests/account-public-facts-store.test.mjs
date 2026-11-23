import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPublicAccountFactsStore} from '../src/account-public-facts-store.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

const base=process.platform==='win32'?'E:\\Temp':tmpdir();
const setup=()=>{mkdirSync(base,{recursive:true});return mkdtempSync(join(base,'dsh-public-facts-'))};
const account={id:'acct_demo',providerId:'own_lingxi',
 credentialRef:'driver:own_lingxi:acct_demo',enabled:true};
test('last verified public balance/name persists through restart but never exposes private binding',()=>{
 const dir=setup();try{
  let clock=Date.parse('2026-11-23T04:00:00Z');
  const path=join(dir,'public-account-facts.json'),now=()=>clock;
  const store=createPublicAccountFactsStore({path,now});
  assert.equal(store.observe(account,{displayName:'正式账户名称',balance:1250,
   balanceUnit:'积分',balanceCheckedAt:clock,expiringPoints:180,
   expiringAt:clock+3*86400000}),true);
  assert.equal(store.get(account).name,'正式账户名称');
  assert.equal(store.get(account).balance,1250);
  assert.equal(store.get(account).expiringPoints,180);
  const text=readFileSync(path,'utf8');
  assert.doesNotMatch(text,/driver:own_lingxi:acct_demo/);
  assert.doesNotMatch(text,/credentialRef|access_token|cookie|password/);
  clock+=60000;
  assert.equal(createPublicAccountFactsStore({path,now}).get(account).balance,1250);
  assert.equal(store.observe(account,{balanceState:'unavailable',name:'账号1'}),false);
  assert.equal(store.get(account).balance,1250);
  assert.equal(store.get({...account,credentialRef:'driver:own_lingxi:replacement'}),null);
  assert.equal(store.get({...account,providerId:'own_doubao'}),null);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('newer exact-account numbers supersede old; older delayed replies cannot roll them back',()=>{
 let clock=Date.parse('2026-11-23T04:00:00Z');
 const store=createPublicAccountFactsStore({now:()=>clock});
 store.observe(account,{balance:900,balanceUnit:'积分',balanceCheckedAt:clock,
   nickname:'初始名字'});
 clock+=30000;
 store.observe(account,{balance:950,balanceUnit:'积分',balanceCheckedAt:clock,
   nickname:'新名字'});
 store.observe(account,{balance:800,balanceUnit:'积分',balanceCheckedAt:clock-30000});
 const row=store.get(account);
 assert.equal(row.balance,950);
 assert.equal(row.name,'新名字');
 assert.equal(row.balanceCheckedAt,clock);
});
test('zero is a valid balance, stale balance is not fresh, expired bonus is not reused',()=>{
 let clock=Date.parse('2026-11-23T04:00:00Z');
 const store=createPublicAccountFactsStore({now:()=>clock});
 store.observe(account,{balance:0,balanceUnit:'积分',balanceCheckedAt:clock,
  nickname:'账号名称'});
 assert.equal(store.get(account).balance,0);
 clock+=8*86400000;
 assert.equal(store.get(account),null);
});
test('expired cache rows are skipped independently, never poison surviving account facts',()=>{
 const dir=setup();try{
  let clock=Date.parse('2026-11-23T04:00:00Z'),now=()=>clock;
  const path=join(dir,'cached.json');
  const store=createPublicAccountFactsStore({path,now});
  store.observe(account,{nickname:'将过期账号',balance:88,
   balanceUnit:'积分',balanceCheckedAt:clock});
  clock+=6*86400000;
  const other={...account,id:'other_account',
   credentialRef:'driver:own_lingxi:other_account'};
  store.observe(other,{nickname:'仍然有效的账户',balance:66,
   balanceUnit:'积分',balanceCheckedAt:clock});
  clock+=2*86400000;
  const restarted=createPublicAccountFactsStore({path,now});
  assert.equal(restarted.blocked,false);
  assert.equal(restarted.get(account),null);
  assert.equal(restarted.get(other).balance,66);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('an authenticated balance without an explicit unit is still a valid display value',()=>{
 let clock=Date.parse('2026-11-23T04:00:00Z');
 const store=createPublicAccountFactsStore({now:()=>clock});
 store.observe(account,{balance:17.75,balanceCheckedAt:clock,
  accountName:'账号名称'});
 assert.equal(store.get(account).balance,17.75);
 assert.equal(store.get(account).balanceUnit,'');
 clock+=30000;
 store.observe(account,{balance:25,balanceCheckedAt:clock});
 assert.equal(store.get(account).balance,25);
});

test('account center does not lose identity and spendable points on an empty/failed driver snapshot',()=>{
 const a={...account,weight:1,autoCheckin:false};
 const cfg=normalizeConfig({providers:[{id:a.providerId,name:'灵犀',protocol:'native-channel',enabled:true}],
 accounts:[a]});
 const configStore={get:()=>cfg,replace:()=>{}};
 let current={nickname:'真实账号',balance:2860,balanceUnit:'积分',
   balanceCheckedAt:Date.parse('2026-11-23T04:00:00Z')};
 let clock=Date.parse('2026-11-23T04:00:00Z');
 const store=createPublicAccountFactsStore({now:()=>clock});
 const driver={accountSnapshot:()=>current,refreshAccountStatus:async()=>({state:'unavailable'})};
 const center=createAccountCenter({configStore,publicFactsStore:store,
  drivers:new Map([[a.providerId,driver]]),now:()=>clock});
 let row=center.list().accounts[0];
 assert.equal(row.nickname,'真实账号');
 assert.equal(row.balance,2860);
 assert.equal(row.balanceState,'available');
 current={balanceState:'unavailable'};clock+=30000;
 row=center.list().accounts[0];
 assert.equal(row.nickname,'真实账号');
 assert.equal(row.profileState,'cached');
 assert.equal(row.balance,2860);
 assert.equal(row.balanceState,'cached');
 assert.equal(row.balanceStale,true);
 assert.equal(row.balanceCheckedAt,clock-30000);
 current={nickname:'重新核实',balance:0,balanceUnit:'积分',
   balanceCheckedAt:clock};row=center.list().accounts[0];
 assert.equal(row.nickname,'重新核实');
 assert.equal(row.balance,0);
 assert.equal(row.balanceState,'available');
 center.stop();
});
