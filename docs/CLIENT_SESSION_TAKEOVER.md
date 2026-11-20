# MiMo Desktop / 豆包工作：只接管现有客户端会员会话，不使用商用 API Key

**项目目标**：在本插件中只读发现原有已登录会话；经所有者明确选择后，一次性复制到 Native Router 自己的 DSH Credentials；此后独立发起客户端原生模型请求、续期、读实名/余额与签到（仅原产品确实支持的项目），停用原客户端/原插件不再成为本插件的运行依赖。不启动另一套本地代理 Gateway。

## 已有可执行代码（开发中，未经过真实云端账号验收）

- `src/channels/mimo-desktop-session.mjs`：用 MiMo Desktop 的账号会话，而非商用 API Key。SSO `passToken → serviceToken`，独立会话缓存，401 只刷新一次；对 MiMo Desktop 原生 `/api/route/chat/completions` 调用，完整 SSE 验证，DSH 工具权限校验，拒绝非小米 SSO 域名重定向。
- `src/channels/mimo-desktop.mjs`：仅在主动发现/确认接管时读取本机 Desktop Cookie 数据库；一旦确认，秘密保存到插件自己的 DSH Credentials，路由/模型调用只使用自有保存记录。旧授权被停用不影响已有有效自有会话。原凭据、原客户端文件不修改；解除本插件绑定不会登出原客户端。
- `src/account-center.mjs` / `src/index.mjs`：首次主动发现即使还没有 Provider 也能显示候选；确认接管后自动新建 `own_mimo_desktop` 本机授权 Provider，**不自动创建链条**，保持模型池的账号鉴权分层。
- 单元及模拟端到端：`tests/mimo-desktop-owned.test.mjs` 与 `tests/mimo-desktop-session.test.mjs`。已覆盖批准、绑定、不泄露秘密、来源停止后独立模型请求、配置写入失败撤销凭据、SSO、401 再认证、重定向边界、SSE 不完整拒绝。

### MiMo 未完成的真实能力

1. **本机实际登录发现**：当前一条扫描路径只能读取未加密的 Chromium Cookie 数据列；Chrome/Electron AppBound 加密和运行态 Cookie 尚需直接集成 DSH 安全登录/CDP 捕获入口。不能因为 `Cookies` 文件存在就宣称成功。
2. **真实云端验证**：项目绑定电脑没有 MiMo Desktop 已登录会话，尚未完成真实 SSO 和真实 `mimo-x-*` 模型请求。源码模拟测试通过不代表各地区线上均可用。
3. **账户真实展示**：尽可能读取 MiMo 的 `/api/user/xiaomi/me` 官方客户端身份响应；确实无公开昵称时显示「名称待获取」。没有余额接口的字段不能假造，也不默认签到。
4. **独立有效期**：`serviceToken` 续期成功只证明有效 `passToken` 仍在；上游撤销或过期后必须以自主登录重新授权，不能伪称永久有效。

## 豆包工作接入（尚未移植、不得显示模型可用）

- 已核对 MIT 参考 `Wahwayhale/dsh-connect-doubao`：它支持浏览器扫码/手机验证、单账号 DPAPI 会话、工作任务会员模型、只读真实额度。必要代码在 `src/doubao-auth-browser.ts`、`doubao-auth.ts`、`doubao-upstream.ts`、`doubao-catalog.ts`。仓库历史版本已有独立 loopback shim，**本插件不能照搬这个网关**，应抽出 Cookie / 上游消息序列化 / SSE 流解码改为原生 DSH Driver。
- Doubao 上游返回的是字节跳动自定义 SSE 事件，不是标准 OpenAI SSE；必须以它自己的完成帧确认，不得因为出现一段文本就算成功。不能用火山方舟 API Key 代替豆包工作会员。
- 正确顺序：一个独立的本插件浏览器登录授权流程 → DSH Credentials 自有 Cookie → 本插件直接 HTTP 调用会员对话/工作任务模型 → 服务端额度核验 → 实际完成推理 → 多账号/断开原插件测试。
- 坚决不读取原插件账号文件作为持续运行依赖；也不劫持、覆盖原 Doubao Provider 或其 Cookie。

## 参考项目与许可证

- `decolua/9router`（MIT）：MiMo Desktop ServiceTokenManager SSO 的 JavaScript 行为、跨区 SID，参考文件 `open-sse/shared/mimoAccount.js`。来源地址：<https://github.com/decolua/9router>。
- `Fly143/xiaomi-mimo-desktop-api`：仅核对 MiMo Desktop 会话与模型协议的可行性，**不引入其 Python/FastAPI 服务器或未审查许可的源码**：<https://github.com/Fly143/xiaomi-mimo-desktop-api>。
- `Wahwayhale/dsh-connect-doubao`（MIT）：独立豆包扫码、工作任务模型、真实额度及自定义 SSE 的实现参考：<https://github.com/Wahwayhale/dsh-connect-doubao>。

本阶段尚不能宣称 MiMo、豆包均完成。只有实际自有账号的成功模型回合、额度/状态按各自官方客户端响应核实后，才能升为可用。
