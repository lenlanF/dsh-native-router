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
