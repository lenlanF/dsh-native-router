import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createInstalledPluginInventory} from '../src/installed-plugin-inventory.mjs';
import {createPrivateOwnedDriver,ownedPrivateId} from '../src/channels/private-owned.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {createCheckinCenter} from '../src/checkins.mjs';
import {mergeAccountSources} from '../src/account-source-view.mjs';
import {normalizeConfig} from '../src/config.mjs';

const NOW=Date.parse('2026-11-20T05:40:00Z');
const day='2026-11-20';
const makeResponse=x=>new Response(JSON.stringify(x),{status:200});

test('Lingxi one-time migration preserves name; runtime identity, balance and signing work after original is gone',t=>{ const home=mkdtempSync(join(process.platform==='win32'?'E:\\Temp':tmpdir(),'lingxi-public-meta-'));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const profileDir=join(home,'.dsh','profiles','desktop');
 const directory=join(profileDir,'data','dsh-connect-lingxi');
 mkdirSync(directory,{recursive:true});
 const source=join(directory,'state.json');
 writeFileSync(source,JSON.stringify({accounts:[{
   id:'lingxi-original-1',enabled:true,wpsSid:'SENSITIVE_LINGXI_SESSION',
   label:'Lingxi True Display Label',credits:312,
   balance:{total:312,bonus:52,purchased:260},
   lastCheckedAt:NOW,lastCheckinDate:day,lastCheckinOutcome:'claimed',
 }]}));
 const inventory=createInstalledPluginInventory({home,profileDir});
 const sourceId='local_'+(awaitHash('lingxi-original-1'));
 const ownedId=ownedPrivateId('lingxi',sourceId);
 const actual=inventory.ownedPublicMetadata('own_lingxi',ownedId);
 assert.equal(actual.displayName,'Lingxi True Display Label');
 assert.equal(actual.balance,312);
 assert.equal(actual.checkinDate,day);
 assert.equal(actual.checkinOutcome,'claimed');
 assert.equal(inventory.ownedPublicMetadata('own_lingxi','pr_'+'a'.repeat(28)),null);
 assert.doesNotMatch(JSON.stringify(actual),/SENSITIVE_LINGXI_SESSION|wpsSid/);
 let cfg=normalizeConfig({providers:[{id:'own_lingxi',name:'lingxi · 聚合路由自有',protocol:'native-channel'}],
    accounts:[{id:ownedId,providerId:'own_lingxi',
      credentialRef:'driver:own_lingxi:'+ownedId,
      enabled:true,autoCheckin:true,displayName:actual.displayName}],   checkin:{autoEnabled:false,timeZone:'Asia/Shanghai'}});
 const store={get:()=>structuredClone(cfg),replace:next=>(cfg=normalizeConfig(next))};
  // The original is deleted BEFORE constructing/starting the owned center.
  unlinkSync(source);
  const ownDriver={checkIn:async()=>{throw Error('do not claim again')},
    accountSnapshot:()=>({state:'ready',balance:312,balanceUnit:'积分',
      balanceCheckedAt:NOW,checkinDate:day,checkinOutcome:'claimed'})};
  const accountCenter=createAccountCenter({configStore:store,
    drivers:new Map([['own_lingxi',ownDriver]]),now:()=>NOW}); const row=accountCenter.list().accounts[0];
 assert.equal(row.nickname,'Lingxi True Display Label');
 assert.equal(row.balance,312);
 const checkins=createCheckinCenter({configStore:store,accountCenter,
   store:{all:()=>[],append:()=>{throw Error('read-only snapshot must not write')}},
   now:()=>NOW});
 const view=checkins.snapshot().accounts[0];
 assert.equal(view.checkinState,'success');
 assert.equal(view.autoCheckinEffective,false,'global auto switch must be surfaced as off');
 assert.match(view.checkinMessage,/确认今日已签到/);
 const merged=mergeAccountSources({roster:accountCenter.list(),embeddedAccounts:{accounts:[]}});
 assert.equal(merged.accounts.length,1);
 assert.equal(merged.accounts[0].sourceKind,'adopted');
 assert.equal(merged.accounts[0].providerId,'lingxi');
 const stop=accountCenter.start();stop();
 assert.equal(cfg.accounts[0].displayName,'Lingxi True Display Label',
    'migrated displayName remains in independent router config');
  assert.equal(accountCenter.list().accounts[0].nickname,'Lingxi True Display Label');
  assert.equal(accountCenter.list().accounts[0].upstreamCheckinSource,'own-driver-live');});

