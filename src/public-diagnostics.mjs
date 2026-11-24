// Public owner-facing diagnostics contain only reviewed states and machine codes.
// Never turn upstream Error.message, raw response text, URLs, identities or
// credential-bearing metadata into UI, persistent history or support logs.
import {safeDshFailureFacts} from './failure.mjs';

const STATUS_MESSAGES=Object.freeze({
  400:'请求参数无效，请核对操作内容',
  401:'账号授权不足，请先核对独立登录状态',
  403:'账号或渠道已拒绝访问',
  404:'指定账号或渠道不存在',
  408:'请求超时，稍后可重新核查',
  409:'账号状态已改变、操作冲突或仍待授权确认',
  429:'渠道请求次数受限，请稍后再试',
  501:'该渠道尚未实现此项操作',
  502:'上游渠道响应异常，请稍后复核',
  503:'渠道暂不可用，请稍后复核',
  504:'上游请求超时，请稍后复核',
});
export function publicAdministrativeError(error,fallbackStatus=503){
  const status=Number(error?.status);
  const allowed=Object.prototype.hasOwnProperty.call(STATUS_MESSAGES,status);
  const code=safeDshFailureFacts(error).code;
  const safeStatus=allowed?status:fallbackStatus;
  return {status:safeStatus,
    error:STATUS_MESSAGES[safeStatus]??STATUS_MESSAGES[503],
    ...(code!=='UPSTREAM'?{code}:{})};
}

export function publicAccountMessage(state){
  const messages={
    online:'已通过渠道登录状态核验',
    expired:'渠道已确认当前授权不可用，请重新登录',
    limited:'渠道账号当前受限，请核对官方额度',
    pending:'授权尚未确认，将按周期继续检查',
    client_required:'该渠道要求在官方客户端完成授权',
    error:'渠道连接校验未成功，不代表模型推理已失败',
  };
  return messages[state]??messages.error;
}
export function publicAccountFailureMessage(error){
  const code=safeDshFailureFacts(error).code;
  const messages={
    AUTH:'渠道拒绝当前账号授权',CREDENTIAL:'独立账号凭据不可用',
    RATE_LIMIT:'渠道请求频率受限',QUOTA:'渠道账户额度不足',
    TIMEOUT:'渠道登录状态检查超时',TRANSPORT:'渠道网络连接失败',
    SERVER:'渠道服务暂时异常',CANCELLED:'请求已取消',
    PROVIDER_NOT_READY:'渠道适配器尚未准备好',
  };
  return messages[code]??'渠道状态检查未成功，稍后可复核';
}
const checkinDiagnostics=Object.freeze({
  LOBSTER_SLOT_READ:'活动槽位读取失败',
  LOBSTER_SLOT_AUTH:'官方活动接口拒绝当前授权',
  LOBSTER_SLOT_LIMIT:'官方活动接口限流',
  LOBSTER_SLOT_ENDPOINT:'官方活动入口不存在或已撤下',
  LOBSTER_SLOT_HTTP:'官方活动接口 HTTP 异常',
  LOBSTER_SLOT_RESPONSE:'官方活动响应格式不符',
  LOBSTER_SLOT_REJECTED:'官方活动业务响应拒绝',
  LOBSTER_SLOT_TRANSPORT:'官方活动连接失败',
  LOOMY_RECEIPT_MISSING:'每日额度初始化回执缺少明确证据',
  LOOMY_WALLET_UNCONFIRMED:'官方钱包每日额度字段未确认',
  LOOMY_DAY_MISMATCH:'每日额度周期日期不一致',
  LOOMY_QUOTA_MISMATCH:'初始化与钱包额度不一致',
  DOUBAO_OFFICIAL_CLIENT:'官方活动限电脑版参加；插件只读回查，不提交领取请求',
  LOBSTER_SLOT_SHAPE:'官方活动槽位字段不完整',
  LOBSTER_CONTEXT_READ:'活动上下文读取失败',
  LOBSTER_CONTEXT_SHAPE:'官方活动资格字段不完整',
  LOBSTER_CLAIM_REQUEST:'官方领取请求失败',
  LOBSTER_CLAIM_REJECTED:'官方拒绝领取请求',
  STATUS_UNAVAILABLE:'官方签到状态查询失败',
  ELIGIBILITY_UNKNOWN:'官方领取资格尚未确认',
  CLAIM_RECEIPT_MISSING:'未返回指定账号领取回执',
  CLAIM_REJECTED:'官方领取未成功',
  CLAIM_STATUS_UNKNOWN:'官方领取结果未知',
});
export const safeCheckinDiagnostic=code=>typeof code==='string'&&Object.prototype.hasOwnProperty.call(checkinDiagnostics,code)?code:undefined;
export function publicCheckinMessage(state,code){
  const messages={
    success:'官方已确认今日签到完成',
    no_task:'该账号今日暂无签到任务',
    client_required:'需在官方客户端完成今日签到',
    pending_confirmation:'上游已受理签到，尚未确认到账',
    failed:'签到未完成或尚无可靠确认依据',
    unsupported:'该渠道未提供每日签到操作',
  };
  return (messages[state]??messages.failed)+(state!=='success'&&safeCheckinDiagnostic(code)?'；'+checkinDiagnostics[code]:'');
}
