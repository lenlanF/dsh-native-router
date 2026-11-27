const n=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12;
// Only use already classified, authoritative, nonoverlapping same-unit
// components. A gift award/claim receipt is not a remaining balance.
export function giftWalletFacts({balance,gift,ordinary,unknown=0,now=Date.now(),expiresAt=null,expiryKnown=false,routeState='cost_bound_unverified'}={}){
 if(![balance,gift,ordinary,unknown].every(n)||Math.abs(gift+ordinary+unknown-balance)>0.0001||unknown>0&&gift===0&&ordinary===0||expiryKnown&&gift>0&&(!Number.isFinite(expiresAt)||expiresAt<=now))return {giftCreditState:'unconfirmed'};
 return {giftCreditState:unknown>0?'partial':'verified',giftedBalance:gift,ordinaryBalance:ordinary,...(unknown>0?{unclassifiedBalance:unknown}:{}),giftCreditCheckedAt:now,giftExpiresAt:expiryKnown&&gift>0?expiresAt:null,giftExpiryKnown:expiryKnown||gift===0,giftRouteState:unknown>0?'cost_bound_unverified':gift===0?'no_gift':routeState};
}
export function staleGiftWallet(row){
 return row?{...row,balanceState:Number.isFinite(row.balance)?'cached':'unavailable',giftCreditState:'unconfirmed',giftedBalance:undefined,ordinaryBalance:undefined,unclassifiedBalance:undefined,giftCreditCheckedAt:undefined,giftExpiresAt:undefined,giftRouteState:undefined,loomyDailyGift:undefined,quotaWindows:[]}:row;
}
export function publicGiftWallet(live,balance,{now=Date.now(),fromCache=false}={}){
 const at=live?.giftCreditCheckedAt;
 if(!['verified','partial'].includes(live?.giftCreditState)||fromCache||balance?.balanceStale||balance?.balanceState!=='available'||balance.balanceUnit!=='积分'||!Number.isFinite(at)||at>now||now-at>180000)return {giftCreditState:'unconfirmed'};
 if(live.giftCreditState==='partial'&&!(n(live.unclassifiedBalance)&&live.unclassifiedBalance>0))return {giftCreditState:'unconfirmed'};
 const hasExpiry=live.giftExpiryKnown===true||Number.isFinite(live.giftExpiresAt);
 const result=giftWalletFacts({balance:balance.balance,gift:live.giftedBalance,ordinary:live.ordinaryBalance,unknown:live.unclassifiedBalance??0,now,expiryKnown:hasExpiry,expiresAt:live.giftExpiresAt,routeState:live.giftRouteState==='existing_daily_policy'?'existing_daily_policy':'cost_bound_unverified'});
 if(['verified','partial'].includes(result.giftCreditState))result.giftCreditCheckedAt=at;
 return result;
}
