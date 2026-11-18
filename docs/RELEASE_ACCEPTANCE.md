# DSH Native Router — 1.0.0-rc.2 发布验收与放行门禁

> 当前状态：**发行候选（Release Candidate），不是稳定版 1.0.0**。仅能在用户明确批准的隔离 DSH 中做实机验收。提交到 npm、发布 GitHub Release、覆盖 DSH 生产插件或接触真实登录态均需单独明确授权；离线测试通过不等同于业务账号、真实服务或桌面端验收通过。

## 已通过的自动化门禁

| 关口 | 已验证事实 | 范围 |
|---|---|---|
| 安装包 | 单个 Cordis 原生插件、纯 `.tgz`；无原始 MIT 渠道源码、无 `tools/`、`tests/`、`node_modules/`、密钥或独立启动脚本；源版权/NOTICE 和 SHA 固定 | npm pack 实物提取逐个 SHA |
| 兼容环境 | 实际 Node 22.16 与 Cordis 4.1、DSH LlmRuntime/AgentLoop/Session/Tools 等 `0.2.2-rc.3` 公共组件；实际 .tgz 单独 npm 安装并通过 Cordis/Connection 加载和卸载 | 单独 `E:\\Temp` 隔离测试 Profile；正式 DSH Host 具体构建待验 |
| 原渠道免登录复用 | DSH 原 Provider/AccountPool 原地借用；仅一个明确启用账号时才自动关联；不复制 Token；卸载后原渠道仍在 | 原始 DSH 组件 + 虚构 Qoder 账号 |
| 自动签到 | 保留 9 类有来源 `credits.status/claim` 的每日渠道；总开关默认禁用；状态未确认不冒充成功 | 固定 MIT 供应包和虚构账号；线上结果未知 |
| 模型连续任务 | 同一真实 AgentLoop/Session 主模型故障后备用模型完成；原 Session 已提交工具结果不重新执行 | 单工具、两个并行虚构工具；主模型第 2 步模拟服务器故障 |
| 生命周期 | 实际 Agent `cancel({kind:'user'})` 及 Agent 销毁时，测试中没有新模型重试/工具输出；自动 retry 只审查插件自建消息 ID | 真实 AgentLoop + 离线虚构请求 |
| 安全管理 | 只注册 DSH Connection 已认证管理 API；匿名 401、伪造 Origin 403；远程 HTTPS 同源可修改配置，HTTP 非本机拒绝；同步/异步处理器异常 HTTP 500 不泄密 | 真实 Connection 组件、以及隔离的 Fetch 处理器 |
| 配置可靠性 | 原子写入，保存成功前不改变内存；崩溃残留同 PID 临时文件不阻塞后续保存 | Windows 临时测试目录 |
| UI 模块生命周期 | DSH 模块加载器接收插件；注册 `settings.section`，卸载后撤销 | Node VM 模拟浏览器模块装载；并非实际 DSH 桌面截图 |
| 许可证与可发布性 | MIT、第三方 NOTICE、固定上游 SHA；`npm publish --dry-run` 成功但未公开发布，发行包中没有独立 Agent2API | npm 干运行和逐文件验证；所有正式发布动作仍待审批 |
| **发行包实装验收** | **从真实 .tgz 安装进全新 npm 环境**，实际 Cordis 加载/卸载、原生 Provider 存在、DSH Connection 200/401/404、没有默认配置写入、仅一个宿主监听器 | `tools/verify-packed-distribution.ps1`，临时 Profile 用后清理；不是正式桌面 DSH |

**CI 与真实磁盘隔离的区别**：GitHub Windows 托管虚拟机没有实际 E: 磁盘，通过 `SUBST` 映射的 E: 在 `realpathSync.native` 后仍属于其它盘符，按设计会被 `channelPackIsolationReason` 拒绝。公开 Windows CI 因此运行 28 个无需物理 E: 的合成测试文件；`tests/embedded-pack.test.mjs` 和 `tests/source-checkin-bridge.test.mjs` 两个涉及真正 E: 磁盘安全门禁的集成测试，必须在项目绑定的真实 E: 测试机执行完整 `npm test`。**不得通过降低插件的真实目录校验让 CI 通过**。Ubuntu CI 核对 Git LF、来源哈希及跨平台配置测试。两类验证各有适用范围，不能混为一谈。

