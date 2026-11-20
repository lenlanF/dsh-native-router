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
    function EmbeddedPackConsole({pack,upstream,run,busy,modelProvider,setModelProvider,onModels,modelBusy,models,onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy}){
      const rows=upstream?.accounts||[],live=pack?.state==='mounted'&&pack?.rpcReady===true;
       const sourceChannels=pack?.channels||[],selectedSource=sourceChannels.includes(modelProvider)
         ?modelProvider:sourceChannels[0]||'';
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
         pack?.skippedProviders?.length?h('details',null,
           h('summary',{style:{cursor:'pointer',fontSize:12}},
             '宿主已有 '+pack.skippedProviders.length+' 个同名原渠道 · 自主登录仍可用'),
           h('p',{style:css.small},pack.skippedProviders.join('、')+'：原插件可继续复用，此处可自主登录到独立账号池，模型调用不会覆盖原插件。')):null,        live?h('div',null,
          h('div',{style:css.line},
            h(Select,{label:'来源渠道',value:selectedSource,onChange:setModelProvider,
              options:sourceChannels.map(id=>({value:id,label:id}))}),
            h(Button,{disabled:!selectedSource||!!busy||!!modelBusy||!!sourceBusy,onClick:()=>onModels(selectedSource)},
              modelBusy?'模型查询中…':'查询模型'),
            h(Button,{disabled:!selectedSource||!!busy||!!sourceBusy,onClick:()=>onSourceLogin(selectedSource)},'发起扫码/网页登录')),
          pendingLogin?h('div',{style:{...css.card,padding:10}},
            h('span',{style:css.small},'待授权渠道：'+pendingLogin.providerId+' / '+pendingLogin.accountId),
            pendingLogin.loginUrl?h('div',{style:css.line},
              h('a',{href:pendingLogin.loginUrl,target:'_blank',rel:'noopener noreferrer'},
                '打开授权链接（先核对域名）')):h('p',{style:css.small},'来源未提供安全授权链接，不能自动打开'),
            h(Button,{disabled:!!sourceBusy,onClick:onSourcePoll},'检查登录结果')):null,
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
      onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy,
      hostModels,hostModelBusy,hostSelectedModel,onSelectHostModel,onHostModels,
      hostCatalog,onRefreshHostCatalog,
      manualHostModel,onManualHostModel,
      adoptionPreview,adoptionBusy,adoptionResults,credentialService,onPreviewAdoption,onAdoptAccount,
      verifyResults,verifyBusy,onVerifyAdopted}){      const reuse=data?.sessionReuse||{hostProviders:[],channels:[],results:[]};
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
          h(EmbeddedPackConsole,{pack:embeddedPack,upstream:data?.embeddedAccounts,run,busy,
            modelProvider,setModelProvider,onModels,modelBusy,models,
            onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy})):null);
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
    function AccountConsole({data,query,onQuery,run,setTab,busy,discovered,onAddProvider,
      onManageAccounts,onOpenOwnedSource,selectedChannel,onSelectChannel}){      if(!data)return h(Panel,{title:'渠道账号'},'账号中心尚未连接 DSH Host。');
      const accounts=data.accounts||[];
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
          actions:h(Button,{disabled:!!busy,onClick:()=>run('/channels/accounts/action',
            {action:'refresh-all'},'已刷新支持校验的账号')},'验证全部')},
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
           const pool=(data.pools||[]).find(x=>x.providerId===channel.id);          return h(Panel,{key:channel.id,title:channel.name,
             actions:h('span',{style:css.small},members.length+' 个账号 · '+              (channel.adapterReady?'已接入':'待接入'))},
            h('div',{style:css.line},
              h('span',{style:css.small},'登录方式：'+(channel.authMethod||'由来源管理')),
              pool?h('span',{style:css.small},'自动候选 '+pool.enabled+' · 已验证 '+pool.verified):null),
            members.map((account,accountIndex)=>h('div',{key:account.id,style:{...css.itemRow,display:'block'}},
              h('div',{style:{...css.line,justifyContent:'space-between',marginBottom:5}},
                 h('strong',null,account.nickname||account.maskedPhone||account.username||'名称待获取'),
                 h(StateTag,{value:account.connectionState})),               h('div',{style:css.line},
                 h('span',{style:css.mutedTag},displayBalance(account)),
                  h('span',{style:css.mutedTag},account.sourceKind==='adopted'?'本地复用 · 已接管':
                    account.sourceKind==='autonomous'?'本插件自主登录':
                    account.sourceKind==='reused'?'本地原插件复用':'来源待确认'),
                  account.backupSources?.length?h('span',{style:css.mutedTag},
                   '另有 '+account.backupSources.length+' 个同账号备援'):null,
                 account.balanceCheckedAt?h('span',{style:css.small},
                   '余额更新 '+new Date(account.balanceCheckedAt).toLocaleString()):null),
               h('div',{style:css.line},
                 account.checkinState?h('span',{style:css.mutedTag},
                   '今日签到：'+(checkinLabels[account.checkinState]||account.checkinState)):null,
                 account.autoCheckin===true?h('span',{style:css.mutedTag},
                   account.autoCheckinEffective===false?'自动签到：全局开关关闭':'账号已允许自动签到'):null,
                 account.checkinMessage?h('span',{style:css.small},
                   account.checkinMessage):null),
               h('details',{style:{marginBottom:8}},
                 h('summary',{style:css.small},'详情 · 账号来源与诊断信息'),
                h('div',{style:css.small},'内部账号：'+account.id),
                h('div',{style:css.small},'凭据：'+account.credentialKind+' 引用'),
                account.reusedExistingSession?h('div',{style:css.small},
                  '复用原账号 · '+(account.connectionState==='online'?'最近鉴权通过':
                    account.connectionState==='expired'?'登录失效':'后台自动复核')):null,
                h('div',{style:css.small},'来源：'+(account.origin?.label||'来源未识别')),
                h('div',{style:css.small},'权重：'+account.weight),
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
                 h(Button,{disabled:!!busy||!account.loginAvailable||!account.configuredEnabled,
                   onClick:()=>run('/channels/accounts/action',{action:'login',accountId:account.id},
                     '已请求账号连接验证')},'校验'),
                 h(Button,{disabled:!!busy||!account.refreshAvailable||!account.configuredEnabled,
                   onClick:()=>run('/channels/accounts/action',{action:'refresh',accountId:account.id},
                     '账号状态已刷新')},'刷新'),
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
                    '已导入账号引用');
              }},'审核后导入'))));
        }));
    }
    function CheckinConsole({data,cfg,onSettings,onAccountAuto,run,refresh,busy,embeddedPack,
      sourceProvider,setSourceProvider,sourceCredits,sourceClaims,sourceBusy,onSourceStatus,onSourceClaim}){
      const [selectedCheckinChannel,setSelectedCheckinChannel]=React.useState('');
      if(!data)return h(Panel,{title:'每日签到中心'},'签到状态服务尚未连接 DSH Host。');
      const accounts=data.accounts||[],groups=(data.groups||[]).filter(x=>x.accountCount>0);
      const supported=accounts.filter(a=>a.checkinSupported).length;
      const success=accounts.filter(a=>a.checkinState==='success').length;
      const pending=accounts.filter(a=>a.checkinState==='pending_confirmation').length;
      const canonicalChannel=id=>String(id||'').replace(/^own_/,'');
      const selectedGroup=groups.find(x=>x.id===selectedCheckinChannel);
      const accountLabel=a=>a?.nickname||a?.username||a?.maskedPhone||'名称待获取';
      const labelFor=id=>{
        const account=accounts.find(a=>a.id===id);
        return account?accountLabel(account):'历史账号（名称尚未关联）';
      };
      return h(React.Fragment,null,
        data.historyBlocked?h('div',{role:'alert',style:css.error},data.historyError):null,
        h(Panel,{title:'今日签到 · '+data.today+' ('+data.timeZone+')',
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
            '仅统计今天确实确认的签到；历史成功日期保留在账号明细。点击渠道标签查看账号。')),
        selectedGroup?h(Panel,{title:selectedGroup.name+' · 账号签到明细',
          actions:h(Button,{onClick:()=>setSelectedCheckinChannel('')},'收起明细')},
          accounts.filter(a=>canonicalChannel(a.providerId)===selectedGroup.id)
            .map((a,i)=>h('div',{key:a.id,style:css.itemRow},
              h('div',{style:{flex:'1 1 190px',minWidth:0}},
                h('strong',null,accountLabel(a)),
                !a.nickname&&!a.username&&!a.maskedPhone?
                  h('span',{style:{...css.small,marginLeft:6}},'（上游尚未返回真实名称）'):null,
                h('p',{style:css.small},a.checkinMessage||'今日状态待核实'),
                a.lastConfirmedDate?h('span',{style:css.small},
                  '最近一次确认成功：'+a.lastConfirmedDate):null),
              h(StateTag,{kind:'checkin',value:a.checkinState}),
              a.sourceAccount&&!cfg.accounts.some(row=>row.id===a.id)?
                h('span',{style:css.small},a.autoCheckin?'自动签到已开':'自动签到已关'):
                h(Toggle,{label:'自动签到',
                  value:cfg.accounts.find(row=>row.id===a.id)?.autoCheckin===true,
                  onChange:v=>onAccountAuto(a.id,v)}),
              h(Button,{disabled:!!busy||!!data.historyBlocked||!a.checkinSupported||!a.enabled,
                onClick:()=>run('/checkins/action',{action:'run',accountId:a.id},
                  '已请求签到，请查看服务端确认状态')},'立即签到')))):
          null,
        h(Panel,{title:'自动签到设置（依托 DSH Host 运行）'},
          h('div',{style:css.line},
            h(Toggle,{label:'启用每日自动签到',value:cfg.checkin?.autoEnabled,
              onChange:v=>onSettings({autoEnabled:v})}),
            h(Toggle,{label:'覆盖所有支持签到的来源账号',
              value:cfg.checkin?.autoSourceAccounts!==false,
              onChange:v=>onSettings({autoSourceAccounts:v})}),
            h(TextField,{label:'执行时间（HH:mm）',value:cfg.checkin?.runAt||'10:05',
              onChange:v=>onSettings({runAt:v})}),
            h(TextField,{label:'时区',value:cfg.checkin?.timeZone||'Asia/Shanghai',
              onChange:v=>onSettings({timeZone:v})})),
          h('p',{style:css.small},'自动开关只影响领取执行；已登录来源的只读签到查询不会被关闭。')),
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
        [checkinsView,setCheckinsView]=useState(null),[actionBusy,setActionBusy]=useState(''),
        [channelQuery,setChannelQuery]=useState(''),[discovered,setDiscovered]=useState({}),
        [managedAccountProvider,setManagedAccountProvider]=useState(''),
        [modelProvider,setModelProvider]=useState('workbuddy'),[modelBusy,setModelBusy]=useState(false),
        [embeddedModels,setEmbeddedModels]=useState(null),
        [sourceRpcBusy,setSourceRpcBusy]=useState(''),
        [pendingSourceLogin,setPendingSourceLogin]=useState(null),
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
          [providerQuery,setProviderQuery]=useState('');
       const refreshRuntime=useCallback(async()=>{
         const response=await fetch(URL+'/status',{cache:'no-store'});
         if(response.ok)setStatus(await response.json());
         await Promise.all([
           fetch(URL+'/channels/accounts',{cache:'no-store'}).then(async r=>{if(r.ok)setChannelsView(await r.json());}),
           fetch(URL+'/checkins',{cache:'no-store'}).then(async r=>{if(r.ok)setCheckinsView(await r.json());}),
           fetch(URL+'/models/autofree',{cache:'no-store'}).then(async r=>{if(r.ok){const d=await r.json();setAutoFreeView(d.result)}}),
         ]);
       },[]);
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
              })
             ]).catch(()=>{});
          },30000);
          return ()=>clearInterval(timer);
        },[refresh]);
        useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return ()=>clearTimeout(timer)},[notice]);
        useEffect(()=>{if(!error)return;const timer=setTimeout(()=>setError(''),5000);return ()=>clearTimeout(timer)},[error]);
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
            setNotice('账号引用已导入，默认停用。请验证该账号后再启用。');
          }
          else if(path==='/channels/accounts/action'&&body.action==='refresh-all')setNotice('已检查 '+data.attempted+' 个可验证账号，各账号的真实结果见上方。');
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
        if(!window.confirm('确认在隔离来源渠道包中为 '+providerId+' 创建新的授权流程？授权链接只供你手动核对并打开，不会自动跳转。'))return;
        setSourceRpcBusy('login');setError('');setNotice('');
        try{
          const result=await callSourceRpc('account.create',{provider:providerId});
          if(typeof result.accountId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(result.accountId))
            throw Error('上游未返回有效的待授权账号 ID');
          const loginUrl=safeSourceLoginUrl(result.loginUrl);
          setPendingSourceLogin({providerId,accountId:result.accountId,loginUrl});
          setNotice(loginUrl?'已创建来源授权流程。请核对链接域名，打开授权后手动点击检查登录结果。':
            '来源授权流程已建立，但返回的授权链接不符合安全要求，未自动打开。');
           await refreshRuntime();
        }catch(error){setError(String(error?.message??error))}
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
       const tabs=[['overview','总览'],['channels','渠道账号'],['reuse','复用管理'],['checkins','每日签到'],['providers','提供商'],['pool','模型池'],['routes','模型链条'],['host','宿主故障切换'],['advanced','高级 JSON']];
       const navGroups=[
         {name:'运行',ids:['overview']},
         {name:'渠道与账号',ids:['channels','reuse','checkins']},
         {name:'模型与策略',ids:['providers','pool','routes']},
         {name:'运维',ids:['host','advanced']},
       ];
       const pageNotes={
         overview:'查看真实来源接入、账号、签到与模型调度状态',
         channels:'管理每个渠道的账号、授权状态与启停操作',
         reuse:'沿用原插件登录态，独立授权与宿主路由互不干扰',
         checkins:'按账号与渠道核对真实签到回执及执行计划',
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
       if(tab==='channels')content=h(AccountConsole,{data:channelsView,
         query:channelQuery,onQuery:setChannelQuery,run:runAction,setTab,
         busy:actionBusy,discovered,onAddProvider:addNativeProvider,
          showReferences:showReferenceChannels,onToggleReferences:setShowReferenceChannels,
          selectedChannel:selectedAccountChannel,onSelectChannel:setSelectedAccountChannel,
           onManageAccounts:channel=>{setManagedAccountProvider(channel.id);setTab('account-debug')},
           onOpenOwnedSource:()=>{setReuseSubtab('source');setTab('reuse')}});       if(tab==='reuse')content=h(ReuseConsole,{data:channelsView,cfg,
         onReuseSettings:changeReuseSettings,run:runAction,busy:actionBusy,
          onRefresh:refreshRuntime,subtab:reuseSubtab,onSubtab:setReuseSubtab,
         embeddedPack:status?.embeddedPack,credentialService:status?.credentialService,modelProvider,
         setModelProvider:value=>{setModelProvider(value);setEmbeddedModels(null)},
         onModels:loadUpstreamModels,modelBusy,models:embeddedModels,
         onSourceLogin:sourceLogin,onSourcePoll:sourcePollLogin,pendingLogin:pendingSourceLogin,
         onSourceRefresh:sourceRefreshAccount,sourceBusy:sourceRpcBusy,
         hostModels,hostModelBusy,hostSelectedModel,onSelectHostModel:setHostSelectedModel,
          onHostModels:loadHostModels,hostCatalog,onRefreshHostCatalog:loadHostCatalog,manualHostModel:hostManualModel,         onManualHostModel:setHostManualModel,adoptionPreview,adoptionBusy,adoptionResults,
          verifyResults,verifyBusy,onVerifyAdopted:verifyAdopted,
          onPreviewAdoption:loadAdoptionPreview,onAdoptAccount:adoptOriginalAccount});
       if(tab==='checkins')content=h(CheckinConsole,{data:checkinsView,cfg,onSettings:setCheckinSettings,
          onAccountAuto:setAccountAuto,run:runAction,refresh:refreshRuntime,busy:actionBusy,
          embeddedPack:status?.embeddedPack,sourceProvider:sourceCreditsProvider,
          setSourceProvider:value=>{setSourceCreditsProvider(value);setSourceCredits(null);setSourceClaims(null)},
          sourceCredits,sourceClaims,sourceBusy:sourceRpcBusy,
          onSourceStatus:sourceCheckinStatus,onSourceClaim:sourceClaimAll});
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
             h('div',{className:'dnr-header-note'},'来源复用 · 账号池 · 模型调度 · 每日签到 · 故障续跑')),
               h('span',{className:'dnr-version'},'1.0.0-rc.23')),           h('div',{className:'dnr-layout'},            h('label',{className:'dnr-mobile-nav'},              h('span',null,'设置页面'),              h('select',{'aria-label':'选择设置页面',value:activeNav,                onChange:e=>setTab(e.target.value)},
                navGroups.map(group=>h('optgroup',{key:group.name,label:group.name},
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
