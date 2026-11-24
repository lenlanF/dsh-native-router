import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,existsSync,readFileSync,rmSync,writeFileSync,readdirSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeConfig,createConfigStore} from '../src/config.mjs';

import {sample} from './fixtures.mjs';

test('valid multi-provider metadata and one cross-provider chain',()=>{
 const cfg=normalizeConfig(sample);
 assert.equal(cfg.providers.length,2);
 assert.equal(cfg.accounts.length,3);
 assert.equal(cfg.routes[0].tiers.length,2);
 assert.equal(cfg.hostFailover.enabled,false);
});
test('provider authentication cannot persist direct secrets',()=>{
 assert.throws(()=>normalizeConfig({...sample,accounts:[{id:'a1',providerId:'alpha',apiKey:'sk-sensitive',credentialRef:'env:KEY'}]}),/Secrets/);
 assert.throws(()=>normalizeConfig({...sample,token:'plain'}),/Secrets/);
});
test('upstream HTTP must be loopback and never contain credentials',()=>{
 assert.throws(()=>normalizeConfig({...sample,providers:[{id:'bad',baseUrl:'http://example.com/v1'}]}),/HTTPS/);
 assert.throws(()=>normalizeConfig({...sample,providers:[{id:'bad',baseUrl:'https://user:password@example.com/v1'}]}),/embed credentials/);
});
test('reject invalid route references and wrong-provider account ids',()=>{
 assert.throws(()=>normalizeConfig({...sample,routes:[{id:'bad',tiers:[{providerId:'alpha',model:'x',accountIds:['l1']}]}]}),/references/);
 assert.throws(()=>normalizeConfig({...sample,providers:[{id:'a',baseUrl:'https://e.invalid'},{id:'a',baseUrl:'https://e.invalid'}]}),/Duplicate/);
});
test('config state writes atomically and retains exhaustion after reload',t=>{
 const parent=process.platform==='win32'&&existsSync('E:\\Temp')?'E:\\Temp':tmpdir();
 const dir=mkdtempSync(join(parent,'dsh-native-router-test-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const path=join(dir,'config.json');
 const store=createConfigStore({path,initial:sample});
 assert.equal(existsSync(path),false,'must not write config at startup');
 const next=store.replace({...store.get(),hostFailover:{enabled:true,mode:'free',
   priority:[{provider:'native-router',model:'chain:daily',free:true}],
   exhaustedRoutes:{'native-router/chain:daily':1700000000000}}});
 assert.equal(next.hostFailover.exhaustedRoutes['native-router/chain:daily'],1700000000000);
 const reload=createConfigStore({path});
 assert.deepEqual(reload.get(),next);
 assert.doesNotMatch(readFileSync(path,'utf8'),/sk-sensitive/);
 assert.equal(existsSync(path+'.tmp-'+process.pid),false);
});
test('stale crash-era temp file never blocks later atomic DSH configuration save',t=>{
 const parent=process.platform==='win32'&&existsSync('E:\\Temp')?'E:\\Temp':tmpdir();
 const dir=mkdtempSync(join(parent,'dsh-native-router-config-crash-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const path=join(dir,'config.json');
 const stale=path+'.tmp-'+process.pid;
 writeFileSync(stale,'{"old":"incomplete"}');
 const store=createConfigStore({path,initial:normalizeConfig({})});
 store.replace({...store.get(),hostFailover:{enabled:true}});
 assert.equal(store.get().hostFailover.enabled,true);
 assert.equal(createConfigStore({path}).get().hostFailover.enabled,true);
 assert.equal(readFileSync(stale,'utf8'),'{"old":"incomplete"}',
  'a leftover crash file is left for forensic review, not silently deleted');
 assert.deepEqual(readdirSync(dir).sort(),['config.json','config.json.tmp-'+process.pid].sort());
});

test('retired provider is absent from all active config surfaces and original data is retained on first save',t=>{
 const parent=process.platform==='win32'&&existsSync('E:\\Temp')?'E:\\Temp':tmpdir();
 const dir=mkdtempSync(join(parent,'dnr-retired-channel-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'config.json'),retired='own_doubao',id='db_'+'a'.repeat(28);
 const removed={providerId:retired,model:'legacy',accountIds:[id]};
 const live=sample.routes[0].tiers[0];
 const raw={...sample,providers:[...sample.providers,{id:retired,protocol:'native-channel'}],
 accounts:[...sample.accounts,{id,providerId:retired,credentialRef:'driver:'+retired+':'+id,enabled:true}],
 routes:[{id:'removed',tiers:[removed]},{id:'mixed',tiers:[removed,live]},{id:'pinned',mode:'pinned',tiers:[removed,live]}],
 freePool:{providerIds:[retired,'alpha'],models:[{providerId:retired,model:'legacy',free:true},{providerId:'alpha',model:'x',free:true}]},
 hostModelSelection:{[retired]:['legacy'],alpha:['x']},
 sessionReuse:{linkedIds:[id,'a1'],ignoredIds:[id,'a2']},
 checkin:{autoEnabled:true,channels:{doubao:true,alpha:true},independentChannels:['doubao','alpha']},
 hostFailover:{enabled:true,mode:'pinned',priority:['native-router/direct:own_doubao:legacy','native-router/chain:removed','alpha/x'],
 exhaustedRoutes:{'native-router/direct:own_doubao:legacy':123,'alpha/x':234},
 switchLog:[{at:123,from:'doubao/x',to:'alpha/x',code:'QUOTA'}]}};
 const original=JSON.stringify(raw);
 writeFileSync(path,original);
 const store=createConfigStore({path}),cfg=store.get();
 assert.equal(readFileSync(path,'utf8'),original);
 assert.equal(cfg.providers.length,sample.providers.length);
 assert.equal(cfg.accounts.length,sample.accounts.length);
 assert.deepEqual(cfg.routes.map(r=>r.id),['mixed','pinned']);
 assert.equal(cfg.routes[0].tiers.length,1);assert.equal(cfg.routes[1].enabled,false);
 assert.deepEqual(cfg.freePool.providerIds,['alpha']);assert.equal(cfg.freePool.models.length,1);
 assert.deepEqual(cfg.hostModelSelection,{alpha:['x']});
 assert.deepEqual(cfg.sessionReuse.linkedIds,['a1']);assert.deepEqual(cfg.sessionReuse.ignoredIds,['a2']);
 assert.deepEqual(cfg.checkin.channels,{alpha:true});assert.deepEqual(cfg.checkin.independentChannels,['alpha']);
 assert.equal(cfg.hostFailover.enabled,false);assert.deepEqual(cfg.hostFailover.priority,['alpha/x']);
 assert.deepEqual(cfg.hostFailover.exhaustedRoutes,{'alpha/x':234});
 assert.equal(cfg.hostFailover.switchLog.length,0);
 assert.doesNotMatch(JSON.stringify(cfg),/doubao|db_aaaaaaaa/);
 store.replace(cfg);
 assert.equal(readFileSync(path+'.retired-channel-v1.bak','utf8'),original);
 assert.deepEqual(createConfigStore({path}).get(),cfg);
});
