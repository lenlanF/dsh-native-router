// Official credit buckets, not a token-price estimator. The Lingxi Pro
// documented gift-first debit order does not establish a per-run cost cap.
const amount=v=>{const n=typeof v==='number'?v:typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v.trim())?Number(v):NaN;return Number.isFinite(n)&&n>=0&&n<=1e12?n:null};
const expiry=v=>{
 if(typeof v==='number'&&Number.isFinite(v)&&v>0)return v<1e11?v*1000:v;
 if(typeof v!=='string')return NaN;
 const text=v.trim();
 if(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text))return Date.parse(text);
 // The published Lingxi wallet batches use a UTC+8 local timestamp.
 if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text))return Date.parse(text.replace(' ','T')+'+08:00');
 return NaN;
};
export function parseLingxiWallet(payload,now=Date.now()){
 const value=payload?.data;if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const total=amount(value.total_balance)??amount(value.credits_balance)??amount(value.balance);
 const basic=total===null?{}:{balance:total,balanceUnit:'积分',balanceCheckedAt:now,balanceState:'available'};
 const unknown={...basic,giftCreditState:'unconfirmed'};
 if(total===null||!Array.isArray(value.bonus_credits)||value.bonus_credits.length>200||value.purchased_credits!==undefined&&(!Array.isArray(value.purchased_credits)||value.purchased_credits.length>200))return unknown;
 const read=(rows,gift)=>rows.map(row=>({left:amount(row?.balance),endAt:expiry(row?.expire_time),gift}));
 const rows=[...read(value.bonus_credits,true),...read(value.purchased_credits??[],false)];
 if(rows.some(r=>r.left===null||r.left>0&&(r.gift&&!Number.isFinite(r.endAt)||Number.isFinite(r.endAt)&&r.endAt<=now)))return unknown;
 const gifts=rows.filter(r=>r.gift),ordinary=rows.filter(r=>!r.gift);
 const sum=rs=>Math.round(rs.reduce((n,r)=>n+r.left,0)*1e4)/1e4;
 const free=sum(gifts),paid=Array.isArray(value.purchased_credits)?sum(ordinary):Math.round((total-free)*1e4)/1e4;
 // Without a purchased-bucket list the remainder is only non-gift balance,
 // not proof that it was purchased. Never allocate it to automatic free use.
 if(paid<0||Math.abs(free+paid-total)>0.0001)return unknown;
 const near=gifts.filter(r=>r.left>0&&r.endAt<=now+7*86400000);
 const windows=gifts.filter(r=>r.left>0).sort((a,b)=>a.endAt-b.endAt).slice(0,12).map(r=>({kind:'gift',label:'官方赠送积分',left:r.left,unit:'积分',endAt:r.endAt}));
 return {...basic,giftCreditState:'verified',giftedBalance:free,ordinaryBalance:paid,giftCreditCheckedAt:now,giftExpiresAt:free>0?Math.min(...gifts.filter(r=>r.left>0).map(r=>r.endAt)):null,
   giftRouteState:free>0?'cost_bound_unverified':'no_gift',quotaWindows:windows,
   ...(near.length?{expiringPoints:sum(near),expiringAt:Math.min(...near.map(r=>r.endAt))}:{})};
}
