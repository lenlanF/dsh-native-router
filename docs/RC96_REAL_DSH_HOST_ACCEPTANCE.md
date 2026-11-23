# rc.96 — DSH 真实宿主调用链、独立来源隔离与本机登录态证据分级

## 本轮验证对象

用户安装的 DSH Native Router 仍为 **1.0.0-rc.94**；GitHub 基线为 rc.95。代码只在项目绑定 Windows WebCodex 工作树修改，运行 DSH 22.16 的独立测试环境：`E:\Temp\dsh-native-router-isolated-alpha10-host`、Portable Node 22.16。未读取用户凭据明文、未覆盖或重启已安装插件、未执行真实收费云模型或领取活动。

## 从失败到通过的复现

1. **第一次隔离 Host 执行真实失败**：`-ExistingHost` 报 `embeddedPack.state=failed / errorStage=import_standalone_runtime / errorKind=missing_module`。原因不是生产 DSH 没装依赖，而是 `tools/run-isolated-dsh-services.ps1` 只复制了 `pack.js`、`pack-native.js` 和 WASM，漏掉真实生产 `embedded-pack.mjs` 入口所依赖的 `pack-runtime.mjs`。已将其加到隔离复制清单。
2. **后续加载全 13 个 Provider 别名成功**；旧脚本仍要求 `state=blocked`，这是旧版无法并存的行为。现有真实架构要求来源包使用自有 `nativeRouterSourceAccountPool`，与已安装 Qoder `accountPool` 和原 Provider 并存，不能以旧测试要求停止服务。已校准到 `mounted` + 私有池可用 + 原 Provider 仍在。
3. **旧测试错误地要求自动导入账号**。现在扫描只是只读发现、需要明确一次性接管；测试改为断言 `attempted=1, linked=0, needsOneTimeMigration=1`，原账号池及配置完全不变。
4. **真实宿主模型限制**：原 Qoder 的两个合成模型仍完整保留在原 Provider 目录，聚合路由只展示用户明确允许的模型；通过聚合路由对已选模型执行一次真实 Cordis LlmRuntime 全链路，拿到 text-delta 和 stop finish。未选模型不会出现在聚合路由目录；独立 Qoder Provider 目录不被修改。
5. **注销与隔离**：Cordis 卸载后聚合路由消失，原 Qoder Provider 和原 AccountPool 仍存在；未授权的 localhost API 被拒绝，整个过程中 `credentialReads=0, credentialWrites=0`、一个 DSH WebServer listener、没有多余进程。

## 三项真实 DSH 组件级实验

| 实验命令 | 主要证据 | 结果 |
|---|---|---|
| `powershell -File tools/run-isolated-dsh-services.ps1 -ExistingHost` | Cordis + LlmRuntime + Connection + WebServer、原 Qoder Provider、私有来源包并存、经聚合路由完成消息、零凭据访问、卸载保留原 Provider | PASS |
| `powershell -File tools/run-isolated-dsh-services.ps1 -SourcePool` | 真实固定来源包 AccountPool；两个合成账号精确选择、阻止错误降级、防重复、零凭据改写 | PASS |
| `powershell -File tools/run-isolated-dsh-services.ps1 -AgentLoop -SandboxRoot E:\Temp\dsh-native-router-agentloop-alpha18-host` | 真实 AgentLoop/SessionStore/ToolsService/LlmRuntime；3 次合成模型调用、一次真实工具流程合成执行、一次故障切换、继续同一 Agent 和会话，外部工具操作 0 | PASS |

三项都是**真实 DSH 组件+合成账号／合成上游**。不是用户登录的 Qoder 云端真实回复、真实付费或所有云端来源已完整验收。
### 第四项：从正式 tgz 安装的真实宿主验收

使用 `npm.cmd pack --ignore-scripts` 生成本项目 `1.0.0-rc.96.tgz`，然后执行 `powershell -File tools/verify-packed-distribution.ps1 -Version 1.0.0-rc.96 -NodePath E:\Temp\dsh-native-router-isolated-alpha11-node-runtime\package\bin\node.exe`。该命令在 **E:\Temp 一次性新目录**安装发行包和固定的 32 个依赖，通过 Node 22.16 运行真实 DSH Cordis + Connection + WebServer：NPM 包入口导入、注册并卸载、自有 13 个别名、宿主已有 Provider 共存、账户只读 RPC 认证、外部别名冲突下登录 RPC 仍可用、API 匿名访问 401、卸载后路由 404、未生成生产配置、未调用真实账号及云模型，**全部 PASS**。验收用临时目录结束后删除，不覆盖现有 rc.94。

## 登录态与模型标记修复

- `src/session-reuse.mjs` 的 `available` 仅表示通道适配器已装载，新增 `accountDetected` 和 `loginVerified`（来源扫描不能提供云端鉴权回执，始终是 false），不得把装载的 TRAE、Gemini 等误当成账号已登录。
- `client.js` 将复用管理说明调整为「已接入渠道适配器（不等于已登录）」「已扫描到可接管账号」「真实登录状态仅以已核验账号列表为准」，适配 320/560/720/1024px DSH 内容容器。
- `tests/session-reuse.test.mjs` 新增证据分级、不自动导入、原登录文件只读的回归；`tests/ui-panels.test.mjs` 增加界面文案验收。
- 账号身份、余额、免费活动到账仍以 rc.95 的匿名只读审计和官方精确凭据为准；不可把成功注册一个路由当成所有账号和奖励均成功。

## 尚未达到的真实验收

用户实际 rc.94 的匿名审计为 9 Provider / 10 账号；名称 6/10、余额 8/10，缺少 10 个近期模型成功证明，今日尚无新签到或官方到账回执，且 `checkin.autoEnabled=false`。本轮绝不修改用户此设置。

隔离的旧版 `verify-isolated-dsh-services.mjs` 仍假设 `ctx.get('nativeRouterSourceCheckins')` 和 `ctx.get('accountPool')` 为**全局**服务；新架构把它们作为私有作用域，因此这项遗留验收脚本仍与现有合约不符，不能声称 PASS。已分别以真实 Host ExistingProvider、真实私有 SourcePool 和 AgentLoop 组件测试覆盖关键路径，后续可将遗留脚本完全迁至私有 RPC API。云端真实模型／免费任务需要在账号已确认免费且官方可校验时继续单独实际验证。
