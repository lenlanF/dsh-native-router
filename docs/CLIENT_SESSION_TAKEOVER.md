# MiMo Desktop / 豆包工作：会员会话接管与独立续期

**目标**：仅在本插件接管用户自己的客户端/浏览器会员登录态，并把经授权复制的会话保存在 DSH 自有私有凭据库；自此模型调用、会话续期、身份和余额读取独立运行。不依赖原 DSH 来源插件。不得通过付费官方 API Key 冒充同一种会员权限。

## MiMo Desktop

两条并行授权路线：

1. **复用现有桌面登录**：主动发现本机 MiMo Desktop Cookie 记录中的明文 `passToken`；对 AppBound 加密数据不绕过 Windows 保护，无法读取时明确为空。
2. **本插件自主浏览器登录**：用隔离 Chromium 打开所选区域的 MiMo 会员账号页面，捕获来自 `account.xiaomi.com` 的会话 Cookie；登录完成后独立存入 DSH Credentials。隔离 profile 保存在 `E:\\Temp` 并清理；不启动网关。
3. **统一独立运行**：基于自有 `passToken` 直接与小米账号服务换取 `serviceToken`，发生 401 时限次刷新；在自身服务上执行模型推理和完整 SSE/工具协议校验。
4. **配置一致性**：仅在有确切授权回执后创建 `own_mimo_desktop` Provider/Account，配置写入失败撤销新凭据；不自动建立自选模型链。

源文件：`src/channels/mimo-desktop-login.mjs`、`browser-login.mjs`、`mimo-desktop.mjs`、`mimo-desktop-session.mjs`、`src/account-center.mjs`。

## 豆包工作

本插件隔离浏览器扫码或显式导入 Cookie → `own_doubao` 私有凭据 → 豆包网页版会员对话服务 → 独立查询公开账号信息、普通聊天目录、会员额度 → 等完整 `SSE_REPLY_END` 后确认模型推理成功。

- 原生 SSE 不是 OpenAI SSE；取消、超时、流截断、HTTP 错误均不得返回假成功。
- 自有账户按 Cookie 的稳定身份区分，不同账号绝不能串用会话；重复导入不改写旧凭据。首次导入配置提交失败清除新保存凭据。
- 每日签到只接受上游已确认的真实回执。桌面工作任务模型及本地工具执行器尚未实际完成验收，不开放虚假工具能力。

## 实际验收状态

- **已执行**：自动化离线模拟 MiMo SSO、401 重试、独立推理、两种授权路径及账号回滚，豆包模型目录、额度、SSE、失败回滚和取消响应。
- **未执行**：真实会员账号扫码/授权、真实云端模型回合、停止旧客户端后的有效期验证、自动签到领取和豆包工作任务执行器。不能仅凭模拟宣布上线可用。
- 检查 Windows 项目电脑：Chrome 存在、MiMo/DoubaoWork 进程数为零、`E:\\Temp` 可用。没有触碰生产登录态。

每次升级先运行 `npm test`、固定源码包检查、私密信息/许可证扫描、隔离打包安装；严格区分开发候选与可发行正式版。

参考并归因：[decolua/9router](https://github.com/decolua/9router)（MIT）、[hulibuld/dsh-get-it-for-free](https://github.com/hulibuld/dsh-get-it-for-free)（MIT）、[Wahwayhale/dsh-connect-doubao](https://github.com/Wahwayhale/dsh-connect-doubao)（MIT）。
