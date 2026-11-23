import {SOURCE_DAILY_SIGNIN_PROVIDERS} from './embedded-pack.mjs';
import {publicAccountName} from './account-facts.mjs';

// Only activities with an already-implemented, no-purchase, official claim
// executor belong here. Never invent rewards from model quotas, marketing
// banners, task counts, or a channel's aggregate wallet.
const SOURCE_SIGNIN=new Set(SOURCE_DAILY_SIGNIN_PROVIDERS);
const DIRECT_FREE_SIGNIN=new Set([
  'own_workbuddy-cn','own_workbuddy-global','own_doubao','own_lingxi']);
const SAFE_END=Number.MAX_SAFE_INTEGER;
const asAmount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const endOf=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<SAFE_END
  ?value<1e11?value*1000:value:null;
const channelKey=id=>String(id||'').replace(/^own_/,'');
const isWorkBuddy=id=>/^own_workbuddy-(?:cn|global)$/.test(id);
const excluded=new Set(['unsupported','client_required','no_task','disabled']);
const safeText=(value,length=80)=>typeof value==='string'&&value.trim()?
  value.trim().slice(0,length):'';
const kindTitle=kind=>kind==='gift'?'官方活动赠送积分':'官方补偿积分';

export function buildChannelActivityCatalog({config,accountRows=[],sourceRows=[],now=Date.now()}={}){
  const channels=new Map();
  const ensure=(providerId,name='')=>{
    const key=channelKey(providerId);
    if(!key)return null;
    if(!channels.has(key))channels.set(key,{id:key,name:safeText(name)||key,
      accountCount:0,activities:[]});
    else if(name&&channels.get(key).name===key)channels.get(key).name=safeText(name)||key;
    return channels.get(key);
  };
  const providers=Array.isArray(config?.providers)?config.providers:[];
  for(const p of providers)if(p&&typeof p.id==='string')
    ensure(p.id,p.name);
  const found=new Map();
  for(const account of [...accountRows,...sourceRows]){
    if(!account||typeof account.id!=='string'||!account.id||
      typeof account.providerId!=='string'||!account.providerId)continue;
    // The source pool may report the same account through owned and borrowed
    // views. Keep the richer, already-merged DSH account snapshot.
    const identity=channelKey(account.providerId)+'\\0'+account.id;
    if(!found.has(identity))found.set(identity,account);
  }
  for(const account of found.values()){
    const channel=ensure(account.providerId,account.providerName);
    if(!channel)continue;
    const name=publicAccountName(account)||'账号名待获取';
    channel.accountCount++;
    if(account.enabled!==true)continue;
    const activeProvider=providers.find(p=>p.id===account.providerId)??
      providers.find(p=>channelKey(p.id)===channel.id);
    if(activeProvider?.enabled===false)continue;
    const signer=account.checkinSupported===true
      &&account.activityActive!==false&&!excluded.has(account.checkinState)
      &&(account.sourceAccount===true&&SOURCE_SIGNIN.has(channelKey(account.providerId))
        ||DIRECT_FREE_SIGNIN.has(account.providerId));
    const doubao=channelKey(account.providerId)==='doubao';
    const source=account.sourceAccount===true;
    const eligible=signer&&(!doubao||
      ['claimable','claimed'].includes(account.activityState))
      &&(!source||SOURCE_SIGNIN.has(channelKey(account.providerId)));
    if(eligible){
      const done=account.checkinState==='success'||doubao&&account.activityState==='claimed';
      const confirmedActive=done||doubao&&account.activityState==='claimable'
        ||account.checkinState==='running';
      const officialAmount=asAmount(account.activityRewardAmount);
      const officialUnit=safeText(account.activityRewardUnit,18);
      channel.activities.push({
        id:account.id+':daily',accountId:account.id,accountName:name,
        name:doubao?'每日签到免费奖励':'每日签到 / 免费奖励领取',
        kind:'daily',rewardAmount:officialAmount,
        rewardUnit:officialAmount!==null?officialUnit:null,
        validity:done?'completed':confirmedActive?'valid':'unverified',
        endAt:endOf(account.activityExpiresAt),execution:'automatic',
        progress:done?'已完成':account.checkinState==='pending_confirmation'?
          '等待官方确认':account.checkinState==='running'?'执行中':
          account.autoCheckinEffective?'自动执行中':'自动任务未开启',
      });
    }
    if(!isWorkBuddy(account.providerId))continue;
    for(const benefit of Array.isArray(account.benefits)?account.benefits:[]){
      if(!benefit||!['gift','compensation'].includes(benefit.kind)
        ||benefit.active!==true||typeof benefit.claimed!=='boolean')continue;
      const deadline=endOf(benefit.endAt);
      if(deadline!==null&&deadline<=now)continue;
      const amount=asAmount(benefit.credit);
      channel.activities.push({
        id:account.id+':'+benefit.kind,accountId:account.id,accountName:name,
        name:kindTitle(benefit.kind),kind:benefit.kind,
        rewardAmount:amount,rewardUnit:amount!==null?'积分':null,
        validity:benefit.claimed?'completed':'valid',
        endAt:deadline,execution:'automatic',
        progress:benefit.claimed?'官方确认已领取':
          account.activityClaims?.unconfirmed>0?'存在待核实回执':
          account.autoCheckinEffective?'待自动领取':'自动任务未开启',
      });
    }
  }
  const list=[...channels.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans'));
  for(const c of list)c.activities.sort((a,b)=>a.accountName.localeCompare(b.accountName,'zh-Hans')
    ||a.name.localeCompare(b.name,'zh-Hans'));
  return {channels:list,checkedAt:now,summary:{
    channelCount:list.length,activityCount:list.reduce((s,c)=>s+c.activities.length,0),
    validCount:list.reduce((s,c)=>s+c.activities.filter(a=>a.validity==='valid').length,0),
    completedCount:list.reduce((s,c)=>s+c.activities.filter(a=>a.validity==='completed').length,0)
  }};
}

export function createChannelActivityCenter({configStore,accountCenter,checkinCenter,
  now=()=>Date.now(),minRefreshMs=20000}={}){
  let pending=null,lastRefreshAt=0,lastRefreshState='not_checked';
  const snapshot=()=>{
    const status=checkinCenter?.snapshot?.()??{accounts:[]};
    // Source accounts already reconciled into the check-in snapshot.
    return {...buildChannelActivityCatalog({
      config:configStore.get(),accountRows:status.accounts,now:now()}),
      refreshedAt:lastRefreshAt||null,refreshState:lastRefreshState};
  };
  const refresh=async()=>{
    if(pending)return pending;
    if(lastRefreshAt&&now()-lastRefreshAt<minRefreshMs)return snapshot();
    pending=(async()=>{
      // These are official *reads*, never a signin/claim action.
      const results=await Promise.allSettled([
        Promise.resolve().then(()=>accountCenter?.refreshReadOnly?.({force:true})),
        Promise.resolve().then(()=>checkinCenter?.refreshSources?.({force:true})),
      ]);
      if(results.every(x=>x.status==='rejected')){
        lastRefreshState='unavailable';
        throw Error('Official reward source reads unavailable');
      }
      lastRefreshState=results.some(x=>x.status==='rejected')?'partial':'read_attempted';
      lastRefreshAt=now();
      return snapshot();
    })().finally(()=>{pending=null});
    return pending;
  };
  return {snapshot,refresh};
}
