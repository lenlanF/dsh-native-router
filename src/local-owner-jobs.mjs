// Local OS-owner delegation for the narrow acceptance service only.
// No DSH peer cookie, vault access, HTTP listener or arbitrary RPC.
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,linkSync,realpathSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const ID=/^[a-f0-9]{32}$/;
const modes=new Set(['inventory','catalog','free-models','channel-activity','all-channel-activity']);
const CHANNEL=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TTL=5*60*1000;
const windows=process.platform==='win32';
const marker='owner-consent.json';
const request='request.json';
const pathEqual=(a,b)=>windows?a.toLowerCase()===b.toLowerCase():a===b;
function localAcl(path,initialize=false){
 if(!windows)return;
 const script=`
$ErrorActionPreference='Stop'
$p=$env:DSH_ROUTER_OWNER_PATH
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$i=Get-Item -LiteralPath $p -Force
if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point'}
if($env:DSH_ROUTER_OWNER_INIT -eq '1'){
 if(!$i.PSIsContainer){throw 'Not directory'}
 $acl=New-Object System.Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid)
 $acl.SetAccessRuleProtection($true,$false)
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
 $i.SetAccessControl($acl)
}
$a=$i.GetAccessControl()
$owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if($owner -ne $sid.Value -and ($i.PSIsContainer -or $owner -ne 'S-1-5-32-544')){throw 'Not current OS owner'}
if($i.PSIsContainer -and !$a.AreAccessRulesProtected){throw 'Inherited directory ACL'}
$rules=$a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])
$ownerAllow=$false
foreach($r in $rules){
 if($r.IdentityReference.Value -ne $sid.Value){throw 'Non-owner ACL'}
 if($r.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow){throw 'Unexpected deny'}
 if(($r.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl){$ownerAllow=$true}
}
if(!$ownerAllow){throw 'Missing owner ACL'}
Write-Output 'OK'
`;
 const out=execFileSync(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
 ['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DSH_ROUTER_OWNER_PATH:path,DSH_ROUTER_OWNER_INIT:initialize?'1':'0'}});
 if(out.trim()!=='OK')throw Error('Local owner ACL unavailable');
}
function privatePath(path,dir){
 const st=lstatSync(path);
 if(st.isSymbolicLink()||!pathEqual(realpathSync(path),resolve(path))||(dir?!st.isDirectory():!st.isFile()||st.nlink!==1))throw Error('Unsafe local owner path');
 if(!windows&&(st.uid!==process.getuid()||(st.mode&0o077)!==0))throw Error('Local owner permissions invalid');
 localAcl(path);
 return st;
}
function load(path){
 const st=privatePath(path,false);if(st.size>16384)throw Error('Local owner record too large');
 return JSON.parse(readFileSync(path,'utf8'));
}
function atomic(path,value){
 const tmp=path+'.'+randomBytes(12).toString('hex')+'.tmp';
 writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});
 try{renameSync(tmp,path)}finally{if(existsSync(tmp))unlinkSync(tmp)}
}
function enabled(dir){
 privatePath(dir,true);
 const value=load(join(dir,marker));
 if(value?.version!==1||value?.consent!=='local-os-owner-acceptance'||typeof value.grantId!=='string'||!ID.test(value.grantId))throw Error('Local owner delegation disabled');
 return value.grantId;
}
export function enableLocalOwnerJobs(dir,{consent=false}={}){
 if(consent!==true)throw Error('Explicit local owner delegation required');
 dir=resolve(dir);
 if(!existsSync(dir)){mkdirSync(dir,{mode:0o700});if(windows)localAcl(dir,true)}
 privatePath(dir,true);
 if(existsSync(join(dir,marker))){enabled(dir);return}
 atomic(join(dir,marker),{version:1,consent:'local-os-owner-acceptance',grantId:randomBytes(16).toString('hex')});
 enabled(dir);
}
export function revokeLocalOwnerJobs(dir){dir=resolve(dir);enabled(dir);unlinkSync(join(dir,marker))}
function validate(body,now,grantId){
 if(!body||body.grantId!==grantId||body.consent!==true||typeof body.requestId!=='string'||!ID.test(body.requestId)||!modes.has(body.mode)||
 (body.channel!==undefined&&!CHANNEL.test(body.channel))||
 (body.mode==='channel-activity'&&!body.channel)||(body.mode==='all-channel-activity'&&body.channel!==undefined)||
 !Number.isSafeInteger(body.issuedAt)||!Number.isSafeInteger(body.expiresAt)||
 body.issuedAt>now+10000||body.expiresAt<=now||body.expiresAt-body.issuedAt>TTL||
 body.expiresAt<=body.issuedAt)throw Error('Invalid local owner request');
 return {requestId:body.requestId,mode:body.mode,...(body.channel?{channel:body.channel}:{}),consent:true};
}
export function submitLocalOwnerJob(dir,{mode,channel,consent=false,requestId=randomBytes(16).toString('hex')}={}){
 dir=resolve(dir);const grantId=enabled(dir);const now=Date.now(),body={mode,channel,consent,requestId,grantId,issuedAt:now,expiresAt:now+TTL};
 validate(body,now,grantId);
 const tmp=join(dir,'submit-'+randomBytes(12).toString('hex')+'.tmp');
 writeFileSync(tmp,JSON.stringify(body),{flag:'wx',mode:0o600});
 try{linkSync(tmp,join(dir,request))}finally{unlinkSync(tmp)}
 return {requestId,state:'queued'};
}
export function readLocalOwnerReport(dir,id){
 dir=resolve(dir);enabled(dir);if(!ID.test(id??''))throw Error('Invalid request ID');
 const path=join(dir,'report-'+id+'.json');return existsSync(path)?load(path):{requestId:id,state:'queued-or-not-observed'};
}
export function startLocalOwnerJobs({dir,service,intervalMs=3000,now=()=>Date.now()}={}){
 if(!dir||!service)return ()=>{};
 dir=resolve(dir);let active=null,activeGrant=null,disposed=false;
 const tick=()=>{
  if(disposed)return;
  try{
   if(!existsSync(join(dir,marker))){if(active){try{service.cancel(active)}catch{}active=null}return}
   if(active){
     if(enabled(dir)!==activeGrant){try{service.cancel(active)}catch{}active=null;activeGrant=null;return}
    const report=service.snapshot(active);
    if(report.requestId===active){
     atomic(join(dir,'report-'+active+'.json'),report);
     if(report.state!=='running')active=null;
    }else active=null;
    return;
   }
   const file=join(dir,request);if(!existsSync(file))return;
    const grantId=enabled(dir);
    let raw,input;
    // Invalid records in our own private queue cannot block all future work.
    // Never unlink an unsafe path; only discard a validated private file.
    privatePath(file,false);
    try{raw=load(file);input=validate(raw,now(),grantId)}catch{
      unlinkSync(file);
      return;
    }
   const consumed=join(dir,'consumed-'+input.requestId+'.json');
   // Durable exclusive claim before any official mutation; a restart never
   // replays an uncertain request. Stale/invalid inputs do not execute.
   if(existsSync(consumed)){unlinkSync(file);return}
   if(service.snapshot().state==='running')return;
   writeFileSync(consumed,JSON.stringify({requestId:input.requestId,at:now()}),{flag:'wx',mode:0o600});
   unlinkSync(file);
   try{
     const report=service.start(input);active=input.requestId;activeGrant=grantId;
    atomic(join(dir,'report-'+active+'.json'),report);
   }catch{atomic(join(dir,'report-'+input.requestId+'.json'),{requestId:input.requestId,state:'failed',code:'OPERATION_UNAVAILABLE'});active=null}
   }catch{if(active){try{service.cancel(active)}catch{}active=null;activeGrant=null}/* Unsafe ACL or unavailable directory fails closed. */}
 };
 const timer=setInterval(tick,Math.max(100,intervalMs));timer.unref?.();
 return ()=>{disposed=true;clearInterval(timer);if(active)try{service.cancel(active)}catch{}};
}
