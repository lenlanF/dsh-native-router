import {sourceAccountOpaqueId} from './source-account-ref.mjs';
// The only automatic equivalence proof is an exact provider-scoped source ID.
// Nickname, display name, email-like labels and model names are NOT identities.
const canonical=id=>typeof id==='string'&&id.startsWith('own_')?id.slice(4):id;
const health={online:5,recently_verified:4,not_checked:3,pending:2,error:1,expired:0,disabled:-1};
const score=row=>(health[row.connectionState]??0)*10+(row.sourceKind==='owned'?1:0);
const key=row=>canonical(row.providerId)+'\0'+row.id;
export function mergeAccountSources({roster,embeddedAccounts,sourceRows=[],embeddedStatus={}}={}){
 const channels=(roster?.channels??[]).map(row=>({...row})),
   channelIds=new Set(channels.map(row=>row.id)),
   sourceMap=new Map(sourceRows.filter(row=>row?.sourceAccount===true).map(row=>[row.id,row]));
 const rows=[];
 for(const item of roster?.accounts??[]){
   const source=sourceMap.get(item.id);
   const owned=canonical(item.providerId)!==item.providerId;
   const displayId=channelIds.has(canonical(item.providerId))
     ?canonical(item.providerId):item.providerId;
   rows.push({...item,providerId:displayId,routeProviderId:item.providerId,
     sourceKind:owned?'owned':item.reusedExistingSession?'reused':'configured',
     ...(source?{nickname:source.nickname||item.nickname||'',
        ...(owned&&source.connectionState==='online'?{connectionState:'online',
          message:'本插件独立账号已通过来源授权核查'}:{}),       ...(Number.isFinite(source.balance)?{balance:source.balance,
         balanceUnit:source.balanceUnit,balanceCheckedAt:source.balanceCheckedAt}:{})}:{})});
 }
 for(const account of embeddedAccounts?.accounts??[]){
   if(typeof account?.providerId!=='string'||typeof account.id!=='string')continue;
   const opaque=sourceAccountOpaqueId(account.providerId,account.id);
   const ownId='own_'+account.providerId;
   const displayId=channelIds.has(account.providerId)?account.providerId:ownId;
   if(!channelIds.has(displayId)){
     channelIds.add(displayId);
     channels.push({id:displayId,name:account.providerId+' · 自主登录',
       authMethod:'本插件独立账号池',adapterReady:embeddedStatus.modelAdapterReady?.includes(account.providerId)===true,
       referenceOnly:true,discoveryAvailable:false});
   }
   const status=sourceMap.get(opaque);
   rows.push({id:opaque,providerId:displayId,routeProviderId:ownId,
     providerName:account.providerId,nickname:status?.nickname||account.nickname||'',
     configuredEnabled:account.enabled===true,enabled:account.enabled===true,
     connectionState:!account.enabled?'disabled':status?.connectionState==='online'?'online':'not_checked',
     sourceKind:'owned',managed:false,weight:1,
     origin:{kind:'owned-source',label:'本插件独立登录态'},
     credentialKind:'driver',checkinState:status?.checkinState??'not_run',
     ...(Number.isFinite(account.balance)?{balance:account.balance,
       balanceUnit:account.balanceUnit,balanceCheckedAt:account.balanceCheckedAt}:{})});
 }
 const grouped=new Map();
 for(const account of rows){
   const k=key(account);
   if(!grouped.has(k))grouped.set(k,[]);
   grouped.get(k).push(account);
 }
 const accounts=[];
 for(const members of grouped.values()){
   members.sort((a,b)=>score(b)-score(a));
   const primary=members[0];
   // Sources remain intact and are not disabled/deleted. Router can fail over
   // only if each source can independently prove the exact account identity.
   accounts.push({...primary,activeSource:primary.sourceKind,
     backupSources:members.slice(1).map(x=>({
       kind:x.sourceKind,routeProviderId:x.routeProviderId,state:x.connectionState,
       available:x.enabled===true,
     }))});
 }
 return {channels,accounts};
}
