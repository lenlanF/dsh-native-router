import {realpathSync} from 'node:fs';
import {win32} from 'node:path';
import * as workerThreads from 'node:worker_threads';

// Strict isolation gate for dev-injected ORIGINAL upstream snapshots and
// disposable E:\Temp acceptance tests. The bundled DSH-native derivative
// has its own state namespace and no gateway/auto-resume sidecar; it does
// not use this legacy experiment gate in an installed DSH Host.
const BASE='E:\\Temp';
const PREFIX='dsh-native-router-isolated-';
function canonical(value){
  if(typeof value!=='string'||!win32.isAbsolute(value)||! /^[a-zA-Z]:[\\/]/.test(value))return null;
  try{return win32.normalize(realpathSync.native(value)).replace(/[\\/]+$/,'').toLowerCase()}
  catch{return null}
}
export function channelPackIsolationReason(env,scope){
  if(env.DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE!=='1')
    return '须显式设置 DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE=1，且使用独立测试 Profile';
  const base=canonical(BASE),home=canonical(env.DSH_HOME),source=canonical(env.DSH_CHANNEL_PACK_STATE_DIR);
  if(!base||!home||!source)
    return 'DSH_HOME 与 DSH_CHANNEL_PACK_STATE_DIR 必须是 E:\\Temp 中已经创建的隔离目录';
  const relative=win32.relative(base,home);
  if(!relative.startsWith(PREFIX)||relative.includes('\\')||relative==='..'
    ||home!==source||win32.parse(home).root.toLowerCase()!=='e:\\')
    return '上游状态目录、DSH_HOME 必须指向同一个 E:\\Temp\\dsh-native-router-isolated-* 测试 Profile';
  let profile;
  // Cordis get(name) is STRICT by default and throws when an optional
  // service was never provided. Use the documented non-strict lookup.
  try{profile=typeof scope?.get==='function'?scope.get('profileContext',false):scope?.profileContext}
  catch{return '无法核验宿主 Profile，拒绝挂载渠道包'}
  if(profile?.home!==undefined&&canonical(profile.home)!==home)
    return '宿主 profileContext.home 与测试 DSH_HOME 不一致，拒绝挂载渠道包';
  return '';
}

// The pinned bundle embeds a newer Undici CacheStorage implementation which
// invokes node:worker_threads.markAsUncloneable during ESM import. Node 22.5
// crashes before pack.apply; Node 22.10 introduced this built-in API.
export function channelPackNodeRuntimeReason({
  nodeVersion=process.versions.node, markAsUncloneable=workerThreads.markAsUncloneable,
}={}){
  const match=/^(\d+)\.(\d+)(?:\.|$)/.exec(String(nodeVersion));
  if(!match)return '无法确认 Node.js 版本，拒绝加载来源渠道包';
  const major=Number(match[1]),minor=Number(match[2]);
  if(major<22||(major===22&&minor<10)||typeof markAsUncloneable!=='function')
    return '来源渠道包要求 Node.js 22.10+（worker_threads.markAsUncloneable）；当前运行时不兼容';
  return '';
}
