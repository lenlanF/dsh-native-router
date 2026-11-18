// Narrow, on-demand inventory of installed DSH-native plugins. It returns
// account presence and opaque metadata only. No raw token, SID, SQLite
// credential column, cookie or file path can escape this module.
import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const SOURCES=[
 {packageName:'dsh-connect-workbuddy',providerId:'workbuddy',name:'WorkBuddy',kind:'private-vault'},
 {packageName:'dsh-connect-lingxi',providerId:'lingxi',name:'Lingxi',kind:'private-json'},
 {packageName:'dsh-connect-loomy',providerId:'loomy',name:'Loomy',kind:'private-json-or-desktop'},
 {packageName:'dsh-zcode-startplan',providerId:'zcode-start-plan',name:'ZCode Start Plan',kind:'private-sqlite'},
];
const LIMIT=1024*1024;
const compact=s=>typeof s==='string'?s.trim().slice(0,70):'';
const privateId=(provider,key)=>'local_'+createHash('sha256')
 .update('dsh-native-router-inventory\0'+provider+'\0'+key).digest('hex').slice(0,20);
function readLimited(file,limit=LIMIT){
 try{const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>limit)return null;
  return JSON.parse(readFileSync(file,'utf8'));
 }catch{return null}
}
const validSession=x=>typeof x==='string'&&x.length>=8&&x.length<=4096
 &&!/[\s\u0000-\u001f]/.test(x);
