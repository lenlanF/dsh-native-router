# DSH Native Router｜聚合路由

**当前版本：1.0.0-rc.11（自动接入和 AutoFree 免费模型池候选版，尚非稳定版）。**「复用管理」包含「宿主路由与模型 / 本机登录态 / 自主登录」三个 Tab。原宿主 Provider 及其模型自动成为聚合路由可选来源，无需二次导入或新建模型链，沿用原插件认证；内置来源包仍可独立发起扫码/网页登录并管理账号与每日签到。**注册 Provider 不等于已登录，目录不等于在线模型可用；真实登录和签到尚待实机验收。** 详见 [发行验收门禁](docs/RELEASE_ACCEPTANCE.md)。

本项目将 AutoFree 免费模型池、人工跨来源模型链和 DSH 宿主级 Agent 故障续跑整合为一个 Cordis 插件。**不依赖 Agent2API 网关或独立常驻服务进程**：由 DSH 插件在本进程直接访问上游模型服务。可以独立卸载，不覆盖原有 WorkBuddy、Loomy、其他 Provider。

## RC.11：接入即用、自动免费模型池与复用界面重构

- 原 DSH Provider 自动接入。复用管理默认打开本机登录态接管清单，自动只读扫描、明确确认后才复制授权；批量验证已接管账号可在同页执行。可发现来源不再用无效的扫码按钮表示；底部只显示简要来源说明。
- 宿主路由与模型采用左侧渠道、右侧该渠道模型目录的双栏布局，任何模型发现都不要求手工二次导入、配置提供商或生成模型链。独立登录成功后账号默认启用，模型目录自动更新，原插件登录态和原 Provider 保持不变。
- AutoFree 是动态免费模型池（聚合路由模型 ID: autofree），从已注册宿主和已登录独立来源发现模型。只有明确免费标签或输入输出两侧价格都为零的来源数据才进入池；未知价格不会被当成免费。可重试错误按可用来源逐级切换，确认不到免费模型时明确拒绝，不能暗中调用可能计费模型。
- 模型链仅由用户主动创建、编辑和排序；任何渠道接入或账号复制都不得隐式生成或改写链条。模型链负责一次模型请求内的顺序回退；宿主故障切换处理 Agent 后续回合续跑，彼此独立且不重复执行用户工具。
- 提供商根据已注册宿主、原生来源或用户输入 URL 自动选择协议；手动覆盖仅保留在排障详情里。账号引用的手工维护改为高级排障入口，不是模型池。
- 针对 RC.10 中来源挂载发生在 register_owned_adapter 阶段的故障，原生适配器绑定 Cordis Scope 释放，并新增反复卸载/重载验证。未挂载时不再显示 13 个可用渠道，改为明确失败类别及阶段。
- 隔离自动化测试并不能证明实际账号已经在线、所有渠道扫码均成功或每日签到已完成。用户应手动更新并完整重启 DSH Host 后，逐渠道验证。

## RC.10：真实 DSH 插件管理器兼容性修复（候选版）

- **rc.9 的实际问题已确认**：标准 npm 隔离安装可成功，但 DSH 插件管理器不保留其 `node_modules`；安装后的内置来源包因 `@deepseek-ai/dsh-credentials` 等模块解析失败，Lingxi/WorkBuddy 等接管也可能仅返回 `unavailable`。不能将 rc.9 的 npm 验收视为正式 DSH 验收。
- RC.10 将来源包连同必要的 11 个 MIT 运行模块编译为单个 `pack-runtime.mjs`，保留来源、构建回执、完整第三方许可证和 SHA-256 校验；自有 13 渠道与原插件同名 Provider 独立并行，不要求额外进程、`node_modules` 或单独网关。
- 私有账号接管取消运行时外部凭据模块导入，凭据引用按 DSH 一致的语法校验；从 DSH 宿主延迟注入其 Credentials 服务。状态页显示宿主凭据服务可用性，失败返回固定阶段码，不输出原账号的 Token、Cookie 或本地路径。
- 在实际 DSH 管理的 Node 24 运行时和隔离 Cordis/LLM/Connection 中，解压后无 `node_modules` 的包可以导入并注册全部 13 个独立来源路由，原 WorkBuddy/Loomy Provider 保留；完整回归、隔离安装、来源凭据及远端授权仍分别核验。
- **边界**：尚未在当前生产 DSH 安装或执行真实账号接管、扫码及签到。须在升级后确认 Credentials 状态，再进行逐账号的在线授权验收；保存独立凭据不等于已验证远端模型。

**Gemini 自主 OAuth 登录特别说明：** 上游开源包中嵌入的 Google OAuth 默认客户端凭据已从发布版本的代码中移除，不能直接发布到公开 GitHub。需要使用 Gemini 自有授权时，应在本地受保护的 DSH 运行环境中提供上游支持的 `CMDC_PAK_GOOGLE_CLIENT_ID`、`CMDC_PAK_GOOGLE_CLIENT_SECRET`，不可写入 GitHub、日志或公开配置。其他自主登录渠道不受这一凭据清理的影响。

## RC.9：接管结果可追踪、自主登录与复用并存、单插件自包含运行

修复三个界面问题：账号接管现在按每个账号实时显示操作中、完成或可操作的失败原因；已经接管的账号可返回「已有接管配置 · 待核验」并执行复核，避免按钮没有反馈或只显示一条红色泛化错误；其中「已保存凭据副本」仍不冒充云端登录已通过。

在固定 MIT 多渠道包中，原来的 `workbuddy`、`loomy` 等宿主 Provider 继续原样运行，**自有渠道统一使用 `native-router-source-渠道名` 独立模型适配器**。因此已有宿主登录态可委托复用，同一渠道也能在「自主登录」中创建聚合路由自己的独立授权与账号池；源路由不允许偷用宿主原账号。13 个来源适配器的登录、模型、签到能力仍使用原 MIT 实现，不增加进程或自定义网关。

旧安装包缺少 `@deepseek-ai/dsh-credentials` 等真实运行依赖，导致渠道包显示「加载失败」。RC.9 曾尝试将固定版本的 DSH Cordis、LlmRuntime、Credentials、Error 和 Schemastery 连同间接依赖放进 .tgz，但实际插件管理器剔除了嵌套依赖，造成加载失败；该发行方式已由 RC.10 的单文件运行模块替代。安装时无需另外运行服务、下载 Node 服务脚本、手动安装 DLL 或创建系统计划任务。发行前仅从 `package.json files` 白名单隔离复制源码到 `E:\Temp`，安装固定依赖并逐一校验打包文件哈希；原账号库、开发日志和未授权源文件不会进入安装包。稳定版仍须在生产环境验证登录、账单和故障恢复。

## RC.8：WorkBuddy 双区域独立接管、Lingxi 在线推理与多账号精确路由

WorkBuddy 5.x MIT 原插件的 **国内/国际独立私有账号保险库**现可只读发现；点击「复用管理 → 本机登录态 → 检查原插件账号」，对选定账号逐条确认后，授权将复制到聚合路由自己持久化的 DSH Credentials，新增 `own_workbuddy-cn` 和 `own_workbuddy-global`，**原插件账号保持不变**。新驱动不再依赖原插件，采用已安装 MIT 插件的各区模型目录、聊天请求头、续期协议和当天签到状态回查。用户确认迁入时尝试读取该账号的真实模型目录并填充自有模型链；目录无法读取时仅创建待验证模型引用，不冒称在线。

