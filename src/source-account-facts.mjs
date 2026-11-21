// Cross-channel facts come from this plugin's own channel pack querying the
// provider's service. A stored account, model list, or cached nickname is NEVER
// proof of authentication or model inference capability.
import {publicAccountName} from './account-facts.mjs';
const numeric=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const record=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
const safeUnit=x=>typeof x==='string'&&x.trim()&&x.trim().length<=24?x.trim():null;
const remoteBalanceProviders=new Set(['codearts','buddy','workbuddy',
  'lobsterai','qoder','qodercn','trae','cline','loomy','raccoon',
  'minimax','zcode','gemini']);
export function sourceAccountFacts({providerId,identity,statusRow,balanceRow,
  observedAt=Date.now()}={}){
  const status=record(statusRow?.status);
  const raw=balanceRow?.balance,structured=record(raw);
  const packages=Array.isArray(structured?.packages)?structured.packages:[];
  // A single explicitly denominated package represents one remaining
  // balance. Multiple packages can have different currencies/periods: never
  // add them together or invent a common unit when no aggregate was given.
  const single=packages.length===1&&record(packages[0])&&safeUnit(packages[0].unit)
    ?packages[0]:null;
  const balanceValue=balanceRow?.error?null:
    numeric(raw)??numeric(structured?.remaining)??numeric(structured?.balance)??
    numeric(structured?.credits)??numeric(structured?.total)??
    numeric(single?.remaining)??numeric(single?.balance);
  const unit=safeUnit(balanceRow?.balanceUnit)??safeUnit(structured?.unit)??
    safeUnit(single?.unit);
  const liveStatus=!statusRow?.error&&status!==null&&(
    typeof status.todayCheckedIn==='boolean'||
    Array.isArray(status.checkinDates)||
    typeof status.lastCheckinDate==='string'||
    typeof status.taskStatus==='string'||
    typeof status.available==='boolean'||
    typeof status.active==='boolean');
  // A non-null credit value is sufficient ONLY when the channel-pack actually
  // calls a provider account endpoint (never for a synthetic local quota).
  const liveBalance=remoteBalanceProviders.has(providerId)&&
    !balanceRow?.error&&balanceValue!==null;
  const authEvidence=liveStatus?'authenticated_upstream_status':
    liveBalance?'authenticated_upstream_balance':'not_verified';
  const nickname=publicAccountName(identity?.status,identity,
    statusRow?.status,statusRow,balanceRow);
  // The isolated Loomy source pack calls the official points API and returns
  // two distinct buckets: "永久积分" may be purchased, whereas "每日赠送"
  // consists solely of free daily credit. Never equate aggregate balance
  // with free allocation or infer a gift when the bucket is absent.
  const loomyDailyGift=providerId==='loomy'&&!balanceRow?.error
    ?packages.filter(pkg=>pkg?.name==='每日赠送'&&pkg.unit==='积分'
      &&pkg.active!==false&&Number.isFinite(pkg.remaining)&&pkg.remaining>=0)
      .reduce((sum,pkg)=>sum+pkg.remaining,0):0;
  // ZCode billing/balance can contain free and paid buckets together. Our
  // source-pack derivative now preserves ONLY provider-returned show_name and
  // unit_type separately from the synthesized display fallback. A label such
  // as "ZCode 免费额度" is trustworthy only when it came from the official bucket.
  const giftedBalance=providerId==='zcode'&&!balanceRow?.error
    ?packages.filter(pkg=>{
       const name=typeof pkg?.officialName==='string'?pkg.officialName.trim():'';
       const unit=typeof pkg?.officialUnitType==='string'?pkg.officialUnitType.trim():'';
       if(!name||name.length>120||!/(赠送|签到|免费|gift|bonus|free)/i.test(name)
         ||/(购买|付费|收费|订阅|paid|purchased|subscription)/i.test(name)
         ||unit.toLowerCase()!=='token')return false;
       const expiry=typeof pkg?.expiredTime==='string'&&pkg.expiredTime.trim()
         ?Date.parse(pkg.expiredTime):NaN;
       return pkg.active!==false
         &&Number.isFinite(pkg.remaining)&&pkg.remaining>0
         &&Number.isFinite(expiry)&&expiry>observedAt;
     }).reduce((sum,pkg)=>sum+pkg.remaining,0):0;  return {
    ...(nickname?{nickname}:{}),
      ...(providerId==='loomy'&&loomyDailyGift>0?{loomyDailyGift}:{}),
      ...(providerId==='zcode'&&giftedBalance>0?{giftedBalance}:{}),
     ...(balanceValue!==null?{balance:balanceValue,
      ...(unit?{balanceUnit:unit}:{}),balanceCheckedAt:observedAt}:{}),
    balanceState:balanceValue!==null?'available':
      balanceRow?.error?'not_returned':balanceRow?'not_returned':'not_supported',
    authVerified:authEvidence!=='not_verified',
    authEvidence,
  };
}
