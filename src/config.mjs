import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {randomUUID} from 'node:crypto';
import {retryAtomicRename} from './retry-atomic-rename.mjs';
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const NAME = /^[^\u0000-\u001f]{1,120}$/;
const AUTH = /^(?:env:[A-Z_][A-Z0-9_]*|host:[a-zA-Z0-9._:-]{1,160}|driver:[a-zA-Z][a-zA-Z0-9_-]{0,63}:[a-zA-Z0-9_-]{1,100})$/;

export function defaultConfigPath() {
  return join(process.env.DSH_HOME?.trim()||join(homedir(),'.dsh'), 'plugins', 'dsh-native-router', 'config.json');
}
function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid ' + label);
  return value;
}
function unique(items, key, label) {
  const values = new Set();
  for (const item of items) { if (values.has(item[key])) throw new Error('Duplicate ' + label + ': ' + item[key]); values.add(item[key]); }
}
function int(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function address(value) {
  if (typeof value !== 'string') throw new Error('Provider baseUrl is required');
  let url;
  try { url = new URL(value) } catch { throw new Error('Invalid provider baseUrl') }
  if (url.username || url.password || url.search || url.hash) throw new Error('Provider URL must not embed credentials or query strings');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Provider baseUrl must use HTTPS or a loopback HTTP address');
  }
  return url.href.replace(/\/+$/, '');
}
export const isRetiredProvider=id=>id==='own_doubao'||id==='doubao'||id==='native-router-source-doubao';
const retiredSelection=(row,removedRoutes=new Set())=>{
  const [provider,model]=typeof row==='string'?row.split(/\/(.*)/s):[row?.provider??row?.providerId,row?.model];
  return isRetiredProvider(provider?.trim?.())||provider==='native-router'&&typeof model==='string'&&(
    model.startsWith('direct:')&&isRetiredProvider(model.split(':')[1])||
    model.startsWith('chain:')&&removedRoutes.has(model.slice(6)));
};
const retiredRoute=(value,removedRoutes)=>typeof value==='string'&&retiredSelection(value,removedRoutes);
export function normalizeConfig(source = {}) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid router configuration');
  if ('apiKey' in source || 'token' in source) throw new Error('Secrets must never be saved in router configuration');
  const providers = (source.providers ?? []).filter(p=>!isRetiredProvider(p?.id)).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider');
    const protocol = value.protocol ?? 'openai-chat';
    if (!['openai-chat','anthropic-messages','native-channel','dsh-host'].includes(protocol)) throw new Error('Unsupported provider protocol: ' + protocol);
    const models = Array.isArray(value.models) ? value.models.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    return { id: id(value.id, 'provider id'), name: typeof value.name === 'string' && NAME.test(value.name) ? value.name : value.id,
      protocol, baseUrl: ['native-channel','dsh-host'].includes(protocol) ? '' : address(value.baseUrl), models: [...new Set(models)], enabled: value.enabled !== false,
      timeoutMs: int(value.timeoutMs, 120000, 1000, 600000), supportsTools: value.supportsTools !== false };
  });
  unique(providers, 'id', 'provider');
  const providerIds = new Set(providers.map(p => p.id));
  const retiredAccounts=new Set((source.accounts??[]).filter(a=>isRetiredProvider(a?.providerId)).map(a=>a.id));
  const accounts = (source.accounts ?? []).filter(a=>!isRetiredProvider(a?.providerId)).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account');
    if ('apiKey' in value || 'token' in value || 'password' in value) throw new Error('Secrets may not be stored in account metadata');
    if (!providerIds.has(value.providerId)) throw new Error('Account refers to unknown provider: ' + value.providerId);
    if (providers.find(p=>p.id===value.providerId)?.protocol==='dsh-host') throw new Error('DSH delegated providers own their login; do not configure shadow accounts');
    if (typeof value.credentialRef !== 'string' || !AUTH.test(value.credentialRef)) throw new Error('Account requires env: or host: credentialRef');
    if (value.credentialRef.startsWith('driver:') && !value.credentialRef.startsWith('driver:'+value.providerId+':')) throw new Error('Driver credential reference must match its provider');
    if (value.credentialRef.startsWith('driver:') && providers.find(p=>p.id===value.providerId)?.protocol!=='native-channel') throw new Error('Driver credential references require native-channel protocol');
    if (providers.find(p=>p.id===value.providerId)?.protocol==='native-channel' && !value.credentialRef.startsWith('driver:')) throw new Error('Native channels require driver-owned credential references');
     return { id: id(value.id, 'account id'), providerId: value.providerId, credentialRef: value.credentialRef,
       enabled: value.enabled !== false, weight: int(value.weight, 1, 1, 100), autoCheckin: value.autoCheckin === true,
       ...(typeof value.displayName==='string'&&NAME.test(value.displayName)&&
         !/\b(?:bearer|wps_sid|access_token|password)\b/i.test(value.displayName)
         ?{displayName:value.displayName.slice(0,120)}:{}) };
  });
  unique(accounts, 'id', 'account');
  const accountsIds = new Set(accounts.map(a => a.id));
  const removedRoutes=new Set();
  const routes = (source.routes ?? []).flatMap(value=>{
    if(!Array.isArray(value?.tiers)||!value.tiers.some(t=>isRetiredProvider(t?.providerId)))return [value];
    const tiers=value.tiers.filter(t=>!isRetiredProvider(t?.providerId));
    if(!tiers.length){removedRoutes.add(value.id);return []}
    return [{...value,tiers,...(value.mode==='pinned'&&isRetiredProvider(value.tiers[0]?.providerId)?{enabled:false}:{})}];
  }).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid route');
    if (!['priority','pinned','free'].includes(value.mode ?? 'priority')) throw new Error('Invalid route mode');
    if (!Array.isArray(value.tiers) || !value.tiers.length || value.tiers.length > 50) throw new Error('Route must have 1–50 tiers');
    const tiers = value.tiers.map(tier => {
      if (!tier || typeof tier !== 'object' || !providerIds.has(tier.providerId) || typeof tier.model !== 'string' || !tier.model.trim()) throw new Error('Invalid route tier');
      const accountIds = tier.accountIds ?? [];
      if (!Array.isArray(accountIds) || accountIds.some(a => !accountsIds.has(a) || accounts.find(x=>x.id===a).providerId !== tier.providerId)) throw new Error('Tier account references must belong to its provider');
      return { providerId: tier.providerId, model: tier.model.trim(), free: tier.free === true, accountIds: [...new Set(accountIds)] };
    });
    return { id: id(value.id, 'route id'), name: typeof value.name === 'string' && NAME.test(value.name) ? value.name : value.id,
      mode: value.mode ?? 'priority', tiers, enabled: value.enabled !== false, maxSwitches: int(value.maxSwitches, 3, 0, 49),
      exhaustionCooldownMs: int(value.exhaustionCooldownMs, 21600000, 1000, 86400000) };
  });
  unique(routes, 'id', 'route');
  // User declarations are NEVER inferred from a model name. They must be an
  // explicit owner action and are stored separately from host credentials.
  const freeInput=source.freePool??{};
  if(!freeInput||typeof freeInput!=='object'||Array.isArray(freeInput))
    throw Error('Invalid AutoFree owner declarations');
  const providerOverrides=freeInput.providerIds??[];
  if(!Array.isArray(providerOverrides)||providerOverrides.length>80)
    throw Error('AutoFree provider overrides exceed safe limit');
  const freeProviderIds=[...new Set(providerOverrides.map(value=>
    id(value,'free provider id')))].filter(value=>value!=='native-router'
      &&!value.startsWith('native-router-source-')&&!isRetiredProvider(value));
  const modelOverrides=freeInput.models??[];
  if(!Array.isArray(modelOverrides)||modelOverrides.length>500)
    throw Error('AutoFree model overrides exceed safe limit');
  const freeModels=modelOverrides.filter(row=>!isRetiredProvider(row?.providerId)).map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.model!=='string'
      ||!row.model.trim()||row.model.length>160||/[\u0000-\u001f]/.test(row.model)
      ||typeof row.free!=='boolean')throw Error('Invalid explicit AutoFree model declaration');
    const providerId=id(row.providerId,'free model provider');
    if(providerId==='native-router'||providerId.startsWith('native-router-source-'))
      throw Error('AutoFree cannot include its own recursive provider');
    return {providerId,model:row.model.trim(),free:row.free};
  });
  const seenFree=new Set();
  for(const row of freeModels){
    const key=row.providerId+'\\u0000'+row.model;
    if(seenFree.has(key))throw Error('Duplicate AutoFree model declaration');
    seenFree.add(key);
  }
  // Provider-scoped owner allowlist. [] or absent means ALL discovered models.
  // A selected model is an exact ID, never inferred from a display label.
  const hostSelectionInput=source.hostModelSelection??{};
  if(!hostSelectionInput||typeof hostSelectionInput!=='object'
    ||Array.isArray(hostSelectionInput)||Object.keys(hostSelectionInput).length>160)
    throw Error('Invalid host model selection');
  const hostModelSelection={};
  for(const [providerId,models] of Object.entries(hostSelectionInput)){
    if(isRetiredProvider(providerId))continue;
    id(providerId,'host selection provider');
    if(providerId==='native-router'||providerId.startsWith('native-router-source-')
      ||!Array.isArray(models)||models.length>250)
      throw Error('Invalid host model selection');
    const cleaned=models.map(model=>{
      if(typeof model!=='string'||!model.trim()||model.length>160
        ||/[\u0000-\u001f]/.test(model))throw Error('Invalid selected host model');
      return model.trim();
    });
    const distinct=[...new Set(cleaned)];
    if(distinct.length)hostModelSelection[providerId]=distinct;
  }
  const channelsInput=source.checkin?.channels??{};
  if(!channelsInput||typeof channelsInput!=='object'||Array.isArray(channelsInput)
    ||Object.keys(channelsInput).length>100)throw Error('Invalid per-channel auto check-in');
  const checkinChannels={};
  for(const [providerId,enabled] of Object.entries(channelsInput)){
    if(isRetiredProvider(providerId))continue;
    id(providerId,'check-in channel');
    if(typeof enabled!=='boolean')throw Error('Invalid per-channel auto check-in setting');
    checkinChannels[providerId.replace(/^own_/,'')]=enabled;
  }
  // Old true channel presets were inert with global scheduling disabled.
  // Only an explicit new independent opt-in may activate those channels.
  const independentInput=source.checkin?.independentChannels??[];
  if(!Array.isArray(independentInput)||independentInput.length>100)
    throw Error('Invalid independently enabled check-in channels');
  const independentChannels=[...new Set(independentInput.map(value=>
    id(value,'independent check-in channel').replace(/^own_/,'')))].filter(value=>!isRetiredProvider(value));
  const hf = source.hostFailover ?? {};
  const checkinInput=source.checkin ?? {};
  const zone=typeof checkinInput.timeZone==='string'?checkinInput.timeZone:'Asia/Shanghai';
  try{new Intl.DateTimeFormat('en',{timeZone:zone})}catch{throw new Error('Invalid check-in timezone')}
  const runAt=checkinInput.runAt??'10:05';
  if(typeof runAt!=='string'||!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(runAt))throw Error('Invalid check-in time, expected HH:mm');
  return {
    version: 1, providers, accounts, routes,
    freePool:{providerIds:freeProviderIds,models:freeModels},
    hostModelSelection,
    embeddedPack:{enabled:source.embeddedPack?.enabled===true},
    sessionReuse:{
      enabled:source.sessionReuse?.enabled===true,
      linkedIds:Array.isArray(source.sessionReuse?.linkedIds)
        ?[...new Set(source.sessionReuse.linkedIds.filter(value=>typeof value==='string'&&ID.test(value)&&!retiredAccounts.has(value)))].slice(-200):[],
       ignoredIds:Array.isArray(source.sessionReuse?.ignoredIds)
         ?[...new Set(source.sessionReuse.ignoredIds.filter(value=>typeof value==='string'&&ID.test(value)&&!retiredAccounts.has(value)))].slice(-200):[],
       linkedOrigins:Object.fromEntries(Object.entries(
         source.sessionReuse?.linkedOrigins && typeof source.sessionReuse.linkedOrigins==='object' && !Array.isArray(source.sessionReuse.linkedOrigins)
           ?source.sessionReuse.linkedOrigins:{}).filter(([key,value])=>ID.test(key)&&accountsIds.has(key)
             &&['desktop-readonly','external-dsh-provider','own-source-pack'].includes(value)).slice(-200)),
    },
    checkin:{autoEnabled:checkinInput.autoEnabled===true,
      autoSourceAccounts:checkinInput.autoSourceAccounts!==false,
      channels:checkinChannels,independentChannels,timeZone:zone,runAt},
    hostFailover: {
      enabled: hf.enabled === true&&!(hf.mode==='pinned'&&retiredSelection(hf.priority?.[0],removedRoutes)), mode: ['off','pinned','free'].includes(hf.mode) ? hf.mode : 'off',
      priority: Array.isArray(hf.priority) ? hf.priority.filter(row=>!retiredSelection(row,removedRoutes)) : [], triggers: Array.isArray(hf.triggers) ? hf.triggers : undefined,
      maxSwitchesPerSession: int(hf.maxSwitchesPerSession, 3, 0, 50),
      exhaustionCooldownMs: int(hf.exhaustionCooldownMs, 21600000, 1000, 86400000),
       exhaustedRoutes: Object.fromEntries(Object.entries(hf.exhaustedRoutes && typeof hf.exhaustedRoutes==='object' && !Array.isArray(hf.exhaustedRoutes) ? hf.exhaustedRoutes : {}).filter(([key,value])=>typeof key==='string'&&key.length<=300&&!retiredRoute(key,removedRoutes)&&Number.isFinite(value)&&value>=0)),
       switchLogLimit:int(hf.switchLogLimit,20,1,100),
       switchLog:Array.isArray(hf.switchLog)?hf.switchLog.slice(-20).filter(x=>x&&typeof x==='object'&&
         Number.isFinite(x.at)&&typeof x.from==='string'&&typeof x.to==='string'&&
         typeof x.code==='string'&&!retiredRoute(x.from,removedRoutes)&&!retiredRoute(x.to,removedRoutes)).map(x=>({at:x.at,from:x.from.slice(0,200),
         to:x.to.slice(0,200),code:x.code.slice(0,40),reason:String(x.reason??'auto').slice(0,32)})):[],
    },
  };
}
// Global-off mode requires fresh channel-specific consent, never old presets.
export function channelAutoEnabled(config,providerId){
 if(isRetiredProvider(providerId))return false;
 const key=String(providerId??'').replace(/^own_/,'');
 const selected=config?.checkin?.channels?.[key];
 return config?.checkin?.autoEnabled===true?selected!==false:
   selected===true&&config?.checkin?.independentChannels?.includes(key)===true;
}

