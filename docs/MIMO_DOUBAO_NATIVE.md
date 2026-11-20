# RC.29：MiMo Desktop / 豆包工作会员授权自有来源（开发候选）

## 方向与边界

**不接受官方商业 API Key 作为 MiMo 或豆包工作会员接入路径。** 本插件仅通过一次性所有者授权，接管本机已登录会话，或启动自己的隔离浏览器完成账号登录；接管后从本插件 DSH Credentials 独立访问会员服务，旧 DSH 插件删除/停用不得成为持续依赖。自主登录不意味着规避正常账号验证或风控。

## 小米 MiMo Desktop：`own_mimo_desktop`

- 主动扫描本机 Desktop Chromium Cookie 数据库中可读取的 `passToken/userId/cUserId`，扫描不修改客户端文件、不生成账号；加密而不可读取时报告「无候选」，不声称解密成功。
- 自主登录入口允许明确选择 `cn/sgp/ams/ru/in` 账号区域，启动一次性隔离 Chromium，经小米账号页面完成授权后捕获本次会话 Cookie，保存进本插件凭据库。共用登录组件 `src/channels/browser-login.mjs` 不启动常驻网关。
- 会员原生调用：`src/channels/mimo-desktop-session.mjs` 处理 `passToken → serviceToken` SSO、带服务域名允许清单的跳转、短期缓存及 401 单次重新认证，直接访问会员 `/api/route/chat/completions`；必须完整解码 SSE 与工具回调校验。
- 用户账号记录、Provider 仅在确认导入或浏览器登录回执成功后写入配置；私密凭据写入失败、配置写入失败和重复接管均需按精确账号回滚/幂等处理。不自动创建模型链，也不自动生成推理成功记录。
- 不依赖 `MIMO_API_KEY`、MiMo Open Platform API Key、`own_mimo` 旧接口或 MiMo Desktop 本地引擎常驻。

## 豆包工作：`own_doubao`

- `src/channels/doubao-login.mjs` 启动一次性隔离 Chromium，经豆包自己的网页版登录，将 `sessionid` 等合法 Cookie 保存在本插件 DSH Credentials。也支持所有者显式提供 Cookie。
- `src/channels/doubao-upstream.mjs` 访问豆包网页版原生接口，获取用户名称、动态普通聊天模型和会员 `window_type=4` 套餐额度。其 SSE 格式不能按 OpenAI 通用格式解析；必须收到 `SSE_REPLY_END` 且有完整文本才记为推理成功。
- Cookie 只接受确切 `doubao.com` 或子域，CDP WebSocket 只能连接本机临时浏览器。多账号密钥按各自绑定引用隔离；配置失败回滚首次保存的私密会话；重复导入不应覆盖旧会话。
- **签到不需要原豆包客户端进程**：经本插件自己的网页会话在 `/alice/ug/campaign/landing/checkin` 提交领取，并以活动详情中 `checkedInToday` 的后续回查确认成功；服务端拒绝或回查未成功只记待确认，不能声称到账。工作任务本地工具执行器仍没有实际在线验收，暂不暴露为可运行模型。

## 证据等级

- **代码完成 / 离线模拟**：浏览器登录、凭据独立保存、模型协议、SSO 续期、异常回滚、多账号保护和网页版签到回查均有模拟测试。13 个内置来源的无原 Host 模型回合也有专项测试；详见 [无客户端进程验收门禁](HOSTLESS_RUNTIME_ACCEPTANCE.md)。可用 `npm test` 重现。
- **真实账号在线验收**：当前项目绑定电脑检查到 Chrome 可用、MiMo/DoubaoWork 客户端进程数为零；没有读取或导出任何真实账号密钥，因此尚未完成两渠道真实登录、推理、续期和客户端卸载后验证。
- **正式发行门禁**：至少一个真实账号成功完整模型回合、会话独立续期、客户端/旧插件停止后复测；其余账号及签到/额度按实际服务能力分别标记，不能以目录或模拟结果冒充可用。

## 已核对的开源来源与许可

- [decolua/9router](https://github.com/decolua/9router)（MIT）：小米桌面会员 SSO 账号服务、区域和请求协议；参考 `src/lib/mimoLoginSession.js`、`open-sse/shared/mimoAccount.js`，不引入它的 Next.js 代理。
- [hulibuld/dsh-get-it-for-free](https://github.com/hulibuld/dsh-get-it-for-free)（MIT）：豆包登录、原生模型与额度协议；衍生浏览器/CDP 及上游请求保留 `LICENSES/dsh-get-it-for-free-MIT.txt`。
- [Wahwayhale/dsh-connect-doubao](https://github.com/Wahwayhale/dsh-connect-doubao)（MIT）：豆包工作会话、模型/会员任务能力对照；保留待真实测试的任务执行器验收边界。

项目只在显式授权时启动一次性隔离浏览器；没有额外 API-Key 计费入口、Gateway 服务或独立常驻进程。
