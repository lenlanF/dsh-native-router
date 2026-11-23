import {SOURCE_DAILY_SIGNIN_PROVIDERS} from './embedded-pack.mjs';
import {publicAccountName} from './account-facts.mjs';

// Evidence grades: authenticated official offer eligibility ('valid') versus
// verified wallet/billing credit ('completed'). Never count an offer or a
// successful model test as a credited free reward.
const SOURCE_SIGNIN=new Set(SOURCE_DAILY_SIGNIN_PROVIDERS);
const EMPTY_EXPLANATIONS=Object.freeze({
 cline:'该渠道当前仅有官方余额查询，尚未发现独立的无感免费领取接口',
 gemini:'官方额度按 5 小时／每周窗口自然恢复，不属于需要领取的活动',
 doubao:'仅自动领取官方已完成且可核实赠送额度的任务；未完成任务不会代做',
 loomy:'只接入官方新手任务完成接口；需要实际生成或分享等可感操作的活动不执行',
});
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
const dayInBeijing=at=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(at));
const validAt=(at,now)=>Number.isSafeInteger(at)&&at>0&&at<=now;
const provenDaily=(account,now)=>account?.checkinState==='success'
  &&account?.activityRewardProof==='official_daily_grant_bill'
  &&account?.sourceAccount===true&&channelKey(account.providerId)==='raccoon'
  &&validAt(account.activityRewardVerifiedAt,now)
  &&dayInBeijing(account.activityRewardVerifiedAt)===dayInBeijing(now)
  &&asAmount(account.activityRewardAmount)>0
  &&account.activityRewardUnit==='积分';
const provenBenefit=(account,benefit,now)=>benefit?.claimed===true
  &&benefit.rewardVerified===true
  &&benefit.rewardProof==='official_wallet_delta'
  &&(account?.sourceAccount===true&&channelKey(account.providerId)==='loomy'
    ||isWorkBuddy(account?.providerId)
    ||account?.providerId==='own_doubao')
  &&validAt(benefit.rewardVerifiedAt,now)
  &&asAmount(benefit.credit)>0;
const kindTitle=kind=>kind==='gift'?'官方活动赠送积分':
  kind==='compensation'?'官方补偿积分':'小浣熊桌面登录免费积分奖励';

