export class UpstreamError extends Error {
  constructor(message, {status=0, code='', retryAfterMs=0}={}) {
    super(message); this.name='UpstreamError'; this.status=status; this.code=code; this.retryAfterMs=retryAfterMs;
  }
}
// DSH-native plugins may reject a request with a structured machine failure
// and no HTTP response at all. Keep only a bounded, reviewed machine status;
// never forward upstream Error.message, headers, tokens or raw failure data.
export function safeDshFailureFacts(error){
 const nested=error?.failure&&typeof error.failure==='object'?error.failure:null;
 const rawCode=typeof nested?.code==='string'?nested.code:
   typeof error?.code==='string'?error.code:error?.cause?.code;
 const code=String(rawCode??'').toUpperCase();
 const codes={
  QUOTA:['QUOTA',402],ACCOUNT_QUOTA:['QUOTA',402],
  RATE_LIMIT:['RATE_LIMIT',429],AUTH:['AUTH',401],CREDENTIAL:['CREDENTIAL',401],
  PROVIDER_NOT_READY:['PROVIDER_NOT_READY',0],
  STREAM_CLOSED:['TRUNCATED',0],TRUNCATED:['TRUNCATED',0],
  SERVER:['SERVER',503],TIMEOUT:['TIMEOUT',408],
  TRANSPORT:['TRANSPORT',0],ECONNRESET:['TRANSPORT',0],
  ETIMEDOUT:['TIMEOUT',408],EPIPE:['TRANSPORT',0],UND_ERR_SOCKET:['TRANSPORT',0],
  INVALID_REQUEST:['INVALID_REQUEST',0],CONTEXT_WINDOW_EXCEEDED:['INVALID_REQUEST',0],
  CANCELLED:['CANCELLED',0],ABORTED:['CANCELLED',0],
 };
 const mapped=Object.prototype.hasOwnProperty.call(codes,code)?codes[code]:['UPSTREAM',0];
 const rawStatus=Number(nested?.status??nested?.statusCode??error?.status??error?.statusCode);
 const status=mapped[0]==='INVALID_REQUEST'||mapped[0]==='CANCELLED'?0:
   Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:mapped[1];
 const wait=Number(nested?.retryAfterMs??error?.retryAfterMs);
 return {code:mapped[0],status,
  retryAfterMs:Number.isFinite(wait)&&wait>0?Math.min(wait,86400000):0};
}
export function safeHostFailure(error){
 return new UpstreamError('Original DSH plugin request failed',safeDshFailureFacts(error));
}
export function classifyFailure(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return {code:'CANCELLED', retryable:false, scope:'request'};
   if(error?.safeStreamPhase==='MAX_TOKENS')
     return {code:'OUTPUT_LIMIT',retryable:false,scope:'request'};
   if(error?.code === 'TRUNCATED'||error?.code==='STREAM_CLOSED')    return {code:'STREAM_CLOSED',retryable:true,scope:'account',cooldownMs:10000};
  if(error?.code === 'RATE_LIMIT'||error?.code==='ACCOUNT_QUOTA'){
    return error.code==='ACCOUNT_QUOTA'
      ?{code:'QUOTA',retryable:true,scope:'account',cooldownMs:21600000}
      :{code:'RATE_LIMIT',retryable:true,scope:'account',cooldownMs:error.retryAfterMs||60000};
  }
  if(error?.code === 'TRANSPORT')return {code:'TRANSPORT',retryable:true,scope:'account',cooldownMs:10000};
  if(error?.code === 'TIMEOUT')return {code:'TIMEOUT',retryable:true,scope:'account',cooldownMs:30000};
  if(error?.code === 'SERVER')return {code:'SERVER',retryable:true,scope:'account',cooldownMs:30000};
  if(error?.code==='CANCELLED'||error?.code==='ABORTED')
    return {code:'CANCELLED',retryable:false,scope:'request'};
  if(error?.code==='INVALID_REQUEST'||error?.code==='CONTEXT_WINDOW_EXCEEDED')
    return {code:'INVALID_REQUEST',retryable:false,scope:'request'};
  if(error?.code === 'PROVIDER_NOT_READY')return {code:'PROVIDER_NOT_READY',retryable:true,scope:'provider',cooldownMs:60000};
  const status=Number(error?.status || 0);
  if (status === 429) return {code:'RATE_LIMIT',retryable:true,scope:'account',cooldownMs:error.retryAfterMs || 60000};
  if (status === 402 || error?.code === 'QUOTA') return {code:'QUOTA',retryable:true,scope:'account',cooldownMs:21600000};
  if (error?.code === 'CREDENTIAL') return {code:'CREDENTIAL',retryable:true,scope:'account',cooldownMs:300000};
  if (status === 401 || status === 403) return {code:'AUTH',retryable:true,scope:'account',cooldownMs:3600000};
  if (status === 408 || status === 504) return {code:'TIMEOUT',retryable:true,scope:'account',cooldownMs:30000};
  if (status >= 500 && status < 600) return {code:'SERVER',retryable:true,scope:'account',cooldownMs:30000};
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
