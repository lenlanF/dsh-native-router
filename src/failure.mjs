export class UpstreamError extends Error {
  constructor(message, {status=0, code='', retryAfterMs=0}={}) {
    super(message); this.name='UpstreamError'; this.status=status; this.code=code; this.retryAfterMs=retryAfterMs;
  }
}
export function classifyFailure(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return {code:'CANCELLED', retryable:false, scope:'request'};
  if(error?.code === 'TRUNCATED')return {code:'STREAM_CLOSED',retryable:true,scope:'account',cooldownMs:10000};
  if(error?.code === 'PROVIDER_NOT_READY')return {code:'PROVIDER_NOT_READY',retryable:true,scope:'provider',cooldownMs:60000};
  const status=Number(error?.status || 0);
  if (status === 429) return {code:'RATE_LIMIT',retryable:true,scope:'account',cooldownMs:error.retryAfterMs || 60000};
  if (status === 402 || error?.code === 'QUOTA') return {code:'QUOTA',retryable:true,scope:'account',cooldownMs:21600000};
  if (error?.code === 'CREDENTIAL') return {code:'CREDENTIAL',retryable:true,scope:'account',cooldownMs:300000};
  if (status === 401 || status === 403) return {code:'AUTH',retryable:true,scope:'account',cooldownMs:3600000};
  if (status >= 500 && status < 600) return {code:'SERVER',retryable:true,scope:'account',cooldownMs:30000};
  if (status === 408 || status === 504) return {code:'TIMEOUT',retryable:true,scope:'account',cooldownMs:30000};
  const causeCode=String(error?.cause?.code ?? error?.code ?? '');
  if (['UND_ERR_SOCKET','ECONNRESET','ETIMEDOUT','EPIPE'].includes(causeCode) ||
      (error instanceof TypeError && ['fetch failed','terminated'].includes(error.message))) {
    return {code:'TRANSPORT',retryable:true,scope:'account',cooldownMs:10000};
  }
  return {code:'UNKNOWN',retryable:false,scope:'request'};
}
export function safeRetryAfter(raw, now=Date.now()) {
  if (!raw) return 0;
  if (/^\d+$/.test(String(raw))) return Math.min(Number(raw)*1000,86400000);
  const parsed=Date.parse(raw); return Number.isFinite(parsed)?Math.max(0,Math.min(86400000,parsed-now)):0;
}