// Import into the already bundled MIT Loomy channel, not a second hand-built
// chat API. Unknown expiry is NOT invented; the upstream must validate online.
function loomyCredential(session,record={}){
 const userid=record.userid??record.userId??record.uid;
 const phone=record.phone;
 const expiry=record.expires_at??record.expiresAt;
 return JSON.stringify({access_token:session,
  ...(typeof userid==='string'&&userid.length<128?{userid}:{}),
  ...(typeof phone==='string'&&phone.length<30?{phone}:{}),
  ...(typeof expiry==='string'&&/^\d{10,16}$/.test(expiry)?{expires_at:expiry}:{})});
}
const discovered=(providerId,name,origin,key,index)=>({
 providerId,providerName:name,source:origin,accountId:privateId(providerId,key),
 label:name+' · 本机账号 '+index,
 credentialDetected:true,loginVerified:false,portable:false,
 state:'private_authorization_unverified',
 reason:'原插件私有授权，当前不支持安全地直接转为内置渠道账号',
});
export function createInstalledPluginInventory({home=homedir(),
 profileDir=join(home,'.dsh','profiles','desktop'),
 publicLoomyDir=process.platform==='win32'?'C:\\Users\\Public\\Loomy':null,
 sqliteReader}={}){
 const root=join(profileDir,'node_modules'),data=join(profileDir,'data');
 function installed(pkg){
  const info=readLimited(join(root,pkg,'package.json'),256*1024);
  return info?.name===pkg?{version:compact(info.version)||'unknown'}:null;
 }
 async function databaseAccounts(file){
  if(!existsSync(file))return {state:'not_found',rows:[]};
  let db;
  try{
   if(sqliteReader)return {state:'ready',rows:await sqliteReader(file)};
   const {DatabaseSync}=await import('node:sqlite');
   db=new DatabaseSync(file,{readOnly:true});
   // Explicit column allowlist: never SELECT credential.
   const rows=db.prepare('SELECT id, enabled FROM accounts LIMIT 101').all();
   return {state:'ready',rows};
  }catch{return {state:'unreadable',rows:[]}}
  finally{try{db?.close()}catch{}}
 }
 async function readCredential(providerId,accountId){
  if(typeof accountId!=='string'||!/^local_[a-f0-9]{20}$/.test(accountId))return null;
  if(providerId==='lingxi'&&installed('dsh-connect-lingxi')){
   const state=readLimited(join(data,'dsh-connect-lingxi','state.json'));
   for(const [index,row] of (state?.accounts??[]).slice(0,100).entries()){
    const key=compact(row?.id)||'account:'+(index+1);
    if(row?.enabled===true&&validSession(row.wpsSid)&&privateId('lingxi',key)===accountId)
     return {providerId,accountId,secret:row.wpsSid};
   }
  }
  if(providerId==='loomy'&&installed('dsh-connect-loomy')){
   const state=readLimited(join(data,'dsh-connect-loomy','state.json'));
   for(const [index,row] of (state?.accounts??[]).slice(0,100).entries()){
    const key=compact(row?.id)||'stored:'+(index+1);
    if(row?.enabled!==false&&validSession(row?.session)
       &&privateId('loomy',key)===accountId)
     return {providerId,accountId,secret:loomyCredential(row.session,row)};
   }
   if(validSession(state?.manualSession)&&privateId('loomy','manual')===accountId)
    return {providerId,accountId,secret:loomyCredential(state.manualSession)};
   if(publicLoomyDir){
    let names=[];try{names=readdirSync(publicLoomyDir).slice(0,80)}catch{}
    for(const name of names){
     if(privateId('loomy','desktop:'+name)!==accountId)continue;
     const state=readLimited(join(publicLoomyDir,name,'userData','auth-session.json'),128*1024);
     if(validSession(state?.session))return {providerId,accountId,secret:loomyCredential(state.session,state)};
    }
   }
  }
  if(providerId==='zcode-start-plan'&&installed('dsh-zcode-startplan')){
   const file=join(home,'.dsh','zcode-start-plan','accounts.db');
   if(!existsSync(file))return null;
   let db;
   try{
    let rows;
    if(sqliteReader)rows=await sqliteReader(file,{includeCredential:true});
    else{
     const {DatabaseSync}=await import('node:sqlite');
     db=new DatabaseSync(file,{readOnly:true});
     db.exec('PRAGMA query_only=ON');
     rows=db.prepare('SELECT id,enabled,credential FROM accounts LIMIT 101').all();
    }
    if(!Array.isArray(rows))return null;
    for(const [index,row] of rows.slice(0,100).entries()){
     const key=compact(row.id)||'db:'+(index+1);
     if(privateId('zcode-start-plan',key)!==accountId||![1,true].includes(row.enabled))continue;
     const secret=typeof row.credential==='string'?JSON.parse(row.credential):row.credential;
     if(typeof secret?.zcode_jwt==='string'&&secret.zcode_jwt
        &&typeof secret?.device_mid==='string'&&secret.device_mid)
      return {providerId,accountId,secret:JSON.stringify({zcode_jwt:secret.zcode_jwt,
        device_mid:secret.device_mid,
        ...(typeof secret.app_version==='string'?{app_version:secret.app_version}:{}),
        ...(typeof secret?.bigmodel?.access_token==='string'
          ?{bigmodel:{access_token:secret.bigmodel.access_token}}:{})})};
    }
   }catch{return null}finally{try{db?.close()}catch{}}
  }
  return null;
 }
 async function scan(){
  const plugins=SOURCES.map(row=>({...row,installed:!!installed(row.packageName),
   version:installed(row.packageName)?.version??null}));
  const accounts=[],issues=[];
  const add=(row)=>{if(accounts.length<100)accounts.push(row)};
  const lingxi=plugins.find(p=>p.providerId==='lingxi');
  if(lingxi.installed){
   const state=readLimited(join(data,'dsh-connect-lingxi','state.json'));
   if(state&&Array.isArray(state.accounts)){
    let index=0;
    for(const row of state.accounts.slice(0,100)){
     if(row?.enabled!==true||!validSession(row.wpsSid))continue;
     index++;
     add(discovered('lingxi','Lingxi','lingxi-private-state',
      compact(row.id)||'account:'+index,index));
    }
   }else issues.push({providerId:'lingxi',state:'private_state_unavailable'});
  }
  const loomy=plugins.find(p=>p.providerId==='loomy');
  if(loomy.installed){
   const state=readLimited(join(data,'dsh-connect-loomy','state.json'));
   let i=0;
   if(state&&Array.isArray(state.accounts)){
    for(const row of state.accounts.slice(0,100)){
     if(row?.enabled===false||!validSession(row?.session))continue;
     i++;add(discovered('loomy','Loomy','loomy-plugin-state',compact(row.id)||'stored:'+i,i));
    }
   }
   if(validSession(state?.manualSession)){i++;add(discovered('loomy','Loomy','loomy-manual-session','manual',i))}
   if(publicLoomyDir){
    let children=[];
    try{children=readdirSync(publicLoomyDir).slice(0,80)}catch{}
    for(const dirName of children){
     if(accounts.filter(x=>x.providerId==='loomy').length>=50)break;
     const file=join(publicLoomyDir,dirName,'userData','auth-session.json');
     const session=readLimited(file,128*1024);
     if(!validSession(session?.session))continue;
     i++;add(discovered('loomy','Loomy','loomy-desktop-session',
      'desktop:'+dirName,i));
    }
   }
  }
  const zcode=plugins.find(p=>p.providerId==='zcode-start-plan');
  if(zcode.installed){
   const file=join(home,'.dsh','zcode-start-plan','accounts.db');
   const state=await databaseAccounts(file);
   if(state.state==='ready'){
    let i=0;
    for(const row of state.rows.slice(0,100)){
     if(row?.enabled!==1&&row?.enabled!==true)continue;
     i++;add(discovered('zcode-start-plan','ZCode Start Plan',
      'zcode-private-sqlite',compact(row.id)||'db:'+i,i));
    }
   }else issues.push({providerId:'zcode-start-plan',state:state.state});
  }
  // WorkBuddy stores login in its own plugin vault; don't classify a
  // registered Provider as a verified logged-in user or probe its vault.
  return {state:'ready',plugins,accounts,issues,
   detected:accounts.length,verified:0,portable:0};
 }
 return {scan,readCredential};
}