import {createHash} from 'node:crypto';
function awaitHash(key){
 return createHash('sha256').update('dsh-native-router-inventory\0lingxi\0'+key).digest('hex').slice(0,20);
}
test('independent Lingxi read-only task lookup and real claim confirmation agree with original semantics',async()=>{
 const id='pr_'+'a'.repeat(28),sid='TEST_LINGXI_SESSION';
 const account={id,providerId:'own_lingxi',credentialRef:'driver:own_lingxi:'+id};
 let daily='claimable',claimChangesState=false,postCount=0,readCount=0;
 const fetched=async(url,options={})=>{
   const endpoint=String(url);
   assert.ok((options.headers?.cookie??'').includes(sid));
   if(endpoint.includes('/credits/balance?credit_type=total'))
     return makeResponse({data:{total_balance:142,total_bonus:20,total_purchased:122}});
   if(endpoint.endsWith('/api/public/v1/tasks')){
     readCount++;
     return makeResponse({data:{tasks:[{task_key:'daily_check_in',status:daily,
       extra:{today_date:day,check_in_days:[{date:day,status:daily}]}}]}});
   }
   if(endpoint.includes('/tasks/daily_check_in/claim')){
     assert.equal(options.method,'POST');postCount++;
     if(claimChangesState)daily='claimed';
     return makeResponse({result:'ok'});
   }
   throw Error('Unexpected remote path');
 };
 const driver=createPrivateOwnedDriver({providerId:'lingxi',now:()=>NOW,
   vault:{resolve:async()=>({value:sid})},makeCredentialRef:x=>x,fetchImpl:fetched});
 const initial=await driver.refreshAccountStatus({account,force:true});
 assert.equal(initial.balance,142);assert.equal(initial.checkinOutcome,'claimable');
 assert.equal(driver.accountSnapshot(account).balance,142);
 const notConfirmed=await driver.checkIn({account,date:day});
 assert.equal(notConfirmed.state,'pending_confirmation');
 assert.equal(notConfirmed.confirmed,undefined);
 assert.equal(postCount,1);
 claimChangesState=true;
 const confirmed=await driver.checkIn({account,date:day});
 assert.equal(confirmed.confirmed,true);
 assert.equal(confirmed.date,day);
 assert.equal(postCount,2);
 assert.equal(driver.accountSnapshot(account).checkinOutcome,'claimed');
 const repeat=await driver.checkIn({account,date:day});
 assert.equal(repeat.confirmed,true);assert.equal(postCount,2);
 assert.ok(readCount>=4);
 assert.doesNotMatch(JSON.stringify(initial)+JSON.stringify(confirmed),/TEST_LINGXI_SESSION/);
});

test('unknown Lingxi remote task status never submits a blind claim',async()=>{
 const id='pr_'+'b'.repeat(28),account={id,providerId:'own_lingxi',
   credentialRef:'driver:own_lingxi:'+id};
 let writes=0;
 const driver=createPrivateOwnedDriver({providerId:'lingxi',now:()=>NOW,
   vault:{resolve:async()=>({value:'TEST_LINGXI_SESSION'})},
   makeCredentialRef:x=>x,fetchImpl:async(url,opts={})=>{
     if(opts.method==='POST')writes++;
     return makeResponse({data:{tasks:[]}});
   }});
 const result=await driver.checkIn({account,date:day});
 assert.equal(result.state,'failed');
 assert.equal(writes,0);
});
