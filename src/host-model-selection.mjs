// Exact owner-scoped DSH host-model selection. No selected model IDs means
// the provider's entire live model directory stays available.
export const selectedHostModels=(cfg,id)=>Array.isArray(cfg?.hostModelSelection?.[id])
  ?cfg.hostModelSelection[id]:[];
export const allowsHostModel=(cfg,id,model)=>{
  const selected=selectedHostModels(cfg,id);
  return selected.length===0||selected.includes(model);
};
export const filterHostModels=(cfg,id,rows)=>Array.isArray(rows)
  ?rows.filter(row=>allowsHostModel(cfg,id,typeof row==='string'?row:row?.id)):[];
export const filterHostRoutes=cfg=>{
  if(!cfg||!Array.isArray(cfg.routes))return cfg;
  return {...cfg,routes:cfg.routes.map(route=>({
    ...route,tiers:route.tiers.filter(tier=>{
      const provider=cfg.providers.find(p=>p.id===tier.providerId);
      return !['dsh-host','native-channel'].includes(provider?.protocol)||
        allowsHostModel(cfg,tier.providerId,tier.model);
    })
  })).filter(route=>route.tiers.length>0)};
};
