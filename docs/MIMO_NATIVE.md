# RC.31：MiMo Desktop 会员授权自有来源（开发候选）

## 方向与边界

**不接受官方商业 API Key 作为 MiMo 会员接入路径。** 本插件仅通过一次性所有者授权，接管本机已登录会话，或启动自己的隔离浏览器完成账号登录；接管后从本插件 DSH Credentials 独立访问会员服务，旧 DSH 插件删除/停用不得成为持续依赖。自主登录不意味着规避正常账号验证或风控。

## 小米 MiMo Desktop：`own_mimo_desktop`

- 主动扫描本机 Desktop Chromium Cookie 数据库中可读取的 `passToken/userId/cUserId`，扫描不修改客户端文件、不生成账号；加密而不可读取时报告「无候选」，不声称解密成功。
- 自主登录入口允许明确选择 `cn/sgp/ams/ru/in` 账号区域，启动一次性隔离 Chromium，经小米账号页面完成授权后捕获本次会话 Cookie，保存进本插件凭据库。共用登录组件 `src/channels/browser-login.mjs` 不启动常驻网关。
  - rc.78 修正互动网页登录：原代码错误地把 `https://mimo-server-<region>.xiaomimimo.com/api/user/xiaomi/me` 作为浏览器首屏，用户实际只能看到 JSON 接口（或鉴权失败），不可能在其中输入小米账号。新的网页登录 URL 是官方 `https://account.xiaomi.com/`，**账号的地区仍由 `region` 明确选择，远端会员身份核验不因网页登录地址相同而跳过**。不得从会员网站自动推断模型免费或无限额度。

- 账号导入和浏览器 Cookie 捕获完成均要先通过小米会员远端身份核验，避免把还未完成 SSO 的半成品 Cookie 认成已登录；五区域自有凭据精确隔离，保留旧区域 ID 读取兼容。
- 会员原生调用：`src/channels/mimo-desktop-session.mjs` 处理 `passToken → serviceToken` SSO、带服务域名允许清单的跳转、短期缓存及 401 单次重新认证，直接访问会员 `/api/route/chat/completions`；必须完整解码 SSE 与工具回调校验。
- 用户账号记录、Provider 仅在确认导入或浏览器登录回执成功后写入配置；私密凭据写入失败、配置写入失败和重复接管均需按精确账号回滚/幂等处理。不自动创建模型链，也不自动生成推理成功记录。
- 不依赖 `MIMO_API_KEY`、MiMo Open Platform API Key、`own_mimo` 旧接口或 MiMo Desktop 本地引擎常驻。
