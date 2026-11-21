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
  // ZCode's signed Start Plan balance names the MODEL (GLM-5.3-Flash),
  // not "free". The official plan_id is the only trusted discriminator
  // between that no-charge grant and purchased Coding Plan balances.
  // Keep exact model and token unit; unknown/expired buckets are not free.
  const starts=providerId==='zcode'&&!balanceRow?.error
    ?packages.filter(pkg=>{
       const plan=typeof pkg?.officialPlanId==='string'?pkg.officialPlanId.trim():'';
       const model=typeof pkg?.officialName==='string'?pkg.officialName.trim():'';
       const unit=typeof pkg?.officialUnitType==='string'?pkg.officialUnitType.trim():'';
       if(!/^zcode-v3-start-plan-[a-z0-9-]+$/i.test(plan)
         ||!/^glm-5\.3-flash$/i.test(model)
         ||unit.toLowerCase()!=='token')return false;
       const expiry=typeof pkg?.expiredTime==='string'&&pkg.expiredTime.trim()
         ?Date.parse(pkg.expiredTime):NaN;
       return pkg.active!==false&&Number.isFinite(pkg.remaining)&&pkg.remaining>0
         &&Number.isFinite(expiry)&&expiry>observedAt+120000;
     }):[];
  // Multiple paid buckets may coexist with a Start Plan. Never add them.
  // Duplicate rows for one plan/meter must not artificially multiply grants.
  const giftByPlan=new Map();
  for(const pkg of starts){
    const key=pkg.officialPlanId+'|'+(pkg.officialMeter??'');
    const old=giftByPlan.get(key);
    giftByPlan.set(key,old===undefined?pkg.remaining:Math.min(old,pkg.remaining));
  }
  // Only anonymous counters reach read-only reports; no raw plan names or IDs.
  const zcodePlanRows=providerId==='zcode'&&!balanceRow?.error
    ?packages.filter(pkg=>typeof pkg?.officialPlanId==='string'
      &&/^zcode-v3-start-plan-[a-z0-9-]+$/i.test(pkg.officialPlanId)):[];
  const zcodeFlashRows=zcodePlanRows.filter(pkg=>/^glm-5\.3-flash$/i.test(pkg.officialName??''));
  const giftedBalance=[...giftByPlan.values()].reduce((sum,value)=>sum+value,0);
  return {
    ...(nickname?{nickname}:{}),
    ...(providerId==='loomy'&&loomyDailyGift>0?{loomyDailyGift}:{}),      ...(providerId==='zcode'?{
        zcodeStatusObserved:status!==null&&!statusRow?.error,
        zcodeBalanceObserved:structured!==null&&!balanceRow?.error,
        zcodePlanBuckets:zcodePlanRows.length,zcodeFlashBuckets:zcodeFlashRows.length,
        zcodePreviewStartPlans:Number.isSafeInteger(status?.zcodeStartPlanCount)
          &&status.zcodeStartPlanCount>=0
          ?Math.min(status.zcodeStartPlanCount,100):
          Number.isSafeInteger(structured?.previewStartPlanCount)
            &&structured.previewStartPlanCount>=0
            ?Math.min(structured.previewStartPlanCount,100):null,
      }:{}),
      ...(providerId==='zcode'&&giftedBalance>0?{giftedBalance}:{}),
     ...(balanceValue!==null?{balance:balanceValue,
      ...(unit?{balanceUnit:unit}:{}),balanceCheckedAt:observedAt}:{}),
    balanceState:balanceValue!==null?'available':
      balanceRow?.error?'not_returned':balanceRow?'not_returned':'not_supported',
    authVerified:authEvidence!=='not_verified',
    authEvidence,
  };
}
