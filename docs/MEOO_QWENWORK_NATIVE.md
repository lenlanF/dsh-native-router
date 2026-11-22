# Native Router rc.79 — 秒悟 Web 与千问办公原生会员驱动

**共同原则**：使用登录后的会员原生授权，不将商业 API Key、原插件进程或另一个 HTTP 网关伪装成独立会员来源。用户自行升级 GitHub main。

## MIT 源与可追溯性

参考 hulibuld/dsh-get-it-for-free (MIT) v3.5.4, commit 114b4a516ab32e6f318a53cab4ac7f83ef8dd0b0。
秒悟适配参照 src/meoo-web/login.js、session.js、provider.js、sse.js，并通过本项目 src/channels/meoo-web.mjs、meoo-sse.mjs 执行，无额外服务。
千问办公原生签名、目录和流解析依赖 src/qwenwork/{cosy,signer-session,sse,catalog,models,errors,upstream-errors}.js 的固定 MIT 版本；源代码以 .mjs 收录于 src/channels/qwenwork-vendor，许可证原文在 LICENSES/qwenwork-MIT.txt。runtime-identity.mjs 特别重写为只使用本插件的私有 machineId，不扫描原千问办公客户端目录。

## 秒悟 Web：own_meoo_web

由用户自主启动隔离 Chromium 登录 https://meoo.com/，或显式导入自己已有网页 Cookie。仅接受确切 meoo.com 或子域的 oneday_sid、login_oneday_ticket；拒绝伪造域名与换行 Header 注入。API /api/v1/user/me 必须真实返回身份 UID，否则匿名 HTTP 200 也不能作为授权成功。
以该 UID 的哈希作为 mw_ 私有账号 ID，凭据只保存在 DSH Credentials，禁止写进公开 JSON。模型从 /api/v1/agent/models 动态读取，额度仅从 /api/mc/entitlement/get 实际返回的 userPointInfo.account.availableBalance 记录，未知费率不能认定免费。
执行普通网页对话时仅使用独立自有项目，通过 /api/agent/query、/api/agent/start 接收秒悟 UI SSE；翻译 delta/snapshot 并强制 task_complete 正常结束。错误、取消、工具调用、截断、空正文均视为失败。凭据更新及取消实行精确回滚凭证，不得以过期取消删除已提交的其他账号。

## 千问办公：own_qwenwork

用户点击申请设备授权，生成独立 PKCE nonce、verifier、challenge 和 machineId；前端只显示精确的 https://gateway.qwenwork.cn/device/selectAccounts 官方 URL，用户主动访问。轮询 /api/v1/deviceToken/poll 的 404 只意味着等待，200 返回有效 Token 后须通过 /api/v1/adapter/user/account-context 验证真实用户 UID。
同一 UID 的不同组织隔离为不同 qw_ 账号；私有 refreshToken 和 machineId 保存在 DSH Credentials，允许原客户端卸载后由本插件直接刷新与 COSY 签名。模型经 /algo/api/v2/model/list?Encode=1 实时签名获取，费率取 price_factor 明示，缺失则待确认、不宣称免费。
原生模型使用 /algo/api/v2/service/pro/sse/agent_chat_generation 的 COSY 包装协议，对 SSE 两层 JSON 解码，只有正文非空且 finish_reason=stop 才能完成 DSH 回合。必须保留全程超时、取消、身份边界、不受支持工具及截断拒绝。

## 验收等级

模拟官方 HTTPS 响应、真实 Node Native Router adapter.stream、私有凭据生命周期及无额外进程均有专门回归。还应通过全部 npm test、真实隔离 Cordis Host、发行包与隐私审计、当前 DSH 托管 Node 安装测试及 GitHub Windows/Linux CI。
**目前没有提供真实秒悟或千问办公会员会话**，不能把合成数据的 DSH 完整回复冒称生产成功；需合法登录会员、确认实际费用后才能做首次线上请求和长期自有续期验收。