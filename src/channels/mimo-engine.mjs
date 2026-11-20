// In-process MiMo desktop engine bridge. Inspired by dsh-mimo-connect (MIT).
// Never launches a gateway or reads another DSH plugin's credentials.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';

const exec=promisify(execFile);
const LABEL='dsh-native-router-mimo:'+process.pid;
const MAX_IDLE=24*60*60*1000,MAX_AGE=7*24*60*60*1000;
let cached=null;
function stateRoot(env){
 if(env.MIMOCODE_HOME)return join(env.MIMOCODE_HOME,'state');
 if(process.platform==='win32')return join(env.APPDATA||join(homedir(),'AppData','Roaming'),'Xiaomi MiMo','mimocode');
 return join(env.XDG_STATE_HOME||join(homedir(),'.local','state'),'mimocode');
}
function absolutePath(path){try{return realpathSync.native(resolve(path))}catch{return resolve(path)}}
function bucketDir(cwd,env){return join(stateRoot(env),'llm-server',createHash('sha1').update(absolutePath(cwd)).digest('hex'))}
async function powershell(command){
 if(process.platform!=='win32')return '';
 const win=process.env.SystemRoot||'C:\\Windows';
 const exe=join(win,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const {stdout}=await exec(existsSync(exe)?exe:'powershell.exe',
   ['-NoProfile','-NonInteractive','-Command',command],
   {windowsHide:true,encoding:'utf8',timeout:6000,maxBuffer:1024*1024});
 return stdout.trim();
}
export async function mimoDesktopProcesses(){
 const command="Get-CimInstance Win32_Process -Filter \"Name='Xiaomi MiMo.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -notmatch 'crashpad' } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress";
 try{
  const raw=await powershell(command);
  if(!raw)return [];
  return (Array.isArray(JSON.parse(raw))?JSON.parse(raw):[JSON.parse(raw)])
   .filter(x=>Number.isInteger(x.ProcessId)&&x.ProcessId>0)
   .map(x=>({pid:x.ProcessId,exe:typeof x.ExecutablePath==='string'?x.ExecutablePath:''}));
 }catch{return []}
}
async function listeningPorts(pids){
 if(!pids.length)return [];
 const filter=pids.map(x=>'$_.OwningProcess -eq '+x).join(' -or ');
 try{
  const output=await powershell('Get-NetTCPConnection -State Listen | Where-Object { '+filter+' } | Select-Object -ExpandProperty LocalPort');
  return [...new Set(output.split(/\s+/).map(Number))]
   .filter(n=>Number.isInteger(n)&&n>0&&n<=65535).slice(0,50);
 }catch{return []}
}
function tokenBuckets(appDir,env){
 const root=join(stateRoot(env),'llm-server'),dirs=[];
 try{for(const entry of readdirSync(root,{withFileTypes:true}))
  if(entry.isDirectory()&&/^[a-f0-9]{40}$/.test(entry.name))dirs.push(join(root,entry.name))
 }catch{}
 const candidates=[appDir&&dirname(appDir)];
 if(process.platform==='win32'){
  const win=env.SystemRoot||'C:\\Windows';
  candidates.push(join(win,'System32'),win);
 }
 candidates.push(homedir());
 for(const cwd of candidates.filter(Boolean))dirs.push(bucketDir(cwd,env));
 return [...new Set(dirs)].slice(0,64);
}
function authorize(token,appDir,env){
 const digest=createHash('sha256').update(token).digest('hex'),now=Date.now();
 let valid=0;
 for(const bucket of tokenBuckets(appDir,env)){
  const file=join(bucket,'tokens.json');
  try{
   let data={version:1,tokens:[]};
   if(existsSync(file)){
    data=JSON.parse(readFileSync(file,'utf8'));
    if(data?.version!==1||!Array.isArray(data.tokens))continue;
   }
   const kept=data.tokens.filter(x=>!x||x.label!==LABEL);
   kept.push({id:'llmk_'+randomUUID().replace(/-/g,'').slice(0,16),
    hash:digest,label:LABEL,models:[],created:now,idle_ms:MAX_IDLE,max_age_ms:MAX_AGE});
   mkdirSync(bucket,{recursive:true});
   const tmp=file+'.native-router-'+process.pid;
   writeFileSync(tmp,JSON.stringify({...data,tokens:kept},null,2),{mode:0o600,flag:'w'});
   renameSync(tmp,file);valid++;
  }catch{/* An unwritable bucket is not proof of a working engine. */}
 }
 return valid;
}
export async function resolveMimoEngine({env=process.env,fetchImpl=fetch,force=false}={}){
 if(!force&&cached&&Date.now()-cached.at<15000)return {...cached.connection};
 const processes=await mimoDesktopProcesses();
 if(!processes.length){cached=null;return null}
 const ports=await listeningPorts(processes.map(x=>x.pid));
 if(!ports.length){cached=null;return null}
 const token=cached?.token??randomBytes(32).toString('base64url');
 if(!authorize(token,processes[0].exe,env)){cached=null;return null}
 for(const port of ports){
  const baseUrl='http://127.0.0.1:'+port+'/v1';
  try{
   const res=await fetchImpl(baseUrl+'/models',{
    headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(2500)});
   if(!res.ok)continue;
   const body=await res.json();
   const ids=(Array.isArray(body?.data)?body.data:[]).map(x=>x?.id)
    .filter(x=>typeof x==='string');
   if(ids.some(id=>id.startsWith('mimo-desktop/'))){
    const connection={baseUrl,token,models:ids};
    cached={at:Date.now(),token,connection};return {...connection};
   }
  }catch{}
 }
 cached=null;return null;
}
export function resetMimoEngineCache(){cached=null}