本机只读线上验收：WorkBuddy 国内/国际原登录态分别返回 60/28 条原始目录记录，新独立驱动的两区小请求均返回正文 2 字符并正常结束；Lingxi 使用现有会话返回 11 个模型，独立驱动在真实 `qwen3.8_flash` 上返回正文 2 字符。WorkBuddy 授权续期、原插件停用后的自有推理、按账号签到在离线隔离测试中通过。**并未在真实 DSH 中卸载现有插件，也未执行真实 WorkBuddy 签到，不能将模拟结果写成生产验收。**

内置的 13 个 MIT 渠道继续共享一套 DSH 内进程来源包和 9 类原生签到实现；已为全部 13 类渠道启用「选中账号 → 请求内凭据隔离 → 禁止回退其他账号」的受控实现，26 个模拟账号逐一验证。无额外网关、守护程序、系统计划任务。ZCode SQLite 账户只能在支持 `node:sqlite` 的 DSH 运行时读取（测试 Node 22.16 识别 1 个候选；Node 22.5 会显示运行时限制）。相关隐私与回归验收见 [接管指南](docs/OWNED_CHANNEL_ADOPTION.md) 与 [发行验收门禁](docs/RELEASE_ACCEPTANCE.md)。

## RC.7：优先复用现成 MIT 多渠道实现

