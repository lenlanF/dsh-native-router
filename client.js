window.__ModuleLoader__.load({
  id:'dsh-native-router',
  factory:(require)=>{
    const React=require('react');
    const h=React.createElement;
    const {useState,useEffect,useCallback}=React;
    const NS='dsh-native-router',URL='/api/plugins/dsh-native-router';
    const css={
      root:{color:'var(--text,inherit)',maxWidth:1260,margin:'0 auto',padding:'22px clamp(12px,2.5vw,30px) 96px',fontSize:14,lineHeight:1.56},
      title:{fontSize:25,fontWeight:760,letterSpacing:'-.025em',margin:'0 0 5px'},
      caption:{fontSize:13,opacity:.76,lineHeight:1.7,margin:'0 0 17px'},
      tabbar:{display:'flex',gap:8,flexWrap:'wrap',padding:'10px 0 20px',borderBottom:'1px solid rgba(128,145,164,.18)',marginBottom:18},
      tab:{border:'1px solid rgba(120,140,160,.26)',borderRadius:11,padding:'10px 15px',minHeight:42,cursor:'pointer',background:'rgba(128,140,160,.045)',color:'inherit',font:'inherit'},
      chosen:{background:'rgba(69,124,228,.15)',borderColor:'rgba(69,124,228,.55)',fontWeight:700,boxShadow:'inset 0 -2px 0 rgba(69,124,228,.70)'},
      card:{border:'1px solid rgba(125,144,167,.22)',borderRadius:16,padding:'19px 20px',marginBottom:16,background:'var(--dsw-alias-bg-layer-2,rgba(128,140,160,.055))',boxShadow:'0 4px 20px rgba(25,40,64,.055)'},
      line:{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12},
      field:{display:'flex',gap:5,flexDirection:'column',flex:'1 1 160px',minWidth:120},
      input:{padding:'10px 12px',minHeight:40,borderRadius:10,border:'1px solid rgba(120,140,160,.4)',color:'inherit',background:'var(--dsw-alias-bg-layer-3,transparent)',font:'inherit',width:'100%',boxSizing:'border-box'},
      btn:{padding:'8px 13px',minHeight:38,borderRadius:9,border:'1px solid rgba(120,140,160,.38)',color:'inherit',background:'transparent',cursor:'pointer',font:'inherit'},
      primary:{background:'rgba(60,130,230,.21)',borderColor:'rgba(60,130,230,.57)',fontWeight:650},
      error:{padding:13,borderRadius:10,border:'1px solid #cc5555',marginBottom:14},
      success:{padding:13,borderRadius:10,border:'1px solid #46a47b',marginBottom:14},
      small:{fontSize:12,opacity:.8,lineHeight:1.55},
      overline:{fontSize:11,fontWeight:750,letterSpacing:'.13em',opacity:.67},
      hero:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap',padding:'20px 23px',marginBottom:18,borderRadius:17,background:'linear-gradient(115deg,rgba(64,122,223,.13),rgba(83,153,156,.045))',border:'1px solid rgba(75,132,215,.23)'},
      metrics:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(175px,1fr))',gap:12,marginBottom:18},
      metric:{minWidth:0,display:'flex',flexDirection:'column',alignItems:'flex-start',gap:6,padding:'17px',border:'1px solid rgba(125,144,167,.22)',borderRadius:14,background:'var(--dsw-alias-bg-layer-2,rgba(128,140,160,.055))'},
      doubleGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,440px),1fr))',gap:14},
      itemRow:{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,padding:'11px 0',borderBottom:'1px solid rgba(120,140,160,.16)'},
      mutedTag:{padding:'4px 9px',borderRadius:8,border:'1px solid rgba(125,144,167,.31)',fontSize:12,opacity:.8},
    };    function TextField({label,value,onChange,placeholder,width}){
      return h('label',{style:{...css.field,...(width?{flex:width}:{})}},
        h('span',{style:css.small},label),
        h('input',{style:css.input,value:value??'',placeholder,onChange:e=>onChange(e.target.value)}));
    }
    function Toggle({label,value,onChange}){
      return h('label',{style:{...css.line,marginBottom:0,whiteSpace:'nowrap',cursor:'pointer'}},
        h('input',{type:'checkbox',checked:!!value,onChange:e=>onChange(e.target.checked)}),
        label);
    }
    function Select({label,value,onChange,options}){
      return h('label',{style:css.field},h('span',{style:css.small},label),
        h('select',{style:css.input,value:value??'',onChange:e=>onChange(e.target.value)},
          options.map(x=>h('option',{key:x.value,value:x.value},x.label))));
    }
    function Button({children,onClick,kind='normal',disabled=false}){
      return h('button',{type:'button',style:{...css.btn,...(kind==='primary'?css.primary:{})},onClick,disabled},children);
    }
    function Panel({title,children,actions}){
      return h('div',{style:css.card},
        h('div',{style:{...css.line,justifyContent:'space-between'}},
          h('strong',{style:{fontSize:14}},title),actions),children);
    }
    function Section({title,children}){
      return h('div',null,h('h3',{style:{fontSize:14,margin:'12px 0 10px'}},title),children);
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
    const accountLabels={online:'已连接验证',not_checked:'待验证',checking:'验证中',
      expired:'登录失效',limited:'限流中',error:'检测异常',disabled:'已停用',provider_disabled:'渠道已停用'};
    const checkinLabels={success:'今日已签到',failed:'签到失败',pending_confirmation:'等待服务端确认',
      no_task:'今日无签到任务',client_required:'需官方客户端操作',unsupported:'待适配',
      not_run:'今日未签到',running:'执行中'};
    function StateTag({value,kind='account'}){
      const good=value==='online'||value==='success';
      const warn=['pending_confirmation','limited','not_run','not_checked','checking','running'].includes(value);
      return h('span',{style:{borderRadius:99,padding:'3px 9px',fontSize:11,border:'1px solid '+(good?'#39a777':warn?'#b89237':'rgba(140,140,150,.55)'),
        color:good?'#38b87a':warn?'#c29d44':'inherit',whiteSpace:'nowrap'}},
        kind==='checkin'?(checkinLabels[value]||value):(accountLabels[value]||value));
    }
    function EmbeddedPackConsole({pack,upstream,run,busy,modelProvider,setModelProvider,onModels,modelBusy,models,onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy}){
      const rows=upstream?.accounts||[],live=pack?.state==='mounted';
       const sourceChannels=pack?.channels||[],selectedSource=sourceChannels.includes(modelProvider)
         ?modelProvider:sourceChannels[0]||'';
      const packLabel={disabled:'默认关闭',blocked:'安全门禁阻止',waiting_host_services:'等待宿主',loading:'加载中',mounted:'已在 DSH 内挂载',failed:'挂载失败',host_disposed:'宿主已释放',disposed:'已释放',unavailable:'不可用'}[pack?.state]||'状态未知';
      return h(Panel,{title:'自主登录 · 渠道账号与模型'},
        h('div',{style:css.line},
          h('strong',null,packLabel),
           h('span',{style:css.mutedTag},'可自主授权 '+(pack?.channelCount??13)+' 个')),
         pack?.reason?h('p',{role:pack?.state==='failed'?'alert':undefined,style:css.small},
           pack.reason+(pack?.errorStage?'（失败阶段：'+pack.errorStage+'）':'')):null,
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
        ):h('p',{style:css.small},'启用并保存配置、重启 DSH 后可进行自主登录、刷新与模型查询。'),
        upstream?.state==='ready'?h('div',null,
          h('p',{style:css.small},'来源账号 '+rows.length+' 个；列表只反映上游设置，登录状态未知。'),
          h('div',{style:{maxHeight:320,overflowY:'auto'}},
            rows.map(row=>h('div',{key:row.providerId+':'+row.id,
              style:{...css.line,padding:'7px 0',borderBottom:'1px solid rgba(120,130,150,.16)'}},
              h('strong',null,row.providerId),
              h('span',null,row.nickname||row.id),
              h('span',{style:css.small},row.enabled?'来源池已启用':'来源池已停用'),
              h('span',{style:css.small},'登录状态未知 · 仅查看'),
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
               }},'退出来源账号（尝试清凭据）'))))):null,
        upstream?.state==='error'?h('p',{style:css.small},'来源账号池读取失败；未修改任何账号。'):null,
        upstream?.state==='unavailable'&&live?h('p',{style:css.small},'来源账号池暂不可读取。'):null
      );
    }
    function ReuseConsole({data,cfg,onReuseSettings,run,busy,onRefresh,subtab,onSubtab,
      embeddedPack,modelProvider,setModelProvider,onModels,modelBusy,models,
      onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy,
      hostModels,hostModelBusy,hostSelectedModel,onSelectHostModel,onHostModels,
      manualHostModel,onManualHostModel,
      adoptionPreview,adoptionBusy,adoptionResults,credentialService,onPreviewAdoption,onAdoptAccount,
      verifyResults,verifyBusy,onVerifyAdopted}){
      const reuse=data?.sessionReuse||{hostProviders:[],channels:[],results:[]};
      const hosts=reuse.hostProviders||[],available=(reuse.channels||[]).filter(x=>x.available);
      const accountLabels={online:'已验证',expired:'授权过期',pending:'等待确认',checking:'检查中',error:'验证失败',limited:'额度/频率受限'};
      const checkedAccounts=data?.accounts||[];
      const selectedHost=hostModels?.providerId||'';
      const hostLabel=id=>id==='workbuddy'?'WorkBuddy 国内':
        id==='workbuddy-global'?'WorkBuddy 国际':id;
      const tabs=[['sessions','本机登录态'],['host','宿主路由与模型'],['source','自主登录']];
      const section={padding:13,border:'1px solid rgba(125,144,167,.18)',
        borderRadius:12,background:'rgba(125,144,167,.03)',minWidth:0};
      return h(React.Fragment,null,
        h('div',{style:{...css.tabbar,marginBottom:14,paddingTop:0},role:'tablist','aria-label':'复用来源'},
          tabs.map(([id,label])=>h('button',{key:id,type:'button',role:'tab',
            'aria-selected':subtab===id,style:{...css.tab,...(subtab===id?css.chosen:{})},
            onClick:()=>onSubtab(id)},label))),
        subtab==='host'?h(Panel,{title:'宿主原生渠道 · 自动接入',
          actions:h(Button,{onClick:onRefresh,disabled:!!busy},'刷新渠道')},
          h('p',{style:css.small},'已注册的 DSH 原生 Provider 自动成为聚合路由可选来源，不创建额外账号或模型链。模型目录可见不等于登录鉴权已经验证。'),
          h('div',{style:{display:'grid',gridTemplateColumns:'minmax(136px,.82fr) minmax(0,1.6fr)',gap:14}},
            h('div',{style:{...section,maxHeight:490,overflowY:'auto'}},
              h('div',{style:{...css.line,justifyContent:'space-between'}},
                h('strong',null,'渠道 · '+hosts.length),
                h('span',{style:css.small},'选择查看右侧模型')),
              hosts.length?hosts.map(p=>h('button',{key:p.providerId,type:'button',
                disabled:!!hostModelBusy,
                onClick:()=>onHostModels(p.providerId),
                style:{display:'flex',width:'100%',textAlign:'left',alignItems:'center',
                  justifyContent:'space-between',gap:9,cursor:'pointer',color:'inherit',
                  background:selectedHost===p.providerId?'rgba(72,127,235,.14)':'transparent',
                  border:'0',borderBottom:'1px solid rgba(125,144,167,.15)',
                  padding:'12px 7px',borderRadius:7}},
                h('span',{style:{display:'flex',flexDirection:'column',minWidth:0}},
                  h('strong',{style:{overflowWrap:'anywhere'}},hostLabel(p.providerId)),
                  h('span',{style:css.small},'原插件托管 · 登录待核验')),
                h('span',{style:css.mutedTag},
                  hostModelBusy===p.providerId?'读取中…':selectedHost===p.providerId?'正在查看':'自动接入'))):
                h('p',{style:css.small},'宿主没有返回已注册原生 Provider'))),
            h('div',{style:{...section,maxHeight:490,overflowY:'auto'}},
              h('div',{style:{...css.line,justifyContent:'space-between'}},
                h('strong',null,selectedHost?'模型目录 · '+hostLabel(selectedHost):'模型目录'),
                selectedHost?h('span',{style:css.mutedTag},'已发现 '+(hostModels?.models?.length??0)):null),
              hostModels?.state==='ready'?h('div',null,
                h('p',{style:css.small},'所有已从原 DSH 插件目录查询到的模型均直接可选，不需要点击二次接入。免费状态必须由来源明确标记。'),
                hostModels.models.length?hostModels.models.map(m=>h('div',{key:m.id,style:css.itemRow},
                  h('div',{style:{minWidth:0,overflowWrap:'anywhere'}},
                    h('strong',null,m.name||m.id),
                    h('div',{style:css.small},m.id)),
                  h('span',{style:css.mutedTag},m.isFree?'来源标记免费':'费用待确认'))):
                  h('p',{style:css.small},'该插件没有公开模型目录；仍可从原插件界面核验可用模型。')):
                hostModels?.state==='unavailable'?h('p',{role:'status',style:css.small},
                  '原插件未提供可读取的模型目录，原 Provider 仍保持注册。'):
                h('p',{style:css.small},'在左侧选择任意渠道，右侧直接显示对应模型，不再跳到页面底部。'))):null,
        subtab==='sessions'?h(React.Fragment,null,
          h(Panel,{title:'接管原插件账号 · 迁入本插件',
            actions:h('div',{style:{...css.line,margin:0}},
              h(Button,{disabled:!!adoptionBusy,onClick:onPreviewAdoption},
                adoptionBusy==='preview'?'扫描中…':'重新扫描'),
              h(Button,{kind:'primary',disabled:!!verifyBusy||!!adoptionBusy||
                !adoptionPreview?.accounts?.some(x=>x.ownedAccountId),
                onClick:onVerifyAdopted},verifyBusy?'验证中…':'批量验证已接管账号'))},
            h('p',{style:css.small},'打开本页自动读取已安装插件的账号清单。只有点击具体账号的「接管」才复制授权；接管后自动启用独立账号、可在此页批量验证，不更改原插件账号。'),
            credentialService?.available===false?h('p',{role:'alert',style:css.small},
              '当前宿主 Credentials 服务不可用，无法安全复制独立授权。宿主插件的原生模型仍能直接复用。'):null,
            h('div',{style:css.line},
              h('span',{style:css.mutedTag},'发现 '+(adoptionPreview?.accounts?.length??0)+' 个'),
              h('span',{style:css.mutedTag},'已接管 '+(adoptionPreview?.accounts?.filter(x=>x.ownedAccountId).length??0)+' 个'),
              h('span',{style:css.mutedTag},'批量验证 '+(verifyResults?.length??0)+' 个')),
            adoptionPreview?.accounts?.length?
              adoptionPreview.accounts.map(row=>{
                const key=row.providerId+':'+row.accountId;
                const verify=verifyResults?.find(x=>x.id===row.ownedAccountId);
                const disabled=!!adoptionBusy||!row.portable||
                  (row.requiresPack&&adoptionPreview.ownPackState!=='mounted')||
                  (!row.privatePortable&&adoptionPreview.ownPackState!=='mounted');
                return h('div',{key,style:{...css.itemRow,gap:12}},
                  h('div',{style:{minWidth:0,flex:'1 1 200px'}},
                    h('strong',null,row.label||row.providerId),
                    h('div',{style:css.small},row.providerId+' · '+
                      (row.ownedAccountId?'已迁入独立账号（在线状态待验证）':
                        row.portable?'具备可审核接管方案':'暂不可独立接管')),
                    adoptionResults?.[key]?h('div',{role:'status',style:css.small},
                      adoptionResults[key].message):null,
                    verify?h('div',{role:'status',style:css.small},
                      '模型/授权检查：'+(accountLabels[verify.state]||verify.state)+' · '+verify.message):null),
                  h(Button,{disabled:disabled||adoptionResults?.[key]?.state==='success',
                    onClick:()=>onAdoptAccount(row)},
                    adoptionBusy==='adopt:'+row.accountId?'接管中…':
                    adoptionResults?.[key]?.state==='success'?'已接管 · 待验证':
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
          h(Panel,{title:'自主登录 · 独立账号',actions:h('span',{style:css.mutedTag},
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
    function AutoFreeConsole({pool,onRefresh,busy}){
      const models=pool?.models||[],catalog=pool?.catalog||[];
      const grouped=[...new Set(catalog.map(x=>x.providerId))];
      return h(React.Fragment,null,
        h(Panel,{title:'AutoFree · 自动免费模型池',
          actions:h(Button,{kind:'primary',disabled:!!busy,onClick:onRefresh},
            busy?'扫描中…':'刷新所有接入来源')},
          h('p',{style:css.small},'选择 DSH 的「聚合路由 / autofree」，将只使用来源明确免费或明确输入/输出零价的模型，额度失败自动切换下一个来源。不生成模型链，不复制账号凭据。'),
          h('div',{style:css.metrics},
            h(Metric,{label:'已确认免费',value:models.length,detail:'可进入自动池'}),
            h(Metric,{label:'发现模型',value:catalog.length,detail:'包含价格未知'}),
            h(Metric,{label:'费用待核实',value:pool?.unknownPricing??0,detail:'不进入 AutoFree'})),
          pool?.state==='not_scanned'?h('p',{style:css.small},'尚未扫描模型目录，可点击右上角刷新；DSH 查询模型时也会按缓存自动发现。'):null,
          models.length?grouped.map(providerId=>{
            const candidates=models.filter(x=>x.providerId===providerId);
            if(!candidates.length)return null;
            return h('div',{key:providerId,style:{...css.card,padding:12}},
              h('strong',null,providerId+' · 免费 '+candidates.length),
              candidates.map(x=>h('div',{key:x.model,style:css.itemRow},
                h('div',{style:{minWidth:0,overflowWrap:'anywhere'}},
                  h('strong',null,x.name||x.model),
                  h('div',{style:css.small},x.model)),
                h('span',{style:css.mutedTag},x.evidence))));
          }):h('p',{style:css.small},'目前没有取得来源明确免费且可路由的模型，AutoFree 会拒绝调度而不是冒险使用计费未知的模型。')));
    }
    function AccountConsole({data,query,onQuery,run,setTab,busy,discovered,onAddProvider,
      showReferences,onToggleReferences}){
      if(!data)return h(Panel,{title:'渠道账号'},'账号中心尚未连接 DSH Host。');
      const accounts=data.accounts||[];
      const channels=(data.channels||[]).filter(c=>(!c.referenceOnly||showReferences)
        &&(!query||[c.name,c.id,c.authMethod].some(x=>String(x||'').toLowerCase().includes(query.toLowerCase()))));
      const active=accounts.filter(a=>a.configuredEnabled).length,
        online=accounts.filter(a=>a.connectionState==='online').length;
      return h(React.Fragment,null,
        h(Panel,{title:'全部渠道 · 账号状态',actions:h(Button,{disabled:!!busy,onClick:()=>run('/channels/accounts/action',{action:'refresh-all'},'已重新验证可连接的账号')},'验证全部')},
          h('div',{style:{...css.line,justifyContent:'space-between'}},
            h('span',{style:css.small},'已登记 '+accounts.length+' 个账号；启用 '+active+'；最近验证通过 '+online+
              '。状态不会凭历史登录记录推断，须由对应渠道真实探针确认。'),
            h('input',{style:{...css.input,maxWidth:210},placeholder:'查找渠道 / 登录方式',
              value:query,onChange:e=>onQuery(e.target.value)})),
           h('div',{style:css.line},
             h(Button,{onClick:()=>onToggleReferences(!showReferences)},
               showReferences?'收起待接入渠道':'查看待接入渠道'),
             h(Button,{onClick:()=>setTab('reuse')},'自主登录与复用'))),
        channels.map(channel=>{
          const members=accounts.filter(a=>a.providerId===channel.id),
            pool=(data.pools||[]).find(x=>x.providerId===channel.id);
          return h(Panel,{key:channel.id,title:channel.name,actions:
            h('span',{style:css.small},
              channel.referenceOnly?(channel.adapterReady?'原生驱动已就绪 · 待配置':'参考渠道 · 尚未原生接入'):
                (channel.adapterReady?'原生接口已接入':'专有协议待适配')+' · '+members.length+' 个账号')},
            h('div',{style:{...css.line,marginBottom:6}},
              h('span',{style:css.small},'登录方式：'+channel.authMethod),
              channel.referenceCheckin?h('span',{style:css.small},'参考项目包含签到流程，本插件尚需逐渠道验收'):null,
              pool?h('span',{style:css.small},'自动候选：'+pool.enabled+' / 已验证：'+pool.verified):null),
            members.length?members.map(account=>
              h('div',{key:account.id,style:{...css.card,padding:10,marginBottom:7}},
                h('div',{style:{...css.line,justifyContent:'space-between',marginBottom:6}},
                  h('strong',null,account.id),h(StateTag,{value:account.connectionState})),
                h('div',{style:{...css.line,marginBottom:7}},
                   h('span',{style:css.small},'凭据：'+account.credentialKind+' 引用'),
                    account.reusedExistingSession?h('span',{style:css.small},'已关联既有账号引用（远端授权待核验）'):null,
                    h('span',{style:css.small},'来源：'+(account.origin?.label||'尚未识别')),
                    account.origin?.sourceAvailable===false?h('span',{style:css.small},'原账号源当前不匹配或不可用 · 不应自动切换至其他账号'):null,
                    h('span',{style:css.small},'权重：'+account.weight),
                  account.checkedAt?h('span',{style:css.small},'最近检查：'+new Date(account.checkedAt).toLocaleString()):null),
                h('div',{style:css.small},account.message||'尚未验证'),
                h('div',{style:{...css.line,marginTop:10,marginBottom:0}},
                  h(Button,{disabled:!!busy||!account.loginAvailable||!account.configuredEnabled,
                     onClick:()=>run('/channels/accounts/action',{action:'login',accountId:account.id},'已完成连接验证')},account.reusedExistingSession?'校验现有登录态':'登录/校验'),
                  h(Button,{disabled:!!busy||!account.refreshAvailable||!account.configuredEnabled,
                    onClick:()=>run('/channels/accounts/action',{action:'refresh',accountId:account.id},'账号状态已刷新')},'刷新'),
                  h(Button,{disabled:!!busy,onClick:()=>run('/channels/accounts/action',{
                    action:'enable',accountId:account.id,enabled:!account.configuredEnabled},
                    !account.configuredEnabled?'账号已启用':'账号已停用')},account.configuredEnabled?'停用':'启用'),
                  h(Button,{disabled:!!busy,
                    onClick:()=>{if(window.confirm('确认将账号 '+account.id+' 从本插件解除关联？不会撤销上游 API Key。已被模型链引用的账号将拒绝退出。'))
                      run('/channels/accounts/action',{action:'logout',accountId:account.id},'已解除插件内账号引用')}},'退出/解绑')))
            ):h('p',{style:css.small},'当前没有已配置账号。'+(channel.protocol==='dsh-host'?'此渠道由原 DSH 插件托管登录，不需要重复添加账号。':channel.referenceOnly?
              channel.adapterReady?'已具备原生驱动；先配置并启用渠道、保存后再主动扫描桌面登录态。':'需要先完成该渠道的专有登录适配。':'可在账号池页面添加多个账号。')),
            h('div',{style:{...css.line,marginBottom:0}},
              !channel.referenceOnly?h(Button,{onClick:()=>setTab('accounts')},'管理账号池'):null,
              channel.referenceOnly&&channel.adapterReady?h(Button,{onClick:()=>onAddProvider(channel)},'配置此渠道'):null,
              !channel.referenceOnly&&channel.discoveryAvailable?h(Button,{disabled:!!busy,onClick:()=>run('/channels/discover',
                {providerId:channel.id},'发现结果已返回，需逐项确认后方可导入')},'扫描本机授权账号'):null,
              !channel.adapterReady?h('span',{style:css.small},'待实现原生 OAuth / 桌面端发现 / Cookie 适配器'):null),
            (discovered[channel.id]||[]).map(candidate=>h('div',{key:candidate.id,
              style:{...css.line,borderTop:'1px solid rgba(128,128,128,.16)',paddingTop:9,marginBottom:0}},
              h('strong',null,candidate.label||candidate.id),
              h('span',{style:css.small},candidate.source),
              h(Button,{disabled:!!busy,onClick:()=>{
                if(window.confirm('确认导入已授权账号 '+(candidate.label||candidate.id)+' ？只保存驱动凭据引用，导入后默认停用。'))
                  run('/channels/import',{providerId:channel.id,candidateId:candidate.id},'已导入账号引用（默认停用）');
              }},'审核后导入'))));
        }));
    }
    function CheckinConsole({data,cfg,onSettings,onAccountAuto,run,refresh,busy,embeddedPack,sourceProvider,setSourceProvider,sourceCredits,sourceClaims,sourceBusy,onSourceStatus,onSourceClaim}){
      if(!data)return h(Panel,{title:'每日签到中心'},'签到状态服务尚未连接到当前 DSH Host。');
      const accounts=data.accounts||[],groups=data.groups||[],ready=accounts.filter(a=>a.checkinSupported),
        success=accounts.filter(a=>a.checkinState==='success').length,
        pending=accounts.filter(a=>a.checkinState==='pending_confirmation').length;
      return h(React.Fragment,null,
        data.historyBlocked?h('div',{role:'alert',style:css.error},data.historyError):null,
        embeddedPack?.state==='mounted'?h(Panel,{title:'来源渠道 · 当日签到（上游实时状态）'},
          h('p',{style:css.small},'DSH 插件内自动签到按账号逐个执行，仅支持真实每日签到的来源渠道；手动批量领取仍会涉及该渠道全部来源账号，需二次确认和状态回查。'),
          h('div',{style:css.line},
            h(Select,{label:'来源渠道',value:sourceProvider,onChange:setSourceProvider,
              options:(embeddedPack.channels||[]).map(id=>({value:id,label:id}))}),
            h(Button,{disabled:!!sourceBusy||!!busy,onClick:()=>onSourceStatus(sourceProvider)},
              sourceBusy==='status'?'查询中…':'查询来源签到状态'),
            h(Button,{disabled:!!sourceBusy||!!busy||!sourceCredits
              ||sourceCredits.providerId!==sourceProvider||!sourceCredits.accounts.length
              ||SOURCE_CLAIM_EXCLUDED.has(sourceProvider),onClick:()=>onSourceClaim(sourceProvider)},
              '批量领取（该渠道所有账号）')),
          SOURCE_CLAIM_EXCLUDED.has(sourceProvider)
            ?h('p',{style:css.small},'此渠道的原始上游实现未提供每日签到领取，不能误报为支持。'):null,
          sourceCredits?.providerId===sourceProvider?h('div',{style:{maxHeight:300,overflowY:'auto'}},
            sourceCredits.accounts.length?sourceCredits.accounts.map(row=>h('div',{
              key:row.accountId,style:{...css.line,borderBottom:'1px solid rgba(128,128,128,.17)',padding:'6px 0'}},
              h('strong',null,row.accountId),
              h('span',{style:css.small},!row.status||row.status.available!==true||row.status.todayCheckedIn===null
                ?'状态未知 · 不计入成功':row.status.todayCheckedIn===true
                ?'来源确认：今天已签到':row.status.active===false?'来源报告：活动未开启':'来源报告：今天尚未签到')))
              :h('p',{style:css.small},'该渠道尚无来源账号的签到状态。')):h('p',{style:css.small},'当前未查询这个渠道；不会自动发起来源请求或显示模拟成功。'),
          sourceClaims?.providerId===sourceProvider?h('div',{style:css.card},
            h('strong',null,'最近一次来源批量领取回执（需要重新查询验证）'),
            sourceClaims.results.map(row=>h('div',{key:row.accountId,style:css.line},
              h('span',null,row.accountId),h('span',{style:css.small},'来源返回：'+row.kind+' · 尚未复核')))):null
        ):h(Panel,{title:'来源渠道 · 当日签到'},h('p',{style:css.small},
          '来源渠道尚未装载。可在本插件设置中启用内置渠道包，无需启动任何外部服务。')),
        h(Panel,{title:'今日签到 · '+data.today+' ('+data.timeZone+')',
          actions:h(Button,{disabled:!!busy,onClick:refresh},'刷新本地记录')},
          h('div',{style:css.line},
            ...['已确认 '+success,'待确认 '+pending,'具备执行器 '+ready.length,'账号总数 '+accounts.length]
              .map(x=>h('span',{key:x,style:css.btn},x))),
          h('p',{style:css.small},'只接受渠道返回并完成服务端验证的签到结果。提交受理不等于完成；无任务、待确认、客户端操作与失败分开显示。')),
        h(Panel,{title:'自动签到设置（依托 DSH Host 运行）'},
          h('div',{style:css.line},
            h(Toggle,{label:'启用每日自动签到（默认关闭）',value:cfg.checkin?.autoEnabled,
              onChange:v=>onSettings({autoEnabled:v})}),
            h(Toggle,{label:'覆盖所有已启用、支持每日签到的来源账号',
              value:cfg.checkin?.autoSourceAccounts!==false,
              onChange:v=>onSettings({autoSourceAccounts:v})}),
            h(TextField,{label:'执行时间（HH:mm）',value:cfg.checkin?.runAt||'10:05',
              onChange:v=>onSettings({runAt:v})}),
            h(TextField,{label:'时区',value:cfg.checkin?.timeZone||'Asia/Shanghai',
              onChange:v=>onSettings({timeZone:v})})),
          h('p',{style:css.small},'开启总开关后：已配置的常规账号按逐账号开关执行；来源渠道自动覆盖全部已启用且确实具备每日签到功能的账号，可单独关闭来源自动覆盖。已受理不算成功，必须回查；失败与待确认最多按间隔重试三次。全部任务在 DSH 进程内运行，无需额外服务。')),
        groups.map(channel=>{
          const members=accounts.filter(a=>a.providerId===channel.id);
          return h(Panel,{key:channel.id,title:channel.name,actions:
            h('span',{style:css.small},members.length+' 个账号 · 今日确认 '+channel.success)},
            members.length?members.map(a=>h('div',{key:a.id,style:{...css.card,padding:10,marginBottom:7}},
              h('div',{style:{...css.line,justifyContent:'space-between',marginBottom:4}},
                h('strong',null,a.id),h(StateTag,{kind:'checkin',value:a.checkinState})),
              h('p',{style:css.small},a.checkinMessage),
              h('div',{style:{...css.line,marginBottom:0}},
                 a.sourceAccount&&!cfg.accounts.some(row=>row.id===a.id)
                   ?h('span',{style:css.small},a.autoCheckin?'来源账号：跟随全渠道自动签到':'来源账号：自动签到已关闭')
                   :h(Toggle,{label:'该账号自动签到',value:cfg.accounts.find(row=>row.id===a.id)?.autoCheckin===true,
                     onChange:v=>onAccountAuto(a.id,v)}),
                h(Button,{disabled:!!busy||!!data.historyBlocked||!a.checkinSupported||!a.enabled,
                  onClick:()=>run('/checkins/action',{action:'run',accountId:a.id},'该账号签到操作已结束，请查看实际结果')},
                  '立即签到')))):
              h('p',{style:css.small},channel.referenceOnly?'此渠道需先完成账号及签到适配。':'暂无账号；没有执行签到请求。'));
        }),
        h(Panel,{title:'最近签到记录（仅保留真实执行）'},
          (data.history||[]).length?(data.history||[]).slice(0,25).map((v,i)=>
            h('div',{key:i,style:{...css.line,borderBottom:'1px solid rgba(128,128,128,.16)',padding:'6px 0'}},
              h('span',{style:css.small},v.date),
              h('strong',null,v.providerId+' / '+v.accountId),
              h(StateTag,{kind:'checkin',value:v.state}),
              h('span',{style:css.small},v.message))):
            h('p',{style:css.small},'暂无实际签到记录；不会显示模拟的已签到状态。')));
    }

    function Metric({label,value,detail,onClick}){
      return h('div',{style:css.metric},
        h('span',{style:css.small},label),
        h('strong',{style:{fontSize:26,fontWeight:760,fontVariantNumeric:'tabular-nums',lineHeight:1.3}},String(value)),
        h('span',{style:css.small},detail),
        onClick?h(Button,{onClick},'查看详情'):null);
    }
    function OverviewConsole({cfg,status,channelsView,checkinsView,onNavigate,onRefresh}){
      const accounts=channelsView?.accounts||[],checkins=checkinsView?.accounts||[];
      const hostProviders=status?.sessionReuse?.hostProviders||channelsView?.sessionReuse?.hostProviders||[];
      const verified=accounts.filter(a=>a.connectionState==='online').length;
      const eligible=checkins.filter(a=>a.checkinSupported&&a.enabled).length;
      const signed=checkins.filter(a=>a.checkinState==='success').length;
      const failed=checkins.filter(a=>a.checkinState==='failed').length;
      const pending=checkins.filter(a=>a.checkinState==='pending_confirmation').length;
      const enabledChains=cfg.routes.filter(r=>r.enabled).length;
      const switchLog=cfg.hostFailover?.switchLog||[];
      const routeName=p=>p.providerId==='workbuddy'?'WorkBuddy 国内原生路由':
        p.providerId==='workbuddy-global'?'WorkBuddy 国际原生路由':p.providerId;
      return h(React.Fragment,null,
        h('div',{style:css.hero},
          h('div',null,h('div',{style:css.overline},'DSH · MULTI-PROVIDER HUB'),
            h('h3',{style:{margin:'7px 0 6px',fontSize:20}},'渠道与聚合路由运行总览'),
            h('p',{style:{...css.caption,marginBottom:0}},'基于 DSH 当前实际数据展示。宿主路由注册、账号授权验证、每日签到互不等同；不以安装记录冒充已登录。')),
          h(Button,{onClick:onRefresh},'刷新运行状态')),
        h('div',{style:css.metrics},
          h(Metric,{label:'宿主已注册路由',value:status?hostProviders.length:'—',detail:'原插件托管 · 状态待核验',onClick:()=>onNavigate('reuse')}),
          h(Metric,{label:'聚合账号',value:channelsView?accounts.length:'—',detail:'已验证在线 '+verified,onClick:()=>onNavigate('channels')}),
          h(Metric,{label:'已启用模型链',value:enabledChains,detail:'共配置 '+cfg.routes.length+' 条',onClick:()=>onNavigate('routes')}),
          h(Metric,{label:'今日确认签到',value:checkinsView?signed:'—',detail:'具备执行器 '+eligible+' · 失败 '+failed,onClick:()=>onNavigate('checkins')}),
          h(Metric,{label:'自动续跑',value:cfg.hostFailover?.enabled?'已开启':'已关闭',detail:'累计留存切换记录 '+switchLog.length,onClick:()=>onNavigate('host')})),
        h('div',{style:css.doubleGrid},
          h(Panel,{title:'本机 DSH Provider · 插件路由状态',actions:h(Button,{onClick:()=>onNavigate('reuse')},'查看渠道来源')},
            h('p',{style:css.small},'这些路由由 DSH Host 实际注册，可能由其他插件自行管理登录态；未核验账号前不将其计入已登录账号池。'),
            hostProviders.length?hostProviders.slice(0,14).map(p=>h('div',{key:p.providerId,style:css.itemRow},
              h('div',null,h('strong',null,routeName(p)),
                h('div',{style:css.small},'Provider: '+p.providerId+' · '+(p.accountAccess==='pool-required'?'需匹配原 DSH 账号池':'账号由原插件管理或未知'))),
              h('span',{style:css.mutedTag},'路由已注册 · 登录未核实'))):
              h('p',{style:css.small},'尚未发现其他已注册 Provider，或运行状态尚未加载。')),
          h(Panel,{title:'账号来源 · 分别核验',actions:h(Button,{onClick:()=>onNavigate('channels')},'管理账号')},
            h('p',{style:css.small},'DSH 原插件账号池、本机桌面只读会话和本插件配置账号分别列示，不复制原插件凭据。'),
            accounts.length?accounts.slice(0,12).map(a=>h('div',{key:a.id,style:css.itemRow},
              h('div',{style:{minWidth:0}},h('strong',{style:{overflowWrap:'anywhere'}},a.providerName+' · '+a.id),
                h('div',{style:css.small},a.origin?.label||'凭据来源待核验')),
              h(StateTag,{value:a.connectionState}))):h('p',{style:css.small},'当前尚未配置账号。宿主已注册 Provider 不会被自动当作本插件账号。'))),
        h('div',{style:css.doubleGrid},
          h(Panel,{title:'每日签到 · 服务端确认结果',actions:h(Button,{onClick:()=>onNavigate('checkins')},'签到管理')},
            h('div',{style:css.line},
              h('span',{style:css.mutedTag},'已确认 '+signed),
              h('span',{style:css.mutedTag},'待确认 '+pending),
              h('span',{style:css.mutedTag},'失败 '+failed),
              h('span',{style:css.mutedTag},'支持执行 '+eligible)),
            h('p',{style:css.small},'签到总开关：'+(cfg.checkin?.autoEnabled?'已启用':'未启用')+
              ' · 日期：'+(checkinsView?.today||'尚未读取')+' · 只统计真实来源回执。'),
            checkinsView?.historyBlocked?h('p',{style:css.error},'签到历史存储异常，已停止自动执行。'):null),
          h(Panel,{title:'模型调度与故障切换',actions:h(Button,{onClick:()=>onNavigate('host')},'管理故障续跑')},
            h('div',{style:css.line},h('span',{style:css.mutedTag},'自定义链 '+enabledChains),
              h('span',{style:css.mutedTag},'续跑 '+(cfg.hostFailover?.enabled?'开启':'关闭')),
              h('span',{style:css.mutedTag},'成功请求 '+(status?.metrics?.successfulTurns??'—')),
              h('span',{style:css.mutedTag},'失败尝试 '+(status?.metrics?.failedAttempts??'—'))),
            switchLog.length?h('p',{style:css.small},'最近切换：'+switchLog.at(-1).from+' → '+switchLog.at(-1).to):
              h('p',{style:css.small},'暂无切换记录；不会将失败尝试算作成功续跑。'),
            h('p',{style:css.small},'模型链与宿主故障切换各有独立规则；不重放已成功执行的工具。'))));
    }
    function App(){
      const [cfg,setCfg]=useState(null),[tab,setTab]=useState('overview'),[busy,setBusy]=useState(false),
        [notice,setNotice]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(null),
        [raw,setRaw]=useState(''),[channelsView,setChannelsView]=useState(null),
        [checkinsView,setCheckinsView]=useState(null),[actionBusy,setActionBusy]=useState(''),
        [channelQuery,setChannelQuery]=useState(''),[discovered,setDiscovered]=useState({}),
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
         [autoFreeBusy,setAutoFreeBusy]=useState(false);
      const refresh=useCallback(async()=>{
        setBusy(true);setError('');
        try{
          const a=await fetch(URL+'/config',{cache:'no-store'});
          if(!a.ok)throw Error('配置读取失败 ('+a.status+')');
          const data=await a.json();if(!data.ok||!data.config)throw Error('插件未返回配置');
          setCfg(data.config);setRaw(JSON.stringify(data.config,null,2));
          const response=await fetch(URL+'/status',{cache:'no-store'});
          if(response.ok)setStatus(await response.json());
          await Promise.all([
            fetch(URL+'/channels/accounts',{cache:'no-store'}).then(async r=>{if(r.ok)setChannelsView(await r.json());}),
            fetch(URL+'/checkins',{cache:'no-store'}).then(async r=>{if(r.ok)setCheckinsView(await r.json());}),
            fetch(URL+'/models/autofree',{cache:'no-store'}).then(async r=>{if(r.ok){const d=await r.json();setAutoFreeView(d.result)}}),
          ]);
        }catch(e){setError(String(e.message??e))}finally{setBusy(false)}
      },[]);
      useEffect(()=>{refresh()},[refresh]);
      // Visiting the adoption tab scans metadata only; no account migration.
      useEffect(()=>{
        if(tab==='reuse'&&reuseSubtab==='sessions')void loadAdoptionPreview();
        if(tab==='pool')void refreshAutoFree();
      },[tab,reuseSubtab]);
      async function refreshAutoFree(){
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
          await refresh();
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
        setActionBusy(path+':'+(body.accountId||body.providerId||body.action));setError('');setNotice('');
        try{
          const response=await fetch(URL+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
          const data=await response.json();
          if(!response.ok||!data.ok)throw Error(data.error||'操作失败（'+response.status+'）');
          await refresh();
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
          await refresh();
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
          await refresh();
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
          await refresh();
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
              status:row.status&&typeof row.status==='object'?{
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
async function loadHostModels(providerId){
        setHostModelBusy(providerId);setHostModels(null);setHostSelectedModel('');setHostManualModel('');setError('');
        try{
          const response=await fetch(URL+'/host/models',{
            method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId}),
          });
          const data=await response.json();
           if(!data.result||!['ready','unavailable'].includes(data.result.state)
             ||data.result.providerId!==providerId)
             throw Error('宿主插件模型目录接口暂不可用');
           if(data.result.state!=='ready')
             setNotice('原插件没有公开模型目录，但原 Provider 已自动接入；可在其原生界面核对模型。');
          setHostModels(data.result);setHostSelectedModel(data.result.models?.[0]?.id||'');
        }catch(error){setError(String(error?.message??error))}
        finally{setHostModelBusy('')}
      }
      async function loadUpstreamModels(providerId){
        setModelBusy(true);setError('');setEmbeddedModels(null);
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
          setCfg(data.config);setRaw(JSON.stringify(data.config,null,2));
          await refresh();
          setNotice('配置保存成功。账号页和签到页已重新读取；涉及宿主级模型目录时请完整重启 DSH Host。');
        }catch(e){setError(String(e.message??e))}finally{setBusy(false)}
      }
       if(!cfg)return h('div',{style:css.root},h('h2',{style:css.title},'聚合路由'),error?h('p',{style:css.error},error):'读取配置中…');
       const providerChoices=cfg.providers.map(x=>({value:x.id,label:x.name+' ('+x.id+')'}));
       const accountProviderChoices=cfg.providers.filter(x=>x.protocol!=='dsh-host')
         .map(x=>({value:x.id,label:x.name+' ('+x.id+')'}));
      const modes=[{value:'priority',label:'按链条顺序降级'},{value:'pinned',label:'固定首个模型（账号可切）'},{value:'free',label:'仅显式标记免费'}];
      const tabs=[['overview','总览'],['channels','渠道账号'],['reuse','复用管理'],['checkins','每日签到'],['providers','提供商'],['pool','模型池'],['routes','模型链条'],['host','宿主故障切换'],['advanced','高级 JSON']];
      let content=null;
       if(tab==='overview')content=h(OverviewConsole,{cfg,status,channelsView,checkinsView,onNavigate:setTab,onRefresh:refresh});
       const changeReuseSettings=change=>setCfg(old=>({...old,
         embeddedPack:{...old.embeddedPack,...('embeddedEnabled' in change?{enabled:change.embeddedEnabled}:{})},
         sessionReuse:{...old.sessionReuse,
           ...('enabled' in change?{enabled:change.enabled}:{}),
           ...('resetIgnored' in change?{ignoredIds:[]}:{})}}));
       if(tab==='channels')content=h(AccountConsole,{data:channelsView,
         query:channelQuery,onQuery:setChannelQuery,run:runAction,setTab,
         busy:actionBusy,discovered,onAddProvider:addNativeProvider,
         showReferences:showReferenceChannels,onToggleReferences:setShowReferenceChannels});
       if(tab==='reuse')content=h(ReuseConsole,{data:channelsView,cfg,
         onReuseSettings:changeReuseSettings,run:runAction,busy:actionBusy,
         onRefresh:refresh,subtab:reuseSubtab,onSubtab:setReuseSubtab,
         embeddedPack:status?.embeddedPack,credentialService:status?.credentialService,modelProvider,
         setModelProvider:value=>{setModelProvider(value);setEmbeddedModels(null)},
         onModels:loadUpstreamModels,modelBusy,models:embeddedModels,
         onSourceLogin:sourceLogin,onSourcePoll:sourcePollLogin,pendingLogin:pendingSourceLogin,
         onSourceRefresh:sourceRefreshAccount,sourceBusy:sourceRpcBusy,
         hostModels,hostModelBusy,hostSelectedModel,onSelectHostModel:setHostSelectedModel,
         onHostModels:loadHostModels,manualHostModel:hostManualModel,
         onManualHostModel:setHostManualModel,adoptionPreview,adoptionBusy,adoptionResults,
          verifyResults,verifyBusy,onVerifyAdopted:verifyAdopted,
          onPreviewAdoption:loadAdoptionPreview,onAdoptAccount:adoptOriginalAccount});
      if(tab==='checkins')content=h(CheckinConsole,{data:checkinsView,cfg,onSettings:setCheckinSettings,
        onAccountAuto:setAccountAuto,run:runAction,refresh,busy:actionBusy,
        embeddedPack:status?.embeddedPack,sourceProvider:sourceCreditsProvider,
        setSourceProvider:value=>{setSourceCreditsProvider(value);setSourceCredits(null);setSourceClaims(null)},
        sourceCredits,sourceClaims,sourceBusy:sourceRpcBusy,
        onSourceStatus:sourceCheckinStatus,onSourceClaim:sourceClaimAll});
      if(tab==='providers')content=h(Section,{title:'提供商注册表'},cfg.providers.map((p,i)=>
        h(Panel,{key:p.id,title:(i+1)+'. '+(p.name||p.id),actions:
          h(Button,{onClick:()=>remove('providers',i)},'删除')},
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
      if(tab==='pool')content=h(AutoFreeConsole,{pool:autoFreeView,onRefresh:refreshAutoFree,busy:autoFreeBusy});
       if(tab==='account-debug')content=h(Section,{title:'账号引用 · 排障用'},cfg.accounts.map((a,i)=>
        h(Panel,{key:a.id,title:(i+1)+'. '+a.id,actions:h(Button,{onClick:()=>remove('accounts',i)},'删除')},
          h('div',{style:css.line},
            h(TextField,{label:'账号 ID',value:a.id,onChange:v=>edit('accounts',i,{id:v})}),
            h(Select,{label:'所属提供商',value:a.providerId,onChange:v=>edit('accounts',i,{providerId:v}),options:accountProviderChoices}),
            h(TextField,{label:'凭据引用，如 env:KEY / host:ref / driver:channel:id',value:a.credentialRef,width:'2 1 260px',onChange:v=>edit('accounts',i,{credentialRef:v})}),
            h(TextField,{label:'权重',value:String(a.weight??1),onChange:v=>edit('accounts',i,{weight:Number(v)})}),
            h(Toggle,{label:'启用',value:a.enabled,onChange:v=>edit('accounts',i,{enabled:v})}),
            h(Toggle,{label:'自动签到',value:a.autoCheckin,onChange:v=>edit('accounts',i,{autoCheckin:v})})))),
        h(Button,{kind:'primary',disabled:!accountProviderChoices.length,onClick:()=>add('accounts',{
          id:'account'+(cfg.accounts.length+1),providerId:accountProviderChoices[0].value,
          credentialRef:'env:MY_API_KEY',enabled:true,weight:1})},'+ 新增账号'));
      if(tab==='routes')content=h(Section,{title:'模型链条 · 仅手工维护'},
        h('p',{style:css.small},'渠道接入、扫码授权、账号接管均不会自动生成或更改模型链。这里手工选择跨来源模型及降级顺序；AutoFree 在模型池单独管理。'),cfg.routes.map((r,i)=>
        h(Panel,{key:r.id,title:r.name+' / chain:'+r.id,actions:h(Button,{onClick:()=>remove('routes',i)},'删除链条')},
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
        h(Panel,{title:'宿主级跨 Provider 链'},
          (cfg.hostFailover.priority||[]).map((entry,i)=>h('div',{key:i,style:css.line},
            h(TextField,{label:'DSH Provider',value:entry.provider,onChange:v=>changeHostTier(i,{provider:v})}),
            h(TextField,{label:'模型 ID',value:entry.model,onChange:v=>changeHostTier(i,{model:v})}),
            h(Toggle,{label:'免费',value:entry.free,onChange:v=>changeHostTier(i,{free:v})}),
            h(Button,{disabled:i===0,onClick:()=>setCfg(old=>{
              const next=structuredClone(old),items=next.hostFailover.priority;[items[i],items[i-1]]=[items[i-1],items[i]];return next;
            })},'↑'),
            h(Button,{disabled:i===cfg.hostFailover.priority.length-1,onClick:()=>setCfg(old=>{
              const next=structuredClone(old),items=next.hostFailover.priority;[items[i],items[i+1]]=[items[i+1],items[i]];return next;
            })},'↓'),
            h(Button,{onClick:()=>changeHost({priority:cfg.hostFailover.priority.filter((_,j)=>j!==i)})},'删除'))),
          h(Button,{onClick:()=>changeHost({priority:[...(cfg.hostFailover.priority||[]),
            {provider:'native-router',model:'chain:'+(cfg.routes[0]?.id||'chain-id'),free:false}]})},'+ 添加宿主候选')),
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
      return h('div',{style:css.root},
        h('h2',{style:css.title},'聚合路由'),
        h('p',{style:css.caption},'DSH 原生插件复用 · 桌面授权复用 · 多账号池 · 每日签到 · 模型故障安全续跑 · v1.0.0-rc.11'),
        h('div',{style:css.tabbar},tabs.map(([id,label])=>h('button',{key:id,type:'button',
          style:{...css.tab,...(tab===id?css.chosen:{})},onClick:()=>setTab(id)},label))),
        error?h('div',{role:'alert',style:css.error},error):null,
        notice?h('div',{role:'status',style:css.success},notice):null,
        content,
        h('div',{style:{...css.line,position:'sticky',bottom:0,padding:12,
          background:'var(--dsw-alias-bg-layer-2,var(--background,#222))',borderTop:'1px solid rgba(120,130,150,.24)'}},
          h(Button,{kind:'primary',disabled:busy,onClick:save},busy?'正在保存…':'保存配置'),
          h(Button,{disabled:busy,onClick:refresh},'重新读取'),
          h('span',{style:css.small},'渠道初始化、模型目录等配置可能需要重启 DSH；宿主故障切换规则会在后续事件读取，已在运行的任务不直接修改。')));
    }
    function apply(ctx){
      const slots=ctx.slots;
      if(!slots?.register||!slots?.inject)return;
      const dispose=slots.inject('settings.section',()=>slots.register({
        name:'settings.section',id:NS,order:62,label:()=> '聚合路由',locale:NS,      },App));
      ctx.effect?.(()=>()=>dispose?.());
    }
    apply.inject=['slots'];
    return {name:NS,inject:['slots'],apply};
  }
});
