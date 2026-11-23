import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createWorkBuddyDriver} from '../src/channels/workbuddy.mjs';
import {createSourceChannelDriver} from '../src/source-channel-driver.mjs';
import {createSessionReuse} from '../src/session-reuse.mjs';
import {createAccountCenter} from '../src/account-center.mjs';
import {normalizeConfig} from '../src/config.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const tnow=Date.parse('2026-11-17T03:00:00Z');
const future=Date.parse('2030-01-01T00:00:00Z');
function fixture(t,{enabled=true,refreshToken='fake-refresh',
  expiresAt=future,sourceRows=[],sourceReady=true,initial={}}={}){
 const root=process.platform==='win32'&&existsSync('E:\\Temp')?'E:\\Temp':tmpdir();
 const dir=mkdtempSync(join(root,'dsh-reuse-fake-client-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const local=join(dir,'AppData','Local'),roaming=join(dir,'AppData','Roaming');
 const folder=join(local,'CodeBuddyExtension','Data','Public','auth');
 mkdirSync(folder,{recursive:true});
 const file=join(folder,'workbuddy-desktop.info');
 const fakeJWT='head.'+Buffer.from(JSON.stringify({sub:'fake-local-user',
   exp:Math.round(expiresAt/1000)})).toString('base64url')+'.fake-signature';
 writeFileSync(file,JSON.stringify({auth:{accessToken:fakeJWT,refreshToken,expiresAt,
  uin:'fake_123456',nickname:'隔离的本机虚构登录用户'}}),'utf8');
 const fileHash=sha(readFileSync(file,'utf8'));
 const calls=[];
 const fetchImpl=async(url)=>{
  calls.push(url);
  return new Response(JSON.stringify({code:0,data:{models:[
    {id:'already-logged-model',supportsToolCall:true}]}}),
  {status:200,headers:{'content-type':'application/json'}});
 };
 const env={USERPROFILE:dir,LOCALAPPDATA:local,APPDATA:roaming};
 const manifestPath=join(dir,'isolated-plugin','workbuddy-sources.json');
 const workbuddy=createWorkBuddyDriver({env,manifestPath,fetchImpl,now:()=>tnow});
 const source={
  status:()=>({state:sourceReady?'mounted':'loading'}),
  async listAccounts(){return {state:sourceReady?'ready':'unavailable',accounts:sourceRows}},
 };
 const drivers=new Map([['workbuddy',workbuddy]]);
 for(const id of new Set(sourceRows.map(x=>x.providerId)))
  drivers.set(id,createSourceChannelDriver({providerId:id,embeddedPack:source}));
 let cfg=normalizeConfig({sessionReuse:{enabled},...initial});
 const store={get:()=>structuredClone(cfg),replace:value=>(cfg=normalizeConfig(value),
  structuredClone(cfg))};
 const adapter={invalidateCatalog(){calls.push('invalidate')}};
 const reuse=createSessionReuse({configStore:store,drivers,embeddedPack:source,
  adapter,logger:{info(){},warn(){}},intervalMs:200});
 const center=createAccountCenter({configStore:store,adapter,drivers,fetchImpl,env});
 return {dir,file,folder,manifestPath,fileHash,fakeJWT,env,store,driver:workbuddy,
  source,drivers,reuse,center,calls,get cfg(){return cfg}};
}
test('mounted adapter is not an authenticated session; read-only scan exposes discovery separately without silently importing',async t=>{
 const f=fixture(t,{sourceRows:[{id:'already-signed-qoder',providerId:'qoder',
   nickname:'Synthetic source only',enabled:true}]});
 f.drivers.set('workbuddy',{async discover(){return []}});
 f.drivers.set('trae',{runtimeReady:true});
 let view=f.reuse.snapshot();
 assert.equal(view.channels.find(x=>x.providerId==='trae').available,true);
 assert.equal(view.channels.find(x=>x.providerId==='trae').accountDetected,false);
 assert.equal(view.channels.find(x=>x.providerId==='trae').loginVerified,false);
 const scanned=await f.reuse.scan({importReferences:false});
 assert.equal(scanned.attempted,1);
 assert.equal(scanned.linked,0);
 assert.equal(scanned.autoLinked,0);
 assert.equal(scanned.channels.find(x=>x.providerId==='qoder').accountDetected,true);
 assert.equal(scanned.channels.find(x=>x.providerId==='qoder').loginVerified,false);
 assert.equal(scanned.channels.find(x=>x.providerId==='trae').available,true);
 assert.equal(scanned.channels.find(x=>x.providerId==='trae').accountDetected,false);
 assert.deepEqual(f.cfg.accounts,[],'a read-only discovery must not import a credential');
 assert.equal(sha(readFileSync(f.file,'utf8')),f.fileHash);
 f.reuse.stop();
});
test('reuse is opt-in: disabled plugin does not even look at existing desktop login files',async t=>{
 const f=fixture(t,{enabled:false});
 let discoveries=0;
 f.drivers.set('workbuddy',{async discover(){discoveries++;throw Error('should not run')}});
 const result=await f.reuse.scan();
 assert.equal(result.skipped,'disabled');
 assert.equal(discoveries,0);
 assert.deepEqual(f.cfg.accounts,[]);
 assert.deepEqual(f.cfg.providers,[]);
 assert.equal(existsSync(f.manifestPath),false);
 f.reuse.stop();
});
test('WorkBuddy desktop session is auto linked and usable with no new login, no auth-file writes, no token persistence',async t=>{
 const f=fixture(t);
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,1);
 assert.equal(f.cfg.providers[0].id,'workbuddy');
 assert.equal(f.cfg.accounts.length,1);
 assert.equal(f.cfg.accounts[0].enabled,true);
 assert.equal(f.cfg.accounts[0].autoCheckin,false);
 assert.equal(f.cfg.sessionReuse.linkedIds[0],f.cfg.accounts[0].id);
 assert.equal(f.center.list().accounts[0].reusedExistingSession,true);
 assert.equal(f.center.list().accounts[0].connectionState,'not_checked',
   'local login evidence is not proof of remote API validity');
 assert.equal(sha(readFileSync(f.file,'utf8')),f.fileHash);
 assert.ok(existsSync(f.manifestPath),'only plugin-side identity pointer may be stored');
 assert.doesNotMatch(JSON.stringify(f.cfg)+readFileSync(f.manifestPath,'utf8'),
  /fake-refresh|fake-signature|accessToken|refreshToken|fake-local-user/);
 assert.equal(f.calls.filter(x=>x.startsWith('https:')).length,0,
   'auto linking cannot call the cloud auth endpoint');
 const models=await f.driver.listModels({account:f.cfg.accounts[0]});
 assert.deepEqual(models.map(x=>x.id),['already-logged-model']);
 assert.ok(f.calls.some(x=>x.endsWith('/v3/config')));
 assert.equal(sha(readFileSync(f.file,'utf8')),f.fileHash);
  assert.equal((await f.reuse.scan({importReferences:true})).linked,0,'repeat scan is idempotent'); f.center.setEnabled(f.cfg.accounts[0].id,false);
  assert.equal((await f.reuse.scan({importReferences:true})).linked,0,'manual disabled state cannot be overridden'); assert.equal(f.cfg.accounts[0].enabled,false);
 f.reuse.stop();
});
test('unlink of an auto-reused WorkBuddy account suppresses auto reimport and never logs out the official client',async t=>{
 const f=fixture(t);
  await f.reuse.scan({importReferences:true}); const id=f.cfg.accounts[0].id;
 const result=await f.center.logout(id);
 assert.equal(result.detached,true);
 assert.equal(result.revokedUpstream,false);
 assert.deepEqual(f.cfg.accounts,[]);
 assert.ok(f.cfg.sessionReuse.ignoredIds.includes(id));
  const scan=await f.reuse.scan({importReferences:true}); assert.equal(scan.linked,0);
 assert.ok(scan.results.some(r=>r.id===id&&r.state==='ignored'));
 assert.equal(sha(readFileSync(f.file,'utf8')),f.fileHash);
 f.reuse.stop();
});
test('expired desktop access+no refresh token is not treated as reusable signed-in client',async t=>{
 const f=fixture(t,{expiresAt:Date.parse('2020-01-01T00:00:00Z'),refreshToken:''});
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,0);
 assert.deepEqual(f.cfg.accounts,[]);
 assert.equal(existsSync(f.manifestPath),false);
 f.reuse.stop();
});
test('already logged-in DSH source accounts auto join native model pool without importing or copying any credentials',async t=>{
 const rows=[
  {id:'src-one',providerId:'qoder',nickname:'Already signed in source',enabled:true},
  {id:'src-two',providerId:'trae',nickname:'Other source',enabled:true},
  {id:'src-disabled',providerId:'minimax',enabled:false},
 ];
 const f=fixture(t,{sourceRows:rows});
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,3,'one native desktop plus two already-source signed-in references');
 assert.deepEqual(f.cfg.providers.map(p=>p.id).sort(),['qoder','trae','workbuddy']);
 assert.deepEqual(f.cfg.accounts.map(x=>x.providerId).sort(),['qoder','trae','workbuddy']);
 assert.ok(f.cfg.accounts.every(a=>a.enabled));
  assert.equal(f.cfg.accounts.find(a=>a.providerId==='workbuddy').autoCheckin,false);
  assert.ok(f.cfg.accounts.filter(a=>a.providerId!=='workbuddy').every(a=>a.autoCheckin===true),
    'user-enabled global source auto-checkin must not be suppressed by a mirrored login ref');
 assert.doesNotMatch(JSON.stringify(f.cfg),/credential-secret|access_token|refresh_token|src-one|src-two/,
  'persist only opaque ID and driver reference, never original source id/token');
 assert.equal(result.results.filter(x=>x.method==='existing-dsh-source-account').length,2);
 assert.equal(sha(readFileSync(f.file,'utf8')),f.fileHash);
 f.reuse.stop();
});
test('unreviewed two-active-account source adapter is not silently routed through one cached login',async t=>{
 const f=fixture(t,{sourceRows:[
  {id:'src-one',providerId:'qoder',enabled:true},
  {id:'src-two',providerId:'qoder',enabled:true},
 ]});
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,1,'only WorkBuddy local session is safe to add automatically');
 assert.ok(!f.cfg.accounts.some(x=>x.providerId==='qoder'));
 f.reuse.stop();
});
test('existing user-disabled provider is never re-enabled, even if original program has a valid session',async t=>{
 const f=fixture(t,{initial:{providers:[{
  id:'workbuddy',name:'Manual disabled',protocol:'native-channel',enabled:false,models:[],
 }]}});
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,0);
 assert.equal(f.cfg.providers[0].enabled,false);
 assert.equal(f.cfg.accounts.length,0);
 f.reuse.stop();
});
test('stop during an async source scan prevents late config imports after plugin unload',async t=>{
 const f=fixture(t);
 let release;
 f.drivers.set('workbuddy',{async discover(){return await new Promise(resolve=>{release=resolve})},
  async importCandidate(){throw Error('should never import after stop')}});
  const scanning=f.reuse.scan({importReferences:true}); for(let i=0;i<10&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof release,'function');
 f.reuse.stop();
 release([{id:'wb_'+('a'.repeat(20)),label:'fake',reusable:true}]);
 await scanning;
 assert.equal(f.cfg.accounts.length,0);
 assert.equal(sha(readFileSync(f.file,'utf8')),f.fileHash);
});
test('Qoder machine-token file alone is not mistaken for an already authorized user session',async t=>{
 const f=fixture(t,{sourceRows:[]});
 const machineTokenPath=join(f.dir,'AppData','Roaming','Qoder','SharedClientCache','cache');
 mkdirSync(machineTokenPath,{recursive:true});
 writeFileSync(join(machineTokenPath,'machine_token.json'),
  JSON.stringify({token:'synthetic-machine-identity-only',type:'device'}),'utf8');
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,1,'WorkBuddy desktop login may link, Qoder machine identity must NOT');
 assert.ok(!f.cfg.providers.some(x=>x.id==='qoder'));
 assert.ok(!f.cfg.accounts.some(x=>x.providerId==='qoder'));
 f.reuse.stop();
});
test('source provider with multiple enabled existing accounts is reported for review, not silently merged',async t=>{
 const f=fixture(t,{sourceRows:[
  {id:'qa1',providerId:'qoder',enabled:true},
  {id:'qa2',providerId:'qoder',enabled:true},
 ]});
  const result=await f.reuse.scan({importReferences:true}); assert.ok(result.results.some(x=>x.providerId==='qoder'
   &&x.state==='multiple_accounts_unverified'));
 assert.equal(result.linked,1,'native WorkBuddy is the only safe automatic session in this fixture');
 f.reuse.stop();
});
test('source accounts are not fabricated when bundled DSH source service is not mounted',async t=>{
 const f=fixture(t,{sourceReady:false,sourceRows:[
  {id:'fake-unavailable',providerId:'qoder',enabled:true},
 ]});
  const result=await f.reuse.scan({importReferences:true}); assert.equal(result.linked,1);
 assert.equal(f.cfg.accounts.filter(a=>a.providerId==='qoder').length,0);
 assert.equal(f.reuse.snapshot().channels.find(x=>x.providerId==='qoder').available,false);
 f.reuse.stop();
});