export function buildChannelActivityCatalog({config,accountRows=[],sourceRows=[],now=Date.now()}={}){
  const channels=new Map();
  const ensure=(providerId,name='')=>{
    const key=channelKey(providerId);
    if(!key)return null;
    if(!channels.has(key))channels.set(key,{id:key,name:safeText(name)||key,
      accountCount:0,activityExecutorCount:0,activities:[],
      emptyReason:EMPTY_EXPLANATIONS[key]??null});
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
    if(account.activitiesSupported===true||account.checkinSupported===true)
      channel.activityExecutorCount++;
    const signer=account.checkinSupported===true
      &&account.activityActive!==false&&!excluded.has(account.checkinState)
      &&(account.sourceAccount===true&&SOURCE_SIGNIN.has(channelKey(account.providerId))
        ||DIRECT_FREE_SIGNIN.has(account.providerId));
    const doubao=channelKey(account.providerId)==='doubao';
    const source=account.sourceAccount===true;
    const eligible=signer&&(!doubao||
      ['claimable','claimed'].includes(account.activityState))
      &&(!source||SOURCE_SIGNIN.has(channelKey(account.providerId)));
    // A genuine OFFICIAL account-scoped daily eligibility response may be
    // visible BEFORE claiming. This is not a reward-credit proof and must
    // never appear as completed or add to an earned-points total.
    const officiallyClaimable=eligible&&account.enabled===true
      &&account.connectionState==='online'
      &&(account.activityClaimable===true||doubao
        &&account.activityState==='claimable'
        &&Number.isSafeInteger(account.activityCheckedAt)
        &&account.activityCheckedAt>0&&account.activityCheckedAt<=now
        &&now-account.activityCheckedAt<=15*60*1000);
    if(officiallyClaimable){
      const deadline=endOf(account.activityExpiresAt);
      if(deadline===null||deadline>now)channel.activities.push({
        id:account.id+':daily-claimable',accountId:account.id,accountName:name,
        name:'今日免费签到／额度活动',kind:'daily',rewardAmount:null,
        rewardUnit:null,validity:'valid',endAt:deadline,
        execution:'automatic',progress:'官方已确认可领取 · 尚无到账证据',
      });
    }
    if(eligible&&provenDaily(account,now)){
      const officialAmount=asAmount(account.activityRewardAmount);
      const officialUnit=safeText(account.activityRewardUnit,18);
      channel.activities.push({
        id:account.id+':daily',accountId:account.id,accountName:name,
        name:doubao?'每日签到免费奖励':'每日签到 / 免费奖励领取',
        kind:'daily',rewardAmount:officialAmount,
        rewardUnit:officialAmount!==null?officialUnit:null,
        validity:'completed',
        endAt:endOf(account.activityExpiresAt),execution:'automatic',
        progress:'官方每日积分账单确认已到账',
      });
    }
    const workbuddy=isWorkBuddy(account.providerId);
    const raccoon=source&&channel.id==='raccoon';
    const loomy=source&&channel.id==='loomy';
    if(!workbuddy&&!raccoon&&!loomy&&!doubao)continue;
    // WorkBuddy's gift and compensation APIs explicitly report active and
    // unclaimed. Do NOT confuse offer value with spendable wallet balance.
    if((workbuddy||doubao)&&account.connectionState==='online')for(const benefit of
      Array.isArray(account.benefits)?account.benefits:[]){
      if(!(['gift','compensation'].includes(benefit?.kind)&&workbuddy
        ||workbuddy&&/^workbuddy_growth_(?:task|travel)_[a-f0-9]{24}$/.test(benefit?.kind)
        ||doubao&&/^doubao_task_[a-f0-9]{24}$/.test(benefit?.kind))
        ||benefit.active!==true||benefit.claimed!==false)continue;
      const deadline=endOf(benefit.endAt);
      if(deadline!==null&&deadline<=now)continue;
      channel.activities.push({id:account.id+':'+benefit.kind+':available',
        accountId:account.id,accountName:name,
        name:/^(?:workbuddy_growth_|doubao_task_)/.test(benefit.kind)?
          safeText(benefit.name)||'会员免费任务':kindTitle(benefit.kind),
        kind:benefit.kind,rewardAmount:asAmount(benefit.credit),
        rewardUnit:Number.isFinite(benefit.credit)?doubao?'平台赠送额度':'积分':null,
        validity:'valid',endAt:deadline,execution:'automatic',
        progress:doubao?'官方确认可领取 · 赠送额度尚未证明到账':
          '官方账户确认活动待领取 · 尚未证明积分入账'});
    }
    for(const benefit of Array.isArray(account.benefits)?account.benefits:[]){
      if(!benefit||!(workbuddy?['gift','compensation'].includes(benefit.kind)
            ||/^workbuddy_growth_(?:task|travel)_[a-f0-9]{24}$/.test(benefit.kind):
          doubao?/^doubao_task_[a-f0-9]{24}$/.test(benefit.kind):
          loomy?['first_message','pick_skill','generate_ppt','set_schedule',
            'install_skill','configure_remote','create_soul','share_soul']
            .some(key=>benefit.kind==='loomy_'+key):
          benefit.kind==='raccoon_login')
        ||benefit.active!==true||!provenBenefit(account,benefit,now))continue;
      const deadline=endOf(benefit.endAt);
      if(deadline!==null&&deadline<=now)continue;
      const amount=asAmount(benefit.credit);
      channel.activities.push({
        id:account.id+':'+benefit.kind,accountId:account.id,accountName:name,
        name:loomy?safeText(benefit.name)||'免费新手活动':
          /^(?:workbuddy_growth_|doubao_task_)/.test(benefit.kind)?
            safeText(benefit.name)||'会员免费任务':kindTitle(benefit.kind),
        kind:benefit.kind,
        rewardAmount:amount,rewardUnit:amount!==null?
          doubao?'平台赠送额度':'积分':null,
        validity:'completed',
        endAt:deadline,execution:'automatic',
        progress:doubao?'官方任务状态与赠送额度窗口增量双重核验':
          '官方任务状态与积分钱包增量双重核验',
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
