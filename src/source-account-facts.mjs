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
  const firstPackage=packages.find(row=>record(row)&&safeUnit(row.unit));
  const balanceValue=balanceRow?.error?null:
    numeric(raw)??numeric(structured?.total)??numeric(structured?.remaining)??
    numeric(structured?.balance)??numeric(structured?.credits);
  const unit=safeUnit(balanceRow?.balanceUnit)??safeUnit(structured?.unit)??
    safeUnit(firstPackage?.unit);
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
  return {
    ...(nickname?{nickname}:{}),
    ...(balanceValue!==null?{balance:balanceValue,
      ...(unit?{balanceUnit:unit}:{}),balanceCheckedAt:observedAt}:{}),
    balanceState:balanceValue!==null?'available':
      balanceRow?.error?'not_returned':balanceRow?'not_returned':'not_supported',
    authVerified:authEvidence!=='not_verified',
    authEvidence,
  };
}