export function createConfigStore({ path = defaultConfigPath(), initial } = {}) {
  let current = initial !== undefined ? normalizeConfig(initial) : existsSync(path) ? normalizeConfig(JSON.parse(readFileSync(path,'utf8'))) : normalizeConfig({});
  return {
    path,
    get: () => structuredClone(current),
    replace(value) {
      const next = normalizeConfig(value);
      if(existsSync(path)){
        const original=readFileSync(path,'utf8');
        const previous=JSON.parse(original);
        if(previous.providers?.some(p=>isRetiredProvider(p?.id))||previous.accounts?.some(a=>isRetiredProvider(a?.providerId))){
          const backup=path+'.retired-channel-v1.bak';
          if(!existsSync(backup))writeFileSync(backup,original,{mode:0o600,flag:'wx'});
        }
      }
      const body = JSON.stringify(next, null, 2) + '\n';
      mkdirSync(dirname(path), { recursive: true });
       // A process can crash after creating its temp file. A fixed
       // pid-suffixed filename would make every later save fail EEXIST.
       // Every write uses a unique same-directory temp so rename stays atomic.
       const tmp = path + '.tmp-' + process.pid + '-' + randomUUID();
       try {
         writeFileSync(tmp, body, { mode: 0o600, flag: 'wx' });
          retryAtomicRename(tmp, path);       } catch (error) {
         try { unlinkSync(tmp) } catch {}
         throw error;
       }
       current = next;
      return this.get();
    },
  };
}
