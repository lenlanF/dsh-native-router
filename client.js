window.__ModuleLoader__.load({
  id:'dsh-native-router',
  factory:(require)=>{
    const React=require('react');
    const h=React.createElement;
    const {useState,useEffect,useCallback}=React;
    const NS='dsh-native-router',URL='/api/plugins/dsh-native-router';

    // WorkBuddy 5.24.14-inspired compact Host-native surfaces. Strictly
    // scoped: never alter other DSH settings or source plugin controls.
    const UI_STYLES=`
.dnr-shell{--dnr-border:var(--dsw-alias-border-l2,rgba(130,144,166,.27));--dnr-surface:var(--dsw-alias-bg-layer-2,rgba(120,138,162,.055));--dnr-elevated:var(--dsw-alias-bg-layer-3,rgba(120,138,162,.09));--dnr-ink:var(--dsw-alias-label-primary,var(--text,inherit));--dnr-muted:var(--dsw-alias-label-secondary,inherit);--dnr-brand:var(--dsw-alias-brand-primary,#5686fe);color:var(--dnr-ink);font-size:13px;line-height:1.55}
.dnr-shell,.dnr-shell *,.dnr-shell *::before,.dnr-shell *::after{box-sizing:border-box}
.dnr-shell button,.dnr-shell input,.dnr-shell select,.dnr-shell textarea{font:inherit}
.dnr-shell button{touch-action:manipulation}
.dnr-shell button:focus-visible,.dnr-shell input:focus-visible,.dnr-shell select:focus-visible,.dnr-shell textarea:focus-visible,.dnr-shell summary:focus-visible{outline:2px solid var(--dnr-brand);outline-offset:2px}
.dnr-shell .dnr-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:0 0 11px;border-bottom:1px solid var(--dnr-border)}
.dnr-shell .dnr-header-note{color:var(--dnr-muted);font-size:12px;line-height:1.5}
.dnr-shell .dnr-version{border:1px solid var(--dnr-border);border-radius:8px;padding:3px 8px;color:var(--dnr-muted);font-variant-numeric:tabular-nums;font-size:11px;white-space:nowrap}
.dnr-shell .dnr-checkin-tags{display:flex;flex-wrap:wrap;gap:7px;min-width:0}
.dnr-shell .dnr-checkin-tag{display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;min-height:31px;padding:5px 9px;border-radius:8px;border:1px solid var(--dnr-border);background:var(--dnr-elevated);color:var(--dnr-ink);cursor:pointer;font-size:11.5px;line-height:1.35}
.dnr-shell .dnr-checkin-tag strong{font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dnr-shell .dnr-checkin-tag[data-confirmed="yes"] strong{color:var(--dsw-alias-positive-primary,#44b790)}
.dnr-shell .dnr-checkin-tag:hover,.dnr-shell .dnr-checkin-tag[aria-pressed="true"]{border-color:var(--dnr-brand);background:var(--dnr-surface)}

.dnr-shell .dnr-layout{display:grid;grid-template-columns:184px minmax(0,1fr);gap:14px;align-items:start}
.dnr-shell .dnr-rail{position:sticky;top:12px;min-width:0;max-height:calc(100vh - 24px);overflow-y:auto;padding:8px;background:var(--dnr-surface);border:1px solid var(--dnr-border);border-radius:11px;scrollbar-width:thin}
.dnr-shell .dnr-nav-group+.dnr-nav-group{border-top:1px solid var(--dnr-border);margin-top:7px;padding-top:7px}
.dnr-shell .dnr-group-title{font-size:10px;letter-spacing:.055em;font-weight:700;opacity:.68;padding:7px 9px 5px}
.dnr-shell .dnr-nav-button{display:flex;align-items:center;width:100%;min-width:0;text-align:left;border:1px solid transparent;border-radius:8px;min-height:35px;padding:7px 10px;color:var(--dnr-muted);background:transparent;font-size:12.5px;cursor:pointer;transition:background-color .14s,border-color .14s,color .14s}
.dnr-shell .dnr-nav-button:hover{background:var(--dnr-elevated);color:var(--dnr-ink)}
.dnr-shell .dnr-nav-button[aria-current="page"]{background:var(--dnr-elevated);border-color:var(--dnr-brand);color:var(--dnr-ink);font-weight:700}
.dnr-shell .dnr-main{min-width:0}
.dnr-shell .dnr-page-head{margin:1px 0 12px;min-width:0}
.dnr-shell .dnr-page-head h3{font-size:17px;font-weight:700;margin:0 0 3px}
.dnr-shell .dnr-page-head p{font-size:12px;color:var(--dnr-muted);margin:0;line-height:1.5}
.dnr-shell .dnr-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:0;min-height:34px;border:1px solid var(--dnr-border);border-radius:7px;padding:5px 10px;background:transparent;color:var(--dnr-ink);font-size:12px;font-weight:550;line-height:1.4;cursor:pointer;transition:background-color .14s,border-color .14s}
.dnr-shell .dnr-button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#888);background:var(--dnr-elevated)}
.dnr-shell .dnr-button:active:not(:disabled){background:var(--dnr-surface)}
.dnr-shell .dnr-button:disabled{opacity:.43;cursor:not-allowed}
.dnr-shell .dnr-button-primary{border-color:var(--dnr-brand);background:var(--dnr-brand);color:var(--dsw-alias-bg-layer-1,#fff);font-weight:700}
.dnr-shell .dnr-button-primary:hover:not(:disabled){filter:brightness(1.09);background:var(--dnr-brand);border-color:var(--dnr-brand)}
.dnr-shell .dnr-panel{min-width:0;overflow-wrap:anywhere}
.dnr-shell .dnr-panel-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:9px;min-width:0}
.dnr-shell .dnr-panel-head>strong{font-size:13px;font-weight:700;min-width:0}
.dnr-shell .dnr-panel-head>div{max-width:100%;display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.dnr-shell .dnr-input-field{min-width:0;max-width:100%}
.dnr-shell .dnr-input-field input,.dnr-shell .dnr-input-field select{min-width:0;text-overflow:ellipsis}
.dnr-shell .dnr-subtab:hover:not([aria-selected="true"]){background:var(--dnr-elevated)}
.dnr-shell .dnr-source-group{border-top:1px solid var(--dnr-border)}
.dnr-shell .dnr-source-entry{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dnr-border);padding:9px 0;min-width:0}
.dnr-shell .dnr-source-entry>div{min-width:0}
.dnr-shell .dnr-source-entry .dnr-action-list{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dnr-shell .dnr-savebar{position:sticky;z-index:4;bottom:0;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:9px 10px;margin-top:10px;border:1px solid var(--dnr-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,var(--background,#242528));box-shadow:0 -4px 14px rgba(0,0,0,.07)}
.dnr-shell .dnr-savebar .dnr-save-note{margin-left:auto;min-width:0;color:var(--dnr-muted);font-size:11px}
.dnr-shell .dnr-savebar details{max-width:100%}
.dnr-shell .dnr-savebar summary{cursor:pointer}
.dnr-shell .dnr-savebar details p{max-width:480px;margin:5px 0}
.dnr-shell .dnr-status-inline{color:var(--dnr-muted);font-size:11px}
.dnr-shell .dnr-section-title{font-size:13px;font-weight:700;margin:10px 0}
.dnr-shell .dnr-disclosure{margin-bottom:9px;border:1px solid var(--dnr-border);border-radius:10px;background:var(--dnr-surface);min-width:0}
.dnr-shell .dnr-disclosure-summary{padding:10px 13px;font-size:13px;font-weight:650;cursor:pointer;overflow-wrap:anywhere}
.dnr-shell .dnr-disclosure[open]>.dnr-disclosure-summary{border-bottom:1px solid var(--dnr-border)}
.dnr-shell .dnr-disclosure-body{padding:10px 12px 12px;min-width:0}
.dnr-shell .dnr-route-tags{display:flex;flex-wrap:wrap;gap:7px;align-items:flex-start}
.dnr-shell .dnr-route-chip{display:inline-flex;gap:6px;align-items:center;max-width:100%;min-width:0;border:1px solid var(--dnr-border);border-radius:8px;padding:6px 9px;font-size:12px;overflow-wrap:anywhere;background:var(--dnr-surface)}
.dnr-shell .dnr-route-chip[data-state="verified"]{border-color:#32a578}
.dnr-shell .dnr-route-chip[data-state="connected"]{border-color:var(--dnr-brand)}
.dnr-shell .dnr-route-chip[data-state="pending"]{opacity:.76}
.dnr-shell .dnr-toast-stack{position:fixed;right:18px;top:20px;z-index:9999;width:min(380px,calc(100vw - 36px));display:flex;flex-direction:column;gap:8px;pointer-events:none}
.dnr-shell .dnr-toast{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;border-radius:10px;border:1px solid var(--dnr-border);background:var(--dsw-alias-bg-layer-1,#252933);box-shadow:0 8px 22px rgba(0,0,0,.18);pointer-events:auto;overflow-wrap:anywhere}
.dnr-shell .dnr-toast[data-kind="error"]{border-color:#be6670}
.dnr-shell .dnr-toast button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:18px;line-height:1;padding:3px}
.dnr-shell .dnr-metric-link:hover{border-color:var(--dnr-brand)!important;background:var(--dnr-elevated)!important}
.dnr-shell .dnr-panel details summary{cursor:pointer}
.dnr-shell .dnr-panel details[open]>summary{margin-bottom:8px}
.dnr-shell .dnr-mobile-nav{display:none}
.dnr-shell .dnr-mobile-nav select{min-width:0;width:100%;min-height:39px;border:1px solid var(--dnr-border);border-radius:8px;background:var(--dnr-elevated);color:var(--dnr-ink);padding:7px 10px}
.dnr-shell .dnr-account-card{min-width:0;border:1px solid var(--dnr-border);border-radius:12px;background:var(--dnr-surface);padding:14px 16px;margin:11px 0;overflow-wrap:anywhere}
.dnr-shell .dnr-account-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;min-width:0}
.dnr-shell .dnr-account-identity{display:flex;gap:10px;align-items:center;min-width:0;flex:1}
.dnr-shell .dnr-account-symbol{display:inline-grid;place-items:center;flex:0 0 39px;width:39px;height:39px;border:1px solid var(--dnr-border);border-radius:11px;background:var(--dnr-elevated);font-size:17px;font-weight:750;color:var(--dnr-ink)}
.dnr-shell .dnr-account-title{display:flex;flex-direction:column;gap:2px;min-width:0}
.dnr-shell .dnr-account-name{font-size:15px;font-weight:750;line-height:1.35;overflow-wrap:anywhere}
.dnr-shell .dnr-account-hint{font-size:12px;color:var(--dnr-muted);line-height:1.45}
.dnr-shell .dnr-account-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,175px),1fr));gap:8px;margin-bottom:11px}
.dnr-shell .dnr-account-metric{min-width:0;display:flex;flex-direction:column;gap:4px;padding:9px 11px;border:1px solid var(--dnr-border);border-radius:9px;background:var(--dnr-elevated)}
.dnr-shell .dnr-account-metric-label{font-size:11px;line-height:1.45;color:var(--dnr-muted);font-weight:600}
.dnr-shell .dnr-account-metric-value{font-size:16px;line-height:1.35;font-weight:750;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dnr-shell .dnr-account-metric-note{font-size:11px;color:var(--dnr-muted);line-height:1.45}
.dnr-shell .dnr-account-hints{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:9px;color:var(--dnr-muted);font-size:11px}
.dnr-shell .dnr-account-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px}
.dnr-shell .dnr-account-actions .dnr-button{min-height:40px;padding:7px 12px}
.dnr-shell .dnr-account-card details{border-top:1px solid var(--dnr-border);margin:10px 0 0;padding-top:9px}
.dnr-shell .dnr-account-card details summary{font-size:12px;color:var(--dnr-muted);min-height:32px;display:flex;align-items:center}
.dnr-shell .dnr-activity-scroll{overflow-x:auto;border:1px solid var(--dnr-border);border-radius:9px;max-width:100%}\n.dnr-shell .dnr-activity-table{width:100%;min-width:645px;border-collapse:collapse;font-size:12px;line-height:1.55}\n.dnr-shell .dnr-activity-table th{text-align:left;background:var(--dnr-elevated);color:var(--dnr-muted);font-weight:700;font-size:11px;white-space:nowrap}\n.dnr-shell .dnr-activity-table th,.dnr-shell .dnr-activity-table td{padding:10px 12px;border-bottom:1px solid var(--dnr-border);vertical-align:middle}\n.dnr-shell .dnr-activity-table tr:last-child td{border-bottom:0}\n.dnr-shell .dnr-activity-table td:first-child{min-width:175px}\n.dnr-shell .dnr-activity-account{display:block;color:var(--dnr-muted);font-size:11px;margin-top:2px;overflow-wrap:anywhere}\n.dnr-shell .dnr-activity-number{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}\n.dnr-shell .dnr-activity-state{display:inline-flex;border-radius:7px;border:1px solid var(--dnr-border);padding:2px 7px;white-space:nowrap}\n.dnr-shell .dnr-activity-state[data-validity='valid']{border-color:var(--dsw-alias-positive-primary,#44b790)}\n.dnr-shell .dnr-activity-state[data-validity='unverified']{color:var(--dnr-muted)}\n.dnr-shell .dnr-activity-empty{text-align:center!important;color:var(--dnr-muted);padding:18px!important}\n@media(max-width:520px){.dnr-shell .dnr-account-card{padding:12px}.dnr-shell .dnr-account-head{gap:6px}.dnr-shell .dnr-account-metrics{grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr))}.dnr-shell .dnr-account-actions .dnr-button{flex:1 1 130px}}
@media (max-width:920px){.dnr-shell .dnr-layout{grid-template-columns:156px minmax(0,1fr);gap:9px}.dnr-shell .dnr-rail{padding:5px}.dnr-shell .dnr-nav-button{padding:6px 8px}}
@media (max-width:760px){.dnr-shell .dnr-layout{display:block}.dnr-shell .dnr-rail{display:none}.dnr-shell .dnr-mobile-nav{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}.dnr-shell .dnr-mobile-nav span{color:var(--dnr-muted);font-size:11px}.dnr-shell .dnr-panel-head{align-items:flex-start}.dnr-shell .dnr-savebar{position:sticky;bottom:0}}
@media (max-width:520px){.dnr-shell .dnr-nav-group{grid-template-columns:repeat(2,minmax(0,1fr))}.dnr-shell .dnr-savebar{gap:6px}.dnr-shell .dnr-savebar .dnr-save-note{flex-basis:100%;margin-left:0}.dnr-shell .dnr-header-note{flex-basis:100%}.dnr-shell .dnr-panel-head{display:block}.dnr-shell .dnr-panel-head>div{margin-top:7px}}
@media (prefers-reduced-motion:reduce){.dnr-shell button{transition:none!important}}
`;
    const css={
      root:{color:'var(--dsw-alias-label-primary,var(--text,inherit))',maxWidth:1400,margin:'0 auto',padding:'12px clamp(8px,1.7vw,20px) 40px',fontSize:13,lineHeight:1.55},
      title:{fontSize:21,fontWeight:740,letterSpacing:'-.025em',margin:'0 0 3px'},
      caption:{fontSize:12,opacity:.78,lineHeight:1.55,margin:'0 0 10px'},
      tabbar:{display:'flex',gap:6,flexWrap:'wrap',padding:'0 0 10px',borderBottom:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.27))',marginBottom:11},
      tab:{border:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.27))',borderRadius:8,padding:'6px 11px',minHeight:34,cursor:'pointer',background:'var(--dsw-alias-bg-layer-3,rgba(128,140,160,.04))',color:'inherit',font:'inherit',fontSize:12},
      chosen:{background:'var(--dsw-alias-bg-layer-2,rgba(69,124,228,.15))',borderColor:'var(--dsw-alias-brand-primary,#5686fe)',fontWeight:700},
      card:{border:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.27))',borderRadius:11,padding:'12px 13px',marginBottom:10,background:'var(--dsw-alias-bg-layer-2,rgba(128,140,160,.055))'},
      line:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:9,minWidth:0},
      field:{display:'flex',gap:4,flexDirection:'column',flex:'1 1 170px',minWidth:0,maxWidth:'100%'},
      input:{padding:'7px 10px',minHeight:35,borderRadius:7,border:'1px solid var(--dsw-alias-border-l2,rgba(120,140,160,.38))',color:'inherit',background:'var(--dsw-alias-bg-layer-3,transparent)',font:'inherit',fontSize:12,width:'100%',minWidth:0,maxWidth:'100%',boxSizing:'border-box'},
      btn:{padding:'5px 10px',minHeight:34,borderRadius:7,border:'1px solid var(--dsw-alias-border-l2,rgba(120,140,160,.38))',color:'inherit',cursor:'pointer',font:'inherit'},
      primary:{background:'var(--dsw-alias-brand-primary,#5686fe)',fontWeight:700},
      error:{padding:10,borderRadius:8,border:'1px solid #c45b64',marginBottom:10,overflowWrap:'anywhere'},
      success:{padding:10,borderRadius:8,border:'1px solid var(--dsw-alias-brand-primary,#5686fe)',marginBottom:10,overflowWrap:'anywhere'},
      small:{fontSize:12,opacity:.83,lineHeight:1.5,overflowWrap:'anywhere'},
      overline:{fontSize:10,fontWeight:720,letterSpacing:'.08em',opacity:.7},
      hero:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',padding:'13px 16px',marginBottom:10,borderRadius:11,background:'var(--dsw-alias-bg-layer-2,rgba(128,140,160,.055))',border:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.27))'},
      metrics:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,145px),1fr))',gap:9,marginBottom:10},
      metric:{minWidth:0,display:'flex',flexDirection:'column',alignItems:'flex-start',gap:4,padding:'11px 12px',border:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.27))',borderRadius:9,background:'var(--dsw-alias-bg-layer-2,rgba(128,140,160,.055))'},
      doubleGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:9},
      itemRow:{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:7,padding:'8px 0',borderBottom:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.22))',minWidth:0},
      mutedTag:{padding:'2px 7px',borderRadius:7,border:'1px solid var(--dsw-alias-border-l2,rgba(130,144,166,.31))',fontSize:11,opacity:.82,maxWidth:'100%',overflowWrap:'anywhere'},
    };
    function TextField({label,value,onChange,placeholder,width}){
      return h('label',{className:'dnr-input-field',style:{...css.field,...(width?{flex:width}:{})}},
        h('span',{style:css.small},label),
        h('input',{style:css.input,value:value??'',placeholder,onChange:e=>onChange(e.target.value)}));
    }
    function Toggle({label,value,onChange}){
      return h('label',{style:{...css.line,marginBottom:0,cursor:'pointer',maxWidth:'100%',whiteSpace:'normal'}},
        h('input',{type:'checkbox',checked:!!value,onChange:e=>onChange(e.target.checked)}),
        h('span',{style:{minWidth:0,overflowWrap:'anywhere'}},label));
    }
    function Select({label,value,onChange,options}){
      return h('label',{className:'dnr-input-field',style:css.field},h('span',{style:css.small},label),
        h('select',{style:css.input,value:value??'',onChange:e=>onChange(e.target.value)},
          options.map(x=>h('option',{key:x.value,value:x.value},x.label))));
    }
    function Button({children,onClick,kind='normal',disabled=false,title,ariaLabel}){
      const isText=typeof children==='string'||typeof children==='number';
      return h('button',{type:'button',className:'dnr-button'+(kind==='primary'?' dnr-button-primary':''),
        title:title??(isText?String(children):undefined),
        'aria-label':ariaLabel??(isText?String(children):undefined),onClick,disabled},children);
    }
    function Panel({title,children,actions}){
      return h('section',{className:'dnr-panel',style:css.card},
        h('div',{className:'dnr-panel-head'},
          h('strong',null,title),actions),children);
    }
    function DisclosurePanel({title,children,actions,initiallyOpen=false}){
      return h('details',{className:'dnr-disclosure',open:initiallyOpen},
        h('summary',{className:'dnr-disclosure-summary'},title),
        h('div',{className:'dnr-disclosure-body'},
          actions?h('div',{style:{...css.line,justifyContent:'flex-end'}},actions):null,
          children));
    }
    function Section({title,children}){
      return h('section',{style:{minWidth:0}},h('h3',{className:'dnr-section-title'},title),children);
    }

    // Reuse the upstream channel RPC inside THIS DSH plugin's namespace.
    // No external server or standalone login proxy is required.
    const SOURCE_RPC='/api/dsh-native-router/channel-pack';
    const SOURCE_CLAIM_EXCLUDED=new Set(['workbuddy','cline','gemini','raccoon']);
    function safeSourceLoginUrl(value){
      if(typeof value!=='string'||value.length>2048)return '';
      try{
        const parsed=new window.URL(value);
        if(parsed.username||parsed.password)return '';
        if(parsed.protocol==='https:')return parsed.href;
        if(parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))
          return parsed.href;
      }catch{}
      return '';
    }
    const accountLabels={online:'鉴权通过',recently_verified:'上次通过 · 待复核',not_checked:'尚未校验',checking:'检查中',
       pending:'待来源确认',expired:'登录失效',limited:'限流中',error:'连接检查异常',disabled:'已停用',provider_disabled:'渠道已停用'};    const checkinLabels={success:'今日已签到',failed:'签到失败',pending_confirmation:'等待服务端确认',
      no_task:'今日无签到任务',client_required:'需官方客户端操作',unsupported:'待适配',
      not_run:'今日未签到',running:'执行中'};
    function StateTag({value,kind='account'}){
      const good=value==='online'||value==='success';
      const warn=['pending_confirmation','limited','not_run','not_checked','checking','running','recently_verified'].includes(value);
      return h('span',{style:{borderRadius:99,padding:'3px 9px',fontSize:11,border:'1px solid '+(good?'#39a777':warn?'#b89237':'rgba(140,140,150,.55)'),
        color:good?'#38b87a':warn?'#c29d44':'inherit',whiteSpace:'nowrap'}},
        kind==='checkin'?(checkinLabels[value]||value):(accountLabels[value]||value));
    }
    function EmbeddedPackConsole({pack,upstream,channelCatalog,run,busy,modelProvider,setModelProvider,onModels,modelBusy,models,onSourceLogin,onSourcePoll,onSourceDismissLogin,pendingLogin,onSourceRefresh,onSourceReuseLoomy,sourceBusy,loomySmsPhone,onLoomySmsPhone,loomySmsCode,onLoomySmsCode,loomySmsSent,onLoomySmsSend,onLoomySmsSubmit}){
      const rows=upstream?.accounts||[],live=pack?.state==='mounted'&&pack?.rpcReady===true;
       const sourceChannels=pack?.channels||[],selectedSource=sourceChannels.includes(modelProvider)
          ?modelProvider:sourceChannels[0]||'';
      const visibleSources=sourceChannels.map(id=>{
        const linked=rows.filter(account=>account.providerId===id);
        return {id,name:channelCatalog?.find(c=>c.id===id)?.name||id,
          count:linked.length,
          verified:linked.filter(account=>account.enabled===true&&account.connectionState==='online').length,
          ready:pack?.modelAdapterReady?.includes(id)===true,
          blocked:pack?.modelAdapterUnready?.includes(id)===true,
          pending:pendingLogin?.providerId===id};
      }).sort((a,b)=>(b.count>0)-(a.count>0)||a.name.localeCompare(b.name,'zh-CN'));
      const packLabel={disabled:'默认关闭',blocked:'安全门禁阻止',waiting_host_services:'等待宿主',loading:'加载中',mounted:live?'自主登录已就绪':'渠道已挂载，登录接口等待中',failed:'挂载失败',host_disposed:'宿主已释放',disposed:'已释放',unavailable:'不可用'}[pack?.state]||'状态未知';
       return h(Panel,{title:'渠道授权池 · 自主登录与原授权接管'},
        h('div',{style:css.line},
          h('strong',null,packLabel),
           h('span',{style:css.mutedTag},'可自主授权 '+(pack?.channelCount??13)+' 个'),
           pack?.state==='mounted'?h('span',{style:css.mutedTag},
             '模型路由 '+(pack?.modelAdapterReady?.length??0)+'/13 已就绪'):null),
         pack?.reason?h('p',{role:pack?.state==='failed'?'alert':undefined,style:css.small},
           pack.reason+(pack?.errorStage?'（失败阶段：'+pack.errorStage+'）':'')+
             (pack?.sourcePhase?'（内部步骤：'+pack.sourcePhase+'）':'')+
             (pack?.sourceErrorLocation?'（定位：'+pack.sourceErrorLocation+' / '+(pack?.sourceErrorType||'Error')+'）':'')):null,
         pack?.state==='mounted'&&pack?.modelAdapterUnready?.length?h('details',null,
           h('summary',{style:{cursor:'pointer',fontSize:12}},
             '模型适配器 '+pack.modelAdapterUnready.length+' 个未就绪；自主扫码/网页登录仍可继续'),
           pack.modelAdapterUnready.map(id=>h('div',{key:id,style:css.small},
             id+' · '+(pack?.modelAdapterUnreadyReasons?.[id]||'unknown')))):null,
          h('p',{style:css.small},'自主扫码或网页授权新账号，原渠道插件与本插件互不覆盖。'),
          sourceChannels.length?h('div',{style:{...css.card,padding:10}},
            h('div',{style:{...css.line,justifyContent:'space-between'}},
              h('strong',null,'全部独立来源 · '+sourceChannels.length+' 渠道'),
              h('span',{style:css.small},'已登记账号和已鉴权账号分开计数，空渠道不代表授权成功')),
            h('div',{style:{maxHeight:390,overflowY:'auto',scrollbarWidth:'thin'}},
              visibleSources.map(item=>h('div',{key:item.id,'data-source-provider':item.id,
                style:{...css.itemRow,gap:9}},
                h('div',{style:{flex:'1 1 170px',minWidth:0}},
                  h('div',{style:{...css.line,marginBottom:2}},
                    h('strong',null,item.name),
                    h('span',{style:css.small},item.id)),
                  h('div',{style:{...css.line,marginBottom:0}},
                    h('span',{style:css.mutedTag},upstream?.state!=='ready'?'账号池尚未读取':
                      item.count===0?'尚无独立账号':'登记 '+item.count+' 个 / 官方鉴权 '+item.verified+' 个'),
                    h('span',{style:css.mutedTag},item.ready?'适配器已就绪':
                      item.blocked?'适配器异常':'模型适配器待确认'),
                    item.pending?h('span',{style:css.mutedTag},'授权待确认'):null)),
                h('div',{className:'dnr-source-login-actions',style:{...css.line,marginBottom:0}},
                  h(Button,{disabled:!live||!!busy||!!sourceBusy,
                    title:'选择 '+item.name+' 查询模型',
                    onClick:()=>setModelProvider(item.id)},'选择'),
                  h(Button,{disabled:!live||!!busy||!!sourceBusy||!!pendingLogin,
                    title:'在本插件自有来源池授权 '+item.name,
                    onClick:()=>onSourceLogin(item.id)},'自主登录')))))):null,
         pack?.skippedProviders?.length?h('details',null,
           h('summary',{style:{cursor:'pointer',fontSize:12}},
             '宿主已有 '+pack.skippedProviders.length+' 个同名原渠道 · 自主登录仍可用'),
           h('p',{style:css.small},pack.skippedProviders.join('、')+'：原插件可继续复用，此处可自主登录到独立账号池，模型调用不会覆盖原插件。')):null,        live?h('div',null,
          h('div',{style:css.line},
            h(Select,{label:'来源渠道',value:selectedSource,onChange:setModelProvider,
              options:sourceChannels.map(id=>({value:id,label:
                (channelCatalog?.find(c=>c.id===id)?.name||id)+' · '+id}))}),
            h(Button,{disabled:!selectedSource||!!busy||!!modelBusy||!!sourceBusy,onClick:()=>onModels(selectedSource)},
              modelBusy?'模型查询中…':'查询模型'),
             h(Button,{disabled:!selectedSource||!!busy||!!sourceBusy||!!pendingLogin,onClick:()=>onSourceLogin(selectedSource)},'发起扫码/网页登录')),
          pendingLogin?h('div',{style:{...css.card,padding:10}},
            h('span',{style:css.small},pendingLogin.mode==='sms-reauth'
              ?'现有 Loomy 账号 · 原账号重新授权，不会创建重复账号'
              :'待授权渠道：'+pendingLogin.providerId+' / '+pendingLogin.accountId),
            pendingLogin.mode==='sms-reauth'?null:pendingLogin.loginUrl?h('div',{style:css.line},
              h('a',{href:pendingLogin.loginUrl,target:'_blank',rel:'noopener noreferrer'},
                '打开授权链接（先核对域名）')):h('p',{style:css.small},'来源未提供安全授权链接，不能自动打开'),
             pendingLogin.mode==='sms-reauth'?null:h(Button,{disabled:!!sourceBusy,onClick:onSourcePoll},'检查登录结果'),
             h(Button,{disabled:!!sourceBusy,onClick:onSourceDismissLogin,
               title:'只结束本页面的授权跟踪，不移除或退出渠道账号'},'结束本次授权跟踪')):null,
          pendingLogin?.providerId==='loomy'?h('div',{style:{...css.card,padding:10}},
            h('p',{style:css.small},'微信扫码不可用时，可使用 Loomy 官方短信验证码备用登录；短信仅用于这次账号授权。'),
            h('div',{style:css.line},
              h('input',{type:'tel',inputMode:'numeric',autoComplete:'tel',maxLength:11,
                'aria-label':'Loomy 手机号',placeholder:'11 位手机号',style:css.input,
                value:loomySmsPhone,onChange:e=>onLoomySmsPhone(e.target.value)}),
              h(Button,{disabled:!!sourceBusy||!/^1[3-9]\d{9}$/.test(loomySmsPhone),
                onClick:onLoomySmsSend},'发送官方短信验证码')),
            h('div',{style:css.line},
              h('input',{type:'text',inputMode:'numeric',autoComplete:'one-time-code',maxLength:8,
                'aria-label':'Loomy 短信验证码',placeholder:'短信验证码',style:css.input,
                value:loomySmsCode,onChange:e=>onLoomySmsCode(e.target.value)}),
              h(Button,{disabled:!!sourceBusy||!loomySmsSent||!/^\d{4,8}$/.test(loomySmsCode),
                onClick:onLoomySmsSubmit},'核验短信并完成登录'))):null,
          models?.state==='ready'&&models.providerId===selectedSource?h('div',{style:{...css.card,maxHeight:300,overflowY:'auto'}},
            h('p',{style:css.small},'模型 '+models.models.length+' 项；免费标记未经核实，需用户自行审核导入账号并配置模型链。'),
            models.models.map(m=>h('div',{key:m.id,style:{...css.line,marginBottom:5}},
              h('strong',null,m.name),h('span',{style:css.small},m.id),
              m.upstreamFreeLabel?h('span',{style:css.small},'来源标记免费 · 未核实'):null))):null
        ):h('p',{style:css.small},
          pack?.state==='mounted'?'来源包已加载，但尚未确认 DSH Connection 登录接口成功注册；请重新读取状态，未确认前不会发起登录。':
          '启用并保存配置、重启 DSH 后可进行自主登录、刷新与模型查询。'),
        upstream?.state==='ready'?h('div',null,
           h('p',{style:css.small},'来源池共 '+rows.length+' 条记录：自主登录与原授权接管均在此管理，来源不会因此被当作二次登录。'),
          h('div',{style:{maxHeight:320,overflowY:'auto'}},
            rows.map(row=>h('div',{key:row.providerId+':'+row.id,className:'dnr-source-entry'},
              h('div',{style:{flex:'1 1 205px',minWidth:0}},
                h('div',{style:{...css.line,marginBottom:2}},
                   h('strong',null,row.providerId),
                   h('span',{style:{fontSize:12,overflowWrap:'anywhere'}},
                     row.nickname||row.maskedPhone||'账号身份尚未取得')),
                 h('div',{style:{...css.line,marginBottom:0}},
                   h('span',{style:css.mutedTag},
                     row.authorizationSource==='autonomous'?'本插件自主登录':
                     row.authorizationSource==='adopted'?'原渠道授权接管':'来源待确认'),
                   h('span',{style:css.small},row.enabled?'来源池已启用':'来源池已停用'),
                   h(StateTag,{value:row.connectionState||'not_checked'}),
                   Number.isFinite(row.balance)?h('span',{style:css.mutedTag},
                     row.balance+' '+(row.balanceUnit||'余额')):null)),
              h('div',{className:'dnr-action-list'},
                h(Button,{disabled:!!busy||!!sourceBusy||!live,onClick:()=>{
                  if(window.confirm('确认'+(row.enabled?'停用':'启用')+'来源渠道 '+row.providerId+' 的账号 '+row.id+' ？修改仅作用于隔离来源池。'))
                    run('/channels/embedded/account-state',{providerId:row.providerId,accountId:row.id,enabled:!row.enabled},
                      '来源账号已修改并回查状态。');
                }},row.enabled?'停用来源账号':'启用来源账号'),
                h(Button,{disabled:!!busy||!!sourceBusy||!live||!row.refreshable,
                  onClick:()=>onSourceRefresh(row)},'刷新来源凭据'),
                row.providerId==='loomy'?h(Button,{
                  disabled:!!busy||!!sourceBusy||!live||!row.enabled,
                  onClick:()=>onSourceReuseLoomy(row)},'短信重新授权现有账号'):null,
                h(Button,{disabled:!!busy||!!sourceBusy||!live,onClick:()=>{
                  if(window.confirm('确认永久移除来源账号 '+row.id+' ？此操作调用上游账号池删除接口，并尝试清除本地保存的来源凭据；不等于撤销云端授权。若本插件仍引用该渠道账号则拒绝删除。'))
                    run('/channels/embedded/account-remove',{providerId:row.providerId,accountId:row.id,
                       acknowledgedSourceCredentialDeletion:true},'来源账号已从上游账号池移除；云端授权撤销需到官方服务检查。');
                }},'退出来源账号（尝试清凭据）')))))):null,
        upstream?.state==='error'?h('p',{style:css.small},'来源账号池读取失败；未修改任何账号。'):null,
        upstream?.state==='unavailable'&&live?h('p',{style:css.small},'来源账号池暂不可读取。'):null
      );
    }
    function diffModelLists(before,after){
      if(!Array.isArray(before)||!Array.isArray(after))return null;
      const old=new Map(before.map(m=>[m.id,m])),next=new Map(after.map(m=>[m.id,m]));
      return {added:[...next.keys()].filter(id=>!old.has(id)).length,
        removed:[...old.keys()].filter(id=>!next.has(id)).length,
        pricingChanged:[...next.entries()].filter(([id,m])=>old.has(id)
          &&JSON.stringify(old.get(id).pricing??null)!==JSON.stringify(m.pricing??null)).length};
    }
    function diffProviderCatalog(before,after){
      if(!Array.isArray(before)||!Array.isArray(after))return null;
      const flatten=list=>list.flatMap(p=>(p.models||[]).map(m=>({...m,id:p.id+'|'+m.id})));
      return diffModelLists(flatten(before),flatten(after));
    }
    function ReuseConsole({data,cfg,onReuseSettings,run,busy,onRefresh,subtab,onSubtab,
      embeddedPack,modelProvider,setModelProvider,onModels,modelBusy,models,
       onSourceLogin,onSourcePoll,onSourceDismissLogin,pendingLogin,onSourceRefresh,onSourceReuseLoomy,sourceBusy,
       loomySmsPhone,onLoomySmsPhone,loomySmsCode,onLoomySmsCode,loomySmsSent,onLoomySmsSend,onLoomySmsSubmit,
       hostModels,hostModelBusy,hostSelectedModel,onSelectHostModel,onHostModels,
      hostCatalog,onRefreshHostCatalog,
      manualHostModel,onManualHostModel,
      adoptionPreview,adoptionBusy,adoptionResults,credentialService,onPreviewAdoption,onAdoptAccount,
       verifyResults,verifyBusy,onVerifyAdopted}){
       const reuse=data?.sessionReuse||{hostProviders:[],channels:[],results:[]};
      const hosts=reuse.hostProviders||[],available=(reuse.channels||[]).filter(x=>x.available);
      const accountLabels={online:'本次鉴权通过',recently_verified:'上次鉴权通过 · 自动复核中',not_checked:'首次鉴权排队中',expired:'授权已失效',pending:'等待确认',checking:'自动检查中',error:'连接检查异常',limited:'限流中',client_required:'需要原客户端操作'};
      const checkedAccounts=data?.accounts||[];
      const selectedHost=hostModelBusy||hostModels?.providerId||'';
      const hostLabel=id=>id==='workbuddy'?'WorkBuddy 国内':
        id==='workbuddy-global'?'WorkBuddy 国际':id;
      const tabs=[['sessions','本机登录态'],['host','宿主路由与模型'],['source','自主登录']];
      const section={padding:11,border:'1px solid rgba(125,144,167,.18)',
        borderRadius:12,background:'rgba(125,144,167,.03)',minWidth:0};
      return h(React.Fragment,null,
        h('div',{style:{...css.tabbar,marginBottom:14,paddingTop:0},role:'tablist','aria-label':'复用来源'},
          tabs.map(([id,label])=>h('button',{key:id,type:'button',role:'tab',
            'aria-selected':subtab===id,style:{...css.tab,...(subtab===id?css.chosen:{})},
            onClick:()=>onSubtab(id)},label))),
        subtab==='host'?h(Panel,{title:'宿主原生渠道 · 自动接入',
          actions:h('div',{style:css.line},
            h(Button,{onClick:onRefresh,disabled:!!busy},'刷新渠道'),
            h(Button,{onClick:()=>onRefreshHostCatalog(false),disabled:!!busy},
              '刷新全部模型与资费'))},
          h('p',{style:css.small},'模型目录及来源公开资费每5分钟自动复核；也可手动获取。不会发起模型推理。'),
          hostCatalog?.changes?h('p',{role:'status',style:css.small},
            '全部渠道变化：新增 '+hostCatalog.changes.added+
            ' · 移除 '+hostCatalog.changes.removed+
            ' · 资费更新 '+hostCatalog.changes.pricingChanged):null,
          hostCatalog?.checkedAt?h('p',{style:css.small},
            '全部渠道最近同步：'+new Date(hostCatalog.checkedAt).toLocaleString()):null,
          h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,380px),1fr))',gap:12,alignItems:'start',minWidth:0}},
            h('div',{style:{...section,maxHeight:210,overflowY:'auto',display:'flex',flexWrap:'wrap',alignContent:'flex-start',gap:7}},
              h('div',{style:{...css.line,justifyContent:'space-between',width:'100%',marginBottom:2}},
                h('strong',null,'渠道 · '+hosts.length),
                h('span',{style:css.small},'点选渠道查看模型')),
              hosts.length?hosts.map(p=>h('button',{key:p.providerId,type:'button',
                disabled:!!hostModelBusy,
                onClick:()=>onHostModels(p.providerId),
                style:{display:'inline-flex',alignItems:'center',justifyContent:'flex-start',
                  gap:6,minWidth:0,maxWidth:'100%',cursor:'pointer',color:'inherit',
                  background:selectedHost===p.providerId?'rgba(72,127,235,.17)':'rgba(125,144,167,.04)',
                  border:'1px solid '+(selectedHost===p.providerId?'rgba(75,135,232,.63)':'rgba(125,144,167,.24)'),
                  padding:'7px 9px',borderRadius:9,minHeight:34}},
                h('strong',{style:{fontSize:12,fontWeight:650,minWidth:0,maxWidth:'100%',
                  flex:'1 1 120px',overflowWrap:'anywhere',textAlign:'left',whiteSpace:'normal'}},
                  hostLabel(p.providerId)),
                h('span',{style:{...css.mutedTag,fontSize:10,padding:'1px 5px',whiteSpace:'nowrap',opacity:1}},
                  hostModelBusy===p.providerId?'加载中':selectedHost===p.providerId?'已选择':'已接入'))):
                h('p',{style:css.small},'宿主没有返回已注册原生 Provider'))),
            h('div',{style:{...section,maxHeight:425,overflowY:'auto',minWidth:0}},
              h('div',{style:{...css.line,justifyContent:'space-between'}},
                h('strong',null,selectedHost?'模型目录 · '+hostLabel(selectedHost):'模型目录'),
                h(Button,{disabled:!selectedHost||!!hostModelBusy,
                  onClick:()=>onHostModels(selectedHost,false)},'重新获取模型'),
                selectedHost?h('span',{style:css.mutedTag},'已发现 '+(hostModels?.models?.length??0)):null),
              hostModels?.checkedAt?h('p',{style:css.small},
                '最近更新：'+new Date(hostModels.checkedAt).toLocaleString()):null,
              hostModels?.changes?h('p',{style:css.small},
                '本渠道变化：新增 '+hostModels.changes.added+' · 移除 '+hostModels.changes.removed+
                ' · 资费更新 '+hostModels.changes.pricingChanged):null,
              hostModels?.state==='ready'?h('div',null,
                h('p',{style:{...css.small,margin:'3px 0 9px'}},'展示宿主模型目录；原插件继续管理授权。'),
                hostModels.models.length?hostModels.models.map(m=>h('div',{key:m.id,
                  style:{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',
                    alignItems:'center',gap:8,padding:'7px 0',borderBottom:'1px solid rgba(125,144,167,.12)'}},
                  h('div',{style:{minWidth:0}},
                    h('strong',{style:{fontSize:12,fontWeight:630,display:'block',overflowWrap:'anywhere'}},m.name||m.id),
                    h('div',{style:{...css.small,fontSize:11,overflowWrap:'anywhere'}},m.id)),
                  h('div',{style:{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}},
                    h('span',{style:{...css.mutedTag,fontSize:10,padding:'2px 5px',whiteSpace:'nowrap'}},
                      m.isFree||m.freeHint?'来源标记免费':
                      ['workbuddy','workbuddy-global'].includes(selectedHost)&&
                        /(?:^|[\s·(])x\s*0(?:\.0+)?(?:$|[\s·)])/i.test(m.name||'')?'x0.00':'费用待确认'),
                    m.pricing?h('span',{style:{...css.small,fontSize:10,textAlign:'right'}},
                      '输入 '+m.pricing.input+' / 输出 '+m.pricing.output+
                      '（来源价格，单位依渠道）'):null))):
                  h('p',{style:css.small},'该插件没有公开模型目录；仍可从原插件界面核验可用模型。')):
                hostModels?.state==='unavailable'?h('p',{role:'status',style:css.small},
                  '原插件未提供可读取的模型目录，原 Provider 仍保持注册。'):
                h('p',{style:css.small},'在左侧选择任意渠道，右侧直接显示对应模型，不再跳到页面底部。'))):null,
         subtab==='sessions'?h(React.Fragment,null,
           h(Panel,{title:'本插件独立登录态 · 无需原渠道插件',
             actions:h(Button,{onClick:()=>onSubtab('source')},'管理自主登录')},
             h('p',{style:css.small},'这里直接显示本插件自有账号池。来源账号存在不等于已经鉴权成功；原渠道插件停止不会自动删除自有授权。'),
             data?.embeddedAccounts?.state==='ready'&&data.embeddedAccounts.accounts?.length?
               data.embeddedAccounts.accounts.map((row,i)=>h('div',{key:row.providerId+':'+row.id,
                 style:css.itemRow},
                 h('strong',null,row.nickname||row.providerId+' 账号 '+(i+1)),
                 h('span',{style:css.small},row.providerId+' · '+(row.enabled?'账号池已启用':'账号池已停用')),
                 h('span',{style:css.mutedTag},Number.isFinite(row.balance)?
                   '积分/余额 '+row.balance+' '+(row.balanceUnit||''):'余额待来源同步'))):
               h('p',{style:css.small},'尚无可读取的独立账号。')),
           h(Panel,{title:'接管原插件账号 · 迁入本插件',
            actions:h('div',{style:{...css.line,margin:0}},
              h(Button,{disabled:!!adoptionBusy,onClick:onPreviewAdoption},
                adoptionBusy==='preview'?'扫描中…':'重新扫描'),
              h(Button,{kind:'primary',disabled:!!verifyBusy||!!adoptionBusy||
                !adoptionPreview?.accounts?.some(x=>x.ownedAccountId),
                onClick:onVerifyAdopted},verifyBusy?'验证中…':'批量验证已接管账号'))},
             h('p',{style:css.small},'原插件账号与自有账号分开管理。已接管账号的状态以最近一次实际核验结果为准，原插件停止时不应一直显示“核验中”。'),            data?.verificationCache?.state==='degraded'?h('p',{role:'alert',style:css.small},
              '校验历史记录无法可靠写入本地文件；本次检查结果可能不会在重启后保留。请检查本插件状态目录的文件权限或损坏记录，原账号不受影响。'):null,
            credentialService?.available===false?h('p',{role:'alert',style:css.small},
              '当前宿主 Credentials 服务不可用，无法安全复制独立授权。宿主插件的原生模型仍能直接复用。'):null,
            h('div',{style:css.line},
              h('span',{style:css.mutedTag},'发现 '+(adoptionPreview?.accounts?.length??0)+' 个'),
              h('span',{style:css.mutedTag},'已接管 '+(adoptionPreview?.accounts?.filter(x=>x.ownedAccountId).length??0)+' 个'),
              h('span',{style:css.mutedTag},'最近确认 '+checkedAccounts.filter(x=>x.connectionState==='online'&&x.reusedExistingSession).length+' 个')),
            adoptionPreview?.accounts?.length?
              adoptionPreview.accounts.map(row=>{
                const key=row.providerId+':'+row.accountId;
                const live=checkedAccounts.find(x=>x.id===row.ownedAccountId);
                const verify=live?{state:live.connectionState,message:live.message,
                  at:live.checkedAt,lastVerifiedAt:live.lastVerifiedAt}:
                  verifyResults?.find(x=>x.id===row.ownedAccountId);
                const disabled=!!adoptionBusy||!row.portable||
                  (row.requiresPack&&adoptionPreview.ownPackState!=='mounted')||
                  (!row.privatePortable&&adoptionPreview.ownPackState!=='mounted');
                return h('div',{key,style:{...css.itemRow,gap:12}},
                  h('div',{style:{minWidth:0,flex:'1 1 200px'}},
                    h('strong',null,row.label||row.providerId),
                    h('div',{style:css.small},row.providerId+' · '+
                      (row.ownedAccountId?
                        verify?.state==='online'?'已接管 · 鉴权正常':
                        verify?.state==='recently_verified'?'已接管 · 之前鉴权成功，正在复核':
                        verify?.state==='expired'?'已接管 · 授权失效':
                         verify?.state==='checking'?'已接管 · 校验进行中（超时会退出）':
                         verify?.state==='error'?'已接管 · 当前核验失败':
                         '已接管 · 暂无鉴权结论' :                        row.portable?'具备可审核接管方案':'暂不可独立接管')),
                    adoptionResults?.[key]?h('div',{role:'status',style:css.small},
                      adoptionResults[key].message):null,
                    verify?h('div',{role:'status',style:css.small},
                      '模型/授权检查：'+(accountLabels[verify.state]||verify.state)+' · '+verify.message+
                      (verify.at?' · 检查于 '+new Date(verify.at).toLocaleString():'')+
                      (verify.lastVerifiedAt&&verify.state!=='online'?
                        ' · 上次成功 '+new Date(verify.lastVerifiedAt).toLocaleString():'')):null),
                  h(Button,{disabled:disabled||adoptionResults?.[key]?.state==='success',
                    onClick:()=>onAdoptAccount(row)},
                    adoptionBusy==='adopt:'+row.accountId?'接管中…':
                    adoptionResults?.[key]?.state==='success'?'已接管':
                    row.ownedAccountId?'复核接管':row.portable?'接管到本插件':'暂不能接管'));
              }):
              h('p',{style:css.small},adoptionBusy==='preview'?'正在读取原插件账号…':
                adoptionPreview?.state==='ready'?'当前没有检测到可接管账号。可到「自主登录」新建独立授权。':
                '正在读取本机账号清单，尚不代表存在有效的远端授权。'),
            verifyResults?.length?h('p',{style:css.small},
              '验证结果：通过 '+verifyResults.filter(x=>x.state==='online').length+
              '，待处理 '+verifyResults.filter(x=>x.state!=='online').length+
              '。目录鉴权通过不保证所有模型推理与签到均成功。'):null),
          h('p',{style:{...css.small,margin:'4px 7px 12px'}},
            '本机可检测来源：'+(available.map(x=>x.providerId).join('、')||'暂无')+
            '。来源可被发现不等于已经登录，也不意味着要重新扫码。'),
          (reuse.results||[]).length?h('details',{style:css.card},
            h('summary',{style:{cursor:'pointer'}},'历史扫描结果 · '+reuse.results.length),
            (reuse.results||[]).slice(-20).map((row,i)=>h('div',{key:i,style:css.itemRow},
              h('strong',null,row.providerId),
              h('span',{style:css.small},row.state||'尚未验证')))):null):null,
        subtab==='source'?h(React.Fragment,null,
           h(Panel,{title:'来源授权池 · 自主登录与原授权接管',actions:h('span',{style:css.mutedTag},
            embeddedPack?.state==='mounted'?'已加载':'当前：'+(embeddedPack?.state||'未知'))},
            h(Toggle,{label:'启用内置渠道授权与签到',value:cfg.embeddedPack?.enabled===true,
              onChange:v=>onReuseSettings({embeddedEnabled:v})}),
            h('p',{style:css.small},embeddedPack?.state==='mounted'?
              '新账号授权成功后直接成为本插件可用来源，模型会自动发现，不必再注册提供商或创建模型链。':
              '渠道挂载尚不可用：'+(embeddedPack?.reason||'请检查 DSH 宿主运行时')),
            embeddedPack?.errorStage?h('p',{style:css.small},
              '安全诊断阶段：'+embeddedPack.errorStage+
              '；仅反映本插件状态，原插件及原账号未被修改'):null),
          h(EmbeddedPackConsole,{pack:embeddedPack,upstream:data?.embeddedAccounts,
            channelCatalog:data?.channels,run,busy,
            modelProvider,setModelProvider,onModels,modelBusy,models,
             onSourceLogin,onSourcePoll,onSourceDismissLogin,pendingLogin,onSourceRefresh,onSourceReuseLoomy,sourceBusy,
              loomySmsPhone,onLoomySmsPhone,loomySmsCode,onLoomySmsCode,loomySmsSent,onLoomySmsSend,onLoomySmsSubmit})):null);
    }
    function AutoFreeConsole({pool,cfg,hostProviders,onRefresh,busy,
      freeProvider,setFreeProvider,freeModel,setFreeModel,manualModel,setManualModel,
      onMarkFree,onMarkPaid,onResetMark,onMarkProvider}){
      const models=pool?.models||[],catalog=pool?.catalog||[];
      const providerIds=[...new Set([...(hostProviders||[]).map(p=>p.providerId),
        ...catalog.map(row=>row.providerId),...(cfg.freePool?.providerIds||[]),
        ...(cfg.freePool?.models||[]).map(row=>row.providerId)])]
        .filter(id=>typeof id==='string'&&id!=='native-router'&&
          !id.startsWith('native-router-source-'));
      const selected=providerIds.includes(freeProvider)?freeProvider:providerIds[0]||'';
      const selectedModels=catalog.filter(x=>x.providerId===selected);
      const modelId=selectedModels.some(x=>x.model===freeModel)?freeModel:selectedModels[0]?.model||'';
      const target=(manualModel||'').trim()||modelId;
      const manual=(cfg.freePool?.models||[]).find(x=>x.providerId===selected&&x.model===target);
      const providerMarked=cfg.freePool?.providerIds?.includes(selected)===true;
      return h(React.Fragment,null,
        h(Panel,{title:'AutoFree · 动态免费模型池',
          actions:h(Button,{kind:'primary',disabled:!!busy,onClick:onRefresh},
            busy?'扫描中…':'刷新模型目录')},
          h('p',{style:css.small},'DSH 中选择「聚合路由 / autofree」即可自动选用免费模型并在额度受限时切换。来源明确免费、WorkBuddy x0.00 积分倍率，以及用户人工标记分别记录；不创建模型链。'),
          h('div',{style:{...css.metrics,gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))'}},
            h(Metric,{label:'可调度模型',value:models.length,detail:'含人工标记'}),
            h(Metric,{label:'已发现',value:catalog.length,detail:'所有来源'}),
            h(Metric,{label:'尚无免费依据',value:pool?.unknownPricing??0,detail:'默认不调度'})),
          pool?.state==='not_scanned'?h('p',{style:css.small},
            '尚未取得模型目录。点击刷新；没有免费依据时不会自行使用可能计费的模型。'):null),
        h(Panel,{title:'人工免费规则 · 选择渠道和模型',
          actions:h('span',{style:css.mutedTag},'配置保存后生效')},
          h('p',{style:css.small},'平台未公布价格时可自行指定；这是你的人工计费判断，不等于来源官方保证免费。若模型未公开目录，请核对原插件中的模型 ID。'),
          h('div',{style:{...css.line,alignItems:'flex-end'}},
            h(Select,{label:'选择渠道',value:selected,
              options:providerIds.map(id=>({value:id,label:id})),
              onChange:v=>{setFreeProvider(v);setFreeModel('');setManualModel('')}}),
            h(Select,{label:'已发现模型',value:modelId,
              options:selectedModels.map(row=>({value:row.model,
                label:(row.name||row.model)+' · '+row.model})),
              onChange:v=>{setFreeModel(v);setManualModel('')}})),
          h('div',{style:css.line},
            h(TextField,{label:'可选：输入经原插件核对的准确模型 ID',value:manualModel,
              onChange:setManualModel,placeholder:'未列在目录中时填写'}),
            h(Button,{kind:'primary',disabled:!selected||!target,
              onClick:()=>onMarkFree(selected,target)},'指定此模型免费'),
            h(Button,{disabled:!selected||!target,
              onClick:()=>onMarkPaid(selected,target)},'明确排除付费/不使用'),
            h(Button,{disabled:!manual||!selected||!target,
              onClick:()=>onResetMark(selected,target)},'恢复自动判断')),
          h('div',{style:{...css.line,marginBottom:0}},
            h(Button,{disabled:!selected,onClick:()=>onMarkProvider(selected,!providerMarked)},
              providerMarked?'取消渠道全免费规则':'手动标记本渠道全部已发现模型免费'),
            h('span',{style:css.small},providerMarked?'本渠道已被人工声明全部模型免费，保存后生效':
              '不推荐整渠道标记；只有你明确确认所有模型确实免费时才使用。')),
          (cfg.freePool?.models||[]).length||cfg.freePool?.providerIds?.length?
            h('details',{style:{marginTop:10}},h('summary',{style:{cursor:'pointer',...css.small}},
              '查看所有人工免费/排除规则'),
              (cfg.freePool?.providerIds||[]).map(id=>h('div',{key:id,style:css.itemRow},
                h('span',{style:css.small},id+' · 渠道全部模型声明免费'),
                h(Button,{onClick:()=>onMarkProvider(id,false)},'移除'))),
              (cfg.freePool?.models||[]).map(row=>h('div',{key:row.providerId+row.model,style:css.itemRow},
                h('span',{style:{...css.small,overflowWrap:'anywhere'}},
                  row.providerId+' / '+row.model+' · '+(row.free?'人工免费':'明确排除')),
                h(Button,{onClick:()=>onResetMark(row.providerId,row.model)},'移除')))):null),
        h(Panel,{title:'AutoFree 当前候选模型'},
          models.length?models.map(row=>h('div',{key:row.providerId+':'+row.model,
            style:{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',
              alignItems:'center',gap:8,padding:'7px 0',
              borderBottom:'1px solid rgba(125,144,167,.15)'}},
            h('div',{style:{minWidth:0}},
              h('strong',{style:{fontSize:12}},row.name||row.model),
              h('div',{style:{...css.small,fontSize:11,overflowWrap:'anywhere'}},
                row.providerId+' · '+row.model)),
            h('span',{style:{...css.mutedTag,padding:'2px 5px',fontSize:10,
              whiteSpace:'normal',maxWidth:155}},row.evidence))):
            h('p',{style:css.small},'没有具有明确免费证据或人工免费标记、且来源可用的模型。AutoFree 会拒绝路由，不会默认改用收费模型。')));
    }
    function ModelTestConsole({account,busy,run,hasDraft}){
      const [candidates,setCandidates]=useState(null);
      const [modelId,setModelId]=useState('');
      const [loading,setLoading]=useState(false);
      const [failure,setFailure]=useState('');
      async function inspect(){
        setLoading(true);setFailure('');
        try{
          const reply=await fetch(URL+'/channels/accounts/models',{
            method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({accountId:account.id})});
          const payload=await reply.json();
          if(!reply.ok||!payload.ok)throw Error(payload.error||'独立模型目录读取失败');
          const list=payload.result?.models||[];
          setCandidates(list);
          setModelId(list.find(x=>x.free===true)?.id||'');
        }catch(error){setFailure(String(error?.message??error));setCandidates(null)}
        finally{setLoading(false)}
      }
      const safe=(candidates||[]).filter(x=>x.free===true);
      return h('details',{style:{flex:'1 1 100%',width:'100%',minWidth:0,
        border:'1px solid var(--dnr-border)',borderRadius:8,marginBottom:7,padding:'4px 7px'}},
        h('summary',{style:{...css.small,cursor:'pointer',padding:'6px 3px'}},
          '真实模型调用 · 免费安全测试'),
        h('div',{style:{padding:'5px 7px 9px'}},
          h('p',{style:css.small},
            '由聚合路由自有账号直接调用，发送一次极短的「请只回复 OK」，限制32个输出Token。仅测试来源零费率、WorkBuddy x0.00 或你明确标记免费的模型；不默认选择未知价格的模型。'),
          h('div',{style:css.line},
            h(Button,{onClick:inspect,
              disabled:!!busy||loading||hasDraft||!account.configuredEnabled},
              loading?'查询中…':'读取本账号模型及费率')),
          candidates?h('div',{style:css.line},
            h('span',{style:css.small},
              '已发现 '+candidates.length+' · 可免费实测 '+safe.length),
            safe.length?h('select',{style:{...css.input,maxWidth:360},
              'aria-label':'选择真实测试模型',value:modelId,
              onChange:e=>setModelId(e.target.value)},
              safe.map(row=>h('option',{key:row.id,value:row.id},
                (row.name||row.id)+' · '+row.id))):null,
            h(Button,{disabled:!!busy||loading||hasDraft||!modelId||!account.configuredEnabled,
              onClick:()=>run('/channels/accounts/action',{
                action:'model-test',accountId:account.id,modelId,
              },'已完成本账号最小真实模型测试')},'发送真实免费测试')):null,
          candidates&&safe.length?h('p',{style:css.small},
            '选中模型免费依据：'+(safe.find(row=>row.id===modelId)?.evidence||'未确认')):null,
          candidates&&!safe.length?h('p',{style:css.small},
            '本账号尚无明确免费依据的模型，已禁止自动发送。可在 AutoFree 设置中核对官方费率并手工标记。'):null,
          failure?h('p',{style:{...css.small,color:'var(--dsw-alias-danger-primary,#de6271)'}},
            failure):null));
    }
    function AccountConsole({data,query,onQuery,run,setTab,busy,discovered,onAddProvider,
      onManageAccounts,onOpenOwnedSource,selectedChannel,onSelectChannel,onRefresh,hasDraft}){
      const [batch,setBatch]=useState(null);
      if(!data)return h(Panel,{title:'渠道账号'},'账号中心尚未连接 DSH Host。');
      const accounts=data.accounts||[];
      async function runFreeBatch(){
        if(busy||batch?.running)return;
        if(hasDraft){setBatch({running:false,done:0,total:0,verified:0,skipped:0,
          failed:0,message:'请先保存费率规则再进行真实调用'});return}
        const targets=accounts.filter(row=>row.modelTestAvailable&&row.configuredEnabled
          &&row.enabled!==false&&row.connectionState==='online').slice(0,16);
        if(!targets.length){setBatch({running:false,done:0,total:0,
          verified:0,skipped:0,failed:0,message:'目前没有已启用且官方鉴权在线的独立账号'});return}
        if(!window.confirm('将逐个通过本插件自有凭据，对 '+targets.length+
          ' 个账号分别尝试一次极短真实模型调用。没有明确免费证据的账号会跳过，'+
          '不会自动使用收费/未知费率模型；免费模型仍可能计入平台会员调用次数。确认开始？'))return;
        const summary={running:true,done:0,total:targets.length,
          verified:0,skipped:0,failed:0};
        setBatch({...summary});
        try{
          for(const account of targets){
            let state='failed';
            try{
              const response=await fetch(URL+'/channels/accounts/action',{
                method:'POST',headers:{'content-type':'application/json'},
                body:JSON.stringify({action:'model-test',accountId:account.id})});
              const answer=await response.json();
              state=answer.ok?answer.result?.state:'failed';
            }catch{state='failed'}
            summary.done++;
            if(state==='verified')summary.verified++;
            else if(state==='skipped')summary.skipped++;
            else summary.failed++;
            setBatch({...summary});
          }
          await onRefresh?.();
        }finally{setBatch({...summary,running:false})}
      }
       // Unified inventory is authoritative; never render raw pool entries twice.
       const allChannels=(data.channels||[]);
      const channels=allChannels.filter(c=>!query||[c.name,c.id,c.authMethod].some(x=>
        String(x||'').toLowerCase().includes(query.toLowerCase())));
      const visibleChannels=query||!selectedChannel||selectedChannel==='all'?channels:
        channels.filter(c=>c.id===selectedChannel);
      const active=accounts.filter(a=>a.configuredEnabled).length;
      const online=accounts.filter(a=>a.connectionState==='online').length;
       const displayBalance=a=>Number.isFinite(a.balance)?
         '余额：'+a.balance+(a.balanceUnit?' '+a.balanceUnit:''):
         a.balanceState==='not_supported'?'余额：平台未提供此项数据':'余额：尚未取得有效数据';
       return h(React.Fragment,null,
        h(Panel,{title:'全部渠道 · 账号状态',
          actions:h('div',{style:css.line},
            h(Button,{disabled:!!busy||batch?.running,onClick:()=>run('/channels/accounts/action',
              {action:'refresh-all'},'已刷新支持校验的账号')},'验证全部'),
            h(Button,{kind:'primary',disabled:!!busy||batch?.running||hasDraft,
              onClick:runFreeBatch},batch?.running?'逐账号实测 '+batch.done+'/'+batch.total:
              '一键实测全部账号的免费模型'))},
          batch?h('p',{style:css.small},
            '真实模型实测 '+batch.done+'/'+batch.total+' · 成功 '+batch.verified+
            ' · 无免费证据跳过 '+batch.skipped+' · 失败 '+batch.failed+
            (batch.running?' · 正在测试下一账号':' · 已完成；详情见各账号状态')+
            (batch.message?' · '+batch.message:'')):null,
          h('div',{style:{...css.line,justifyContent:'space-between'}},
             h('span',{style:css.small},'渠道 '+allChannels.length+' · 可见账号 '+accounts.length+              ' · 启用 '+active+' · 最近验证通过 '+online),
            h('input',{'aria-label':'搜索渠道名称或登录方式',
              style:{...css.input,maxWidth:230,flex:'1 1 170px'},
              placeholder:'搜索渠道或登录方式',value:query,
              onChange:e=>onQuery(e.target.value)})),
          h('label',{className:'dnr-input-field',style:{...css.field,maxWidth:350}},
            h('span',{style:css.small},'筛选渠道（默认全部）'),
            h('select',{style:css.input,value:selectedChannel||'all',
              onChange:e=>onSelectChannel(e.target.value)},
              h('option',{value:'all'},'全部渠道'),
              allChannels.map(c=>h('option',{key:c.id,value:c.id},
                c.name+' · '+accounts.filter(a=>a.providerId===c.id).length+' 个账号'))))),
        visibleChannels.map(channel=>{
          const members=accounts.filter(a=>a.providerId===channel.id);
           const pool=(data.pools||[]).find(x=>x.providerId===channel.id);
           const inferred=members.some(a=>Number.isFinite(a.modelInferenceVerifiedAt)
             &&a.modelInferenceVerifiedAt>0);
           const authenticated=members.some(a=>a.connectionState==='online');
           const readiness=!channel.adapterReady?'适配器未就绪':
             inferred?'模型推理已实测':
             authenticated?'账号鉴权通过 · 推理待实测':'适配器就绪 · 账号待验证';
           return h(Panel,{key:channel.id,title:channel.name,
             actions:h('span',{style:css.small},members.length+' 个账号 · '+readiness)},
            h('div',{style:css.line},
              h('span',{style:css.small},'登录方式：'+(channel.authMethod||'由来源管理')),
              pool?h('span',{style:css.small},'自动候选 '+pool.enabled+' · 已验证 '+pool.verified):null),
             members.map((account,accountIndex)=>h('div',{key:account.id,className:'dnr-account-card'},
               h('div',{className:'dnr-account-head'},
                 h('div',{className:'dnr-account-identity'},
                   h('span',{className:'dnr-account-symbol','aria-hidden':'true'},
                     (channel.name||'渠').trim().slice(0,1)||'渠'),
                   h('div',{className:'dnr-account-title'},
                     h('strong',{className:'dnr-account-name'},
                       account.nickname||account.accountName||account.username||
                       account.loginName||account.maskedPhone||'账号名待获取'),
                     h('span',{className:'dnr-account-hint'},
                       account.runtimeMode==='owned'?'本插件独立持有授权':
                       account.sourceKind==='reused'?'复用来源 · 原授权有效':
                       '账号来源待确认'))),
                 h(StateTag,{value:account.connectionState})),
               h('div',{className:'dnr-account-metrics'},
                 h('div',{className:'dnr-account-metric'},
                   h('span',{className:'dnr-account-metric-label'},
                     account.balanceUnit==='积分'?'总可用积分':'官方可用额度'),
                   h('strong',{className:'dnr-account-metric-value'},
                     Number.isFinite(account.balance)?
                       account.balance.toLocaleString()+
                         (account.balanceUnit?' '+account.balanceUnit:''):
                       account.balanceState==='not_supported'?'平台暂无可读取的余额':
                       account.balanceState==='not_returned'?'官方本次未返回':
                       account.balanceState==='unavailable'?'官方额度暂不可读取':'尚未取得'),
                   account.balanceCheckedAt?h('span',{className:'dnr-account-metric-note'},
                     '核实 '+new Date(account.balanceCheckedAt).toLocaleString()):null),
                 Number.isFinite(account.expiringPoints)&&account.expiringPoints>0
                   &&account.balanceUnit==='积分'&&Number.isFinite(account.expiringAt)
                   &&account.expiringAt>Date.now()?
                   h('div',{className:'dnr-account-metric'},
                     h('span',{className:'dnr-account-metric-label'},'未来 7 天将过期积分'),
                     h('strong',{className:'dnr-account-metric-value'},
                       account.expiringPoints.toLocaleString()+' 积分'),
                     Number.isFinite(account.expiringAt)?
                       h('span',{className:'dnr-account-metric-note'},
                         '最早到期 '+new Date(account.expiringAt).toLocaleDateString()):null):null,
                 account.usageState?h('div',{className:'dnr-account-metric'},
                   h('span',{className:'dnr-account-metric-label'},'MiMo 七日自然恢复额度'),
                   h('strong',{className:'dnr-account-metric-value'},
                     account.usageState==='available'&&
                       Number.isFinite(account.usagePercentRemaining)?
                       account.usagePercentRemaining+'% 剩余':
                       account.usageState==='no_cycle'?'当前无有效周期':
                       '待核实'),
                   account.usageResetAt?h('span',{className:'dnr-account-metric-note'},
                     '恢复于 '+new Date(account.usageResetAt).toLocaleString()):null):null,
                 account.membershipState&&account.balanceUnit!=='积分'?
                   h('div',{className:'dnr-account-metric'},
                     h('span',{className:'dnr-account-metric-label'},'MiMo 会员使用额度'),
                     h('strong',{className:'dnr-account-metric-value'},
                       account.membershipState==='active'&&
                         Number.isFinite(account.membershipPercentRemaining)?
                         account.membershipPercentRemaining+'% 剩余':
                         account.membershipState==='not_subscribed'?'未订阅会员':
                         '暂不可核实')):null),
               h('div',{className:'dnr-account-hints'},
                 account.quotaCheckedAt?h('span',null,
                   '额度更新 '+new Date(account.quotaCheckedAt).toLocaleString()):null,
                 account.modelInferenceVerifiedAt?h('span',null,
                   '模型实测成功 · '+new Date(account.modelInferenceVerifiedAt).toLocaleString()):
                 account.modelTestFailedAt?h('span',null,
                   '最近实测失败 · '+new Date(account.modelTestFailedAt).toLocaleString()):
                 account.connectionState==='online'?h('span',null,'身份鉴权通过 · 推理尚待实测'):
                   h('span',null,'登录状态待核验'),
                 account.backupSources?.length?h('span',null,
                   '备援账号 '+account.backupSources.length):null),
                h('div',{style:css.line},
                  account.activityState&&account.providerId?.includes('doubao')?h('span',{style:css.mutedTag},
                    '豆包活动：'+({claimed:'今日已领取',claimable:'今日可领取',not_offered:'当前无开放活动',
                      not_confirmed:'等待官方任务状态',unavailable:'活动状态未同步'}[account.activityState]||'待确认')):null,
                  (account.activityTaskCount>0&&account.providerId?.includes('doubao')?
                     [h('span',{key:account.id+'-other-tasks',style:css.mutedTag},
                       '另发现 '+account.activityTaskCount+' 项活动 · 暂无经验证自动执行接口')]:[]),
                   (account.benefits||[]).filter(b=>b.active&&!b.claimed).map(b=>
                    h('span',{key:account.id+'-reward-'+b.kind,style:css.mutedTag},
                      '可领取 '+(b.kind==='gift'?'官方活动赠送':'补偿积分')+
                      (Number.isFinite(b.credit)?' · '+b.credit+' 积分':''))),
                  account.checkinState?h('span',{style:css.mutedTag},
                   '今日签到：'+(checkinLabels[account.checkinState]||account.checkinState)):null,
                 account.autoCheckin===true?h('span',{style:css.mutedTag},
                   account.autoCheckinEffective===false?'积分任务：全局开关关闭':'账号已允许自动积分任务'):null,
                 account.activitiesSupported?h('span',{style:css.mutedTag},
                   '活动奖励 · 已确认 '+(account.activityClaims?.confirmed??0)+
                   ' · 待回查 '+(account.activityClaims?.unconfirmed??0)):null,
                 account.checkinMessage?h('span',{style:css.small},
                   account.checkinMessage):null),
               h('details',{style:{marginBottom:8}},
                 h('summary',{style:css.small},'详情 · 账号来源与诊断信息'),
                h('div',{style:css.small},'内部账号：'+account.id),
                h('div',{style:css.small},'凭据：'+account.credentialKind+' 引用'),
                 account.reusedExistingSession&&account.runtimeMode!=='owned'?
                   h('div',{style:css.small},'原渠道引用 · 尚未完成独立接管'):null,
                 account.runtimeMode==='owned'?h('div',{style:css.small},
                   '首次授权来源仅用于迁移，后续由本插件独立管理；'+
                   (account.connectionState==='online'?'自有驱动鉴权通过':
                    '自有驱动尚待在线验证')):null,                h('div',{style:css.small},'来源：'+(account.origin?.label||'来源未识别')),
                h('div',{style:css.small},'权重：'+(Number.isFinite(account.weight)?account.weight:'未设置')),
                 account.checkedAt?h('div',{style:css.small},'最近检查：'+new Date(account.checkedAt).toLocaleString()):null,
                 (account.backupSources||[]).map((s,i)=>h('div',{key:'backup-'+i,style:css.small},
                   '保留备援 '+(i+1)+'：'+(s.kind==='autonomous'?'自主登录':
                     s.kind==='adopted'?'原授权接管':'原渠道复用')+
                   ' · '+(s.available?'可选':'已停用')+' · '+(s.state==='online'?'已验证':'待核验/不可用'))),                 h('div',{style:css.small},account.message||'未返回校验详情')),               account.managed===false?
               h('div',{style:{...css.line,marginBottom:0}},
                 h('span',{style:css.small},account.sourceKind==='adopted'?
                   '复用原渠道授权，保存于本插件私有池；这不是一次新自主登录':
                   '本插件自主登录授权；是否可用以来源鉴权为准'),
                 h(Button,{onClick:onOpenOwnedSource},'管理来源授权池')):               h('div',{style:{...css.line,marginBottom:0}},
                  h(Button,{disabled:!!busy||!account.refreshAvailable||!account.configuredEnabled,
                    kind:'primary',onClick:()=>run('/channels/accounts/action',
                      {action:'refresh',accountId:account.id},'已重新查询官方账号身份和额度')},'刷新账户资料'),
                  !account.refreshAvailable&&account.loginAvailable?h(Button,{disabled:!!busy||!account.configuredEnabled,
                    onClick:()=>run('/channels/accounts/action',{action:'login',accountId:account.id},
                      '已请求账号连接验证')},'校验身份'):null,
                 account.modelTestAvailable?h(ModelTestConsole,{account,busy,run,hasDraft}):null,
                 h(Button,{disabled:!!busy,onClick:()=>run('/channels/accounts/action',
                   {action:'enable',accountId:account.id,enabled:!account.configuredEnabled},
                   '账号启停状态已更新')},account.configuredEnabled?'停用':'启用'),
                 h(Button,{disabled:!!busy,onClick:()=>{
                   if(window.confirm('确认解除本插件账号 '+(account.nickname||account.id)+
                     ' 的关联？不撤销云端账号，已被模型链使用则拒绝。'))
                     run('/channels/accounts/action',{action:'logout',accountId:account.id},
                       '账号引用已解除');
                 }},'解绑')))),
             !members.length?h('p',{style:css.small},
               '当前没有经账号库存确认的登录记录；不会将模型适配器视为登录成功。'):null,            h('div',{style:css.line},
              !channel.referenceOnly?h(Button,{onClick:()=>onManageAccounts(channel)},'管理账号池'):null,
              channel.referenceOnly&&channel.adapterReady?h(Button,{onClick:()=>onAddProvider(channel)},'配置此渠道'):null,
              channel.discoveryAvailable?h(Button,{disabled:!!busy,
                onClick:()=>run('/channels/discover',{providerId:channel.id},'已读取本机账号候选')},
                '扫描本机授权账号'):null),
            (discovered[channel.id]||[]).map(candidate=>h('div',{key:candidate.id,style:css.itemRow},
              h('strong',null,candidate.label||'账号候选'),
              h(Button,{disabled:!!busy,onClick:()=>{
                if(window.confirm('确认导入该已授权账号？仅保存引用，导入后默认停用。'))
                  run('/channels/import',{providerId:channel.id,candidateId:candidate.id},
                    '账号授权已导入，请执行远端鉴权和实测对话');
              }},'审核后导入'))));
        }));
    }
    function ActivitiesConsole({data,busy,refresh}){
      const groups=Array.isArray(data?.channels)?data.channels:[];
      const summary=data?.summary??{};
      const stateText={valid:'有效 · 可自动执行',completed:'已完成',
        unverified:'待官方核验'};
      const endText=value=>Number.isFinite(value)&&value>0?
        new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',
          year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
          .format(new Date(value)):'官方未公布';
      return h('div',{className:'dnr-activities'},
        h(Panel,{title:'免费自动活动总览',
          actions:h(Button,{disabled:!!busy,onClick:refresh},
            busy?'核验中…':'刷新官方活动')},
          h('p',{style:css.small},'只执行后台无感的官方查询／任务完成／领取接口；需要实际发送、分享、生成、付款、验证码或界面操作的任务直接跳过。所有完成状态必须有官方回查，奖励和到期时间不推测。'),
          h('div',{style:css.line},
            h('span',{style:css.mutedTag},'渠道 '+(summary.channelCount??groups.length)),
            h('span',{style:css.mutedTag},'符合条件活动 '+(summary.activityCount??0)),
            h('span',{style:css.mutedTag},'有效 '+(summary.validCount??0)),
            h('span',{style:css.mutedTag},'已完成 '+(summary.completedCount??0)),
            data?.refreshedAt?h('span',{style:css.small},
              '最近官方刷新 '+new Date(data.refreshedAt).toLocaleString()):null),
          data?.refreshState==='partial'||data?.refreshState==='unavailable'?
            h('p',{style:css.small},'部分来源尚未返回结果，活动状态仍需官方核验'):null),
        groups.length?groups.map(channel=>h(Panel,{key:channel.id,
          title:channel.name+' · '+channel.activities.length+' 项'},
          h('div',{className:'dnr-activity-scroll'},
            h('table',{className:'dnr-activity-table'},
              h('thead',null,h('tr',null,
                ...['活动名称','免费奖励','是否有效','到期时间','执行状态']
                  .map(title=>h('th',{key:title,scope:'col'},title)))),
              h('tbody',null,
                channel.activities.length?channel.activities.map(activity=>
                  h('tr',{key:activity.id},
                    h('td',null,h('strong',null,activity.name),
                      h('span',{className:'dnr-activity-account'},
                        activity.accountName||'账号名待获取')),
                    h('td',{className:'dnr-activity-number'},
                      Number.isFinite(activity.rewardAmount)&&activity.rewardUnit?
                        activity.rewardAmount.toLocaleString()+' '+activity.rewardUnit:
                        '官方未公布'),
                    h('td',null,h('span',{
                      className:'dnr-activity-state',
                      'data-validity':activity.validity},
                      stateText[activity.validity]||'待官方核验')),
                    h('td',null,endText(activity.endAt)),
                    h('td',null,activity.progress||'待核实')))
                :h('tr',null,h('td',{colSpan:5,className:'dnr-activity-empty'},
                  channel.accountCount>0?
                    '暂无符合条件的免费自动活动'+
                      (channel.emptyReason?'；'+channel.emptyReason:''):
                    '尚无已接入账号，暂无符合条件的免费自动活动'))))))):
          h(Panel,{title:'渠道活动'},'尚未取得渠道配置'));
    }

    function CheckinConsole({data,cfg,onSettings,onAccountAuto,run,refresh,busy,embeddedPack,
      sourceProvider,setSourceProvider,sourceCredits,sourceClaims,sourceBusy,onSourceStatus,onSourceClaim}){
      const [selectedCheckinChannel,setSelectedCheckinChannel]=React.useState('');
      if(!data)return h(Panel,{title:'每日积分任务中心'},'签到状态服务尚未连接 DSH Host。');
      const accounts=data.accounts||[],groups=(data.groups||[]).filter(x=>x.accountCount>0);
      const supported=accounts.filter(a=>a.checkinSupported).length;
      const success=accounts.filter(a=>a.checkinState==='success').length;
      const pending=accounts.filter(a=>a.checkinState==='pending_confirmation').length;
      const canonicalChannel=id=>String(id||'').replace(/^own_/,'');
      const selectedGroup=groups.find(x=>x.id===selectedCheckinChannel);
      const accountLabel=a=>a?.nickname||a?.accountName||a?.username||
        a?.loginName||a?.maskedPhone||'账号名待获取';
      const labelFor=id=>{
        const account=accounts.find(a=>a.id===id);
        return account?accountLabel(account):'历史账号（名称尚未关联）';
      };
      return h(React.Fragment,null,
        data.historyBlocked?h('div',{role:'alert',style:css.error},data.historyError):null,
        h(Panel,{title:'今日积分任务 · '+data.today+' ('+data.timeZone+')',
          actions:h(Button,{disabled:!!busy,onClick:refresh},'同步签到状态')},
          h('div',{style:css.line},
            ...['已签 '+success,'待确认 '+pending,'支持签到 '+supported,'账号 '+accounts.length]
              .map(x=>h('span',{key:x,style:css.mutedTag},x))),
          h('div',{style:{...css.small,marginBottom:7,fontWeight:650}},'各渠道今日签到'),
          h('div',{className:'dnr-checkin-tags',role:'group','aria-label':'按渠道查看今日签到'},
            groups.map(channel=>h('button',{key:channel.id,type:'button',
              className:'dnr-checkin-tag',
              'aria-pressed':selectedCheckinChannel===channel.id,
              'data-confirmed':channel.success>0?'yes':'no',
              title:channel.name+'：今日已签到 '+channel.success+' / '+channel.accountCount+
                ' 账号；待确认 '+channel.pending+'，点击查看账号明细',
              onClick:()=>setSelectedCheckinChannel(id=>
                id===channel.id?'':channel.id)},
              h('span',null,channel.name),
              h('strong',null,'已签 '+channel.success+'/'+channel.accountCount)))),
          h('p',{style:{...css.small,marginTop:8,marginBottom:0}},
            '每日签到只是积分任务的一部分；活动领取独立回查，积分到账以官方总余额为准。')),
        selectedGroup?h(Panel,{title:selectedGroup.name+' · 账号签到明细',
          actions:h(Button,{onClick:()=>setSelectedCheckinChannel('')},'收起明细')},
          accounts.filter(a=>canonicalChannel(a.providerId)===selectedGroup.id)
            .map((a,i)=>h('div',{key:a.id,style:css.itemRow},
              h('div',{style:{flex:'1 1 190px',minWidth:0}},
                h('strong',null,accountLabel(a)),
                !a.nickname&&!a.accountName&&!a.username&&!a.loginName&&!a.maskedPhone?
                  h('span',{style:{...css.small,marginLeft:6}},'（上游尚未返回真实名称）'):null,
                h('p',{style:css.small},a.checkinMessage||'今日状态待核实'),
                a.activitiesSupported?h('p',{style:css.small},
                  '活动 · 已确认 '+(a.activityClaims?.confirmed??0)+
                  ' · 待回查 '+(a.activityClaims?.unconfirmed??0)):null,
                a.lastConfirmedDate?h('span',{style:css.small},
                  '最近一次确认成功：'+a.lastConfirmedDate):null),
              h(StateTag,{kind:'checkin',value:a.checkinState}),
              a.sourceAccount&&!cfg.accounts.some(row=>row.id===a.id)?
                h('span',{style:css.small},a.autoCheckin?'自动签到已开':'自动签到已关'):
                h(Toggle,{label:'自动积分任务',
                  value:cfg.accounts.find(row=>row.id===a.id)?.autoCheckin===true,
                  onChange:v=>onAccountAuto(a.id,v)}),
              h(Button,{disabled:!!busy||!!data.historyBlocked||(!a.checkinSupported&&!a.activitiesSupported)||!a.enabled,
                onClick:()=>run('/checkins/action',{action:'run',accountId:a.id},
                  '已请求官方积分任务，请核实领取及到账状态')},'执行积分任务')))):
          null,
        h(Panel,{title:'每日积分任务设置（依托 DSH Host 运行）'},
          h('div',{style:css.line},
            h(Toggle,{label:'启用每日自动积分任务',value:cfg.checkin?.autoEnabled,
              onChange:v=>onSettings({autoEnabled:v})}),
            h(Toggle,{label:'覆盖所有支持签到的来源账号',
              value:cfg.checkin?.autoSourceAccounts!==false,
              onChange:v=>onSettings({autoSourceAccounts:v})}),
            h(TextField,{label:'执行时间（HH:mm）',value:cfg.checkin?.runAt||'10:05',
              onChange:v=>onSettings({runAt:v})}),
            h(TextField,{label:'时区',value:cfg.checkin?.timeZone||'Asia/Shanghai',
              onChange:v=>onSettings({timeZone:v})})),
           h('p',{style:css.small},'自动积分任务不等于仅签到：系统持续发现符合领取条件的活动，WorkBuddy 签到、赠送、补偿分别执行并回查；即使今日已签到，也会继续检查新开放的奖励。未接入官方执行接口或要求验证码、消费、人工完成的任务不会伪造成功。未知领取回执留待核实，不重复扣/领；MiMo 自然恢复额度不消耗模型调用。')),
        embeddedPack?.state==='mounted'?h(Panel,{title:'来源渠道 · 状态与手动领取'},
          h('div',{style:css.line},
            h(Select,{label:'来源渠道',value:sourceProvider,onChange:setSourceProvider,
              options:(embeddedPack.channels||[]).map(id=>({value:id,label:id}))}),
            h(Button,{disabled:!!sourceBusy||!!busy,onClick:()=>onSourceStatus(sourceProvider)},
              sourceBusy==='status'?'查询中…':'重新同步来源状态'),
            h(Button,{disabled:!!sourceBusy||!!busy||!sourceCredits
              ||sourceCredits.providerId!==sourceProvider||!sourceCredits.accounts.length
              ||SOURCE_CLAIM_EXCLUDED.has(sourceProvider),onClick:()=>onSourceClaim(sourceProvider)},
              '批量领取（该渠道所有账号）')),
          SOURCE_CLAIM_EXCLUDED.has(sourceProvider)?
            h('p',{style:css.small},'此渠道不提供可验证的每日签到领取操作。'):null,
           sourceCredits?.providerId===sourceProvider?
             sourceCredits.accounts.map(row=>h('div',{key:row.accountId,style:css.itemRow},
               h('strong',null,accountLabel(row)),
               h('span',{style:css.small},
                 row.status?.todayCheckedIn===true?'来源确认：今日已签到':
                 row.status?.todayCheckedIn===false?'来源报告：今日尚未签到':
                 '来源状态尚未核实'))):
            h('p',{style:css.small},'已在下方同步各账号状态；这里可按需刷新指定渠道。'),
          sourceClaims?.providerId===sourceProvider?h('div',{style:css.card},
            h('strong',null,'最近领取请求（必须回查确认）'),
            sourceClaims.results.map(row=>h('div',{key:row.accountId,style:css.itemRow},
              h('span',null,labelFor(row.accountId)),
              h('span',{style:css.small},'来源返回：'+row.kind+' · 尚未复核')))):null):null,
        h(Panel,{title:'最近签到记录'},
          (data.history||[]).length?(data.history||[]).slice(0,25).map((v,i)=>
            h('div',{key:i,style:css.itemRow},
              h('span',{style:css.small},v.date),
              h('strong',null,labelFor(v.accountId)),
              h(StateTag,{kind:'checkin',value:v.state}),
              h('span',{style:css.small},v.message))):
            h('p',{style:css.small},'暂无已核实的签到执行记录。')));
    }

    function Metric({label,value,detail,onClick}){
      return h(onClick?'button':'div',{className:onClick?'dnr-metric-link':undefined,
        type:onClick?'button':undefined,style:{...css.metric,textAlign:'left',color:'inherit',
          ...(onClick?{cursor:'pointer'}:{})},onClick,
        title:onClick?'打开'+label:undefined,'aria-label':onClick?'打开'+label:undefined},
        h('span',{style:css.small},label),
        h('strong',{style:{fontSize:20,fontWeight:730,fontVariantNumeric:'tabular-nums',lineHeight:1.2}},String(value)),
        h('span',{style:css.small},detail));
    }
    function OverviewConsole({cfg,status,channelsView,checkinsView,onNavigate,onRefresh}){
      const accounts=channelsView?.accounts||[],checkins=checkinsView?.accounts||[];
      const hostProviders=status?.sessionReuse?.hostProviders||
        channelsView?.sessionReuse?.hostProviders||[];
      const verified=accounts.filter(a=>a.connectionState==='online').length;
      const eligible=checkins.filter(a=>a.checkinSupported&&a.enabled).length;
      const signed=checkins.filter(a=>a.checkinState==='success').length;
      const failed=checkins.filter(a=>a.checkinState==='failed').length;
      const pending=checkins.filter(a=>a.checkinState==='pending_confirmation').length;
      const enabledChains=cfg.routes.filter(r=>r.enabled).length;
      const switchLog=cfg.hostFailover?.switchLog||[];
      const rank={verified:0,connected:1,pending:2};
      const sources=new Map();
      const add=(id,name,state)=>{
        if(typeof id!=='string'||!id)return;
        const previous=sources.get(id);
        if(!previous||rank[state]<rank[previous.state])
          sources.set(id,{id,name:name||id,state});
      };
      for(const c of channelsView?.channels||[]){
        add(c.id,c.name,c.referenceOnly||!c.adapterReady?'pending':'connected');
      }
      for(const p of hostProviders){
        add(p.providerId,p.providerId==='workbuddy'?'WorkBuddy 国内':
          p.providerId==='workbuddy-global'?'WorkBuddy 国际':p.providerId,'connected');
      }
      for(const a of accounts)if(a.connectionState==='online')
        add(a.providerId,a.providerName,'verified');
      const sorted=[...sources.values()].sort((a,b)=>
        rank[a.state]-rank[b.state]||a.name.localeCompare(b.name,'zh'));
      return h(React.Fragment,null,
        h('div',{style:css.hero},
          h('div',null,h('div',{style:css.overline},'DSH · MULTI-PROVIDER HUB'),
            h('h3',{style:{margin:'7px 0 6px',fontSize:20}},'渠道与聚合路由运行总览'),
            h('p',{style:{...css.caption,marginBottom:0}},
              '汇总全部已发现来源；只有账号实际鉴权通过才显示“已验证”。')),
          h(Button,{onClick:onRefresh},'刷新运行状态')),
        h('div',{style:css.metrics},
          h(Metric,{label:'宿主已注册路由',value:status?hostProviders.length:'—',
            detail:'原插件维护认证',onClick:()=>onNavigate('reuse')}),
          h(Metric,{label:'聚合账号',value:channelsView?accounts.length:'—',
            detail:'已验证 '+verified,onClick:()=>onNavigate('channels')}),
          h(Metric,{label:'已启用模型链',value:enabledChains,
            detail:'共配置 '+cfg.routes.length+' 条',onClick:()=>onNavigate('routes')}),
          h(Metric,{label:'今日确认签到',value:checkinsView?signed:'—',
            detail:'支持 '+eligible+' · 失败 '+failed,onClick:()=>onNavigate('checkins')}),
          h(Metric,{label:'自动续跑',value:cfg.hostFailover?.enabled?'开启':'关闭',
            detail:'留存切换记录 '+switchLog.length,onClick:()=>onNavigate('host')})),
        h(Panel,{title:'本机 DSH Provider · 插件路由状态',
          actions:h('span',{style:css.mutedTag},'全部来源 '+sorted.length)},
          sorted.length?h('div',{className:'dnr-route-tags'},
            sorted.map(item=>h('span',{key:item.id,className:'dnr-route-chip',
              'data-state':item.state,title:item.id},
              h('strong',null,item.name),
              h('span',{style:css.small},
                item.state==='verified'?'已验证':item.state==='connected'?'已接入':'待接入')))):
            h('p',{style:css.small},'暂无来源；请检查宿主 Provider 注册状态。')),
        h('div',{style:css.doubleGrid},
          h(Panel,{title:'每日签到 · 服务端确认结果',
            actions:h(Button,{onClick:()=>onNavigate('checkins')},'签到管理')},
            h('div',{style:css.line},
              h('span',{style:css.mutedTag},'已确认 '+signed),
              h('span',{style:css.mutedTag},'待确认 '+pending),
              h('span',{style:css.mutedTag},'失败 '+failed),
              h('span',{style:css.mutedTag},'支持执行 '+eligible)),
            h('p',{style:css.small},'签到：'+(cfg.checkin?.autoEnabled?'自动已启用':'自动未启用')+
              ' · '+(checkinsView?.today||'正在同步')+' · 仅统计真实回执')),
          h(Panel,{title:'模型调度与故障切换',
            actions:h(Button,{onClick:()=>onNavigate('host')},'管理故障续跑')},
            h('div',{style:css.line},
              h('span',{style:css.mutedTag},'自定义模型链 '+enabledChains),
              h('span',{style:css.mutedTag},'宿主续跑 '+(cfg.hostFailover?.enabled?'开启':'关闭')),
              h('span',{style:css.mutedTag},'成功请求 '+(status?.metrics?.successfulTurns??'—'))),
            h('p',{style:css.small},'模型链与宿主故障切换独立运行；失败尝试不计为成功。'))));
    }
    function App(){
      const [cfg,setCfg]=useState(null),[tab,setTab]=useState('overview'),[busy,setBusy]=useState(false),
        [notice,setNotice]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(null),
        [raw,setRaw]=useState(''),[channelsView,setChannelsView]=useState(null),
        [checkinsView,setCheckinsView]=useState(null),
        [activitiesView,setActivitiesView]=useState(null),
        [activitiesBusy,setActivitiesBusy]=useState(false),
        [actionBusy,setActionBusy]=useState(''),
        [channelQuery,setChannelQuery]=useState(''),[discovered,setDiscovered]=useState({}),
        [managedAccountProvider,setManagedAccountProvider]=useState(''),
        [modelProvider,setModelProvider]=useState('workbuddy'),[modelBusy,setModelBusy]=useState(false),
        [embeddedModels,setEmbeddedModels]=useState(null),
        [sourceRpcBusy,setSourceRpcBusy]=useState(''),
         [pendingSourceLogin,setPendingSourceLogin]=useState(null),
         [loomySmsPhone,setLoomySmsPhone]=useState(''),[loomySmsCode,setLoomySmsCode]=useState(''),
         [loomySmsSent,setLoomySmsSent]=useState(false),
         [sourceCreditsProvider,setSourceCreditsProvider]=useState('qoder'),
        [sourceCredits,setSourceCredits]=useState(null),
        [sourceClaims,setSourceClaims]=useState(null),
        [hostModels,setHostModels]=useState(null),[hostModelBusy,setHostModelBusy]=useState(''),
        [hostSelectedModel,setHostSelectedModel]=useState(''),
        [hostManualModel,setHostManualModel]=useState(''),[reuseSubtab,setReuseSubtab]=useState('sessions'),
        [showReferenceChannels,setShowReferenceChannels]=useState(false),
         [adoptionPreview,setAdoptionPreview]=useState(null),[adoptionBusy,setAdoptionBusy]=useState(''),
         [adoptionResults,setAdoptionResults]=useState({}),[verifyResults,setVerifyResults]=useState([]),
         [verifyBusy,setVerifyBusy]=useState(false),[autoFreeView,setAutoFreeView]=useState(null),
         [autoFreeBusy,setAutoFreeBusy]=useState(false),
         [hostCatalog,setHostCatalog]=useState(null),
         [hostCatalogBusy,setHostCatalogBusy]=useState(false),
         [freeProvider,setFreeProvider]=useState(''),
         [freeModel,setFreeModel]=useState(''),
          [manualFreeModel,setManualFreeModel]=useState(''),
          [savedConfig,setSavedConfig]=useState(null),
          [selectedAccountChannel,setSelectedAccountChannel]=useState('all'),
          [mimoBusy,setMimoBusy]=useState(false),
          [mimoRegion,setMimoRegion]=useState('cn'),
          [mimoLogin,setMimoLogin]=useState(null),
          [doubaoCookie,setDoubaoCookie]=useState(''),[doubaoBusy,setDoubaoBusy]=useState(false),
           [doubaoLogin,setDoubaoLogin]=useState(null),
           [meooCookie,setMeooCookie]=useState(''),[meooBusy,setMeooBusy]=useState(false),
           [meooLogin,setMeooLogin]=useState(null),
           [qwenBusy,setQwenBusy]=useState(false),[qwenLogin,setQwenLogin]=useState(null),
           [awsQuickBusy,setAwsQuickBusy]=useState(false),
           [awsQuickLogin,setAwsQuickLogin]=useState(null),
           [awsQuickCallback,setAwsQuickCallback]=useState(''),
           [providerQuery,setProviderQuery]=useState('');
       const refreshRuntime=useCallback(async()=>{
         const response=await fetch(URL+'/status',{cache:'no-store'});
         if(response.ok)setStatus(await response.json());
         await Promise.all([
           fetch(URL+'/channels/accounts',{cache:'no-store'}).then(async r=>{if(r.ok)setChannelsView(await r.json());}),
           fetch(URL+'/checkins',{cache:'no-store'}).then(async r=>{if(r.ok)setCheckinsView(await r.json());}),
           fetch(URL+'/activities',{cache:'no-store'}).then(async r=>{if(r.ok)setActivitiesView(await r.json());}),
           fetch(URL+'/models/autofree',{cache:'no-store'}).then(async r=>{if(r.ok){const d=await r.json();setAutoFreeView(d.result)}}),
         ]);
       },[]);
       const refreshActivities=useCallback(async()=>{
         if(activitiesBusy)return;
         setActivitiesBusy(true);setError('');
         try{
           const res=await fetch(URL+'/activities/refresh',{method:'POST'});
           const data=await res.json();
           if(!res.ok||data.ok!==true)throw Error(data.error||'官方活动核验失败');
           setActivitiesView(data);
           setNotice(data.refreshState==='partial'?'部分来源尚未完成状态查询':
             '已请求更新官方活动状态，请以逐项回执为准');
         }catch(error){setError(String(error?.message||'活动核验暂不可用'))}
         finally{setActivitiesBusy(false)}
       },[activitiesBusy]);
       const refresh=useCallback(async()=>{
         setBusy(true);setError('');
         try{
           const a=await fetch(URL+'/config',{cache:'no-store'});
           if(!a.ok)throw Error('配置读取失败 ('+a.status+')');
           const data=await a.json();if(!data.ok||!data.config)throw Error('插件未返回配置');
           setCfg(data.config);setRaw(JSON.stringify(data.config,null,2));setSavedConfig(data.config);
           await refreshRuntime();
         }catch(e){setError(String(e.message??e))}finally{setBusy(false)}
       },[refreshRuntime]);
       useEffect(()=>{
         refresh();
         // Read local validation snapshots only; never start OAuth or inference
         // simply because the user has opened the settings page.
         if(typeof setInterval!=='function')return;
         const timer=setInterval(()=>{
            void Promise.all([
              fetch(URL+'/channels/accounts',{cache:'no-store'}).then(async res=>{
                if(res.ok)setChannelsView(await res.json())
              }),
              fetch(URL+'/checkins',{cache:'no-store'}).then(async res=>{
                if(res.ok)setCheckinsView(await res.json())
              }),
              fetch(URL+'/activities',{cache:'no-store'}).then(async res=>{
                if(res.ok)setActivitiesView(await res.json())
              })
             ]).catch(()=>{});
          },30000);
          return ()=>clearInterval(timer);
        },[refresh]);
        useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return ()=>clearTimeout(timer)},[notice]);
        useEffect(()=>{if(!error)return;const timer=setTimeout(()=>setError(''),5000);return ()=>clearTimeout(timer)},[error]);
        useEffect(()=>{
          if(mimoLogin?.status!=='waiting')return;
          let disposed=false;
          const timer=setInterval(async()=>{
            try{
              const response=await fetch(URL+'/channels/mimo/login',{method:'POST',
                headers:{'content-type':'application/json'},body:JSON.stringify({action:'poll'})});
              const data=await response.json();
              if(disposed||!response.ok||!data.ok)return;
              const next=data.result;
              if(next.status==='done'){
                setMimoLogin(next);setNotice('MiMo Desktop 会员会话已独立保存；请再核验真实模型调用。');
                await refresh();
              }else if(next.status==='error'||next.status==='canceled'){
                setMimoLogin(next);setError('MiMo 会员授权未完成，请重新选择登录或扫描本机会话。');
              }
            }catch{/* Temporary polling error: retry without losing draft. */}
          },1800);
          return ()=>{disposed=true;clearInterval(timer)};
        },[mimoLogin?.status,refresh]);
        useEffect(()=>{
          if(doubaoLogin?.status!=='waiting')return;
          let disposed=false;
          const timer=setInterval(async()=>{
            try{
              const response=await fetch(URL+'/channels/doubao/login',{method:'POST',
                headers:{'content-type':'application/json'},body:JSON.stringify({action:'poll'})});
              const data=await response.json();
              if(disposed||!response.ok||!data.ok)return;
              const next=data.result;
              if(next.status==='done'){
                setDoubaoLogin(next);setNotice('豆包浏览器登录已完成，凭据已归本插件独立持有。');
                await refresh();
              }else if(next.status==='error'||next.status==='canceled'){
                setDoubaoLogin(next);setError('豆包授权未完成，请重试或使用 Cookie 导入。');
              }
            }catch{/* Transient polling error: retry next interval. */}
          },1800);
          return ()=>{disposed=true;clearInterval(timer)};
         },[doubaoLogin?.status,refresh]);
         useEffect(()=>{
           if(meooLogin?.status!=='waiting')return;
           let disposed=false;
           const timer=setInterval(async()=>{
             try{
               const response=await fetch(URL+'/channels/meoo/login',{method:'POST',
                 headers:{'content-type':'application/json'},body:JSON.stringify({action:'poll'})});
               const data=await response.json();
               if(disposed||!response.ok||!data.ok)return;
               const next=data.result;
               if(next.status==='done'){
                 setMeooLogin(next);
                 setNotice('秒悟会员身份已通过远端确认，独立授权已保存；模型可用性还需完整推理验收。');
                 await refresh();
               }else if(next.status==='error'||next.status==='canceled'){
                 setMeooLogin(next);setError('秒悟浏览器授权未完成，可重新扫码或通过 Cookie 导入。');
               }
             }catch{/* Transient lookup error; do not fabricate login success. */}
           },1800);
           return ()=>{disposed=true;clearInterval(timer)};
         },[meooLogin?.status,refresh]);
         useEffect(()=>{
           if(qwenLogin?.status!=='waiting')return;
           let disposed=false,active=false;
           const timer=setInterval(async()=>{
             if(active)return;active=true;
             try{
               const response=await fetch(URL+'/channels/qwenwork/login',{method:'POST',
                 headers:{'content-type':'application/json'},body:JSON.stringify({action:'poll'})});
               const data=await response.json();
               if(disposed||!response.ok||!data.ok)return;
               const next=data.result;
               if(next.status==='done'){
                 setQwenLogin(next);
                 setNotice('千问办公已确认官方身份，私有授权已提交；请按实际积分和模型倍率使用。');
                 await refresh();
               }else if(['error','expired','canceled'].includes(next.status)){
                 setQwenLogin(next);setError('千问办公授权未完成或已过期；可以重新发起设备码授权。');
               }
             }catch{/* Temporary network failure is not a failed member grant. */}
             finally{active=false}
           },1800);
           return ()=>{disposed=true;clearInterval(timer)};
         },[qwenLogin?.status,refresh]);
         useEffect(()=>{
           if(awsQuickLogin?.status!=='waiting')return;
           let disposed=false,active=false;
           const timer=setInterval(async()=>{
             if(active)return;active=true;
             try{
               const response=await fetch(URL+'/channels/aws-quick/login',{
                 method:'POST',headers:{'content-type':'application/json'},
                 body:JSON.stringify({action:'poll'})});
               const data=await response.json();
               if(disposed||!response.ok||!data.ok)return;
               const next=data.result;
               if(next.status==='done'){
                 setAwsQuickLogin(next);
                 setNotice('Amazon Quick 官方身份已确认，DSH 自有授权和账号已保存。模型实际可用性需完成推理测试。');
                 await refresh();
               }else if(['error','expired','canceled','discovery_saved'].includes(next.status)){
                 setAwsQuickLogin(next);
                 setNotice(next.status==='discovery_saved'?
                   '已保存当前 AWS 租户发现信息，请再次点击开始账号授权。':'');
                 if(next.status!=='discovery_saved')setError('Amazon Quick 授权未完成；可以重新开始 OAuth 登录。');
               }
             }catch{/* Do not invent authentication completion from transport errors. */}
             finally{active=false}
           },1800);
           return ()=>{disposed=true;clearInterval(timer)};
         },[awsQuickLogin?.status,refresh]);
         useEffect(()=>{
          if(tab!=='reuse'||reuseSubtab!=='host')return;
          const first=hostModels?.providerId||
            channelsView?.sessionReuse?.hostProviders?.[0]?.providerId;
          if(first&&!hostModels?.providerId)void loadHostModels(first,true);
          void loadHostCatalog(true);
          const timer=setInterval(()=>{
            void loadHostCatalog(true);
            if(hostModels?.providerId)void loadHostModels(hostModels.providerId,true);
          },5*60*1000);
          return ()=>clearInterval(timer);
        },[tab,reuseSubtab,hostModels?.providerId]);
        // Visiting the adoption tab scans metadata only; no account migration.
      useEffect(()=>{
        if(tab==='reuse'&&reuseSubtab==='sessions')void loadAdoptionPreview();
        if(tab==='pool')void refreshAutoFree();
        if(tab==='host')void loadHostCatalog();
      },[tab,reuseSubtab]);
       async function loadHostCatalog(silent=false){
         if(!silent){if(hostCatalogBusy)return;setHostCatalogBusy(true);setError('')}
         try{
           const res=await fetch(URL+'/host/catalog',{cache:'no-store'});
           const data=await res.json();
           if(!res.ok||!data.ok||!Array.isArray(data.providers))
             throw Error(data.error||'DSH Provider 模型目录读取失败');
           setHostCatalog(old=>({...data,
             changes:diffProviderCatalog(old?.providers,data.providers)}));
         }catch(error){if(!silent)setError(String(error?.message??error))}
         finally{if(!silent)setHostCatalogBusy(false)}
       }      async function refreshAutoFree(){
        if(autoFreeBusy)return;
        setAutoFreeBusy(true);setError('');
        try{
          const res=await fetch(URL+'/models/autofree/refresh',{method:'POST'});
          const data=await res.json();
          if(!res.ok||!data.ok)throw Error(data.error||'来源模型目录暂不可用');
          setAutoFreeView(data.result);
        }catch(error){setError(String(error?.message??error))}
        finally{setAutoFreeBusy(false)}
      }
      async function verifyAdopted(){
        if(verifyBusy)return;
        setVerifyBusy(true);setVerifyResults([]);setError('');
        try{
          const res=await fetch(URL+'/channels/adopt/verify',{method:'POST'});
          const data=await res.json();
          if(!res.ok||!data.ok)throw Error(data.error||'批量验证失败');
          setVerifyResults(Array.isArray(data.results)?data.results:[]);
          setNotice('已对 '+data.attempted+' 个已接管账号执行来源授权探针；失败的不标记为在线。');
           await refreshRuntime();
          await loadAdoptionPreview();
        }catch(error){setError(String(error?.message??error))}
        finally{setVerifyBusy(false)}
      }
      const edit=(collection,index,change)=>{
        setCfg(old=>{
          const next=structuredClone(old);next[collection][index]={...next[collection][index],...change};return next;
        });
      };
      const add=(collection,value)=>setCfg(old=>({...old,[collection]:[...old[collection],value]}));
      const remove=(collection,index)=>setCfg(old=>({...old,[collection]:old[collection].filter((_,i)=>i!==index)}));
      const changeHost=change=>setCfg(old=>({...old,hostFailover:{...old.hostFailover,...change}}));
      const setFreeModelMark=(providerId,model,free)=>{
        if(!providerId||!model||model.length>160)return;
        if(free&&!window.confirm('这是你人工确认的免费模型，平台未必保证不计费。确认将 '+providerId+' / '+model+' 标为免费并允许 AutoFree 使用？'))return;
        setCfg(old=>{
          const rules=old.freePool??{providerIds:[],models:[]};
          return {...old,freePool:{...rules,
            models:[...(rules.models??[]).filter(row=>row.providerId!==providerId||row.model!==model),
              {providerId,model,free}]}};
        });
        setNotice('已修改人工模型费用规则草稿，请保存配置后刷新模型池。');
      };
      const resetFreeModelMark=(providerId,model)=>{
        setCfg(old=>({...old,freePool:{...old.freePool,
          models:(old.freePool?.models??[]).filter(row=>row.providerId!==providerId||row.model!==model)}}));
      };
      const markFreeProvider=(providerId,free)=>{
        if(free&&!window.confirm('将整个渠道已发现的全部模型标记为免费可能产生实际费用。你已逐个核实该渠道所有模型都免费吗？'))return;
        setCfg(old=>({...old,freePool:{...old.freePool,
          providerIds:free?[...new Set([...(old.freePool?.providerIds??[]),providerId])]:
            (old.freePool?.providerIds??[]).filter(id=>id!==providerId)}}));
        setNotice('渠道免费规则已修改，保存配置后才会生效。');
      };

      const changeTier=(routeIndex,tierIndex,change)=>{
        setCfg(old=>{const next=structuredClone(old);Object.assign(next.routes[routeIndex].tiers[tierIndex],change);return next;});
      };
      const changeHostTier=(index,change)=>setCfg(old=>{
        const next=structuredClone(old);Object.assign(next.hostFailover.priority[index],change);return next;
      });
      const move=(collection,index,delta)=>{
        const target=index+delta;setCfg(old=>{
          if(target<0||target>=old[collection].length)return old;
          const next=structuredClone(old);const rows=next[collection];[rows[index],rows[target]]=[rows[target],rows[index]];return next;
        });
      };
       async function runAction(path,body,success){
         const changesConfig=path==='/channels/import'||
           (path==='/channels/accounts/action'&&['enable','logout'].includes(body.action));
         const hasDraft=Boolean(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig));
         if(changesConfig&&hasDraft){
           setError('当前表单存在未保存修改。请先保存配置，再修改账号关联，以免覆盖新旧账号状态。');
           return;
         }
         setActionBusy(path+':'+(body.accountId||body.providerId||body.action));setError('');setNotice('');
         try{
           const response=await fetch(URL+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error(data.error||'操作失败（'+response.status+'）');
           await (changesConfig?refresh():refreshRuntime());
          if(path==='/channels/discover'){
            setDiscovered(old=>({...old,[body.providerId]:data.candidates||[]}));
            setNotice('发现 '+(data.candidates?.length||0)+' 个候选；需人工确认后才能导入。');
          }else if(path==='/channels/import'){
            setDiscovered(old=>({...old,[body.providerId]:[]}));
            setNotice('账号引用已导入并启用；还需完成服务端鉴权及真实模型回复验收。');
          }
          else if(path==='/channels/accounts/action'&&body.action==='refresh-all')setNotice('已检查 '+data.attempted+' 个可验证账号，各账号的真实结果见上方。');
          else if(path==='/channels/accounts/action'&&body.action==='model-test'){
            if(data.result?.state==='verified')setNotice('真实回复成功：'+data.result.modelId+
              ' · '+(data.result.responsePreview||'完成')+'；已记录到对应账号。');
            else if(data.result?.state==='skipped')setNotice(data.result?.message||'模型价格或资格未确认，未发送请求。');
            else setError((data.result?.code?data.result.code+' · ':'')+
              (data.result?.message||'模型尚未完成真实回复验收；没有标记为可用。'));
          }
          else setNotice(success||'操作完成，详细状态已刷新。');
        }catch(error){setError(String(error?.message??error));}
        finally{setActionBusy('')}
      }
      // Browser-side client of the existing upstream DSH connection.fetch RPC.
      // No custom OAuth, refresh, or daily-credit protocol is implemented here.
      async function callSourceRpc(method,payload){
        if(status?.embeddedPack?.state!=='mounted')
          throw Error('来源渠道包尚未在隔离宿主挂载');
        const provider=payload?.provider;
        if(provider!==undefined&&!status.embeddedPack.channels?.includes(provider))
          throw Error('未知来源渠道');
        const rpcId='native-router-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
        const response=await fetch(SOURCE_RPC,{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({type:'client-request',rpcId,method:'native-router-channel-pack',payload:{method,payload}}),
        });
        if(!response.ok)throw Error('上游 DSH 管理接口不可用（HTTP '+response.status+'）');
        let envelope;
        try{envelope=await response.json()}
        catch{throw Error('上游 DSH 响应不是有效 JSON')}
        if(envelope?.type!=='server-response'||envelope.rpcId!==rpcId
          ||!envelope.result||typeof envelope.result!=='object')
          throw Error('上游 DSH 响应校验失败');
        if(envelope.result.ok!==true){
          const code=String(envelope.result.error?.code??'source-rejected');
          throw Error('上游拒绝操作：'+(/^[a-zA-Z0-9/_-]{1,64}$/.test(code)?code:'source-rejected'));
        }
        return envelope.result.value??{};
      }
      async function sourceLogin(providerId){
        if(pendingSourceLogin){setError('已有渠道授权待确认，请先完成或结束本次跟踪');return}
        if(!window.confirm('确认在隔离来源渠道包中为 '+providerId+' 创建新的授权流程？授权链接只供你手动核对并打开，不会自动跳转。'))return;
        setSourceRpcBusy('login');setError('');setNotice('');
        try{
          const result=await callSourceRpc('account.create',{provider:providerId});
          if(typeof result.accountId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(result.accountId))
            throw Error('上游未返回有效的待授权账号 ID');
          const loginUrl=safeSourceLoginUrl(result.loginUrl);
          setPendingSourceLogin({providerId,accountId:result.accountId,loginUrl});
          setLoomySmsPhone('');setLoomySmsCode('');setLoomySmsSent(false);
          setNotice(loginUrl?'已创建来源授权流程。请核对链接域名，打开授权后手动点击检查登录结果。':
            '来源授权流程已建立，但返回的授权链接不符合安全要求，未自动打开。');
           await refreshRuntime();
        }catch(error){setError(String(error?.message??error))}
        finally{setSourceRpcBusy('')}
      }
      function sourceDismissLogin(){
        if(!pendingSourceLogin)return;
        if(!window.confirm('确定结束当前页面的授权跟踪？仅清除界面待确认状态，不会删除来源账号或凭据；已建账号仍可在来源账号池管理。'))return;
        setPendingSourceLogin(null);
        setLoomySmsPhone('');setLoomySmsCode('');setLoomySmsSent(false);
        setNotice('已结束本页授权跟踪，来源账号池未修改。');
      }
      function sourceReuseLoomyAccount(account){
        if(account?.providerId!=='loomy'||account.enabled!==true
          ||typeof account.id!=='string'||!/^[-_a-zA-Z0-9]{1,100}$/.test(account.id))return;
        if(pendingSourceLogin){setError('已有授权待确认，不能覆盖另一账号的待授权状态');return;}
        setPendingSourceLogin({providerId:'loomy',accountId:account.id,mode:'sms-reauth'});
        setLoomySmsPhone('');setLoomySmsCode('');setLoomySmsSent(false);
        setNotice('准备为现有 Loomy 账号重新授权，未自动申请短信，也未创建新账号。');
      }
      async function sourceSendLoomySms(){
        const pending=pendingSourceLogin;
        if(pending?.providerId!=='loomy'||!/^1[3-9]\d{9}$/.test(loomySmsPhone)){
          setError('请先创建 Loomy 授权并填写有效手机号');return;
        }
        setSourceRpcBusy('sms-send');setError('');setNotice('');
        try{
          const result=await callSourceRpc('login.sendSms',{
            provider:'loomy',accountId:pending.accountId,phone:loomySmsPhone});
          if(typeof result.msgid!=='string'||!result.msgid||result.msgid.length>256)
            throw Error('官方短信请求尚未取得有效回执');
          setLoomySmsSent(true);
          setNotice('已申请官方短信验证码。收到后填写验证码完成独立登录。');
        }catch{setError('Loomy 官方短信请求未成功；没有标记登录成功。');}
        finally{setSourceRpcBusy('')}
      }
      async function sourceSubmitLoomySms(){
        const pending=pendingSourceLogin;
        if(pending?.providerId!=='loomy'||!loomySmsSent||!/^\d{4,8}$/.test(loomySmsCode)){
          setError('请先获取官方短信验证码并填写有效数字验证码');return;
        }
        setSourceRpcBusy('sms-submit');setError('');setNotice('');
        try{
          const result=await callSourceRpc('login.submitSms',{
            provider:'loomy',accountId:pending.accountId,code:loomySmsCode});
          if(result.done!==true)throw Error('官方未确认验证码');
          setLoomySmsCode('');setLoomySmsPhone('');setLoomySmsSent(false);
          setPendingSourceLogin(null);
          setNotice('Loomy 官方短信认证已成功保存；模型调用仍须另外验收。');
          await refreshRuntime();await refreshAutoFree();
        }catch{setLoomySmsCode('');setError('Loomy 验证码未通过或授权未完成。');}
        finally{setSourceRpcBusy('')}
      }
      async function sourcePollLogin(){
        const pending=pendingSourceLogin;
        if(!pending)return;
        setSourceRpcBusy('poll');setError('');setNotice('');
        try{
          const result=await callSourceRpc('login.poll',{accountId:pending.accountId});
          if(result.done!==true){
            setNotice('来源授权尚未完成；并未认定该账号已连接。');return;
          }
          if(result.success!==true)throw Error('来源账号未能完成授权，请从原渠道确认');
          setPendingSourceLogin(null);
          setLoomySmsCode('');setLoomySmsPhone('');setLoomySmsSent(false);
          setNotice('来源端确认已保存登录凭据，新账号已经成为独立来源；在线推理和签到仍需核验。');
           await refreshRuntime();
          await refreshAutoFree();
        }catch(error){setError(String(error?.message??error))}
        finally{setSourceRpcBusy('')}
      }
      async function sourceRefreshAccount(account){
        setSourceRpcBusy('refresh');setError('');setNotice('');
        try{
          const result=await callSourceRpc('account.refresh',{accountId:account.id});
          if(result.success!==true)throw Error('来源未确认续期成功');
          setNotice('来源端返回续期操作成功；请另外验证账号连接状态。');
           await refreshRuntime();
        }catch(error){setError(String(error?.message??error))}
        finally{setSourceRpcBusy('')}
      }
      async function sourceCheckinStatus(providerId){
        setSourceRpcBusy('status');setError('');setNotice('');setSourceClaims(null);
        try{
          const result=await callSourceRpc('credits.status',{provider:providerId});
          if(!Array.isArray(result.accounts))throw Error('来源签到状态格式无效');
          const accounts=result.accounts.slice(0,200).filter(row=>
            typeof row?.accountId==='string'&&row.accountId.length<=100)
             .map(row=>({accountId:row.accountId,
               nickname:typeof row.nickname==='string'?row.nickname.slice(0,80):'',              status:row.status&&typeof row.status==='object'?{
                active:typeof row.status.active==='boolean'?row.status.active:null,
                todayCheckedIn:typeof row.status.todayCheckedIn==='boolean'?row.status.todayCheckedIn:null,
                available:true,
              }:null}));
          setSourceCredits({providerId,accounts});
          setNotice('已按需读取 '+providerId+' 的来源签到状态；未知状态不计入成功。');
        }catch(error){setSourceCredits(null);setError(String(error?.message??error))}
        finally{setSourceRpcBusy('')}
      }
      async function sourceClaimAll(providerId){
        if(!sourceCredits||sourceCredits.providerId!==providerId||!sourceCredits.accounts.length)return;
        if(!window.confirm('确认调用 '+providerId+' 来源渠道的批量领取？这将逐一处理该渠道所有来源账号，不是仅给某一个账号签到。'))return;
        setSourceRpcBusy('claim');setError('');setNotice('');
        try{
          const result=await callSourceRpc('credits.claimAll',{provider:providerId});
          if(!Array.isArray(result.results))throw Error('上游未返回逐账号领取结果，不能认为领取成功');
          setSourceClaims({providerId,results:result.results.slice(0,200).filter(row=>
            typeof row?.accountId==='string'&&row.accountId.length<=100)
            .map(row=>({accountId:row.accountId,kind:typeof row.outcome?.kind==='string'
              ?row.outcome.kind.slice(0,40):'unconfirmed'}))});
          setSourceCredits(null);
          setNotice('来源批量领取调用已结束；必须重新查询状态确认是否真正签到，不能把请求成功当成签到成功。');
        }catch(error){setError(String(error?.message??error))}
        finally{setSourceRpcBusy('')}
      }
      async function loadAdoptionPreview(){
         setAdoptionBusy('preview');setError('');
         try{
           const response=await fetch(URL+'/channels/adopt/preview',{cache:'no-store'});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error('独立接管账号检查暂不可用');
           setAdoptionPreview(data.result);
         }catch{setError('无法读取可迁移账号，未访问或改动授权')}finally{setAdoptionBusy('')}
       }
       async function adoptOriginalAccount(row){
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('当前存在未保存配置草稿。请先保存后再接管账号，避免覆盖新接管的账号设置。');
           return;
         }
         if(!row?.portable||adoptionBusy||!window.confirm(
           '将 '+row.providerId+' 的账号 '+(row.label||row.accountId)+' 复制到聚合路由独立授权库？原账号保持不变；迁移后仍需验证模型和签到。'))return;
         const key=row.providerId+':'+row.accountId;
         setAdoptionBusy('adopt:'+row.accountId);setError('');setNotice('');
         setAdoptionResults(old=>({...old,[key]:{state:'pending',message:'正在核验本机授权并安全复制…'}}));
         try{
           const response=await fetch(URL+'/channels/adopt',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({
               providerId:row.providerId,accountId:row.accountId,consent:true})});
           const data=await response.json();
           const state=data?.result?.state??'unavailable';
           if(!response.ok||!data.ok||!['stored_unverified','already_owned'].includes(state)){
             const message=data?.error||'接管失败；原账号没有被修改。请刷新账号来源后再试。';
             const stage=typeof data?.result?.stage==='string'?data.result.stage.slice(0,40):'';
             setAdoptionResults(old=>({...old,[key]:{state:'failed',message:'未接管（'+state+'）：'+message+(stage?'；阶段：'+stage:'')}}));
             setError('账号接管失败：'+message);
             return;
           }
           const message=state==='already_owned'
             ?'该账号此前已经接管；原账号未修改。请进行模型及签到验证。'
             :data.result.modelCatalogVerified===true
               ?'授权副本已保存，且模型目录鉴权通过；仍需验证真实推理与签到。'
               :'授权副本已保存；仍需进行模型、推理与签到验证。';
           setAdoptionResults(old=>({...old,[key]:{state:'success',message}}));
           await refresh();
           await loadAdoptionPreview();
           await refreshAutoFree();
           setNotice(row.label+'：'+message);
         }catch(error){
           const message='请求未完成（'+String(error?.name??'network').slice(0,24)+'）；请刷新后检查是否已接管，避免重复操作。';
           setAdoptionResults(old=>({...old,[key]:{state:'failed',message}}));
           setError(message);
         }finally{setAdoptionBusy('')}
       }
       async function loadHostModels(providerId,silent=false){
         if(!providerId)return;
         if(!silent){setHostModelBusy(providerId);setError('')}
         try{
           const response=await fetch(URL+'/host/models',{
             method:'POST',headers:{'content-type':'application/json'},
             body:JSON.stringify({providerId}),
           });
           const data=await response.json();
           if(!data.result||!['ready','unavailable'].includes(data.result.state)
             ||data.result.providerId!==providerId)
             throw Error('宿主插件模型目录接口暂不可用');
            if(data.result.state!=='ready'){
              if(!silent){setHostModels({...data.result,models:[],checkedAt:Date.now()});
                setNotice('原插件没有公开模型目录；原 Provider 仍然保留接入。')}
              return;
            }           setHostModels(old=>({...data.result,checkedAt:Date.now(),
             changes:old?.providerId===providerId?diffModelLists(old.models,data.result.models):null}));
           if(!silent)setHostSelectedModel(data.result.models?.[0]?.id||'');
         }catch(error){if(!silent)setError(String(error?.message??error))}
         finally{if(!silent)setHostModelBusy('')}
        }
        async function loadUpstreamModels(providerId){        setModelBusy(true);setError('');setEmbeddedModels(null);
        try{
          const response=await fetch(URL+'/channels/embedded/models',{
            method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId}),
          });
          const data=await response.json();
          if(!response.ok||!data.ok)throw Error(data.error||'来源模型查询失败');
          setEmbeddedModels(data.result);
        }catch(error){setError(String(error?.message??error))}
        finally{setModelBusy(false)}
      }
      const setCheckinSettings=change=>setCfg(old=>({...old,checkin:{...old.checkin,...change}}));
      const setAccountAuto=(id,enabled)=>setCfg(old=>({...old,accounts:old.accounts.map(a=>a.id===id?{...a,autoCheckin:enabled}:a)}));
      const addNativeProvider=channel=>{
        setCfg(old=>old.providers.some(p=>p.id===channel.id)?old:{...old,providers:[...old.providers,
          {id:channel.id,name:channel.name,protocol:'native-channel',baseUrl:'',models:[],enabled:true,supportsTools:true}]});
        setTab('providers');setNotice('已为此原生渠道启用提供商配置；账号授权仍由原渠道或本插件自主登录完成，不会复制原有登录秘密。');
      };
             async function scanMimo(){
         if(mimoBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('存在未保存的配置草稿。请先保存后扫描 MiMo。');return;
         }
         setMimoBusy(true);setError('');setNotice('');
         try{
           const scan=await fetch(URL+'/channels/discover',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'own_mimo_desktop'})});
           const found=await scan.json();
           if(!scan.ok||!found.ok)throw Error(found.error||'MiMo 本机授权扫描失败');
           setDiscovered(old=>({...old,own_mimo_desktop:found.candidates??[]}));
           await refreshRuntime();
           setNotice('发现 '+(found.candidates?.length||0)+' 个 MiMo 候选，请在下方渠道卡确认后导入。');
         }catch(error){setError(String(error?.message??error))}
         finally{setMimoBusy(false)}
       }
       async function startMimoBrowser(){
         if(mimoBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('存在尚未保存的配置草稿，请先保存。');return;
         }
         setMimoBusy(true);setError('');
         try{
           const res=await fetch(URL+'/channels/mimo/login',{method:'POST',
             headers:{'content-type':'application/json'},
             body:JSON.stringify({action:'start',region:mimoRegion})});
           const data=await res.json();
           if(!res.ok||!data.ok)throw Error(data.error||'MiMo 会员登录未能启动');
           setMimoLogin(data.result);
           setNotice('独立浏览器已启动，请完成小米会员账号登录。');
         }catch(error){setError(String(error?.message??error))}
         finally{setMimoBusy(false)}
       }
       async function cancelMimoBrowser(){
         await fetch(URL+'/channels/mimo/login',{method:'POST',
           headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel'})}).catch(()=>{});
         setMimoLogin(null);
       }
       async function addDoubaoCookie(){
         if(doubaoBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('存在未保存的配置草稿。请先保存再接入豆包账号。');return;
         }
         setDoubaoBusy(true);setError('');setNotice('');
         try{
           const response=await fetch(URL+'/channels/doubao/cookie',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({cookie:doubaoCookie})});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error(data.error||'豆包授权未保存');
           setDoubaoCookie('');await refresh();
           setNotice('豆包会员身份已获远端确认，账号保存在独立凭据库；还需实测模型回复与额度。');
         }catch(error){setError(String(error?.message??error))}
         finally{setDoubaoBusy(false)}
       }
       async function startDoubaoBrowser(){
         if(doubaoBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('存在未保存的配置草稿。请先保存再开始豆包扫码授权。');return;
         }
         setDoubaoBusy(true);setError('');setNotice('');
         try{
           const response=await fetch(URL+'/channels/doubao/login',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({action:'start'})});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error(data.error||'豆包登录无法启动');
           setDoubaoLogin(data.result);
           setNotice('已启动专属浏览器授权流程；登录完成后会自动检测并加入本插件账号池。');
         }catch(error){setError(String(error?.message??error))}
         finally{setDoubaoBusy(false)}
       }
       async function cancelDoubaoBrowser(){
         await fetch(URL+'/channels/doubao/login',{method:'POST',
           headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel'})}).catch(()=>{});
         setDoubaoLogin(null);
       }
       async function addMeooCookie(){
         if(meooBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('请先保存配置草稿再接管秒悟账号。');return;
         }
         setMeooBusy(true);setError('');setNotice('');
         try{
           const response=await fetch(URL+'/channels/meoo/cookie',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({cookie:meooCookie})});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error(data.error||'秒悟会员授权未验证成功');
           setMeooCookie('');await refresh();
           setNotice('秒悟自有会员已验证并保存，模型列表和积分将从对应会员账号读取。');
         }catch(error){setError(String(error?.message??error))}
         finally{setMeooBusy(false)}
       }
       async function startMeooBrowser(){
         if(meooBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('请先保存配置草稿再开始秒悟网页授权。');return;
         }
         setMeooBusy(true);setError('');setNotice('');
         try{
           const response=await fetch(URL+'/channels/meoo/login',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({action:'start'})});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error(data.error||'秒悟浏览器登录无法启动');
           setMeooLogin(data.result);
           setNotice('已打开秒悟独立登录窗口；账户身份由秒悟官方接口确认后才保存。');
         }catch(error){setError(String(error?.message??error))}
         finally{setMeooBusy(false)}
       }
       async function cancelMeooBrowser(){
         await fetch(URL+'/channels/meoo/login',{method:'POST',
           headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel'})}).catch(()=>{});
         setMeooLogin(null);
       }
       async function startQwenDevice(){
         if(qwenBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('请先保存配置草稿，再申请千问办公设备授权。');return;
         }
         setQwenBusy(true);setError('');setNotice('');
         try{
           const response=await fetch(URL+'/channels/qwenwork/login',{method:'POST',
             headers:{'content-type':'application/json'},body:JSON.stringify({action:'start'})});
           const data=await response.json();
           if(!response.ok||!data.ok)throw Error(data.error||'千问办公设备授权未能发起');
           setQwenLogin(data.result);
           setNotice('已创建本插件专属设备码，请通过下方官方授权链接登录并确认账号。');
         }catch(error){setError(String(error?.message??error))}
         finally{setQwenBusy(false)}
       }
       async function cancelQwenDevice(){
         await fetch(URL+'/channels/qwenwork/login',{method:'POST',
           headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel'})}).catch(()=>{});
         setQwenLogin(null);
       }
       async function awsQuickRequest(action,callbackUrl){
         const response=await fetch(URL+'/channels/aws-quick/login',{method:'POST',
           headers:{'content-type':'application/json'},
           body:JSON.stringify({action,...(action==='submit'?{callbackUrl}:{})})});
         const data=await response.json();
         if(!response.ok||!data.ok)throw Error(data.error||'Amazon Quick 自有授权未能完成');
         return data.result;
       }
       async function startAwsQuick(){
         if(awsQuickBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('请先保存配置草稿，再申请 Amazon Quick 登录。');return;
         }
         setAwsQuickBusy(true);setError('');setNotice('');
         try{
           const state=await awsQuickRequest('start');
           setAwsQuickLogin(state);
           setNotice('已创建独立 OAuth PKCE 授权，请用自己的 Amazon Quick 账号在官方页面登录。');
         }catch(e){setError(String(e?.message??e))}
         finally{setAwsQuickBusy(false)}
       }
       async function submitAwsQuickCallback(){
         if(awsQuickBusy||!awsQuickCallback.trim())return;
         setAwsQuickBusy(true);setError('');setNotice('');
         try{
           const state=await awsQuickRequest('submit',awsQuickCallback.trim());
           setAwsQuickCallback('');
           setAwsQuickLogin(state);
           if(state.status==='discovery_saved')
             setNotice('已保存 AWS 授权发现信息。点击重新开始 OAuth，即可进入正式授权。');
           else setNotice('已提交官方回调，正在核验身份并保存 DSH 自有授权。');
         }catch(e){setError(String(e?.message??e))}
         finally{setAwsQuickBusy(false)}
       }
       async function cancelAwsQuick(){
         await awsQuickRequest('cancel').catch(()=>{});
         setAwsQuickLogin(null);setAwsQuickCallback('');
       }
       async function importAwsQuickLocal(){
         if(awsQuickBusy)return;
         if(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig)){
           setError('请先保存配置草稿再接管本机 Amazon Quick 账号。');return;
         }
         setAwsQuickBusy(true);setError('');setNotice('');
         try{
           const response=await fetch(URL+'/channels/aws-quick/import-local',{
             method:'POST',headers:{'content-type':'application/json'},
             body:JSON.stringify({consent:true})});
           const data=await response.json();
           if(!response.ok||!data.ok)
             throw Error(data.error||'未找到已登录且身份可确认的 Amazon Quick 客户端');
           setNotice('已将本机登录态一次性转为 DSH 自有凭据，原客户端卸载后仍能独立续期。');
           await refresh();
         }catch(e){setError(String(e?.message??e))}
         finally{setAwsQuickBusy(false)}
       }
   async function save(){
        setBusy(true);setError('');setNotice('');
        try{
          const value=tab==='advanced'?JSON.parse(raw):cfg;
          const res=await fetch(URL+'/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
          const data=await res.json();
          if(!res.ok||!data.ok)throw Error(data.error??'保存失败');
           setCfg(data.config);setRaw(JSON.stringify(data.config,null,2));setSavedConfig(data.config);
          await refresh();
          if(tab==='pool')await refreshAutoFree();
          setNotice('配置保存成功，模型池及账号状态已更新；涉及宿主级路由注册时请完整重启 DSH Host。');
        }catch(e){setError(String(e.message??e))}finally{setBusy(false)}
      }
       if(!cfg)return h('div',{style:css.root},h('h2',{style:css.title},'聚合路由'),error?h('p',{style:css.error},error):'读取配置中…');
       const providerChoices=cfg.providers.map(x=>({value:x.id,label:x.name+' ('+x.id+')'}));
       const accountProviderChoices=cfg.providers.filter(x=>x.protocol!=='dsh-host')
         .map(x=>({value:x.id,label:x.name+' ('+x.id+')'}));
      const modes=[{value:'priority',label:'按链条顺序降级'},{value:'pinned',label:'固定首个模型（账号可切）'},{value:'free',label:'仅显式标记免费'}];
       const tabs=[['overview','总览'],['channels','渠道账号'],['reuse','复用管理'],['checkins','每日积分任务'],
        ['activities','渠道活动'],['providers','提供商'],['pool','模型池'],['routes','模型链条'],['host','宿主故障切换'],['advanced','高级 JSON']];
       const navGroups=[
         {name:'运行',ids:['overview']},
         {name:'渠道与账号',ids:['channels','reuse','checkins','activities']},
         {name:'模型与策略',ids:['providers','pool','routes']},
         {name:'运维',ids:['host','advanced']},
       ];
       const pageNotes={
         overview:'查看真实来源接入、账号、签到与模型调度状态',
         channels:'管理每个渠道的账号、授权状态与启停操作',
         reuse:'沿用原插件登录态，独立授权与宿主路由互不干扰',
         checkins:'按账号与渠道核对真实签到回执及执行计划',
         activities:'每个渠道独立列出免付费、可自动完成的官方奖励活动',
         providers:'维护来源名称与协议，授权仍由对应渠道处理',
         pool:'自动发现可用模型并明确免费依据',
         routes:'人工制定模型优先级与跨来源降级链条',
         host:'DSH Agent 后续回合的故障续跑配置',
         advanced:'仅用于排障的账号引用与完整 JSON 配置',
         'account-debug':'管理所选渠道的账号引用与权限',
       };
       const activeNav=tab==='account-debug'?'channels':tab;
       const pageTitle=tab==='account-debug'?'账号池维护':tabs.find(x=>x[0]===tab)?.[1]||'运行总览';
       const unsaved=Boolean(cfg&&savedConfig&&(tab==='advanced'
         ?raw!==JSON.stringify(savedConfig,null,2)
         :JSON.stringify(cfg)!==JSON.stringify(savedConfig)));
       let content=null;
       if(tab==='overview')content=h(OverviewConsole,{cfg,status,channelsView,checkinsView,onNavigate:setTab,onRefresh:refreshRuntime});
       const changeReuseSettings=change=>setCfg(old=>({...old,
         embeddedPack:{...old.embeddedPack,...('embeddedEnabled' in change?{enabled:change.embeddedEnabled}:{})},
         sessionReuse:{...old.sessionReuse,
           ...('enabled' in change?{enabled:change.enabled}:{}),
           ...('resetIgnored' in change?{ignoredIds:[]}:{})}}));
       if(tab==='channels')content=h('div',null,
          h(AccountConsole,{data:channelsView,
           query:channelQuery,onQuery:setChannelQuery,run:runAction,setTab,
           busy:actionBusy,discovered,onAddProvider:addNativeProvider,
           showReferences:showReferenceChannels,onToggleReferences:setShowReferenceChannels,
           selectedChannel:selectedAccountChannel,onSelectChannel:setSelectedAccountChannel,
           onManageAccounts:channel=>{setManagedAccountProvider(channel.id);setTab('account-debug')},
           onOpenOwnedSource:()=>{setReuseSubtab('source');setTab('reuse')},
           onRefresh:refreshRuntime,
           hasDraft:Boolean(cfg&&savedConfig&&JSON.stringify(cfg)!==JSON.stringify(savedConfig))}),
          h('details',{className:'dnr-disclosure'},
           h('summary',{className:'dnr-disclosure-summary'},
              '新增账号或重新登录 · 小米 / 豆包 / 秒悟 / 千问办公 / Amazon Quick（展开）'),
           h('div',{className:'dnr-disclosure-body'},
           h(Panel,{title:'小米 MiMo 会员 · 无需 MiMo 客户端进程'},
           h('p',{style:css.small},'即使没有安装或运行 MiMo Desktop，也能通过本插件独立浏览器登录会员账号；已有客户端会话也可一次性接管。授权后无需任何原客户端进程，独立保存会话、续期与推理；不使用商业 API Key。'),
           h('div',{style:css.line},
             h(Button,{disabled:mimoBusy,onClick:scanMimo},mimoBusy?'扫描中…':'复用本机已登录会话'),
             h('select',{'aria-label':'MiMo 会员账号区域',style:css.input,value:mimoRegion,
               onChange:e=>setMimoRegion(e.target.value)},
               ...[['cn','中国大陆'],['sgp','新加坡'],['ams','欧洲'],['ru','俄罗斯'],['in','印度']]
                .map(([value,label])=>h('option',{key:value,value},label))),
             h(Button,{kind:'primary',disabled:mimoBusy||mimoLogin?.status==='waiting',
               onClick:startMimoBrowser},mimoLogin?.status==='waiting'?'等待会员授权…':'自主浏览器登录'),
             mimoLogin?.status==='waiting'?h(Button,{onClick:cancelMimoBrowser},'取消授权'):null)),
                   h(Panel,{title:'豆包工作会员 · 无需豆包客户端进程'},
            h('p',{style:css.small},'无需安装或运行豆包工作客户端：本插件通过普通浏览器独立扫码、保存各账号 Cookie，并直接请求会员网页服务。签到通过网页提交并回查确认才算成功；未验收的工作任务模型不会虚报可用。'),
            h('div',{style:css.line},
              h(Button,{kind:'primary',disabled:doubaoBusy||doubaoLogin?.status==='waiting',
                onClick:startDoubaoBrowser},doubaoLogin?.status==='waiting'?'等待浏览器授权…':'浏览器扫码登录'),
              doubaoLogin?.status==='waiting'
                ?h(Button,{onClick:cancelDoubaoBrowser},'取消授权'):null,
              h('input',{type:'password',autoComplete:'off','aria-label':'豆包独立 Cookie',
                placeholder:'或粘贴豆包 Cookie（不会写入公开配置）',
                style:css.input,value:doubaoCookie,onChange:e=>setDoubaoCookie(e.target.value)}),
              h(Button,{disabled:doubaoBusy||doubaoCookie.length<12,
                onClick:addDoubaoCookie},doubaoBusy?'处理中…':'导入 Cookie'))),
          h(Panel,{title:'秒悟网页版 · 独立会员账号'},
            h('p',{style:css.small},'独立浏览器登录或显式接管自己的网页 Cookie。官方身份核验成功后存入本插件私有凭据库，动态模型与真实积分均从秒悟会员接口读取；不复用原插件进程，不提供 API Key 计费通道，也不虚报免费模型。'),
            h('div',{style:css.line},
              h(Button,{kind:'primary',disabled:meooBusy||meooLogin?.status==='waiting',
                onClick:startMeooBrowser},meooLogin?.status==='waiting'?'等待秒悟网页登录…':'秒悟浏览器登录'),
              meooLogin?.status==='waiting'
                ?h(Button,{onClick:cancelMeooBrowser},'取消授权'):null,
              h('input',{type:'password',autoComplete:'off','aria-label':'秒悟独立 Cookie',
                placeholder:'或粘贴秒悟 Cookie（必须包含会话票据）',
                style:css.input,value:meooCookie,onChange:e=>setMeooCookie(e.target.value)}),
              h(Button,{disabled:meooBusy||meooCookie.length<24,
                onClick:addMeooCookie},meooBusy?'校验中…':'验证并导入'))),
          h(Panel,{title:'千问办公 · 设备码 PKCE 独立账号'},
            h('p',{style:css.small},'无需安装千问办公客户端：生成本插件专属设备授权链接，通过官方网页选择账号及团队。授权后保存到 DSH 私有凭据，模型经 COSY 签名直连官方服务，不启动额外本地网关。模型倍率从账号实时目录读取，未知费率不视为免费。'),
            h('div',{style:css.line},
              h(Button,{kind:'primary',disabled:qwenBusy||qwenLogin?.status==='waiting',
                onClick:startQwenDevice},
                qwenLogin?.status==='waiting'?'等待官方账号确认…':'申请独立设备授权'),
              qwenLogin?.status==='waiting'?
                h(Button,{onClick:cancelQwenDevice},'取消授权'):null),
            qwenLogin?.status==='waiting'&&typeof qwenLogin.loginUrl==='string'&&
              /^https:\/\/gateway\.qwenwork\.cn\/device\/selectAccounts\?/.test(qwenLogin.loginUrl)?
              h('div',{style:{...css.line,marginTop:8}},
                h('a',{href:qwenLogin.loginUrl,target:'_blank',rel:'noopener noreferrer',
                  style:{fontWeight:600,wordBreak:'break-all'}},'打开千问办公官方账号授权页'),
                h('span',{style:css.small},'必须在官方网页完成选择；本插件只显示公开授权地址')):null),
           h(Panel,{title:'Amazon Quick · 独立会员渠道'},
             h('p',{style:css.small},
               '通过自己的 Amazon Quick 登录账号完成 OAuth PKCE，或一次性接管本机已登录的 Quick 桌面凭据。DSH 自己存储和续期授权，不依赖 Magpie、原插件或 Quick outpost 进程。四个模式 fast / balanced / smart / advanced 由 Quick 服务端动态选择真实模型。该项目采用非官方内部协议，存在服务条款与账号限制风险，费率未知不标免费。'),
             h('div',{style:css.line},
               h(Button,{kind:'primary',disabled:awsQuickBusy||
                 awsQuickLogin?.status==='waiting',onClick:startAwsQuick},
                 awsQuickBusy?'处理中…':'Amazon Quick 自主 OAuth 登录'),
               h(Button,{disabled:awsQuickBusy,onClick:importAwsQuickLocal},
                 '一次性接管本机已登录 Quick'),
               awsQuickLogin?.status==='waiting'?
                 h(Button,{onClick:cancelAwsQuick},'取消授权'):null),
             awsQuickLogin?.status==='waiting'&&typeof awsQuickLogin.loginUrl==='string'&&
               /^https:\/\/(?:quick\.aws\.com\/sn(?:\?|$)|oidc\.[a-z0-9-]+\.amazonaws\.com\/authorize\?)/.test(awsQuickLogin.loginUrl)?
               h('div',{style:{...css.line,marginTop:8}},
                 h('a',{href:awsQuickLogin.loginUrl,target:'_blank',
                   rel:'noopener noreferrer',style:{wordBreak:'break-all',fontWeight:600}},
                   '打开 Amazon Quick 官方账号授权页')):null,
             awsQuickLogin?.status==='waiting'?
               h('div',{style:css.line},
                 h('input',{type:'password',autoComplete:'off',
                   'aria-label':'Amazon Quick 官方回调完整地址',
                   placeholder:'其他电脑或无法访问回调端口时，粘贴官方返回的完整回调 URL',
                   style:css.input,value:awsQuickCallback,
                   onChange:e=>setAwsQuickCallback(e.target.value.slice(0,12000))}),
                 h(Button,{disabled:awsQuickBusy||!awsQuickCallback.trim(),
                   onClick:submitAwsQuickCallback},'提交回调地址')):null,
             awsQuickLogin?.status==='discovery_saved'?
               h('p',{style:css.small},
                 '已记住 AWS 租户发现信息。点击“自主 OAuth 登录”进入第二步授权。'):null,
             awsQuickLogin?.status==='done'?
               h('p',{style:css.small},
                 '已确认独立账号并保存到 DSH 凭据库；可在上方账号列表查看额度及执行模型测试。'):null),
            null)));
       if(tab==='reuse')content=h(ReuseConsole,{data:channelsView,cfg,         onReuseSettings:changeReuseSettings,run:runAction,busy:actionBusy,
          onRefresh:refreshRuntime,subtab:reuseSubtab,onSubtab:setReuseSubtab,
         embeddedPack:status?.embeddedPack,credentialService:status?.credentialService,modelProvider,
         setModelProvider:value=>{setModelProvider(value);setEmbeddedModels(null)},
         onModels:loadUpstreamModels,modelBusy,models:embeddedModels,
          onSourceLogin:sourceLogin,onSourcePoll:sourcePollLogin,
          onSourceDismissLogin:sourceDismissLogin,pendingLogin:pendingSourceLogin,
          onSourceRefresh:sourceRefreshAccount,onSourceReuseLoomy:sourceReuseLoomyAccount,sourceBusy:sourceRpcBusy,
          loomySmsPhone,onLoomySmsPhone:value=>{setLoomySmsPhone(value.replace(/\D/g,'').slice(0,11));setLoomySmsCode('');setLoomySmsSent(false)},
          loomySmsCode,onLoomySmsCode:value=>setLoomySmsCode(value.replace(/\D/g,'').slice(0,8)),
          loomySmsSent,onLoomySmsSend:sourceSendLoomySms,onLoomySmsSubmit:sourceSubmitLoomySms,
          hostModels,hostModelBusy,hostSelectedModel,onSelectHostModel:setHostSelectedModel,
          onHostModels:loadHostModels,hostCatalog,onRefreshHostCatalog:loadHostCatalog,manualHostModel:hostManualModel,
          onManualHostModel:setHostManualModel,adoptionPreview,adoptionBusy,adoptionResults,
          verifyResults,verifyBusy,onVerifyAdopted:verifyAdopted,
          onPreviewAdoption:loadAdoptionPreview,onAdoptAccount:adoptOriginalAccount});
       if(tab==='checkins')content=h(CheckinConsole,{data:checkinsView,cfg,onSettings:setCheckinSettings,
          onAccountAuto:setAccountAuto,run:runAction,refresh:refreshRuntime,busy:actionBusy,
          embeddedPack:status?.embeddedPack,sourceProvider:sourceCreditsProvider,
          setSourceProvider:value=>{setSourceCreditsProvider(value);setSourceCredits(null);setSourceClaims(null)},
          sourceCredits,sourceClaims,sourceBusy:sourceRpcBusy,
          onSourceStatus:sourceCheckinStatus,onSourceClaim:sourceClaimAll});
       if(tab==='activities')content=h(ActivitiesConsole,{
         data:activitiesView,busy:activitiesBusy,refresh:refreshActivities});
       if(tab==='providers')content=h(Section,{title:'提供商注册表'},
         h('div',{style:css.line},h('input',{'aria-label':'筛选提供商',
           placeholder:'按名称、标识或协议筛选提供商',style:css.input,value:providerQuery,
           onChange:e=>setProviderQuery(e.target.value)})),
         cfg.providers.map((p,i)=>({p,i})).filter(({p})=>
           [p.id,p.name,p.protocol].some(v=>String(v||'').toLowerCase().includes(providerQuery.toLowerCase())))
           .map(({p,i})=>h(DisclosurePanel,{key:p.id,title:(i+1)+'. '+(p.name||p.id),
             initiallyOpen:false,actions:
               h(Button,{onClick:()=>{if(window.confirm('确认从配置草稿移除提供商 '+p.name+'？保存后生效。'))remove('providers',i)}},'删除')},
          h('div',{style:css.line},
            h(TextField,{label:'标识 ID',value:p.id,onChange:v=>edit('providers',i,{id:v})}),
            h(TextField,{label:'显示名称',value:p.name,onChange:v=>edit('providers',i,{name:v})}),
            h('span',{style:css.mutedTag},
              '协议自动识别：'+(p.protocol==='dsh-host'?'DSH 原生 Provider':
                p.protocol==='native-channel'?'已安装原生渠道适配器':
                p.protocol==='anthropic-messages'?'Anthropic Messages':'OpenAI 兼容 API')),
            h('details',{style:{maxWidth:'100%',flex:'1 1 180px'}},
              h('summary',{style:{cursor:'pointer',...css.small}},
                '异常排障 · 手动调整协议'),
              h(Select,{label:'手动协议覆盖',value:p.protocol,
                onChange:v=>edit('providers',i,{protocol:v}),
                options:[{value:'openai-chat',label:'OpenAI Chat'},
                  {value:'anthropic-messages',label:'Anthropic Messages'},
                  {value:'native-channel',label:'原生驱动'},
                  {value:'dsh-host',label:'DSH 已注册 Provider'}]})),
            ['native-channel','dsh-host'].includes(p.protocol)?null:
            h(TextField,{label:'Base URL',value:p.baseUrl,width:'2 1 260px',
              onChange:v=>edit('providers',i,{baseUrl:v,
                protocol:/(?:api[.]anthropic[.]com|\/v1\/messages(?:$|\?))/i.test(v)
                 ?'anthropic-messages':'openai-chat'})})),
          h('div',{style:css.line},h(TextField,{label:'模型 ID，以逗号分隔（留空则查询 /models）',
            value:(p.models||[]).join(', '),width:'3 1 360px',onChange:v=>edit('providers',i,{models:v.split(',').map(s=>s.trim()).filter(Boolean)})}),
            h(Toggle,{label:'启用',value:p.enabled,onChange:v=>edit('providers',i,{enabled:v})}),
            h(Toggle,{label:'支持工具调用',value:p.supportsTools,onChange:v=>edit('providers',i,{supportsTools:v})})),
          h('p',{style:css.small},p.protocol==='dsh-host'?'宿主原生路由复用原插件认证；不创建本插件账号。':
             '通用 API 凭据、独立渠道授权以及本机登录态复用可以并存。'))),
        h(Button,{kind:'primary',onClick:()=>add('providers',{id:'provider'+(cfg.providers.length+1),name:'新提供商',
          protocol:'openai-chat',baseUrl:'https://api.example.invalid/v1',models:[],enabled:false,supportsTools:true})},'+ 新增提供商'));
      if(tab==='pool')content=h(AutoFreeConsole,{pool:autoFreeView,cfg,
         hostProviders:channelsView?.sessionReuse?.hostProviders,onRefresh:refreshAutoFree,busy:autoFreeBusy,
         freeProvider,setFreeProvider,freeModel,setFreeModel,
         manualModel:manualFreeModel,setManualModel:setManualFreeModel,
         onMarkFree:(providerId,model)=>setFreeModelMark(providerId,model,true),
         onMarkPaid:(providerId,model)=>setFreeModelMark(providerId,model,false),
         onResetMark:resetFreeModelMark,onMarkProvider:markFreeProvider});
       if(tab==='account-debug')content=h(Section,{title:'渠道账号池 · '+(managedAccountProvider||'全部渠道')},
        h(Panel,{title:'账号来源管理',actions:h(Button,{onClick:()=>setTab('channels')},'返回渠道账号')},
          h('p',{style:css.small},'只管理聚合路由已登记的账号引用，不复制或覆盖宿主插件的独立账号池。宿主原生 Provider 继续由原插件维护认证。'),
          h(Select,{label:'管理渠道',value:managedAccountProvider,onChange:setManagedAccountProvider,
            options:[{value:'',label:'所有已登记渠道'},...cfg.providers.filter(p=>p.protocol!=='dsh-host')
              .map(p=>({value:p.id,label:p.name+' · '+p.id}))]})),
        cfg.accounts.map((a,i)=>managedAccountProvider&&a.providerId!==managedAccountProvider?null:
         h(DisclosurePanel,{key:a.id,initiallyOpen:i===0||a.providerId===managedAccountProvider,
           title:(i+1)+'. '+a.id,actions:h(Button,{onClick:()=>{
             if(window.confirm('确认从配置草稿中移除账号引用 '+a.id+'？保存后才会生效。'))remove('accounts',i)
           }},'删除')},
          h('div',{style:css.line},
            h(TextField,{label:'账号 ID',value:a.id,onChange:v=>edit('accounts',i,{id:v})}),
            h(Select,{label:'所属提供商',value:a.providerId,onChange:v=>edit('accounts',i,{providerId:v}),options:accountProviderChoices}),
            h(TextField,{label:'凭据引用，如 env:KEY / host:ref / driver:channel:id',value:a.credentialRef,width:'2 1 260px',onChange:v=>edit('accounts',i,{credentialRef:v})}),
            h(TextField,{label:'权重',value:String(a.weight??1),onChange:v=>edit('accounts',i,{weight:Number(v)})}),
            h(Toggle,{label:'启用',value:a.enabled,onChange:v=>edit('accounts',i,{enabled:v})}),
            h(Toggle,{label:'自动签到',value:a.autoCheckin,onChange:v=>edit('accounts',i,{autoCheckin:v})})))),
        h(Button,{kind:'primary',disabled:!accountProviderChoices.some(p=>
           cfg.providers.find(x=>x.id===p.value&&['openai-chat','anthropic-messages'].includes(x.protocol))),
           onClick:()=>{const p=cfg.providers.find(x=>x.id===managedAccountProvider&&
             ['openai-chat','anthropic-messages'].includes(x.protocol))||
             cfg.providers.find(x=>['openai-chat','anthropic-messages'].includes(x.protocol));
             if(!p)return;add('accounts',{id:'account'+(cfg.accounts.length+1),
                providerId:p.id,credentialRef:'env:MY_API_KEY',enabled:true,weight:1})}},
             '+ 新增 API 账号引用'));
      if(tab==='routes')content=h(Section,{title:'模型链条 · 仅手工维护'},
        h('p',{style:css.small},'渠道接入、扫码授权、账号接管均不会自动生成或更改模型链。这里手工选择跨来源模型及降级顺序；AutoFree 在模型池单独管理。'),cfg.routes.map((r,i)=>
        h(DisclosurePanel,{key:r.id,initiallyOpen:i===0||i===cfg.routes.length-1,
          title:r.name+' / chain:'+r.id,actions:h(Button,{onClick:()=>{
            if(window.confirm('确认从配置草稿中移除模型链 '+r.name+'？保存后生效。'))remove('routes',i);
          }},'删除链条')},
          h('div',{style:css.line},
            h(TextField,{label:'链条 ID',value:r.id,onChange:v=>edit('routes',i,{id:v})}),
            h(TextField,{label:'链条名称',value:r.name,onChange:v=>edit('routes',i,{name:v})}),
            h(Select,{label:'策略',value:r.mode,onChange:v=>edit('routes',i,{mode:v}),options:modes}),
            h(TextField,{label:'最大模型切换次数',value:String(r.maxSwitches),onChange:v=>edit('routes',i,{maxSwitches:Number(v)})}),
            h(Toggle,{label:'启用',value:r.enabled,onChange:v=>edit('routes',i,{enabled:v})})),
          r.tiers.map((tier,j)=>h('div',{key:j,style:{...css.card,marginBottom:6,padding:10}},
            h('div',{style:css.line},h('strong',null,'第 '+(j+1)+' 级'),
              h(Button,{disabled:j===0,onClick:()=>{
                setCfg(old=>{const next=structuredClone(old),list=next.routes[i].tiers;[list[j],list[j-1]]=[list[j-1],list[j]];return next;});
              }},'上移'),
              h(Button,{disabled:j===r.tiers.length-1,onClick:()=>{
                setCfg(old=>{const next=structuredClone(old),list=next.routes[i].tiers;[list[j],list[j+1]]=[list[j+1],list[j]];return next;});
              }},'下移'),
              h(Button,{disabled:r.tiers.length<=1,onClick:()=>{
                setCfg(old=>{const next=structuredClone(old);next.routes[i].tiers.splice(j,1);return next;});
              }},'删除')),
            h('div',{style:css.line},
              h(Select,{label:'提供商',value:tier.providerId,options:providerChoices,onChange:v=>changeTier(i,j,{providerId:v,accountIds:[]})}),
              h(TextField,{label:'模型 ID',value:tier.model,onChange:v=>changeTier(i,j,{model:v})}),
              h(TextField,{label:'限定账号 ID（逗号分隔，留空使用所有）',value:(tier.accountIds||[]).join(', '),
                width:'2 1 250px',onChange:v=>changeTier(i,j,{accountIds:v.split(',').map(s=>s.trim()).filter(Boolean)})}),
              h(Toggle,{label:'明确标记免费',value:tier.free,onChange:v=>changeTier(i,j,{free:v})})))),
          h(Button,{disabled:!providerChoices.length,onClick:()=>setCfg(old=>{
            const next=structuredClone(old);next.routes[i].tiers.push({
              providerId:next.providers[0].id,model:next.providers[0].models?.[0]||'model-id',free:false,accountIds:[]});
            return next;
          })},'+ 追加降级档位'))),
        h(Button,{kind:'primary',disabled:!providerChoices.length,onClick:()=>add('routes',{
          id:'chain'+(cfg.routes.length+1),name:'新模型链条',mode:'priority',enabled:false,maxSwitches:3,
          tiers:[{providerId:cfg.providers[0].id,model:cfg.providers[0].models?.[0]||'model-id',free:false,accountIds:[]}]
        })},'+ 新增模型链条'));
      if(tab==='host')content=h(Section,{title:'DSH Agent 级故障续跑'},
        h('p',{style:css.small},'宿主故障切换处理 DSH Agent 失败后的后续回合续跑；模型链负责单次请求内部的跨来源切换。两者独立，避免重复重试已执行的操作。'),h(Panel,{title:'安全模式'},
        h('div',{style:css.line},h(Toggle,{label:'启用宿主级自动降级',value:cfg.hostFailover.enabled,onChange:v=>changeHost({enabled:v})}),
          h(Select,{label:'运行模式',value:cfg.hostFailover.mode,onChange:v=>changeHost({mode:v}),
            options:[{value:'off',label:'正常选模，故障时降级'},{value:'pinned',label:'固定在链内'},{value:'free',label:'仅显式免费'}]}),
          h(TextField,{label:'每会话最大切换次数',value:String(cfg.hostFailover.maxSwitchesPerSession??3),
            onChange:v=>changeHost({maxSwitchesPerSession:Number(v)})})),
        h('p',{style:css.small},'不要与旧 dsh-model-failover 同时启用宿主级自动降级；否则两个监听器可能重复安排自动续跑。')),
        h(Panel,{title:'宿主级跨 Provider 模型优先级',
          actions:h(Button,{disabled:hostCatalogBusy,onClick:loadHostCatalog},
            hostCatalogBusy?'读取中…':'刷新全部模型')},
          h('p',{style:css.small},'从 DSH 宿主全部已注册 Provider 自动读取模型目录，不要求先接入聚合路由。选择候选后才保存优先级，不复制任何原插件账号。'),
          h('div',{style:css.line},
            h('span',{style:css.mutedTag},'Provider '+(hostCatalog?.providers?.length??0)),
            h('span',{style:css.mutedTag},'已发现模型 '+(hostCatalog?.providers?.reduce((sum,p)=>sum+p.models.length,0)??0)),
            (hostCatalog?.providers||[]).some(p=>p.state!=='ready')?
              h('span',{style:css.small},'部分渠道未开放模型目录；不会替它猜测模型'):null),
          (cfg.hostFailover.priority||[]).map((entry,i)=>{
            const providers=hostCatalog?.providers??[];
            const selected=providers.find(p=>p.id===entry.provider);
            const models=selected?.models??[];
            const providerChoices=providers.map(p=>({value:p.id,
              label:p.name+' · '+p.models.length+' 模型'+(p.state==='ready'?'':'（目录不可用）')}));
            if(entry.provider&&!providerChoices.some(x=>x.value===entry.provider))
              providerChoices.unshift({value:entry.provider,label:entry.provider+'（旧配置，当前未发现）'});
            const modelChoices=models.map(m=>({value:m.id,label:m.name!==m.id?m.name+' · '+m.id:m.id}));
            if(entry.model&&!modelChoices.some(x=>x.value===entry.model))
              modelChoices.unshift({value:entry.model,label:entry.model+'（原有配置，尚未重新发现）'});
            return h('div',{key:i,style:{...css.line,padding:'10px 0',
              borderBottom:'1px solid rgba(128,145,164,.2)'}},
            h(Select,{label:'DSH Provider',value:entry.provider,options:providerChoices,
              onChange:v=>{
                const p=providers.find(x=>x.id===v);
                const first=p?.models?.[0];
                changeHostTier(i,{provider:v,model:first?.id??'',
                  free:!!first?.freeHint});
              }}),
            h(Select,{label:'该 Provider 的模型',value:entry.model,options:modelChoices,
              onChange:v=>changeHostTier(i,{model:v,
                free:!!models.find(m=>m.id===v)?.freeHint})}),
            h(Toggle,{label:'仅免费策略允许',value:entry.free,
              onChange:v=>changeHostTier(i,{free:v})}),
            h(Button,{title:'上移优先级',ariaLabel:'上移优先级',disabled:i===0,onClick:()=>setCfg(old=>{
              const next=structuredClone(old),items=next.hostFailover.priority;[items[i],items[i-1]]=[items[i-1],items[i]];return next;
            })},'↑'),
            h(Button,{title:'下移优先级',ariaLabel:'下移优先级',disabled:i===cfg.hostFailover.priority.length-1,onClick:()=>setCfg(old=>{
              const next=structuredClone(old),items=next.hostFailover.priority;[items[i],items[i+1]]=[items[i+1],items[i]];return next;
            })},'↓'),
            h(Button,{onClick:()=>changeHost({priority:cfg.hostFailover.priority.filter((_,j)=>j!==i)})},'删除'));
          }),
          h(Button,{kind:'primary',
            disabled:hostCatalogBusy||!(hostCatalog?.providers??[]).some(p=>p.models.length),
            onClick:()=>{
              const p=(hostCatalog?.providers??[]).find(x=>x.id!=='native-router'&&x.models.length)
                ??(hostCatalog?.providers??[]).find(x=>x.models.length);
              if(!p)return;
              const first=p.models[0];
              changeHost({priority:[...(cfg.hostFailover.priority||[]),
                {provider:p.id,model:first.id,free:!!first.freeHint}]});
            }},'+ 从已发现模型添加候选')),
        h(Panel,{title:'最近自动模型切换与续跑记录'},
          (cfg.hostFailover.switchLog||[]).length
            ?cfg.hostFailover.switchLog.slice().reverse().map((entry,i)=>h('div',{
              key:i,style:{...css.line,borderBottom:'1px solid rgba(128,128,128,.12)',padding:'6px 0'}},
              h('span',{style:css.small},new Date(entry.at).toLocaleString('zh-CN',{hour12:false})),
              h('strong',null,entry.from+' → '+entry.to),
              h('span',{style:css.small},'故障：'+entry.code+' · 已向 DSH 提交续跑')))
             :h('p',{style:css.small},'暂无已入队的自动切换记录；此处不会把提交失败记录为成功。')));
       if(tab==='advanced')content=h(React.Fragment,null,
       h(Panel,{title:'账号引用 · 仅异常排障',actions:h(Button,{onClick:()=>setTab('account-debug')},'维护账号引用')},
         h('p',{style:css.small},'正常接入由宿主注册或自主登录自动完成，不再手工添加账号。此处只维护异常引用。')),
       h(Panel,{title:'JSON 高级编辑器'},
        h('p',{style:css.small},'高级模式会直接替换整份配置。仅保存提供商、账号引用与链条规则；不要填写 Token、密码或明文 API Key。'),
        h('textarea',{style:{...css.input,width:'100%',minHeight:400,fontFamily:'ui-monospace,monospace',fontSize:12},
          value:raw,onChange:e=>setRaw(e.target.value),'aria-label':'完整路由配置 JSON'})));
        return h('div',{className:'dnr-shell',style:css.root},
         h('style',{dangerouslySetInnerHTML:{__html:UI_STYLES}}),
         h('header',{className:'dnr-header'},
           h('div',{style:{minWidth:0}},
             h('h2',{style:css.title},'聚合路由'),
             h('div',{className:'dnr-header-note'},'来源复用 · 账号池 · 模型调度 · 每日积分任务 · 故障续跑')),
               h('span',{className:'dnr-version'},status?.version??'版本校验中')),           h('div',{className:'dnr-layout'},            h('label',{className:'dnr-mobile-nav'},              h('span',null,'设置页面'),              h('select',{'aria-label':'选择设置页面',value:activeNav,                onChange:e=>setTab(e.target.value)},                navGroups.map(group=>h('optgroup',{key:group.name,label:group.name},
                  group.ids.map(id=>h('option',{key:id,value:id},tabs.find(x=>x[0]===id)?.[1]||id)))))),            h('nav',{className:'dnr-rail','aria-label':'聚合路由设置导航'},
              navGroups.map(group=>h('div',{key:group.name,className:'dnr-nav-group'},
                h('div',{className:'dnr-group-title'},group.name),
                group.ids.map(id=>{
                  const label=tabs.find(x=>x[0]===id)?.[1]||id;
                  return h('button',{key:id,type:'button',className:'dnr-nav-button',
                    'aria-current':activeNav===id?'page':undefined,
                    title:label,onClick:()=>setTab(id)},label);
                })))),
            h('main',{className:'dnr-main',id:'dnr-settings-content'},
              h('div',{className:'dnr-page-head'},
                h('h3',null,pageTitle),h('p',null,pageNotes[tab]||'')),
              h('div',{className:'dnr-toast-stack'},
                error?h('div',{role:'alert',className:'dnr-toast','data-kind':'error'},
                  h('span',null,error),
                  h('button',{type:'button','aria-label':'关闭错误提示',onClick:()=>setError('')},'×')):null,
                notice?h('div',{role:'status',className:'dnr-toast','data-kind':'success'},
                  h('span',null,notice),
                  h('button',{type:'button','aria-label':'关闭提示',onClick:()=>setNotice('')},'×')):null),
              content,
             h('footer',{className:'dnr-savebar'},
               h(Button,{kind:'primary',disabled:busy,onClick:save},busy?'正在保存…':'保存配置'),
               h(Button,{disabled:busy,onClick:()=>{
                 if(unsaved&&!window.confirm('当前有未保存的修改。重新读取将丢弃草稿，确定继续？'))return;
                 refresh();
               }},'重新读取'),
               h('span',{className:'dnr-status-inline','aria-live':'polite'},
                 unsaved?'● 有未保存修改':'配置已载入'),
               h('div',{className:'dnr-save-note'},
                 h('details',null,h('summary',null,'生效说明'),
                    h('p',null,'渠道初始化等配置可能需要重启 DSH；已运行中的任务不会被直接修改。')))))));    }
    function apply(ctx){      const slots=ctx.slots;
      if(!slots?.register||!slots?.inject)return;
      const dispose=slots.inject('settings.section',()=>slots.register({
        name:'settings.section',id:NS,order:62,label:()=> '聚合路由',locale:NS,      },App));
      ctx.effect?.(()=>()=>dispose?.());
    }
    apply.inject=['slots'];
    return {name:NS,inject:['slots'],apply};
  }
});
