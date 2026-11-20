// Read-only daily rollup. Channel aliases are a presentation grouping;
// they never merge account credentials or let yesterday count as today.
const canonical=id=>typeof id==='string'&&id.startsWith('own_')?id.slice(4):id;
const displayName=(id,name)=>{
  const familiar={'workbuddy-cn':'WorkBuddy 国内','workbuddy-global':'WorkBuddy Global',
    lingxi:'Lingxi',loomy:'Loomy',zcode:'ZCode',codearts:'CodeArts'};
  return familiar[id]??(typeof name==='string'&&name.trim()
    ?name.replace(/\s*·\s*(?:聚合路由自有|自有渠道|DSH 已注册)$/u,'').trim():id);
};
const verifiedDate=/^\d{4}-\d{2}-\d{2}$/;
export function latestConfirmedDate(history=[],accountId,today){
  if(typeof accountId!=='string'||!verifiedDate.test(today))return null;
  const records=history.filter(row=>row?.accountId===accountId
    &&row?.state==='success'&&typeof row.date==='string'
    &&verifiedDate.test(row.date)&&row.date<=today);
  return records.reduce((latest,row)=>!latest||row.date>latest?row.date:latest,null);
}
export function checkinGroups(accounts=[],channels=[]){
  const labels=new Map();
  for(const c of channels){
    const id=canonical(c?.id);
    if(typeof id!=='string'||!id)continue;
    const current=labels.get(id);
    const name=displayName(id,c.name);
    if(!current||current.raw.startsWith('own_')&&!String(c.id).startsWith('own_'))
      labels.set(id,{raw:c.id,name});
  }
   const groups=new Map();
   const blank=(id,name)=>({id,name,accountCount:0,success:0,pending:0,
     failed:0,unsupported:0,notRun:0,supported:0,historyConfirmed:0});
   for(const [id,label] of labels)groups.set(id,blank(id,label.name));
  for(const a of accounts){
    const id=canonical(a?.providerId);
    if(!id||typeof a?.id!=='string')continue;
     if(!groups.has(id))groups.set(id,blank(id,labels.get(id)?.name??displayName(id,id)));
    const group=groups.get(id);
    group.accountCount++;
    if(a.checkinSupported)group.supported++;
    if(a.checkinState==='success')group.success++;
    else if(a.checkinState==='pending_confirmation')group.pending++;
    else if(a.checkinState==='failed')group.failed++;
    else if(a.checkinState==='unsupported')group.unsupported++;
    else group.notRun++;
    if(a.lastConfirmedDate)group.historyConfirmed++;
  }
  return [...groups.values()].sort((a,b)=>b.success-a.success
    ||b.pending-a.pending||b.accountCount-a.accountCount
    ||a.name.localeCompare(b.name,'zh-CN'));
}
export function checkinChannelId(providerId){return canonical(providerId)}
