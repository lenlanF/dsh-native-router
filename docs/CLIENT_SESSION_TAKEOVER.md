# MiMo Desktop：会员会话接管与独立续期

**目标**：仅在本插件接管用户自己的客户端/浏览器会员登录态，并把经授权复制的会话保存在 DSH 自有私有凭据库；自此模型调用、会话续期、身份和余额读取独立运行。不依赖原 DSH 来源插件。不得通过付费官方 API Key 冒充同一种会员权限。

## MiMo Desktop

**原 MiMo 客户端未安装、未启动也不阻止授权和推理。** 两条并行授权路线：

1. **复用现有桌面登录**：主动发现本机 MiMo Desktop Cookie 记录中的明文 `passToken`；对 AppBound 加密数据不绕过 Windows 保护，无法读取时明确为空。
2. **本插件自主浏览器登录**：用隔离 Chromium 打开所选区域的 MiMo 会员账号页面，捕获来自 `account.xiaomi.com` 的会话 Cookie；登录完成后独立存入 DSH Credentials。隔离 profile 保存在 `E:\\Temp` 并清理；不启动网关。
   - rc.78：网页登录实际打开 `https://account.xiaomi.com/` 交互表单，**不**打开会员 `/api/user/xiaomi/me` JSON API。用户选定的 `cn/sgp/ams/ru/in` 区域只控制后台该地区的会员服务验证与推理；没有远端身份确认的 Cookie 不生成 Provider 或账号。

3. **统一独立运行**：基于自有 `passToken` 直接与小米账号服务换取 `serviceToken`，发生 401 时限次刷新；在自身服务上执行模型推理和完整 SSE/工具协议校验。
4. **配置一致性**：仅在有确切授权回执后创建 `own_mimo_desktop` Provider/Account，配置写入失败撤销新凭据；不自动建立自选模型链。

源文件：`src/channels/mimo-desktop-login.mjs`、`browser-login.mjs`、`mimo-desktop.mjs`、`mimo-desktop-session.mjs`、`src/account-center.mjs`。

完整独立会员来源的验收边界参见 [MiMo 会员](MIMO_NATIVE.md) 与当前检查点。
