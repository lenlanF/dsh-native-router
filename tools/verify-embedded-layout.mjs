// Render the actual client.js stylesheet in installed Chrome at a DSH-like
// host viewport (1440px) with independently narrow settings panes.
// No DSH login, plugin installation, internet, credentials or production I/O.
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const chromeCandidates=[
 process.env.DSH_LAYOUT_CHROME,
 process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':null,
 process.platform==='win32'?'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':null,
 process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':null,
 process.platform!=='win32'?'/usr/bin/google-chrome':null,
 process.platform!=='win32'?'/usr/bin/chromium':null,
].filter(Boolean);
const chrome=chromeCandidates.find(existsSync);
if(!chrome){console.error('No local Chrome/Edge; embedded visual acceptance unavailable');process.exit(2)}
const source=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const found=source.match(/const UI_STYLES=`([\s\S]*?)`;/);
if(!found)throw Error('Cannot extract the real plugin stylesheet');
const css=found[1].replace(/\\n/g,'\n').replace(/\\"/g,'"');
const base=process.platform==='win32'?'E:\\Temp':tmpdir();
mkdirSync(base,{recursive:true});
const temp=mkdtempSync(join(base,'dsh-embedded-layout-'));
let failures=0;
try{
 for(const width of [320,560,720,1024]){
  const file=join(temp,'layout-'+width+'.html');
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
   *{box-sizing:border-box}
   html,body{margin:0;width:100%;background:#242426;color:#ddd;font-family:Arial,sans-serif}
   .outer{display:flex;width:${width+180}px;max-width:100%}
   .outer-rail{width:180px;flex:0 0 180px;height:720px;background:#292a2b;padding:10px}
   .pane{flex:0 0 ${width}px;width:${width}px;min-width:0;max-width:${width}px}
   ${css}</style></head><body>
   <div class="outer"><aside class="outer-rail">DSH 已有设置导航</aside>
   <section class="pane" id="pane"><div class="dnr-shell" id="plugin"
    style="width:100%;max-width:100%;min-width:0;padding:10px 8px 22px">
    <header class="dnr-header">聚合路由 · 渠道工作台</header>
    <div class="dnr-layout">
     <label class="dnr-mobile-nav"><span>切换功能</span><select aria-label="选择设置页面"><option>渠道账号</option></select></label>
     <nav class="dnr-rail" aria-label="聚合路由设置导航">
      <div class="dnr-nav-group">${Array.from({length:10},(_,i)=>'<button class="dnr-nav-button">模块'+(i+1)+'</button>').join('')}</div>
     </nav>
     <main class="dnr-main" id="main">
      <div class="dnr-page-head"><h3>渠道账号</h3><p>展示用户名、余额和积分</p></div>
      <div class="dnr-toolbar" id="toolbar">
       <div class="dnr-sync-status"><span class="dnr-sync-dot"></span>数据已同步<button class="dnr-button">刷新显示</button></div>
       <div class="dnr-savebar"><button class="dnr-button dnr-button-primary">保存配置</button><button class="dnr-button">重新读取</button></div>
      </div>
      <div class="dnr-page-body" id="body">
       <section class="dnr-panel" style="padding:12px;border:1px solid #555">
        <div class="dnr-panel-head"><strong>全部渠道 · 账号状态</strong><div>
         <button class="dnr-button">只读刷新账号数据</button><button class="dnr-button">逐账号验证</button></div></div>
         <div class="dnr-workspace-stats" id="stats">${['渠道','账号','已鉴权','已实测'].map((label,i)=>'<div class="dnr-workspace-stat"><span>'+label+'</span><strong>'+[15,12,12,4][i]+'</strong></div>').join('')}</div>
         <div class="dnr-workspace-filters" id="filters"><label><span>搜索渠道或账号</span><input type="search" style="width:100%;min-width:0;height:42px" placeholder="渠道、账号名称或登录方式"></label><label><span>筛选渠道</span><select style="width:100%;min-width:0;height:42px"><option>全部渠道</option><option>长名称渠道 · 2 个账号</option></select></label></div>
         <div class="dnr-filter-bar"><button class="dnr-button" aria-pressed="true">全部账号</button><button class="dnr-button">仅看异常</button><button class="dnr-button">有余额或积分</button><button class="dnr-button">已实测</button></div>
         <div class="dnr-filter-summary"><span>显示 15 个渠道 / 12 个账号</span><button class="dnr-button">清除筛选</button></div>
        <details class="dnr-channel-group" open><summary>WorkBuddy 国内 · 2 个账号<span class="dnr-channel-caption">鉴权通过 · 推理待实测</span></summary>
         <div class="dnr-disclosure-body"><div class="dnr-account-card" id="account">
          <div class="dnr-account-head"><div class="dnr-account-identity"><span class="dnr-account-symbol">W</span><div class="dnr-account-title"><strong class="dnr-account-name">正式账户名称</strong><span class="dnr-account-hint">独立持有授权</span></div></div><span class="dnr-state-tag" data-tone="good">鉴权通过</span></div>
          <div class="dnr-account-metrics"><div class="dnr-account-metric"><span>总可用积分</span><strong class="dnr-account-metric-value">2,880 积分</strong><span>官方核实时间</span></div>
          <div class="dnr-account-metric"><span>会员自然恢复额度</span><strong>85% 剩余</strong></div></div>
           <div class="dnr-account-actions"><div class="dnr-action-group"><button class="dnr-button dnr-button-primary" id="accountAction">刷新账户资料</button></div><div class="dnr-action-group"><button class="dnr-button">停用</button><button class="dnr-button dnr-button-danger">解绑</button></div></div>
          </div></div></details>
          <div class="dnr-model-row" id="modelRow"><div><strong>WorkBuddy / very-long-official-model-identifier-without-spaces</strong><div>独立渠道 · 适用 2 个账号</div></div><span class="dnr-model-evidence dnr-state-tag" data-tone="good">来源明确标记免费</span></div>
        <div class="dnr-activity-scroll"><table class="dnr-activity-table" id="activity"><thead><tr><th>活动名称</th><th>免费奖励</th><th>是否有效</th><th>到期时间</th><th>执行状态</th></tr></thead><tbody><tr>
         <td data-label="活动名称">免费活动名称与账号</td><td data-label="免费奖励">200 积分</td><td data-label="是否有效">已完成</td><td data-label="到期时间">2026-11-23</td><td data-label="执行状态">官方到账</td></tr></tbody></table></div>
       </section>
      </div>
     </main>
    </div></div></section>
   </div><pre id="layout-report"></pre>
   <script>window.addEventListener('load',()=>{
    const e=id=>document.getElementById(id),rect=id=>e(id).getBoundingClientRect();
    const pane=rect('pane'),main=rect('main'),account=rect('account'),table=rect('activity');
    const summary={
      pane:Math.round(pane.width), main:Math.round(main.width),
      nav:getComputedStyle(document.querySelector('.dnr-rail')).display,
      compact:getComputedStyle(document.querySelector('.dnr-mobile-nav')).display,
      toolbarPosition:getComputedStyle(e('toolbar')).position,
      savePosition:getComputedStyle(document.querySelector('.dnr-savebar')).position,
      toolbarAbove:rect('toolbar').bottom<=rect('body').top+2,
      paneOverflow:e('pane').scrollWidth>e('pane').clientWidth+1,
      mainOverflow:e('main').scrollWidth>e('main').clientWidth+1,
      account:Math.round(account.width),
      activity:Math.round(table.width),
      activityOverflow:table.width>pane.width+1,
      filterColumns:getComputedStyle(e('filters')).gridTemplateColumns.split(' ').length,
      statColumns:getComputedStyle(e('stats')).gridTemplateColumns.split(' ').length,
      actionHeight:rect('accountAction').height,
      modelColumns:getComputedStyle(e('modelRow')).gridTemplateColumns.split(' ').length,
      modelOverflow:e('modelRow').scrollWidth>e('modelRow').clientWidth+1,
      filtersOverflow:e('filters').scrollWidth>e('filters').clientWidth+1
    };
    e('layout-report').textContent='DSH_LAYOUT_REPORT:'+JSON.stringify(summary);
   });<\/script></body></html>`;
  writeFileSync(file,html,'utf8');
  const proc=spawnSync(chrome,['--headless=new','--disable-gpu','--disable-extensions',
    '--no-first-run','--no-default-browser-check','--hide-scrollbars',
    '--user-data-dir='+join(temp,'chrome-'+width),
    '--window-size=1440,900','--dump-dom',pathToFileURL(file).href],
    {timeout:24000,maxBuffer:5e6,encoding:'utf8'});
  const match=proc.stdout?.match(/DSH_LAYOUT_REPORT:(\{[^<\n]+\})/);
  if(!match){
    failures++;console.error('FAIL '+width+' Chrome no measurement; '+String(proc.stderr).slice(-450));
    continue;
  }
  const summary=JSON.parse(match[1]),small=width<=850;
  const okay=summary.pane===width&&summary.main>=width-40
    &&!summary.paneOverflow&&!summary.mainOverflow
    &&summary.toolbarAbove&&summary.savePosition==='static'
    &&summary.nav===(small?'none':'flex')
    &&summary.compact===(small?'flex':'none')
    &&!summary.activityOverflow&&!summary.modelOverflow&&!summary.filtersOverflow
    &&summary.filterColumns===(width<=560?1:2)
    &&summary.statColumns>=(width<=560?2:3)
    &&summary.modelColumns===(width<=560?1:2)
    &&summary.actionHeight>=(width<=560?44:36);
  console.log((okay?'PASS ':'FAIL ')+width+'px embedded pane '+JSON.stringify(summary));
  if(!okay)failures++;
 }
}finally{rmSync(temp,{recursive:true,force:true})}
if(failures)process.exitCode=1;
