// Last-known PUBLIC account identity and balance snapshots, never credentials.
// This is a display-only cache: it does not grant access, authorize models,
// execute check-ins, or turn a stale number into a current verified balance.
import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {publicAccountName,publicBalance} from './account-facts.mjs';

const MAX=200,VERSION=1,MAX_AGE=7*86400000;
const hash=account=>createHash('sha256').update(
  account.providerId+'\0'+account.id+'\0'+account.credentialRef).digest('hex');
const validTime=(value,now)=>Number.isSafeInteger(value)&&value>0
  &&value<=now+5*60000&&now-value<=MAX_AGE;
const validNumber=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const cleanName=value=>publicAccountName({displayName:value})||'';
function safeRow(value,now){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    !/^[a-f0-9]{64}$/.test(value.binding)||!validTime(value.updatedAt,now))
    return null;
  const row={binding:value.binding,updatedAt:value.updatedAt};
  const name=cleanName(value.name);
  if(name)row.name=name;
  if(validNumber(value.balance)&&typeof value.balanceUnit==='string'
      &&value.balanceUnit.length<=24&&validTime(value.balanceCheckedAt,now)){
    row.balance=value.balance;row.balanceUnit=value.balanceUnit;
    row.balanceCheckedAt=value.balanceCheckedAt;
    if(validNumber(value.expiringPoints)&&
      validTime(value.expiringAt,now+MAX_AGE)&&value.expiringAt>now){
      row.expiringPoints=value.expiringPoints;row.expiringAt=value.expiringAt;
    }
  }
  return row.name||hasOwn(row,'balance')?row:null;
}
export function createPublicAccountFactsStore({path,now=()=>Date.now()}={}){
  let rows={},blocked=false;
  if(path&&existsSync(path)){
    try{
      const data=JSON.parse(readFileSync(path,'utf8'));
      if(data?.version!==VERSION||!Array.isArray(data.rows)||
        data.rows.length>MAX)throw Error('Invalid public facts cache');
      const good=[];
      for(const x of data.rows){
        // Expiration is expected, not file corruption: retain good accounts
        // when an old account has naturally aged out of the local cache.
        if(x&&/^[a-f0-9]{64}$/.test(x.binding)
          &&Number.isSafeInteger(x.updatedAt)&&now()-x.updatedAt>MAX_AGE)
          continue;
        const row=safeRow(x,now());
        if(!row)throw Error('Invalid cached public fact');
        good.push([row.binding,row]);
      }
      rows=Object.fromEntries(good);
    }catch{rows={};blocked=true}
  }
  const persist=()=>{
    if(!path||blocked)return;
    const next=Object.values(rows).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,MAX);
    rows=Object.fromEntries(next.map(x=>[x.binding,x]));
    const tmp=path+'.tmp-'+process.pid+'-'+randomUUID();
    try{
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(tmp,JSON.stringify({version:VERSION,rows:next})+'\n',
        {mode:0o600,flag:'wx'});
      renameSync(tmp,path);
    }catch(error){
      try{unlinkSync(tmp)}catch{}
      // A read-only cache failure must never affect model dispatch or account I/O.
      blocked=true;
    }
  };
  function get(account){
    if(!account?.id||!account.providerId||!account.credentialRef)return null;
    const record=rows[hash(account)];
    if(!record||!safeRow(record,now()))return null;
    return {...record};
  }
  function observe(account,snapshot){
    if(blocked||!account?.credentialRef||!snapshot||
       typeof snapshot!=='object'||Array.isArray(snapshot))return false;
    const before=get(account),time=now(),next={...(before??{}),
      binding:hash(account),updatedAt:time};
    let changed=false;
    const name=publicAccountName(snapshot);
    if(name&&name!==before?.name){next.name=name;changed=true}
    const raw=publicBalance(snapshot);
    const balanceTime=Number.isSafeInteger(raw.balanceCheckedAt)?
      raw.balanceCheckedAt:before?.balanceCheckedAt??time;
    // Only genuine numerical values may replace existing amounts. Transient
    // 'unavailable', 401, omitted fields and older replies never erase facts.
    const unit=typeof raw.balanceUnit==='string'?raw.balanceUnit:
      before?.balanceUnit??'';
    if(validNumber(raw.balance)&&unit.length<=24&&validTime(balanceTime,time)
       &&(!before?.balanceCheckedAt||balanceTime>=before.balanceCheckedAt)){
      if(raw.balance!==before?.balance||unit!==before?.balanceUnit||
         balanceTime!==before?.balanceCheckedAt){
        next.balance=raw.balance;next.balanceUnit=unit;
        next.balanceCheckedAt=balanceTime;changed=true;
      }
      if(validNumber(snapshot.expiringPoints)&&
         Number.isSafeInteger(snapshot.expiringAt)&&snapshot.expiringAt>time
         &&snapshot.balanceUnit==='积分'){
        next.expiringPoints=snapshot.expiringPoints;
        next.expiringAt=snapshot.expiringAt;changed=true;
      }else if(hasOwn(next,'expiringPoints')&&
        (snapshot.expiringPoints===0||next.expiringAt<=time)){
        delete next.expiringPoints;delete next.expiringAt;changed=true;
      }
    }
    if(!changed)return false;
    rows[next.binding]=next;persist();return true;
  }
  function forget(account){
    if(!account?.credentialRef)return;
    const key=hash(account);
    if(hasOwn(rows,key)){delete rows[key];persist()}
  }
  return {get,observe,forget,get blocked(){return blocked}};
}