## 稳定版 1.0.0 的**阻断关口**

1. **正式 DSH 版本和桌面 GUI 实测（需要审批）**：在已备份且允许操作的 DSH 实例中安装候选包，验证菜单加载、模型列表、账号状态、来源登录复用、签到页、重启/升级/卸载及原渠道不受影响。不能仅靠 VM 注册测试声称已兼容桌面 UI。
2. **真实渠道鉴权/登录态续期（需要审批）**：用户明确指定允许测试的各渠道和账号；逐一核验已登录可直接复用、登录失效与刷新、人工启停、扫码/授权等；不得外借、复制或记录 Token。来源包支持 13 个渠道入口 ≠ 所有渠道的真实在线认证均可用。
3. **每日签到在线核验（需要审批）**：用户批准的真实账号逐渠道验证状态查询、领取/签到、回查确认和多账号隔离；有 9 个来源具备每日活动代码 ≠ 9 个渠道当前均有可执行任务。保持默认停用。
4. **危险/不可回滚工具的真实宿主策略**：离线验证两个并发合成工具不重复；实际多进程重启、掉电、工具已执行但回执丢失、真实 Shell/文件/网络工具的强幂等性尚未证明。生产配置建议先关闭 `hostFailover.enabled`，在可恢复的业务任务中先验收。
5. **发布权限（需要审批）**：用户确认最终版本号、npm 组织/仓库及公开发布目标后，才允许 npm publish / Git push / GitHub Release 或覆盖正式 DSH；当前只能交付 `.tgz` 候选供用户批准安装。

## 运维与安装要求

- DSH Host Node.js 最低 **22.10.0**；额外进程、8326 网关、Windows 计划任务均不需要。源码版本的前端 UI 和认证 API 必须由 DSH Host 自带的 Connection 服务提供。
- 如需试装：对准经允许的测试 DSH，使用本项目 `dsh-native-router-1.0.0-rc.2.tgz` 作为本地插件包、由 DSH 现有插件安装方式装载，并在系统插件页核对已安装版本和前端页面。**未对任何生产 DSH 执行安装。**
- 如需试装：对准经允许的测试 DSH，使用本项目 `dsh-native-router-1.0.0-rc.1.tgz` 作为本地插件包、由 DSH 现有插件安装方式装载，并在系统插件页核对已安装版本和前端页面。**未对任何生产 DSH 执行安装。**
- 插件配置默认不开启现有认证自动扫描、内置来源包自动加载、每日自动签到及宿主自动续跑；启用前请核对具体账号与模型链。
- 回滚操作：通过宿主 DSH 原生插件管理卸载本插件或恢复原版本，再还原部署前备份的本插件配置；此操作不应删除其他 DSH 渠道账号或原 Provider。

## 开发回归命令（仅项目绑定电脑、E:\Temp 隔离依赖已准备时）

```powershell
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\run-isolated-dsh-services.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\run-isolated-dsh-services.ps1 -ExistingHost
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\run-isolated-dsh-services.ps1 -SourcePool
$env:DSH_NATIVE_ROUTER_AGENTLOOP_SCENARIO='parallel'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\run-isolated-dsh-services.ps1 -AgentLoop
Remove-Item Env:DSH_NATIVE_ROUTER_AGENTLOOP_SCENARIO
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\audit-release-package.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\verify-packed-distribution.ps1
npm publish --dry-run --ignore-scripts --json  # 仅检查公开发布格式，不上传
```

请区分：**已验证 = 离线可执行的官方 DSH 组件测试；待验收 = 真实桌面端和真实账户条件**。
