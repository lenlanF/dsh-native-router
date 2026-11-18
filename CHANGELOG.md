# Change Log

## 1.0.0-rc.2 — 2026-11-18 — Public source integrity and privacy hardening

- 修复固定上游来源哈希只接受 Windows CRLF、公开 GitHub LF 克隆无法完整验证的问题；文本统一 LF，WASM 字节保持完全不变。
- 新增公开仓库 GitHub Actions Windows/Linux 测试、只公开经过凭据扫描的合成测试、零权限的秘密扫描脚本和更严格的 .gitignore 保护；移除发行清单中的私人开发日志。
- 整理上游 MIT 版权说明和漏洞私下报告渠道；版本号提升为 rc.2，正式 1.0.0 仍需实际 DSH 登录、签到和不可逆工具场景验收。

## 1.0.0-rc.1 — 2026-11-18 — Release Candidate

- 将 DSH 原生单插件构建整理为可分发 npm tarball：Node `>=22.10.0`、MIT 及三方版权 NOTICE；不包含开发依赖或第二个服务进程。
- 修复 DSH Connection 已认证的远程 HTTPS UI 同源请求不能保存配置的问题；拒绝不同源与非本机明文 HTTP 的管理写入。
- 管理路由内部同步/异步异常统一返回 HTTP 500、不暴露实际异常内容；超大请求仍 HTTP 413。
- 修复 Windows 配置更新使用固定 PID 临时文件名、进程崩溃残留导致后续保存永久报 EEXIST 的问题；保留同目录随机临时文件与原子覆盖。
- 在真实公共 DSH AgentLoop、Session、Tools 组合中新增并行两个虚构工具的续跑证明、用户取消与 Agent 销毁无误触发续跑的验证。
- 新增 DSH Web 模块加载、设置区插件挂载/卸载的结构级测试，以及 `docs/RELEASE_ACCEPTANCE.md` 明确正式版放行门禁。
- 实际打包安装（不是直接引用项目源码）进入全新 `E:\\Temp` 环境，DSH 组件成功加载/卸载，真实 Connection owner 鉴权 200/401、卸载 404；npm 公开发布 **dry-run** 通过但未真实发布。

**此版本只作为候选发布包**，无正式 DSH 桌面实机验收、没有读取或更新任何真实账号，也未提交 npm、GitHub 或替换生产插件。

## 0.1.0-alpha.18 — 2026-11-17

- 经真实 DSH AgentLoop 端到端测试，修复模型请求故障后 `agent/error` 与 idle 状态竞态造成自动续跑被漏掉。
- 限制仅本插件已登记的 retry ID，避免拦截其他原生 DSH 组件合法重试。
- 已提交工具结果在真实 Session 中保持一次，模型更换与 Agent 连续性获隔离证据。

## 0.1.0-alpha.17 — 2026-11-17

- 借用 DSH 宿主已安装 Provider 与唯一有效账号引用，不复制原认证内容、不重复注册同名渠道。
- WorkBuddy 本机 Desktop 认证与 DSH 来源账号双通道复用，保持现有单插件路由链和来源签到能力。
