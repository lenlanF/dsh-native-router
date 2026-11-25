const n=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12;
// Only use already classified, authoritative, nonoverlapping same-unit
// components. A gift award/claim receipt is not a remaining balance.
export function giftWalletFacts({balance,gift,ordinary,now=Date.now(),expiresAt=null,expiryKnown=false,routeState='cost_bound_unverified'}={}){
 if(![balance,gift,ordinary].every(n)||Math.abs(gift+ordinary-balance)>0.0001||expiryKnown&&gift>0&&(!Number.isFinite(expiresAt)||expiresAt<=now))return {giftCreditState:'unconfirmed'};
 return {giftCreditState:'verified',giftedBalance:gift,ordinaryBalance:ordinary,giftCreditCheckedAt:now,giftExpiresAt:expiryKnown&&gift>0?expiresAt:null,giftExpiryKnown:expiryKnown||gift===0,giftRouteState:gift===0?'no_gift':routeState};
}
export function staleGiftWallet(row){
 return row?{...row,balanceState:Number.isFinite(row.balance)?'cached':'unavailable',giftCreditState:'unconfirmed',giftedBalance:undefined,ordinaryBalance:undefined,giftCreditCheckedAt:undefined,giftExpiresAt:undefined,giftRouteState:undefined,loomyDailyGift:undefined,quotaWindows:[]}:row;
}
export function publicGiftWallet(live,balance,{now=Date.now(),fromCache=false}={}){
 const at=live?.giftCreditCheckedAt;
 if(live?.giftCreditState!=='verified'||fromCache||balance?.balanceStale||balance?.balanceState!=='available'||balance.balanceUnit!=='积分'||!Number.isFinite(at)||at>now||now-at>180000)return {giftCreditState:'unconfirmed'};
 const hasExpiry=live.giftExpiryKnown===true||Number.isFinite(live.giftExpiresAt);
 const result=giftWalletFacts({balance:balance.balance,gift:live.giftedBalance,ordinary:live.ordinaryBalance,now,expiryKnown:hasExpiry,expiresAt:live.giftExpiresAt,routeState:live.giftRouteState==='existing_daily_policy'?'existing_daily_policy':'cost_bound_unverified'});
 if(result.giftCreditState==='verified')result.giftCreditCheckedAt=at;
 return result;
}