核查发现本仓库早已内置 [dsh-get-it-for-free](https://github.com/hulibuld/dsh-get-it-for-free) 的 MIT 来源包，含 **Loomy 微信扫码/短信登录、模型目录、流式聊天、每日额度领取** 与 **ZCode 设备会话/验证码/模型路由**。RC.7（历史实现）停用重复手写 Loomy、ZCode 协议分支，改为通过 `nativeRouterSourceAccountPool` 使用现有来源包。逐账号明确同意后，可从原 Loomy 私有 Session / ZCode Start Plan SQLite 设备凭据复制到自有 DSH Credentials 与独立账号池，保留原插件，建立 `own_loomy`、`own_zcode` Provider 和自有模型链；原插件与来源包同名 Provider 冲突时，要在隔离或备份环境停用旧插件并重新加载 DSH 后，才能验收自有推理与签到。

Lingxi 不在该 MIT 包中，仍需自有原生驱动。WorkBuddy 既有桌面只读驱动和宿主委托调用，但原插件加密私有仓库的独立接管尚未实际验收。Agent2API 为 AGPL-3.0，本项目只参考其行为、不直接混合 GPL 源码。**保存授权副本不意味着在线模型及签到已经成功**。详见 [兼容矩阵](docs/PLUGIN_REUSE_MATRIX.md)。

## RC.6：真实原插件授权来源发现

在「复用管理 → 本机登录态」点击「检查原插件账号」，系统按已安装 WorkBuddy、Lingxi、Loomy 和 ZCode Start Plan 各自的真实存储类型进行只读发现，分别展示插件存在、私有授权记录、能否独立接管。既有 DSH AccountPool 的标准授权仍通过原有逐账号确认流程迁移；**私有格式发现不等于可迁移，更不等于已验证登录**。无来源直接显示扫描限制及建议使用自主登录；不展示 SID、Session、JWT、原始凭据字段或私有数据库路径。完整兼容说明见 [各渠道复用能力矩阵](docs/PLUGIN_REUSE_MATRIX.md)。

## RC.5：原插件账号独立接管

兼容原 DSH AccountPool 的已授权账号可经用户逐个确认复制到本插件独立授权库，建立独立 Provider 与直连模型入口，且绝不自动创建模型链；不能迁移的私有会话使用本插件原生授权。模拟原插件卸载后，独立模型推理及签到已通过自动化验证，真实账号仍待验收。完整说明见 [独立接管指南](docs/OWNED_CHANNEL_ADOPTION.md)。

## RC.4：复用与自主登录同时可用

- 宿主插件保持原生 Provider、认证与续期所有权；按需查询并接入真实模型目录，目录不存在时允许手动填写经原插件核实的模型 ID。
- 自主登录渠道与已有宿主账号并存：已注册的同名 Provider 由原插件负责，其余内置渠道保留原生账号创建、扫码/网页授权、回查和刷新能力。
- 内置渠道包使用独立 Cordis AccountPool、私有存储位置和新授权专用凭据引用，不覆盖宿主服务；无需外部网关或额外进程。挂载要求 Node.js >=22.10.0。
- 来源每日签到只对 9 种已有逐账号接口的渠道展示可操作结果，不伪造其他渠道签到成功。生产 DSH 安装与在线授权仍待验收。
### 原插件账号独立接管（可选）

在「复用管理 → 本机登录态」点击「检测可迁移账号」，逐个确认兼容 DSH AccountPool 账号的独立接管。只有明确授权后才在 DSH 安全凭据保管库复制**新的、自有引用**，原插件和原账号不变，并建立 `own_渠道` Provider 及自有模型链。原插件停止后，自有渠道在重新加载 DSH、验收模型及签到时才能认定独立可用。WorkBuddy 等原插件私有登录态不保证能直接迁移，保留桌面驱动及自主扫码/网页登录。详见 [独立接管指南](docs/OWNED_CHANNEL_ADOPTION.md)。

## RC.2：公开 GitHub 源码安全与可复现性修复

- 固定公开 Git 的 **LF 文本哈希**，Windows CRLF 工作目录与 Linux LF 克隆使用同一 `SOURCE_RECEIPT`；二进制 Qoder WASM **不做任何文本转换**。原本的 `pack-native.js` 仍由原 MIT 上游源码确定性生成，不改变供应代码。
- `.gitignore` 保护本机账号、Token、密钥、数据库、环境变量和运行状态；GitHub 仓库恢复合成测试、自动安全扫描与 Windows/Linux 构建验证。**严禁将真实 DSH Profile 或客户端登录文件上传**。
- 公开发行包不再包含私有开发日志，只包含源码、版权、脱敏的示例和运行必须文件。公开源代码与 .tgz 候选版一致；更多安全报告说明见 `SECURITY.md`。
- 更新原来误导性的上游渠道包 `NOTICE`，区分审计快照 `pack.js` 与实际加载 `pack-native.js`。
- 保留冻结的上游 MIT `NOTICE.md` 作为历史归属资料；当前实际加载与构建说明见 [上游渠道包的本项目集成说明](docs/CHANNEL_PACK_INTEGRATION.md)，不要照旧项目 OFM/网关命令直接操作。
## RC.1：向正式版发行收口

- 已补充**可发布元数据和最低运行环境要求**：Node.js `>=22.10.0`、MIT、DSH Client 模块注册及卸载验证，且保留 Cordis 单进程插件形态；发行包不带真实凭据、开发脚本或额外独立进程。
- 管理后台保留 **DSH Connection 的 owner 鉴权**，进一步支持远程 HTTPS DSH 同源 UI 修改、拒绝伪造 Origin，异常 HTTP 500 不泄露具体错误。
- Windows 原子配置保存支持旧进程崩溃残留的 PID 临时文件，保存不会因旧文件永久失败。
- 官方 AgentLoop + DSH Tools 的隔离测试现包括**两个实际同时执行的测试工具**，主模型第二步报错后切换备用模型，调用结果各一次；用户取消与 Agent 销毁后不续跑。**真实破坏性工具跨进程崩溃的强幂等性尚未证明。**
- 完成 **真正的发行包实装**：在全新 `E:\\Temp` 环境 npm 安装生成的 `.tgz`，使用公开 Cordis + LlmRuntime + WebServer + Connection 验证注册、鉴权、卸载；原机正式 DSH 与真实账号均未操作。逐文件发行审计可通过 `tools/audit-release-package.ps1` 重跑，完整实装验证使用 `tools/verify-packed-distribution.ps1`；`npm publish --dry-run` 通过但没有任何实际公开发布。
- 正式版放行表与版本记录分别见 `docs/RELEASE_ACCEPTANCE.md`、`CHANGELOG.md`。当前候选可以交付用于批准的测试环境安装，不允许擅自替换正式 DSH。

## Alpha.18：真实 DSH AgentLoop 多步骤故障续跑与工具防重复执行

- **修复经官方 AgentLoop 实测发现的事件竞态**：模型请求在第二步骤失败后，`agent/error` 发生时 Agent 仍在运行，随后 `agent/status=idle` 可能在首次调度微任务结束之前到达。原来这次 idle 被忽略，导致故障意图永远挂起、不执行备用模型。现用一个串行 `requestDrive` 与合并的 `rerunPending` 确保 idle 信号不会丢失、又不会重复入队。异常调度失败会清除旧意图、拒绝不受控重放；Agent 卸载后禁止继续调度。
- **真实工具与会话验收**：在一次性 `E:\\Temp` Profile 内装载公开的 DSH Cordis 4.1、AgentLoop、AgentRegistry、SessionStore、SessionProjectionRegistry、ToolsService 和 LlmRuntime 的兼容发行组件（0.2.2-rc.3），真实创建 Agent。在第一模型第 1 步通过 DSH 工具服务执行一次虚构本地工具、写入原 Session 的 `tool/call` 与 `tool/result`；第 2 步模拟主模型 `SERVER` 失败；Native Router 在 **同一个 Agent / Session** 下切到第二模型，新的 turn 顺利完成。验收确认主模型请求两次、备用模型一次、虚构工具实际执行一次、对应工具调用事件/结果事件各一条、切换记录一条；**不是仅模拟 Agent API，也不代表生产破坏性工具在崩溃或长时间执行后绝对不会重复**。
- **不影响其他 DSH 自动重试**：以前 `agent/pre-step` 错误拒绝所有空内容 `retry` 消息（包括 DSH 或其他插件自己的正常重试）。现在只登记并校验**本插件自己发出的**有 ID 的重试消息。新用户输入可以取消本插件旧续跑意图，旧重试不会随后执行；其他组件创建的正常 retry 不会被拦截。新增并发信号、异常失败封闭和正常外部重试的自动化测试。
- **来源登录及自动签到继续保留 Alpha.17 行为**：优先复用本机已登录 WorkBuddy、已有 DSH Provider/AccountPool，不复制 Token 或修改原插件；仅对有经过核验的单账号签到接口执行自动签到，原有总开关默认关闭。没有新服务、网关或计划任务。正式桌面 GUI、并行/长时间/崩溃恢复场景、真实账号和线上签到仍需单独验收。

## Alpha.17：无需重复登录，直接借用其他已安装 DSH 渠道插件

- **新增真正的“现有 DSH 渠道插件”复用**：如果 DSH 宿主已注册原生 Qoder、TRAE、CodeBuddy、Loomy 等来源 Provider 且提供可用 `accountPool`，本插件现在可以**直接借用其他插件的既有 `llm` 适配器和登录引用**，不注册第二个同名 Provider，不改写原有账号、原 Session 或凭据，也不要求再次扫码登录。原插件仍继续负责其自身登录、续期和模型调用；本插件只提供统一账号池、模型链条与失败降级。
- **两层来源自动选择**：`src/existing-dsh-channels.mjs` 验证宿主已注册 Provider、原 `accountPool` 的唯一启用账号及 `getAvailableAccount` 实际选择，再通过原 `llm.stream` 完成请求。如果其他 DSH 渠道已就绪，本插件内置来源包会拒绝重复挂载、直接借用现有渠道；没有可复用现有 Provider 时，才在用户明确启用的情况下使用本插件内置渠道包。仅查询原插件已有非秘密账号元数据，不复制 Token。
- **同时复用本机桌面与现有 DSH 渠道账号**：WorkBuddy / CodeBuddy Desktop 和 CodeArts 的本机驱动不被覆盖；同一个 `workbuddy`、`codearts` 渠道中可区分 `wb_...`/`ca_...` 本机引用和 `sp_...` 已安装 DSH 渠道引用。已有来源账号只在单一启用账号且原池明确选中该账号时参与模型路由；多个账号、失效账号、来源插件卸载、登录状态突然切换均停止该模型请求，不冒险串号或错误调用。
- **仍保留人工审批边界**：用户在「渠道账号」中开启 `sessionReuse.enabled` 并保存后，本机同进程扫描才执行。没有安装、没有经过核验登录数据、仅有 Qoder 设备标识等不作为登录成功；未知客户端既不自动读取凭据也不假装已登录。已有来源的签到由来源已有适配器负责；本插件原有内置包的逐账号自动签到与 Host 模型故障切换保持独立。**完整正式桌面 AgentLoop 的复杂工具副作用、线上全部平台的真实登录有效性仍未验收。**
- **验收证据**：官方 Cordis、LlmRuntime、WebServer、Connection 组成的真实 DSH 组件，隔离 E:\\Temp 中预先安装一个虚构 `qoder` Provider、来源账号池，然后本插件无需重复注册或新建登录，成功调用原 Provider 的真实 `llm.stream` 路径。插件卸载后原 Provider 和账号池仍保留、凭据读写为零、只有 DSH 原 WebServer 一个监听口，未登录调用扫描为 401；其它渠道没有虚构就绪状态。隔离测试不等于真实外网账号认证。

## Alpha.16：复用 DSH 机器已有渠道程序的登录态

- **只需启用一次，不需要每个已登录账号重新授权**：在本插件的「渠道账号」页开启「自动关联本机已有登录态（无需重复登录）」，保存配置并重新加载本插件。默认关闭扫描，开启后在同一个 DSH 进程内首次扫描、来源包加载后的补扫以及大约 90 秒一次轻量检查。扫描只在当前 DSH 运行时进行，不启动额外程序、网关、任务计划或 OAuth 流程。
- **已验证本机直接登录态**：WorkBuddy / CodeBuddy Desktop 的现有桌面登录文件由成熟原生适配器只读解析，凭据保留原客户端，插件只保存身份和源位置的非秘密引用；真正请求时适配器重新读取原会话凭据到内存，**不会创建新的登录流程**。只有存在可用的会话（有效 access token 或可续期凭据）才关联；如果凭据失效，界面仍标记待验证，禁止将本地身份当作已通过云端鉴权。使用虚构客户端文件的真实 DSH LlmRuntime 适配链已验证，文件 SHA 不变、配置不含令牌。
- **已有 DSH 渠道登录态直接借用**：内置上游渠道包中已经有且已启用的同渠道来源账号，可引用其当前 DSH `AccountPool` 和 `credentials`，路由器只存 `sp_...` 不可逆 ID 和 `driver:<渠道>:<ID>` 引用，不复制上游登录 Token。现阶段仅对**每个渠道只有一个已启用来源账号**自动映射；多账号的精确路由能力尚未完成实机认证验收，显示「多个现有账号待核验」，而不冒险串号。来源自动签到仍由全局开关统一管理，已自动关联的来源账号不会无故关闭已有签到能力。
- **不是所有已安装程序都已登录**：Qoder 的 `machine_token.json` 是设备身份资料，**不能把它当作账号已登录证据**；其余渠道仅当当前 DSH 内置包已有会话时复用，不能凭软件安装目录假装已登录。CodeArts 当前仅支持经验证的独立 AK/SK 或 DSH 内置渠道包原生登录，不承诺直接读取本地桌面认证；以后需要按各软件真实、可授权的接口补充只读本机适配器。
- **保护现有配置**：自动发现不覆盖已存在的用户账号，不强制重新启用用户停用的渠道或账号；新关联账号状态标记为「已关联，远端待验证」。主动解绑会记入忽略清单，后续自动扫描不会把它重新加入，用户可以在页面手动清除忽略。宿主 Connection 验证管理身份，未认证的扫描调用返回 401，开启功能前返回 409。
- **交付与限制**：本版本仍是一个 DSH Cordis 插件；真实多步 AgentLoop 工具副作用续跑和全部外部桌面客户端的现有认证复用，尚未进入正式桌面端/真实账号验收，不得据离线模拟认为所有渠道均已连接或在线。

## Alpha.15：认证管理通道与实际模型步骤校验

- **管理 API 已从本机无认证入口迁移到 DSH Connection**：完整账号、配置、签到管理均通过 `connection.fetch.register` 注册在 `/api/plugins/dsh-native-router/*`。宿主 Connection 会先鉴别浏览器会话 Cookie、Host/Origin 与 owner Peer；无认证的 localhost 不再能查看配置或更改账户。旧的 `/plugins/dsh-native-router/*` WebServer 管理接口不再注册；未挂载 DSH Connection 时管理 API 会拒绝启用，不退回无认证接口。来源渠道包自身的 `/api/dsh-native-router/channel-pack` 继续使用同一认证通道。整个架构仍只有一个 DSH WebServer，没有第二个后台服务。
- **按 DSH 的实际步骤选模**：AgentLoop 在 `agent/pre-step` 之前固定 `modelSelection`。插件现在在 Agent 创建和消息入队时提前选择允许的免费或固定链模型，步骤开始时按 DSH 捕获的真实模型做最后校验，旧收费模型不允许偷偷通过。DSH 的同一步骤 `{kind:'retry'}` 会保留已捕获模型，所以跨模型续跑继续通过原 Agent **下一个队列轮次**完成，而不是错误地声称同一步骤已切换模型。失败后新指令优先、重试去重、工具交给 DSH 授权与执行的安全规则均保留。
- **真实基础组件离线验收**：公开 Cordis 4.1.0、LlmRuntime、WebServer、Connection 0.2.2-rc.3 与内置渠道包共同运行，虚构身份的 DSH Connection Cookie 仅在 `E:\Temp` 隔离环境的内存中使用。未认证访问为 **401**，恶意 Origin 为 **403**，已认证访问为 **200**，旧直连入口和插件卸载后为 **404**；14 个来源/路由模型 Provider 仍正常注册、文本与工具事件及虚构 429 降级正常。正式 DSH GUI/完整 AgentLoop 多步工具续跑和真实 OAuth/签到尚未完成，必须与离线验证区分。

## Alpha.14：自动模型降级续跑与全渠道自动签到

**仍然是单个 DSH 原生插件，不需要额外运行 Node、网关、脚本或常驻服务。**

- **自动切换模型**：模型链内部按优先级依次尝试可用账号和候选模型，遇到可重试的额度、限流、服务器或连接故障才换用下一项；失败档位冷却，防止反复请求已耗尽的模型。宿主级 `hostFailover.enabled:true` 加上自行配置的 `priority` 后，可在 DSH Agent 报错时切换跨 Provider 模型，并向同一 Agent 队列提交零内容的原生 `retry` 续跑请求。模型校验期间用户输入新消息、Agent 被销毁或重新运行时会取消过期续跑；相同失败不会重复排队，入队 API 抛错后停止而不再提交其它重试。成功提交的切换记录显示在“宿主故障切换”页。**不是直接执行或重放 Bash、文件修改等工具；实际工具授权与执行仍由 DSH 决定。尚未用正式 DSH Agent 测试复杂多步工具任务，所以不能保证所有工具副作用场景完全不重复。**
- **来源自动签到**：原上游成熟 `credits.status` 与 `credits.claimAll` 已改造出同一 DSH 进程内的**单账号服务**，只处理目标来源账号，不会因某个账号启用自动签到而对同渠道其余账号批量领取。已实现每日任务的九个来源渠道为 **CodeArts、CodeBuddy（buddy）、LobsterAI、Qoder、Qoder CN、TRAE、Loomy、MiniMax、ZCode**。**WorkBuddy、Cline、Gemini** 没有对应每日签到执行能力，**Raccoon** 的日常积分是服务器自动发放，批量领取属于一次性桌面奖励而非每日签到，故不计入自动每日签到渠道。
- **签到判定**：必须获取上游对该账号明确返回的 `available:true`、当日 `todayCheckedIn:true` 才记“已确认”；领取请求仅返回 `claimed`、网络无法读取状态或尚未同步时均不得假报成功。已受理未确认、失败、无活动、已确认分开保存并呈现，自动重试间隔至少 1 小时、单账号每天最多 3 次，已确认不重复发起。考虑到部分来源活动在北京时间 10:00 后开放，来源自动任务不早于北京时间 10:05 运行。
- **配置**：在 DSH 本插件中启用 `embeddedPack.enabled:true`，再启用 `checkin.autoEnabled:true` 即可由 DSH 内置定时器自动处理全部已启用、支持每日签到的来源账号；`checkin.autoSourceAccounts:false` 可以整体关闭来源自动覆盖。已纳入本插件配置的来源账号可通过 `autoCheckin:false` 单独关闭。手动签到仍可以操作单账号并读取真实回查状态；整个过程不建立第二个独立调度器。账号授权和线上签到行为尚未经实际平台验收，测试均为离线虚构账号。
- **验收边界**：已在隔离环境同时使用真实 Cordis 4.1.0、DSH LlmRuntime、DSH WebServer、内置原生渠道包验证 14 个 Provider、模型流/工具事件和模拟 429 账号降级；真实来源 AccountPool 使用两条测试账号记录，`credits.status`、`credits.claimAll` 均只读取 B 账号；没有调用真实模型和平台签到。发布前仍需授权的真实 DSH GUI/Agent/账号线上验收，**不得以来源渠道已注册推断线上登录、签到或续跑任务全覆盖已验证**。

## Alpha.13：DSH 单插件运行（无 Sidecar）

**安装与运行：仅需将本插件安装、启用于 DSH。** DSH 通过 Cordis 插件入口 `src/index.mjs` 装载其 Provider、账号管理页面、失败切换与签到调度。所有运行在**同一个 DSH Host 进程**，不需要另外启动 Node、Agent2API、独立 HTTP/API 网关、守护程序或 Windows 计划任务；项目中的 PowerShell/测试 Node 仅供开发者离线验收，**不是用户安装步骤**。

- 原始上游 MIT 快照继续在开发仓库的 `vendor/channel-pack/pack.js` 以 SHA-256 固定，不手工修改。运行包只包含由开发时 `tools/build-native-channel-pack.py` 可复现生成的 `pack-native.js`、Qoder WASM、许可证及双份来源回执。使用 `python tools/build-native-channel-pack.py --check` 可校验构建，**用户无需运行构建脚本**。
- 衍生包删除上游自动启用的 **8326 OpenAI 网关、第二套 Agent 自动续跑、独立自动签到计时器**；来源批量自动续期默认关闭，避免加载即对外发请求。统一签到仅由本插件现有的 DSH 进程内调度并受账号级 opt-in 控制，手动授权/刷新/签到依旧由内置协议与 DSH 入口负责。OAuth 在用户明确点击时可能需要 DSH 进程内短暂的本地回调，这不属于单独常驻服务。
- 原始来源包的状态目录迁至 `<DSH_HOME>/plugins/dsh-native-router/source-channel-pack`，设置命名空间和 `connection.fetch` 路由均归属本插件，**不读取/覆盖独立 channel-pack 插件的状态文件**。来源 RPC 地址为 `/api/dsh-native-router/channel-pack`。检测到已有同名 Provider 或账号池会拒绝重复接管。
- 初次安装时 `embeddedPack.enabled` 默认为 `false`；在插件设置中主动启用后才装载衍生渠道包，不再要求设置 `DSH_NATIVE_ROUTER_CHANNEL_PACK_ENABLE`、`DSH_OPENAI_GATEWAY_ENABLED`、`DSH_REASONING_LOOP_AUTO_RESUME` 等外部环境变量。来源多账号精确选号仍**默认关闭**，需要另外经过真实平台账号隔离验收；不能仅凭可注册的渠道数判断已可用。
- 内嵌上游包包含需要 **DSH Host 自身 Node.js 22.10+** 的 Undici 实现：低版本 Host 将仅拒绝来源包挂载，其余原生路由功能继续工作。**不允许通过额外独立 Node 服务绕过该条件。** 需要的是兼容的 DSH 内置运行时，而不是再运行一套进程。
- 真实 Cordis 4.1.0、DSH LlmRuntime、DSH WebServer 与内置衍生包在**无任何额外启动开关**的隔离 Profile 中验证：14 个 Provider 注册、文本/工具/模拟429账号降级、同源HTTP管理正常；实际仅发现 **DSH WebServer 一个监听器**，来源状态写入独立子目录，插件卸载后 Provider/账号池/管理路由全部释放。**仍未完成正式 DSH GUI/完整 Host 与真实渠道账号线上验收，不宣称生产稳定。**

下列 Alpha.6—Alpha.12 章节作为**历史开发审计记录**保留；其中的 `E:\Temp` 挂载门禁、额外环境变量只属于当时对**未净化上游包**的验证，不再是 Alpha.13 插件的安装要求。

## 已实现

1. **提供商注册表**：支持 OpenAI Chat、Anthropic Messages，以及可注册驱动的 native-channel 专有协议。没有真实驱动时隐藏对应模型，不假装渠道已可调用。
2. **多账号池**：相同提供商多账号、环境变量/宿主安全凭据引用、按账号轮换、同会话粘性、账号错误隔离和冷却。原始 Key 不保存在本插件配置中。
3. **自定义模型链条**：支持不同提供商、不同模型、指定可用账号、上下调整顺序及策略 `priority`（自动降级）、`pinned`（锁首模型但允许轮换账号）、`free`（仅尝试明确标注免费的档位）；可设置最多切换模型次数。
4. **原生 DSH 模型目录**：独立 Provider ID 为 `native-router`。模型选择 `chain:<链条ID>`，也支持已配置/发现模型的 `direct:<提供商ID>:<模型ID>`。
5. **两套协议原生转换**：标准 Chat SSE、Anthropic Messages SSE，模型原生工具调用与 DSH `tool-call` 块、返回历史互相转换。仅将本轮 DSH 实际提供的工具 Schema 发给模型；工具权限和实际执行始终由 DSH 决定。
6. **故障转移集成**：复用 MIT 许可的 `dsh-model-failover` 规则和每会话状态机制；同时支持插件内部（账号/模型）故障转移、独立的 DSH Host 跨 Provider 失败续跑。宿主层默认关闭，避免与已有插件冲突。
7. **设置界面与管理接口**：包含独立的“渠道账号”和“每日签到”两页，以及提供商、账号池、模型链、宿主故障切换、高级 JSON；操作入口进行本机回环/同源校验。

8. **账号看板**：渠道级和账号级状态、真正的通用凭据验证、刷新、启停、退出/解绑，支持经真实驱动扫描后的候选账号审核导入。自动池收集同渠道启用账号，自建池可通过模型链限制 accountIds。明确批准接入后账号默认启用；远端鉴权依旧单独验证。
9. **每日签到中心**：账号级今日状态与独立历史、时区与时间配置、双重 opt-in 自动签到，仅在 DSH Host 运行期间检查；只有驱动服务端确认才记成功，缺失签到驱动的渠道显示待适配。
10. **驱动扩展**：dsh-native-router/drivers 支持注册专有原生 driver（生成请求、登录、刷新、发现、导入、退出、签到），未实现的操作不会产生虚假成功。

11. **WorkBuddy 原生渠道**：用户主动触发只读桌面授权发现，审核后导入默认停用账号，原生远程模型目录、SSE 对话、工具调用白名单、内存续期及账号解绑。已通过隔离本机 HTTP 测试；尚未完成真实授权账号线上验收。

12. **CodeArts 原生账号池第一阶段**：在不启动独立网关的前提下，用户主动使用环境变量组建多个有权使用的临时 AK/SK 账号，完成账户发现、审核导入、真实签名模型目录与直接 SSE 生成；准备 DPoP 和 PKCE 密码学模块。尚不具备 CodeArts OAuth 浏览器登录、自动 STS 续期、福利领取或签到。

参考项目对照与驱动契约见 docs/REFERENCE_AUDIT.md、docs/NATIVE_DRIVER_CONTRACT.md。接入细节见 docs/WORKBUDDY_NATIVE.md 与 docs/CODEARTS_NATIVE.md。

## 上游渠道包复用（历史 Alpha.5—Alpha.9）

已按固定提交引入 `dsh-get-it-for-free` 的 **MIT 许可**原生渠道包 `vendor/channel-pack/pack.js` 和 `qoder-auth-wasm.wasm`。其现成实现覆盖 CodeArts、WorkBuddy、Qoder（两地）、TRAE、Loomy、Raccoon 等 13 个上游 provider，而 MiMo 和豆包属于参考插件其他模块。详细来源、复用范围和未完成项见 `docs/UPSTREAM_REUSE_AUDIT.md`。

**以下为早期原始渠道包实验历史，并非当前安装要求。** Alpha.13 已内置经过可复现转换的 `pack-native.js`；启用源包只需在 DSH 内设置 `embeddedPack.enabled:true`，不再启动网关或要求独立 Profile 环境开关。真实账户仍需验收。

发布包内携带 `pack-native.js`、Qoder WASM、MIT 许可、NOTICE、来源与构建回执；原始 `pack.js` 留在开发仓库并被 SHA-256 固定。衍生包可从原始快照确定性重建，用户不必运行构建工具。模型注册不等于登录或在线推理已经成功。

已有**脱敏的上游账号池桥接**：隔离挂载后经 `accountPool.listAllAccounts()` 读取安全元数据；Alpha.6 支持明确确认后的来源启停和主动模型目录。Alpha.8 已新增来源账号审核引用与受控的原生 `llm.stream`→`chain:` 桥接，但真实账号登录、续期、退出、签到和 DSH Host 验收仍在后续阶段。

下一阶段优先将渠道包已有的登录、续期、模型、签到映射到统一账号页、签到页和 `chain:`；不再重写这些协议。


## Alpha.6：上游渠道包原生管理桥接（隔离验证阶段）

- 复用来源包 `accountPool.updateAccount`：**只有全部隔离安全条件满足、用户在“渠道账号”页确认操作后**，允许启用或停用来源账号。执行前按 provider + account ID 校验唯一归属，执行后回读确认；不复制、导出或迁移任何 Token、Cookie 或源凭据。
- 复用来源包 `llm.listModels(provider)`：支持逐渠道手动查看目录，同时 AutoFree 在使用模型池时会进行有界只读目录扫描。有限展示模型 ID、名称及上游显式免费的标签，**不代表真正零费用或已能加入 `chain:` 路由**；不在本插件伪造专有登录、签到或模型可用性。
- 仅本机同源 POST 管理接口；没有隔离挂载时两项操作均拒绝。每个渠道避免重复模型查询，超时只解除 UI 阻塞，不宣称取消已交给宿主的上游请求。
- 优先验收：真实隔离 DSH Host 依赖、原生 provider 的目录和账户更新 RPC，随后逐渠道加上经宿主验证的登录/刷新/退出与统一 `chain:` 生成请求桥接、回滚、权限验证。未授权前不得对生产 Profile 和真实账户运行。

## Alpha.7：历史隔离挂载前置审计（已由 Alpha.13 原生构建取代）

**从固定上游构建产物逐行核实：** `pack.apply()` 不只是注册模型。它会尝试清理域名不匹配的旧 WorkBuddy 账号（包括 `credentials.unset`）、创建或写回渠道包状态和独立永久锁存储、安装自动签到以及注册 13 个 Provider。上游的重复 Provider 处理可能静默保留已有适配器，因此“挂载成功”不意味着每个 Provider 都来自本渠道包。

为了不影响正式账号和原有插件，**Alpha.7 的挂载仅对独立测试 Profile 开放**，除 Alpha.6 的三个运行开关外，必须同时满足：

- `DSH_NATIVE_ROUTER_CHANNEL_PACK_ISOLATED_PROFILE=1`。
- `DSH_HOME` 和 `DSH_CHANNEL_PACK_STATE_DIR` 指向同一个**事先创建、真实路径位于 E:\Temp 且名称为 `dsh-native-router-isolated-*`** 的子目录；路径经 `realpath` 核验，符号链接指向其他位置不允许。
- 宿主若提供 `profileContext.home`，须与隔离 Profile 匹配。挂载开始时及执行原包 `apply()` 前均重检，杜绝异步加载期间路径被更改。
- 若宿主暴露 `llm.listProviders()`，发现任意已存在的 13 个同名渠道直接拒绝导入；目录格式不正确也拒绝。真实上游代码入口要求宿主支持目录检查，无法检查时拒绝。其他插件不自动停止、覆盖或卸载。

上述 E:\Temp 与外部开关只适用于当时原始包的研究性挂载。Alpha.13 单插件衍生包已封闭单独网关、重复调度和独立状态命名空间；来源多账号与真实线上授权仍须逐项验收。

## Alpha.8：复用上游原生 DSH 流的受控模型链桥接

- **不重写 13 个渠道的登录、签名和推理协议。** 当 `embeddedPack.enabled:true` 且 Alpha.7 隔离挂载成功时，为尚无原生驱动的 11 个来源渠道提供薄驱动；已存在的 WorkBuddy/CodeArts 兼容驱动仍保持原状。上游渠道由其自己注册的 DSH `llm.stream` 完成模型请求。
- 用户在“渠道账号”页通过现有“扫描 → 审核导入”流程，获取只包含 `sp_...` 哈希标识和 `driver:<channel>:sp_...` 引用的账号；**不复制、迁移或导出 Token、Cookie、refresh token**。导入默认停用，只有用户在插件配置中明确启用并为其创建模型链之后才会参与路由。
- 只有 **该来源渠道恰好一个启用账号**、且上游 `accountPool.getAvailableAccount(provider,model)` 明确返回相同账号并可解析凭据时，才调用 `llm.stream`。当前 DSH 公共流接口不支持传入 `forceAccountId`，所以多启用账号情形直接拒绝；**不能将 Alpha.8 解释为完整的源账号自动切换**，也不向正式环境开放。
- 新增 DSH-native 流原子汇聚：在收到完整 `finish` 前绝不向 Native Router 输出部分响应，拒绝损坏事件、超大正文、超过 8 次工具调用和未授权工具；模型错误保留有限状态码用于现有模型链降级，但不暴露原始上游错误消息和私有路径。由 DSH 宿主负责实际执行及审批工具。
- 来源挂载状态变化会即时影响原生模型目录缓存与账号页的“可用”标记：未挂载不展示这些实验渠道的模型和链条。已经配置的其他正式 Provider/Driver 不受此逻辑影响。
- **已通过模拟 Host 的账号发现、导入、模型链、工具协议、429 降级及自动卸载测试；尚未通过真正 DSH Host、任何真实服务账号登录/生成/签到测试。** 来源包本身的 OAuth 登录、续期、登出和每日签到仍需要通过既有 RPC/服务接口完成安全映射，MiMo 与豆包不在该 13 渠道包中。

## Alpha.9：上游原生登录、续期、退出与每日签到管理

- 复用固定 MIT 渠道包已经注册的 DSH `connection.fetch` 管理入口 `POST /api/channel-pack`，通过其原生 `account.create`、`login.poll`、`account.refresh`、`credits.status`、`credits.claimAll` RPC 实现操作按钮。**不另写 OAuth、Cookie、令牌刷新或签到的上游平台协议。** 所有请求仅在 Alpha.7 独立测试 Profile 已挂载且用户主动操作时触发；不自动启动登录、不暗中签到。
- 登录为“用户确认 → 来源创建流程 → 浏览器手动核对并打开安全授权链接 → 手动检查完成状态”；仅接纳 HTTPS 或本机回环 HTTP 授权地址，拒绝携带 URL 用户密码的不安全链接。来源表示登录完成，只说明已存储来源凭据，**不代表该账号真实在线或模型已经可用**。
- 来源账号操作中，“停用来源账号”仅修改来源池启用标记；“退出来源账号”需要单独二次确认，调用本插件受限于本机同源的 API，随后复用上游 `accountPool.removeAccount` 移除来源池记录。原上游会**尝试**执行 `credentials.unset`，但吞掉清理异常；本插件只确认账号池记录已消失，**不能据此保证本地密钥彻底清除或云端授权已撤销**。若本插件仍引用这一具体来源账号则拒绝删除，同渠道其他账号不受牵连。
- “每日签到”新增来源频道的**手动实时状态查询**与逐账号结果显示。原 `credits.claimAll` 是该渠道**全部来源账号的批量领取**，绝非单账号请求；只有先手动查询、看到来源账号后，并再次确认才执行。原来源不支持 WorkBuddy 与 Cline 日领，禁用其领取按钮。领取结果只是待复核回执，必须重新查询 `credits.status` 才可判断“今天已签到”。
- RPC 强制匹配响应类型与 `rpcId`，不在 UI 展示上游原始错误、Token 或解析出错的 JSON；不安全授权链接不提供点击入口。此阶段仍只有**模拟浏览器 / 模拟 Host 测试**；尚未真实验收 `connection.fetch` 在 DSH 设置页的权限与路由，也未使用任何真实云账号完成 OAuth/签到。原渠道包启动时可能自带自动签到，独立测试 Profile 安全开关并不等于关闭其所有后台行为。


## Alpha.10：隔离宿主内实验性多账号精确选号

- **默认继续拒绝同渠道多个已启用来源账号。** 在 Alpha.7 所有隔离挂载门禁已满足、来源包在独立的 `E:\Temp\dsh-native-router-isolated-*` Profile 中运行，且额外显式设置 `DSH_NATIVE_ROUTER_SOURCE_MULTIACCOUNT_EXPERIMENT=1` 时，才允许经审计的 `lobsterai`、`cline`、`minimax`、`gemini`、`zcode` 进入**模拟测试级别的多账号请求桥接**。上述列表不是生产支持承诺；CodeArts、WorkBuddy 仍由既有独立驱动承担，Qoder/QoderCN/Trae/Loomy/Raccoon/Buddy 暂不开放这项实验。
- 根据固定上游包实际实现复用 `accountPool.getAvailableAccount(provider, model, excludeAccountIds)` 的排除能力，在原始账号池 API 上建立一次请求专属的 `AsyncLocalStorage` 作用域。上游对来源账号的选择仍由其本身完成；本插件仅在该请求作用域中排除其它账户的候选、禁止跨渠道账号查找、拒绝读取或写入其它 CredentialRef。没有证明使用目标账号的流不能交付结果。**不修改来源账号的 `enabled` 字段、不复制 Token、不更改凭据存储。**
- 为降低上游适配器进程级账号缓存风险，同一 Provider 在实验期最多一个未完成的来源请求。选中账号不存在、被禁用、模型限流、账号列表变动、尝试读取其他账户凭据或没有完整完成流，均安全拒绝并交由现有 native-router 的账号冷却及模型链降级处理，不把失败请求已输出的片段交给 DSH。进程内其他非实验请求依旧使用原始账号池。
- 宿主作用域释放时仅标记实验账号门禁终止；在途请求结束之前保留方法约束，避免突然还原原始 `getAvailableAccount` 造成串号。相关模拟测试覆盖并发独立选号、其它账号无法读取、目标账号限流、旧方法恢复、请求中释放、同渠道失败后换号与工具输出完整性。
- **边界：尚未运行真实 DSH Host，也未以任何真实服务账号测试这些渠道。** 上游适配器可能存在缓存或内部绕过，因此这里只是一个严格限制的实验能力，不代表已经对所有真实平台完成账号归属证明。正式使用前还需隔离 Host、真实授权账号、单账号/多账号、取消/限流、工具流和长期回归的逐渠道验收。
- **额外确认的运行时门槛：** 2026-11-17 使用单独 `E:\\Temp\\dsh-native-router-isolated-alpha10-host` 工作目录、公开 DSH 依赖（`@deepseek-ai/cordis@4.1.0`、`@deepseek-ai/dsh-llm@0.2.2-rc.3`、`@deepseek-ai/dsh-credentials@0.2.2-rc.3`、`@deepseek-ai/schemastery@3.19.0`）成功安装，但固定上游渠道包在绑定电脑当前 Node.js **22.5.0** 的模块导入阶段即抛 `TypeError: webidl.util.markAsUncloneable is not a function`（上游内联 Undici）。现在只对固定上游渠道包增加 Node.js **22.10+ 且 `worker_threads.markAsUncloneable` 实际存在**的前置门禁；其它原生路由功能不受该兼容门禁约束。尝试使用 `npx node@22.16.0` 的隔离升级验证因命令超时、结果未知，**没有宣称新版 Node 导入测试成功**。真实 DSH Host 仍未验收。


## Alpha.11：真实 Cordis 组件的空账号隔离宿主验收

- 已解决 Node 版本阻碍：Windows 全局 Node.js 22.5.0 保持不变，从 npm 注册表获得 node-win-x64@22.16.0 独立 Windows 运行包，仅解压在 E:\Temp\dsh-native-router-isolated-alpha11-node-runtime。验证 worker_threads.markAsUncloneable 存在，固定上游 pack.js 真实导入成功，apply 为函数；独立 Node 22.16.0 运行的全项目测试也通过。
- 真实 Cordis 4.1.0、真实来源包，**空账号模拟服务**：在独立 E:\Temp\dsh-native-router-isolated-alpha10-host 中安装公开 Cordis、dsh-llm 0.2.2-rc.3、dsh-credentials 0.2.2-rc.3、schemastery 3.19.0 等依赖。使用真正 Cordis Context 生命周期，但以不持有任何真实凭据的 llm、credentials、commands 服务替身模拟宿主；上游实际 apply() 注册了 **13 个 Provider 适配器**、提供 accountPool，账号数量 0、凭据读取 0 次、写入 0 次；卸载后 accountPool 确认消失。实验多账号标志关闭与开启两种空账号场景均通过。
- 实测修复了 Cordis 的可选服务兼容问题：profileContext 和 accountPool 必须以 scope.get(name,false) 查询，不能触发不存在的 scope.profileContext 严格属性；否则会错误拒绝隔离挂载。来源包 Facade 释放时显式从 Cordis registry 删除自己的 inject 子回调，使 Provider、账号池及作用域效果一起释放；Web 设置路由的 webServer 子 Fiber 也补上清理。
- 请求级凭据证明更加严格：只有真正收到非空来源凭据 value 字符串才视为解析成功；仅调用 resolve() 或返回 undefined/空值不能证明使用目标账号。相应补上单元与回归测试。
- 可重复的开发环境验收命令（需事先安装本节提到的独立 Node 与公开依赖）：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\run-isolated-cordis-host-smoke.ps1；加 -ExperimentalMultiAccount 可测试门禁开启。脚本只支持预建的 E:\Temp\dsh-native-router-isolated-* 测试目录，拒绝目录联接/符号链接；校验代码 tools/verify-isolated-cordis-host.mjs 不访问正式 DSH Profile。
- **仍未完成：这是实际 Cordis 包与实际来源包、模拟 DSH 服务、空账号的集成验收，而非完整正式 DSH Host 验收。** 未使用真实 OAuth、签到、真实模型流、多账号账号归属或用户凭据。不能据此宣称所有来源渠道已真正可用。


## Alpha.12：真实 DSH LLM、WebServer 与来源账号池的隔离集成验收

- 使用公开发行的 **Cordis 4.1.0、dsh-llm 0.2.2-rc.3、dsh-host-webserver 0.2.2-rc.3** 和固定 MIT 渠道包，在独立 `E:\Temp\dsh-native-router-isolated-*` 环境中联合运行；仍采用便携 Node.js 22.16.0，未升级系统运行时。WebServer 仅监听 **127.0.0.1:0**（系统临时端口），不公开局域网接口。
- **14 个 Provider 真正同时注册（上游 13 个 + native-router 1 个）**。经真实 `LlmRuntime.stream` 用本地离线测试驱动完成 `chain:` 文本回复、工具 Schema 传递、`tool-call-delta` 和 `finish` 契约，以及同一模拟 Provider 首账号 429 后切到第二个测试账号。没有真实模型调用、Token 或用户账号，工具只发出数据事件，不会执行。
- 真实 WebServer 的 `/plugins/dsh-native-router/status`、`/config`、`/channels/accounts` 正常返回；来源账号池为空，配置 POST 仅更改内存测试变量，正常同源请求允许、恶意跨源请求返回 **403**。撤销插件后 Provider 归零、accountPool 消失、原设置路由 **404**。此测试不代表已经通过正式 DSH Connection 登录会话、Peer 权限与桌面 UI 的完整验收。
- 在另一个一次性 E:\Temp Profile 通过**真实上游 AccountPool** `addAccount` 注册两个完全虚构账号，使用请求级 `AsyncLocalStorage` 门禁验证指定账号 B 时真正读到 B 的离线假凭据；B 被模拟限流时不会回退到 A。该测试不调用上游模型推理或 OAuth，不证明适配器内部缓存与真实在线账号归属均已安全。
- 实测发现：即便账号池非空时测试随后拒绝，来源包**启动阶段仍可能修改已有测试状态文件**。已把账号池开发验收工具改为每轮先创建**全新临时 Profile**，从所选 E:\Temp 目录仅复制公开测试依赖，用完自动删除。复测确认已有测试 Profile 的 state.json SHA-256 不变；绝不对已有账号状态文件执行测试清空。
- **可重复的本机开发验证：** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\run-isolated-dsh-services.ps1`（实际 DSH LLM/WebServer/来源包集成），加 `-SourcePool`（自动创建并销毁全新纯测试账号 Profile）。依赖需预装于 E:\Temp 测试目录；脚本拒绝指向正式 DSH Profile。
- **仍未覆盖**真正 DSH 桌面/GUI Host 启动、`connection.fetch` 的实际鉴权、真实提供商 OAuth/刷新/签到、WASM 业务调用、模型网络流及真实账号多活切换；保持当前正式配置与原插件不变，实验选号仍默认关闭。

## 目录架构

```text
dsh-native-router/
  src/
    index.mjs               DSH Cordis Provider 注册和宿主集成
    config.mjs              配置验证与原子落盘（不包含密钥值）
    accounts.mjs            多账号、鉴权引用、冷却与粘性
    router.mjs              自定义链条与单次请求状态机
    catalog.mjs             DSH 模型目录与 /models 发现
    protocol.mjs            DSH 模型输出与工具调用事件格式
    host-failover.mjs       DSH 请求失败与原会话续跑
    failover/               MIT 许可的原有规则与状态机制
    provider/openai.mjs     OpenAI Chat + SSE
    provider/anthropic.mjs  Anthropic Messages + SSE
    routes.mjs              本机设置 API
    channels.mjs            渠道身份及能力目录
    account-center.mjs      登录/刷新/启停/退出/候选账号审核导入
    checkins.mjs            签到状态、持久化与显式启用的每日调度
     driver-registry.mjs     可动态注册的专有渠道驱动
     embedded-pack.mjs       上游渠道包隔离挂载、账号池及 DSH 服务桥接
     channel-pack-isolation.mjs  独立 Profile 真实路径校验
      source-channel-driver.mjs    来源账号引用、原生流校验及故障归类
      source-account-selection.mjs  请求级来源账号池及凭据边界（隔离实验）
    channels/workbuddy.mjs  WorkBuddy 只读桌面登录态、原生模型目录与 SSE 请求
    channels/codearts.mjs   CodeArts 临时 AK/SK 多账号、原生模型目录与签名 SSE
    channels/codearts-crypto.mjs  SDK-HMAC-SHA256 / PKCE / DPoP 密码学辅助
  client.js                 DSH 设置区
  config.example.json       禁用状态的安全示例
  tests/                   测试集合
```

## 安全配置

默认配置路径优先使用 DSH_HOME 下的 `plugins/dsh-native-router/config.json`，无 DSH_HOME 时使用 `~/.dsh/plugins/dsh-native-router/config.json`。首次插件加载如果不存在文件，不会自动生成账户/模型，也不自动对外发起请求。你可以在设置页配置，或将 `config.example.json` 拷贝为配置文件，再逐项启用。

每个 Provider 可选 `protocol: openai-chat`、`protocol: anthropic-messages`，或者配合专有驱动使用 `native-channel`；完整 Base URL 示例分别为 `https://api.example.invalid/v1` 和 `https://api.anthropic.com/v1`。普通 API 账号只填 `credentialRef: env:MY_PROVIDER_API_KEY` 或 `host:your-credential-reference`；专有原生渠道只用已授权驱动生成的 `driver:provider-id:opaque-id` 引用。**不能直接填写明文 Token、密码、cookies、会话字符串**。远程 Base URL 必须使用 HTTPS，本机允许 HTTP loopback。

每条链的 `tiers` 按顺序包含 `providerId`、`model`、`free` 和可选 `accountIds`。`free: true` 是用户手动标记的筛选条件，并非第三方计费来源的证明。请勿把需要付费的账号误标为免费。网络失败后的重试可能重复产生实际上游用量。

在 DSH 的模型菜单选择 `native-router / chain:<id>`。当账号和模型配置变化时，需要完整重启 DSH Host 以刷新注册与宿主层状态。

## 与现有插件的冲突防护

- DSH `dsh-model-failover` 当前若仍启用，保持本插件 `hostFailover.enabled: false`。不允许同时让两套宿主级失败续跑监听器生效。
- 插件内部的路线降级与 DSH 宿主级跨 Provider 降级是不同层次：内部处理一次模型请求尚未出 DSH 前的换账号/换模型；宿主级只在已正式失败、没有更下游重试决策时安排下一次 Agent 步骤。
- 调用中的工具由 DSH 原生 Permissions 处理，插件不得自行执行 shell、文件修改或后台任务。
- 状态文件损坏、配置中的外部 HTTP Base URL、匿名工具调用等场景默认拒绝，避免用不安全的回退掩盖问题。

## 已知限制 / 未完成

- 上游 MIT 原生渠道包已提供 CodeArts、CodeBuddy、WorkBuddy、LobsterAI、Qoder/QoderCN、TRAE、Cline、Loomy、Raccoon、MiniMax、ZCode、Gemini 共 13 类 Provider 的源码适配；其中 9 类实现了每日活动状态/领取逻辑。但**代码接入不等于当前每一平台已完成真实认证、可用模型及线上签到验收**。优先复用 DSH 已安装、已有账号的原插件登录态，不复制凭据；WorkBuddy 本机桌面已有登录直连、CodeArts 临时 AK/SK 已获隔离验证。真实 OAuth/刷新及其它专有账号仍待用户批准逐渠道实测。
- 原生上游实现包括 OpenAI Chat、Anthropic Messages、WorkBuddy 桌面授权直连、CodeArts 临时 STS 账号签名直连（均通过本机协议测试）。专有渠道实际线上鉴权仍需用户授权的真实 DSH Host 验收；OpenAI Responses API 另列后续适配器。
- 为防止断流响应中的半截工具调用进入 DSH，当前模型响应先校验完整再发送 DSH 事件，**不支持实时逐 token 渲染**。
- DSH 模型动态工具变更、真实 Permissions / Bash / 文件读写 / 后台任务、真实账号额度耗尽后的稳定性，仍需要在独立测试会话中进行宿主级验收。
- `host:` 凭据引用要求宿主支持对应凭据查询接口，否则会安全报错；账号登录管理界面目前还不能自动创建该引用。
- 按用户要求不覆盖原插件、不静默修改 Profile 和现有授权/账号/历史数据。

## 下一阶段

1. 完成 CodeArts 安全 OAuth（PKCE/DPoP）授权码回调、用户账号凭据安全落盘与临时 STS 续期；对 WorkBuddy/CodeArts 在明确授权的隔离宿主中完成模型目录、工具权限、账号轮换和长对话验收，然后推进 Loomy、Qoder。
2. 增加 Responses / 图片 / 其它平台的完整请求与流式工具契约、账号过期/余额、自动健康探针。
3. 完成账号级额度策略、权重路由和成本统计、用量报告及专有平台维护任务。
4. 接入 DSH 真实 Host 验证（Shell、工具列表改变、人工审批、流式断开、跨 Agent 连续执行），完成 UI 真实交互测试。
5. 在独立可回滚版本中迁移并替换原故障转移插件，禁止直接删除现有 DSH 配置。

## 测试

Node.js 22.10+（固定渠道包运行时要求）：`npm test`。本机还运行 `node --check`、无秘密信息扫描、npm pack 及文件摘要比对。**生产稳定版发行另需完成 `docs/RELEASE_ACCEPTANCE.md` 的人工放行项目**。

## 授权与来源

`dsh-model-failover` MIT 规则与状态实现沿用自身 MIT 条款和版权。`dsh-connect-loomy` 的工具 Schema 解析辅助逻辑基于用户现有插件。WorkBuddy 协议字段参考 MIT 许可的 `lg22-long/workbuddy-bridge`，保留 `LICENSES/workbuddy-bridge-MIT.txt`。CodeArts 请求签名与已知端点参考 MIT 许可的 `elegant01/dsh-codearts` 和 `hulibuld/dsh-get-it-for-free`，分别保留相应 MIT 版权声明。Agent2API 是架构调研对象，**没有复制 AGPL-3.0 的 Rust 实现代码**。后续若实际复用 Agent2API 代码，须单独执行 AGPL 合规审查。
