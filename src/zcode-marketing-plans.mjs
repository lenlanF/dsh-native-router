// Strict, dependency-free ZCode 3.17+ marketing campaign reader.
// The server can deliver Start Plan gifts only through marketing/touch;
// this extracts ONLY explicit claim_zcode_plan buttons and never performs I/O.
const START_PLAN_ID=/^zcode-v3-start-plan-[a-z0-9-]{1,100}$/i;
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
const safeLabel=x=>typeof x==='string'&&x.trim()&&x.length<=120?x.trim():undefined;
export function parseZcodeMarketingPlans(body){
  const root=obj(body);
  if(root?.code!==0||!Array.isArray(root.data?.deliveries)
    ||root.data.deliveries.length>32)return null;
  const found=new Map();
  for(const raw of root.data.deliveries){
    const delivery=obj(raw),banner=obj(delivery?.banner),popup=obj(delivery?.popup);
    const contexts=[
      [banner?.buttons,banner?.background?.args?.zcode_plan],
      [popup?.buttons,popup?.hero?.args?.zcode_plan],
    ];
    for(const [buttons,rawPlan] of contexts){
      if(!Array.isArray(buttons)||buttons.length>4)continue;
      const plan=obj(rawPlan);
      for(const button of buttons){
        const action=obj(button?.action);
        if(action?.type!=='claim_zcode_plan')continue;
        const planId=action?.args?.plan_id;
        if(typeof planId!=='string'||!START_PLAN_ID.test(planId))continue;
        // Never mix an action for one plan with another banner's metadata.
        if(typeof plan?.plan_id==='string'&&plan.plan_id!==planId)continue;
        if(found.has(planId))continue;
        const priority=Number.isInteger(plan?.priority)?plan.priority:
          Number.isInteger(delivery.priority)?delivery.priority:0;
        const entitlements=Array.isArray(plan?.entitlements)?plan.entitlements:[];
        const grant=entitlements.find(x=>x?.unit_type==='token'
          &&/^glm[-.]5[-.]3[-.]flash$/i.test(x?.show_name??''));
        found.set(planId,{
          planId,priority,
          ...(safeLabel(plan?.name)?{name:safeLabel(plan.name)}:{}),
          ...(Number.isSafeInteger(grant?.grant_units)&&grant.grant_units>0
            ?{grantUnits:grant.grant_units,unitType:'token'}:{}),
        });
      }
    }
  }
  return [...found.values()].sort((a,b)=>b.priority-a.priority);
}
export function mergeZcodeClaimablePlans(preview,marketing,{marketingAuthoritative=false}={}){
  if(!Array.isArray(preview)&&!Array.isArray(marketing))return null;
  const merged=new Map();
  // Billing preview wins over a banner for the same plan ID.
  for(const batch of [preview,marketing]){
    if(!Array.isArray(batch))continue;
    for(const row of batch){
      const planId=row?.planId;
      if(typeof planId!=='string'||!START_PLAN_ID.test(planId)||merged.has(planId))
        continue;
      merged.set(planId,row);
    }
  }
  const result=[...merged.values()].sort((a,b)=>(b.priority??0)-(a.priority??0));
  // One unavailable source cannot justify a definitive "nothing to claim".
  return result.length||(marketingAuthoritative&&Array.isArray(marketing))
    ||Array.isArray(preview)&&Array.isArray(marketing)?result:null;
}
