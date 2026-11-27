// Cross-channel facts come from this plugin's own channel pack querying the
// provider's service. A stored account, model list, or cached nickname is NEVER
// proof of authentication or model inference capability.
import {publicAccountName} from './account-facts.mjs';
import {giftWalletFacts} from './gift-wallet.mjs';
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
  // Each trusted native source pack's billing `total` is its explicitly
  // returned aggregate SPENDABLE balance (CodeArts/ZCode/Loomy), unlike
  // WorkBuddy's `CapacitySize` or a subscription capacity. Never infer a
  // total by summing packages of incompatible currency or product type.
  const single=packages.length===1&&record(packages[0])&&safeUnit(packages[0].unit)
    ?packages[0]:null;
  const trusted=remoteBalanceProviders.has(providerId);
  const balanceValue=balanceRow?.error?null:
    numeric(raw)??numeric(structured?.remaining)??numeric(structured?.available)??
    numeric(structured?.balance)??numeric(structured?.credits)??
    numeric(structured?.credit_balance)??numeric(structured?.points)??
    (trusted?numeric(structured?.total):null)??
    numeric(single?.remaining)??numeric(single?.balance);
  // A multi-bucket wallet may omit its top-level unit despite the vendor
  // explicitly labeling *every* spendable bucket (e.g. Loomy gift/purchased
  // points). Infer only when all units match AND their official remaining
  // values reconcile exactly to the independently returned wallet total.
  // Never use a guessed provider default or sum mixed units/overlapping quotas.
  const reconciledUnit=packages.length>0&&balanceValue!==null&&
    packages.every(x=>record(x)&&safeUnit(x.unit)
      &&numeric(x.remaining)!==null)
    &&new Set(packages.map(x=>safeUnit(x.unit))).size===1
    &&Math.abs(packages.reduce((sum,x)=>sum+x.remaining,0)-balanceValue)<0.000001
    ?safeUnit(packages[0].unit):null;
  // One official package can also label the total when its own remaining
  // is omitted (the source API reports a single unit and the total). If
  // remaining is present but differs from total, do not assume a unit.
  const soleUnit=single&&balanceValue!==null&&
    (numeric(single.remaining)===null||
      Math.abs(single.remaining-balanceValue)<0.000001)?safeUnit(single.unit):null;
  // CodeArts publishes its authoritative TOTAL metric alongside component
  // metrics, not as an additional spendable bucket.
  const codeArtsTotal=providerId==='codearts'&&balanceValue!==null
    &&packages.filter(x=>x?.name==='总积分包').length===1
    &&packages.some(x=>x?.name==='总积分包'&&x.unit==='credit'
      &&numeric(x.remaining)!==null&&Math.abs(x.remaining-balanceValue)<0.000001)
    &&packages.every(x=>x?.unit==='credit')?'积分':null;
  const rawUnit=safeUnit(balanceRow?.balanceUnit)??safeUnit(structured?.unit)??
    codeArtsTotal??reconciledUnit??soleUnit;
  const unit=providerId==='codearts'&&rawUnit==='credit'?'积分':rawUnit;
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
     identity?.profile,identity?.user,identity?.account,identity?.data,
     statusRow?.status,statusRow,status?.profile,status?.user,
     statusRow?.profile,balanceRow?.profile,balanceRow?.user,balanceRow);
  // The isolated Loomy source pack calls the official points API and returns
  // two distinct buckets: "永久积分" may be purchased, whereas "每日赠送"
  // consists solely of free daily credit. Never equate aggregate balance
  // with free allocation or infer a gift when the bucket is absent.
  let giftWallet={};
  if(['loomy','codearts','raccoon'].includes(providerId))giftWallet={giftCreditState:'unconfirmed'};
  const exactBuckets=(names,expectedUnit)=>!balanceRow?.error&&balanceValue!==null&&packages.length===names.length&&names.every(name=>packages.filter(p=>p?.name===name).length===1)&&packages.every(p=>p.unit===expectedUnit&&numeric(p.remaining)!==null&&p.active!==false);
  if(providerId==='loomy'&&exactBuckets(['每日赠送','永久积分'],'积分')){
    const gift=packages.find(p=>p.name==='每日赠送').remaining,ordinary=packages.find(p=>p.name==='永久积分').remaining;
    giftWallet=giftWalletFacts({balance:balanceValue,gift,ordinary,now:observedAt});
  }
  if(providerId==='codearts'&&!balanceRow?.error&&balanceValue!==null
     &&packages.some(p=>p?.name==='总积分包'&&p.remaining===balanceValue)
     &&packages.some(p=>p?.name==='赠送积分包')
     &&new Set(packages.map(p=>p?.name)).size===packages.length
     &&packages.every(p=>['总积分包','基础积分包','按需积分包','赠送积分包'].includes(p?.name)&&p.unit==='credit'&&numeric(p.remaining)!==null&&p.active!==false)){
    // The pinned pack omits zero-capacity components. Reconcile the actual
    // reported components to the independent total; do not invent missing credit.
    const gift=packages.find(p=>p.name==='赠送积分包').remaining;
    const ordinary=packages.filter(p=>['基础积分包','按需积分包'].includes(p.name)).reduce((sum,p)=>sum+p.remaining,0);
    giftWallet=giftWalletFacts({balance:balanceValue,gift,ordinary,now:observedAt});
  }
  // Magpie Raccoon reference: daily_points is the authoritative daily-grant
  // remainder, not the total wallet. Reward points have ambiguous provenance.
  if(providerId==='raccoon'&&reconciledUnit==='积分'&&!balanceRow?.error
     &&packages.some(p=>p?.name==='每日积分')
     &&new Set(packages.map(p=>p.name)).size===packages.length
     &&packages.every(p=>['每日积分','奖励积分','充值积分','会员积分'].includes(p.name)&&p.active!==false)){
    const gift=packages.find(p=>p.name==='每日积分').remaining;
    const ordinary=packages.filter(p=>['充值积分','会员积分'].includes(p.name)).reduce((sum,p)=>sum+p.remaining,0);
    const unknown=packages.filter(p=>p.name==='奖励积分').reduce((sum,p)=>sum+p.remaining,0);
    giftWallet=giftWalletFacts({balance:balanceValue,gift,ordinary,unknown,now:observedAt});
  }
  const loomyDailyGift=providerId==='loomy'&&giftWallet.giftCreditState==='verified'?giftWallet.giftedBalance:0;
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
  // Show near-expiry points only when the complete same-unit package list
  // reconciles to the official spendable balance; never add overlapping
  // quota windows or mixed-currency package limits.
  const expirySummary=(()=>{
    if(unit!=='积分'||balanceValue===null||!packages.length)return null;
    const entries=packages.map(pkg=>{
      const left=numeric(pkg?.remaining);
      const u=safeUnit(pkg?.unit);
      const raw=pkg?.expiredTime??pkg?.expiresAt??pkg?.endAt;
      const end=typeof raw==='number'&&raw>0?
        raw<1e11?raw*1000:raw:
        typeof raw==='string'&&raw.includes('T')?Date.parse(raw):NaN;
      return {left,unit:u,end};
    });
    if(entries.some(x=>x.left===null||x.unit!=='积分'))return null;
    const sum=entries.reduce((a,x)=>a+x.left,0);
    if(Math.abs(sum-balanceValue)>0.0001)return null;
    const near=entries.filter(x=>Number.isFinite(x.end)&&x.end>observedAt
      &&x.end<=observedAt+7*86400000&&x.left>0);
    return near.length?{expiringPoints:Math.round(
      near.reduce((a,x)=>a+x.left,0)*1e4)/1e4,
      expiringAt:Math.min(...near.map(x=>x.end))}:null;
  })();
  return {
    ...(nickname?{nickname}:{}),...giftWallet,
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
     ...(expirySummary??{}),
     ...(balanceValue!==null?{balance:balanceValue,
      ...(unit?{balanceUnit:unit}:{}),balanceCheckedAt:observedAt}:{}),
    balanceState:balanceValue!==null?'available':
      balanceRow?.error?'not_returned':balanceRow?'not_returned':'not_supported',
    authVerified:authEvidence!=='not_verified',
    authEvidence,
  };
}
