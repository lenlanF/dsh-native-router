window.__ModuleLoader__.load({
  id:'dsh-native-router',
  factory:(require)=>{
    const React=require('react');
    const h=React.createElement;
    const {useState,useEffect,useCallback}=React;
    const NS='dsh-native-router',URL='/api/plugins/dsh-native-router';
    const css={
      root:{color:'var(--text,inherit)',maxWidth:1080,padding:'18px 24px 80px',fontSize:13},
      title:{fontSize:20,fontWeight:750,margin:'0 0 7px'},
      caption:{fontSize:12,opacity:.72,lineHeight:1.7,margin:'0 0 16px'},
      tabbar:{display:'flex',gap:6,flexWrap:'wrap',padding:'7px 0 13px'},
      tab:{border:'1px solid rgba(120,130,150,.34)',borderRadius:9,padding:'7px 13px',cursor:'pointer',background:'transparent',color:'inherit'},
      chosen:{background:'rgba(80,130,240,.15)',borderColor:'rgba(80,130,240,.60)',fontWeight:650},
      card:{border:'1px solid rgba(120,130,150,.26)',borderRadius:12,padding:'14px',marginBottom:10,background:'rgba(120,130,150,.04)'},
      line:{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap',marginBottom:10},
      field:{display:'flex',gap:4,flexDirection:'column',flex:'1 1 140px',minWidth:115},
      input:{padding:'7px 9px',borderRadius:8,border:'1px solid rgba(120,130,150,.4)',color:'inherit',background:'var(--dsw-alias-bg-layer-3,transparent)',font:'inherit',width:'100%',boxSizing:'border-box'},
      btn:{padding:'6px 12px',borderRadius:8,border:'1px solid rgba(120,130,150,.40)',color:'inherit',background:'transparent',cursor:'pointer'},
      primary:{background:'rgba(60,130,230,.20)',borderColor:'rgba(60,130,230,.55)'},
      error:{padding:12,borderRadius:8,border:'1px solid #dc5959',marginBottom:10},
      success:{padding:12,borderRadius:8,border:'1px solid #47a57a',marginBottom:10},
      small:{fontSize:11,opacity:.74,lineHeight:1.5},
    };
    function TextField({label,value,onChange,placeholder,width}){
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
      const packLabel={disabled:'默认关闭',blocked:'安全门禁阻止',waiting_host_services:'等待宿主',loading:'加载中',mounted:'隔离挂载已运行',failed:'挂载失败',host_disposed:'宿主已释放',disposed:'已释放',unavailable:'不可用'}[pack?.state]||'状态未知';
      return h(Panel,{title:'来源渠道包 · 账号与模型'},
        h('div',{style:css.line},
          h('strong',null,packLabel),
          h('span',{style:css.small},'开源渠道 '+(pack?.channelCount||13)+' 个，启用需要隔离宿主许可')),
        pack?.reason?h('p',{style:css.small},pack.reason):null,
        h('p',{style:css.small},'上游来源池不等于 native-router 可用账号。仅复用来源接口，任何账号操作需手动确认；不复制授权信息。'),
        h('p',{style:css.small},'重要：上游代码启动时可能清理旧版账号、注册相同 Provider 或执行自动签到。本实验仅允许在 E:\\Temp 下独立测试 Profile 进行；不得用于正式 DSH 配置。'),
        live?h('div',null,
          h('div',{style:css.line},
            h(Select,{label:'来源渠道',value:modelProvider,onChange:setModelProvider,
              options:(pack.channels||[]).map(id=>({value:id,label:id}))}),
            h(Button,{disabled:!!busy||!!modelBusy||!!sourceBusy,onClick:()=>onModels(modelProvider)},
              modelBusy?'模型查询中…':'查询模型'),
            h(Button,{disabled:!!busy||!!sourceBusy,onClick:()=>onSourceLogin(modelProvider)},'发起来源登录')),
          pendingLogin?h('div',{style:{...css.card,padding:10}},
            h('span',{style:css.small},'待授权渠道：'+pendingLogin.providerId+' / '+pendingLogin.accountId),
            pendingLogin.loginUrl?h('div',{style:css.line},
              h('a',{href:pendingLogin.loginUrl,target:'_blank',rel:'noopener noreferrer'},
                '打开授权链接（先核对域名）')):h('p',{style:css.small},'来源未提供安全授权链接，不能自动打开'),
            h(Button,{disabled:!!sourceBusy,onClick:onSourcePoll},'检查登录结果')):null,
          models?.state==='ready'&&models.providerId===modelProvider?h('div',{style:{...css.card,maxHeight:300,overflowY:'auto'}},
            h('p',{style:css.small},'模型 '+models.models.length+' 项；免费标记未经核实，需用户自行审核导入账号并配置模型链。'),
            models.models.map(m=>h('div',{key:m.id,style:{...css.line,marginBottom:5}},
              h('strong',null,m.name),h('span',{style:css.small},m.id),
              m.upstreamFreeLabel?h('span',{style:css.small},'来源标记免费 · 未核实'):null))):null
        ):h('p',{style:css.small},'隔离挂载关闭时不会发起来源登录、刷新或模型查询。'),
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
    function AccountConsole({data,cfg,onReuseSettings,query,onQuery,run,setTab,busy,discovered,onAddProvider,embeddedPack,modelProvider,setModelProvider,onModels,modelBusy,models,onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy}){
      if(!data)return h(Panel,{title:'渠道账号总览'},'账号管理服务尚未连接到当前 DSH Host。');
      const accounts=data.accounts||[],channels=(data.channels||[]).filter(c=>
        !query||[c.name,c.id,c.authMethod].some(x=>String(x||'').toLowerCase().includes(query.toLowerCase())));
      const active=accounts.filter(a=>a.configuredEnabled).length,online=accounts.filter(a=>a.connectionState==='online').length;
      const pack=embeddedPack??{state:'unavailable'};
      const upstream=data.embeddedAccounts??{state:'unavailable',accounts:[]};
      const reuse=data.sessionReuse??{enabled:false,channels:[],results:[]};
      return h(React.Fragment,null,
        h(Panel,{title:'复用本机已登录的渠道程序',
          actions:h('div',{style:css.line},
            h(Button,{disabled:!!busy||!reuse.enabled,
              onClick:()=>run('/channels/reuse/scan',{},'已重新扫描现有登录态；没有执行登录操作')},
              '重新扫描现有登录态'),
            (reuse.ignored??0)>0?h(Button,{disabled:!!busy,
              onClick:()=>{if(window.confirm('确认重新允许此前主动解绑的已有登录态？请保存配置后再扫描。'))
                onReuseSettings({resetIgnored:true})}},'解除忽略'):null)},
          h('div',{style:css.line},
            h(Toggle,{label:'自动关联本机已有登录态（无需重复登录）',
              value:cfg?.sessionReuse?.enabled===true,
              onChange:v=>onReuseSettings({enabled:v})}),
            h(Toggle,{label:'启用内置 DSH 多渠道账号源',
              value:cfg?.embeddedPack?.enabled===true,
              onChange:v=>onReuseSettings({embeddedEnabled:v})})),
           h('p',{style:css.small},'启用并保存后会优先复用本机 WorkBuddy / CodeBuddy Desktop 的只读登录态，或 DSH 已安装渠道插件的既有账号与原 Provider；不存在时才挂载本插件内置渠道包。原程序登录文件不修改、原 DSH 凭据不复制、没有新 OAuth。账号已关联不等于服务端已经验证在线；同渠道多账号如无法安全精确选号，将等待核验。'),
          h('div',{style:css.line},
            h('span',{style:css.small},'当前自动关联 '+(reuse.autoLinked??0)+' 个账号'),
            h('span',{style:css.small},'已忽略 '+(reuse.ignored??0)+' 个已解绑账号'),
             h('span',{style:css.small},'认证来源：'+({
               'external-dsh-provider':'已安装的其他 DSH 渠道插件',
               'own-source-pack':'本插件内置 DSH 渠道包',
             }[reuse.reusableSource]??'尚无来源账号池'))),
          h('div',{style:{...css.line,flexWrap:'wrap',rowGap:5}},
            ...(reuse.channels||[]).map(row=>h('span',{key:row.providerId,style:css.small},
              row.providerId+'：'+(row.available?'可复用入口已就绪':'尚无经过核验的复用入口')))),
          (reuse.results||[]).slice(-8).map((row,i)=>h('div',{key:i,style:css.line},
            h('span',{style:css.small},row.providerId+' · '+({
              linked_unverified:'已关联（远端状态待验证）',
              already_configured:'已在账号池',
              ignored:'手动解绑后已忽略',
              provider_disabled:'渠道由用户停用',
              source_changed:'原客户端登录态已变化',
              multiple_accounts_unverified:'多个现有账号待核验精确选号',
              invalid_reference:'账号引用不安全，已拒绝',
              config_unavailable:'关联配置未成功保存',
            }[row.state]??'未确认')))),
          h('p',{style:css.small},'未支持的本机程序仍使用已有渠道授权入口，不会把机器标识或安装路径当作登录凭据。解除自动关联后会记入忽略清单，防止下次扫描又自动添加。')),
        h(EmbeddedPackConsole,{pack,upstream,run,busy,modelProvider,setModelProvider,onModels,modelBusy,models,onSourceLogin,onSourcePoll,pendingLogin,onSourceRefresh,sourceBusy}),
        h(Panel,{title:'全部渠道 · 账号状态',actions:h(Button,{disabled:!!busy,onClick:()=>run('/channels/accounts/action',{action:'refresh-all'},'已重新验证可连接的账号')},'验证全部')},
          h('div',{style:{...css.line,justifyContent:'space-between'}},
            h('span',{style:css.small},'已登记 '+accounts.length+' 个账号；启用 '+active+'；最近验证通过 '+online+
              '。状态不会凭历史登录记录推断，须由对应渠道真实探针确认。'),
            h('input',{style:{...css.input,maxWidth:210},placeholder:'查找渠道 / 登录方式',
              value:query,onChange:e=>onQuery(e.target.value)})),
          h('p',{style:css.small},'自建池：在账号池添加多个账号，并在模型链里限定账号；自动池：同渠道已启用账号自动加入候选（不代替实际登录）。')),
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
                   account.reusedExistingSession?h('span',{style:css.small},'已复用本机既有登录态（授权有效性待验）'):null,
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
            ):h('p',{style:css.small},'当前没有已配置账号。'+(channel.referenceOnly?
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
        [sourceClaims,setSourceClaims]=useState(null);
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
          ]);
        }catch(e){setError(String(e.message??e))}finally{setBusy(false)}
      },[]);
      useEffect(()=>{refresh()},[refresh]);
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
          setNotice('来源端确认已保存登录凭据。账号在线与模型可用性仍需单独验证。');
          await refresh();
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
          {id:channel.id,name:channel.name,protocol:'native-channel',baseUrl:'',models:[],enabled:false,supportsTools:true}]});
        setTab('providers');setNotice('渠道已放入草稿，默认停用。请启用后保存配置，再返回账号页点击扫描并审核导入。');
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
      if(!cfg)return h('div',{style:css.root},h('h2',{style:css.title},'原生多提供商路由'),error?h('p',{style:css.error},error):'读取配置中…');
      const providerChoices=cfg.providers.map(x=>({value:x.id,label:x.name+' ('+x.id+')'}));
      const modes=[{value:'priority',label:'按链条顺序降级'},{value:'pinned',label:'固定首个模型（账号可切）'},{value:'free',label:'仅显式标记免费'}];
      const tabs=[['overview','总览'],['channels','渠道账号'],['checkins','每日签到'],['providers','提供商'],['accounts','账号池配置'],['routes','模型链条'],['host','宿主故障切换'],['advanced','高级 JSON']];
      let content=null;
      if(tab==='overview')content=h(React.Fragment,null,
        h(Panel,{title:'当前配置'},h('div',{style:css.line},
          ['提供商：'+cfg.providers.length,'账号：'+cfg.accounts.length,'链条：'+cfg.routes.length,
           '可用账号：'+cfg.accounts.filter(a=>a.enabled).length].map(x=>h('span',{key:x,style:css.btn},x)))),
        h(Panel,{title:'设计说明'},
          h('p',null,'直接访问配置的上游提供商，不经过 Agent2API。本插件使用独立 Provider：native-router，其他 DSH 插件不受影响。'),
          h('p',{style:css.small},'账户只保存 env: 或 host: 凭据引用；免费标签由用户标注，不代表已验证真实计费。工具由 DSH 宿主授权执行。'),
          h('p',{style:css.small},'支持 chain:<链条ID> 作为 DSH 模型；账号/路线变更后重启宿主以刷新模型菜单。')),
        status?h(Panel,{title:'运行状态'},h('pre',{style:{whiteSpace:'pre-wrap',fontSize:11}},JSON.stringify(status,null,2))):null);
       if(tab==='channels')content=h(AccountConsole,{data:channelsView,cfg,
         onReuseSettings:change=>setCfg(old=>({...old,
           embeddedPack:{...old.embeddedPack,...('embeddedEnabled' in change?{enabled:change.embeddedEnabled}:{})},
            sessionReuse:{...old.sessionReuse,
              ...('enabled' in change?{enabled:change.enabled}:{}),
              ...('resetIgnored' in change?{ignoredIds:[]}:{}),}})),
         query:channelQuery,onQuery:setChannelQuery,
        run:runAction,setTab,busy:actionBusy,discovered,onAddProvider:addNativeProvider,embeddedPack:status?.embeddedPack,
        modelProvider,setModelProvider:value=>{setModelProvider(value);setEmbeddedModels(null)},
        onModels:loadUpstreamModels,modelBusy,models:embeddedModels,onSourceLogin:sourceLogin,
        onSourcePoll:sourcePollLogin,pendingLogin:pendingSourceLogin,onSourceRefresh:sourceRefreshAccount,
        sourceBusy:sourceRpcBusy});
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
            h(Select,{label:'协议类型',value:p.protocol,onChange:v=>edit('providers',i,{protocol:v}),options:[{value:'openai-chat',label:'OpenAI Chat'},{value:'anthropic-messages',label:'Anthropic Messages'},{value:'native-channel',label:'专有原生驱动（需适配器）'}]}),
            h(TextField,{label:'Base URL（含 /v1）',value:p.baseUrl,width:'2 1 260px',onChange:v=>edit('providers',i,{baseUrl:v})})),
          h('div',{style:css.line},h(TextField,{label:'模型 ID，以逗号分隔（留空则查询 /models）',
            value:(p.models||[]).join(', '),width:'3 1 360px',onChange:v=>edit('providers',i,{models:v.split(',').map(s=>s.trim()).filter(Boolean)})}),
            h(Toggle,{label:'启用',value:p.enabled,onChange:v=>edit('providers',i,{enabled:v})}),
            h(Toggle,{label:'支持工具调用',value:p.supportsTools,onChange:v=>edit('providers',i,{supportsTools:v})})),
          h('p',{style:css.small},'已支持 OpenAI Chat 和 Anthropic Messages 两套原生协议；专有 OAuth/短信账号适配将在后续版本加入。'))),
        h(Button,{kind:'primary',onClick:()=>add('providers',{id:'provider'+(cfg.providers.length+1),name:'新提供商',
          protocol:'openai-chat',baseUrl:'https://api.example.invalid/v1',models:[],enabled:false,supportsTools:true})},'+ 新增提供商'));
      if(tab==='accounts')content=h(Section,{title:'账号池（仅保存凭据引用）'},cfg.accounts.map((a,i)=>
        h(Panel,{key:a.id,title:(i+1)+'. '+a.id,actions:h(Button,{onClick:()=>remove('accounts',i)},'删除')},
          h('div',{style:css.line},
            h(TextField,{label:'账号 ID',value:a.id,onChange:v=>edit('accounts',i,{id:v})}),
            h(Select,{label:'所属提供商',value:a.providerId,onChange:v=>edit('accounts',i,{providerId:v}),options:providerChoices}),
            h(TextField,{label:'凭据引用，如 env:KEY / host:ref / driver:channel:id',value:a.credentialRef,width:'2 1 260px',onChange:v=>edit('accounts',i,{credentialRef:v})}),
            h(TextField,{label:'权重',value:String(a.weight??1),onChange:v=>edit('accounts',i,{weight:Number(v)})}),
            h(Toggle,{label:'启用',value:a.enabled,onChange:v=>edit('accounts',i,{enabled:v})}),
            h(Toggle,{label:'自动签到',value:a.autoCheckin,onChange:v=>edit('accounts',i,{autoCheckin:v})})))),
        h(Button,{kind:'primary',disabled:!providerChoices.length,onClick:()=>add('accounts',{id:'account'+(cfg.accounts.length+1),
          providerId:cfg.providers[0].id,credentialRef:'env:MY_API_KEY',enabled:false,weight:1})},'+ 新增账号'));
      if(tab==='routes')content=h(Section,{title:'自定义模型降级链'},cfg.routes.map((r,i)=>
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
      if(tab==='host')content=h(Section,{title:'DSH 宿主跨 Provider 故障续跑'},h(Panel,{title:'安全模式'},
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
            :h('p',{style:css.small},'暂无已入队的自动切换记录；此处不会把提交失败记录为成功。')));      if(tab==='advanced')content=h(Panel,{title:'JSON 高级编辑器'},
        h('p',{style:css.small},'高级模式会直接替换整份配置。仅保存提供商、账号引用与链条规则；不要填写 Token、密码或明文 API Key。'),
        h('textarea',{style:{...css.input,width:'100%',minHeight:400,fontFamily:'ui-monospace,monospace',fontSize:12},
          value:raw,onChange:e=>setRaw(e.target.value),'aria-label':'完整路由配置 JSON'}));
      return h('div',{style:css.root},
        h('h2',{style:css.title},'原生多提供商路由'),
        h('p',{style:css.caption},'已有 DSH 渠道登录态复用 · 本机桌面登录复用 · 账号池 · 自动签到 · AgentLoop 故障安全续跑 · v1.0.0-rc.1'),
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
        name:'settings.section',id:NS,order:62,label:()=> '原生多提供商路由',locale:NS,
      },App));
      ctx.effect?.(()=>()=>dispose?.());
    }
    apply.inject=['slots'];
    return {name:NS,inject:['slots'],apply};
  }
});
