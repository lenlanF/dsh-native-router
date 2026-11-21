import {sourceAccountOpaqueId} from './source-account-ref.mjs';
import {publicAccountName,publicBalance} from './account-facts.mjs';

// Physical location is not login provenance. A migrated credential stored in the
// private pool is still an adopted/reused login, NOT a new autonomous OAuth.
const canonical=id=>typeof id==='string'&&id.startsWith('own_')?id.slice(4):id;
const rank={online:5,recently_verified:4,not_checked:3,pending:2,error:1,expired:0,disabled:-1};
const key=row=>canonical(row.providerId)+'\0'+row.id;
const safeSource=source=>source==='adopted'?'adopted':
  source==='autonomous'?'autonomous':'unknown';
const sourceName=kind=>kind==='adopted'?'原渠道授权接管':
  kind==='autonomous'?'本插件自主登录':kind==='reused'?'本地插件复用':'来源待确认';
const isIndependent=kind=>kind==='autonomous';
const sourceScore=row=>(row.enabled===true&&row.connectionState==='online'?100:
  row.enabled===true?(rank[row.connectionState]??0)*10:0)+
  (isIndependent(row.sourceKind)?2:row.sourceKind==='adopted'?1:0);
// An independent source pack may retain the session after owner detaches the
// account from Native Router. Both the public embeddedAccounts inventory and
// the aggregated cards must honor the same persistent ignoredIds guard as
// AutoFree, source check-ins and the execution layer. Explicit re-adoption of
// the precise identity is allowed without clearing historical audit markers.
export function visiblePrivateSourceAccounts(accounts=[],{
 ignoredIds=[],configuredAccounts=[],
}={}){
 const hidden=new Set(ignoredIds);
 return (Array.isArray(accounts)?accounts:[]).filter(row=>{
   if(typeof row?.providerId!=='string'||typeof row.id!=='string')return false;
   const id=sourceAccountOpaqueId(row.providerId,row.id);
   return !hidden.has(id)||configuredAccounts.some(a=>a?.id===id
     &&canonical(a.providerId)===row.providerId);
 });
}
export function mergeAccountSources({roster,embeddedAccounts,sourceRows=[],
 embeddedStatus={},ignoredIds=[],}={}){
 const channelMap=new Map();
 for(const channel of roster?.channels??[]){
   const id=canonical(channel.id),current=channelMap.get(id);
   if(!current||current.referenceOnly&&channel.referenceOnly!==true)
     channelMap.set(id,{...channel,id});
   else channelMap.set(id,{...current,adapterReady:current.adapterReady||channel.adapterReady});
 }
 const pool=new Map(),sourceMap=new Map(
   sourceRows.filter(row=>row?.sourceAccount).map(row=>[row.id,row]));
 for(const row of visiblePrivateSourceAccounts(embeddedAccounts?.accounts,{
   ignoredIds,configuredAccounts:roster?.accounts??[],
 })){
   if(typeof row?.providerId!=='string'||typeof row.id!=='string')continue;
   const id=sourceAccountOpaqueId(row.providerId,row.id);
   pool.set(key({providerId:row.providerId,id}),{...row,opaqueId:id,status:sourceMap.get(id)});
   if(!channelMap.has(row.providerId))
     channelMap.set(row.providerId,{id:row.providerId,name:row.providerId,
       referenceOnly:true,authMethod:'原渠道复用与自主登录',
       adapterReady:embeddedStatus.modelAdapterReady?.includes(row.providerId)===true});
 }
 const grouped=new Map(),physicalSeen=new Set();
 const add=(row,physicalKey)=>{
   if(!grouped.has(key(row)))grouped.set(key(row),[]);
   const members=grouped.get(key(row));
   if(members.some(x=>x.physicalKey===physicalKey))return;
   members.push({...row,physicalKey});
 };
 for(const item of roster?.accounts??[]){
   const id=canonical(item.providerId),ownedPool=pool.get(key({id:item.id,providerId:id}));
   const localAdopted=item.providerId==='own_lingxi'&&/^pr_[a-f0-9]{28}$/.test(item.id);
   const boundToPack=ownedPool&&(
     item.origin?.kind==='embedded-account-pool'||
     // An independently QR-signed-in CodeArts account may keep its legacy
     // public provider ID. Require both the verified private runtime binding
     // and an exact match in the actual private account pool.
     item.origin?.kind==='independent-owned'&&item.runtimeMode==='owned'||
     item.providerId==='own_'+id);
   const kind=boundToPack?safeSource(ownedPool.authorizationSource):
     localAdopted?'adopted':
     item.origin?.kind==='dsh-account-pool'?'reused':
     item.reusedExistingSession?'reused':'unknown';
    const status=boundToPack?ownedPool.status:null;
    const label=publicAccountName(status,ownedPool,item);
    const reported=publicBalance(status,item);
    const enabled=item.enabled===true&&(!boundToPack||ownedPool.enabled===true);
    add({...item,id:item.id,providerId:id,routeProviderId:item.providerId,
       sourceKind:kind,nickname:label,enabled,
       runtimeMode:boundToPack?'owned':item.runtimeMode??'linked',      origin:boundToPack||localAdopted?{kind,label:sourceName(kind)}:item.origin,
      connectionState:!enabled?'disabled':
        boundToPack&&status?.connectionState==='online'?'online':item.connectionState,
      ...reported,
   },boundToPack?'private:'+id+':'+item.id:'configured:'+item.providerId+':'+item.id);
   if(boundToPack)physicalSeen.add(key({providerId:id,id:item.id}));
 }
 for(const [id,source] of pool){
   if(physicalSeen.has(id))continue;
   const row=source.status,kind=safeSource(source.authorizationSource);
   // The source pack's stored login can remain physically enabled after the
   // Native Router owner disables the channel/account. The source check-in
   // health row is the latest effective owner-state, not merely a score tag.
   const enabled=source.enabled===true&&row?.enabled!==false;
   add({id:source.opaqueId,providerId:source.providerId,routeProviderId:'own_'+source.providerId,
      providerName:source.providerId,sourceKind:kind,managed:false,
       nickname:publicAccountName(row,source),runtimeMode:'owned',
       ...(row?.maskedPhone?{maskedPhone:row.maskedPhone}:{}),      enabled,configuredEnabled:source.enabled===true,weight:1,
      connectionState:!enabled?'disabled':
        row?.connectionState==='online'?'online':'not_checked',
      origin:{kind,label:sourceName(kind)},credentialKind:'driver',
      ...publicBalance(row,source),
     checkinState:row?.checkinState??'not_run',
   },'private:'+source.providerId+':'+source.opaqueId);
 }
 const accounts=[];
 for(const members of grouped.values()){
   members.sort((a,b)=>sourceScore(b)-sourceScore(a));
   const primary=members[0];
   accounts.push({...primary,activeSource:primary.sourceKind,
      backupSources:members.slice(1).map(s=>({kind:s.sourceKind,routeProviderId:s.routeProviderId,
        available:s.enabled===true&&s.connectionState==='online',
        configured:s.enabled===true,state:s.connectionState}))});
 }
 return {channels:[...channelMap.values()],accounts};
}