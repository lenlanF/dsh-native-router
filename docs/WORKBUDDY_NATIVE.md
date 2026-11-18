# WorkBuddy / CodeBuddy 原生渠道 — Alpha.3

内置驱动直接运行在 DSH 的 dsh-native-router 插件中，不启动独立 API 网关。账号发现、导入、启停、对话路由和退出都服从统一账号中心。

## 已实现

1. 注册 WorkBuddy 原生驱动时不读取桌面授权文件、不联网。用户主动点击扫描才只读检查 CodeBuddyExtension/Data/Public/auth 下的 workbuddy-desktop.info 或 workbuddy-desktop-ai.info（LOCALAPPDATA、APPDATA；可通过 WORKBUDDY_AUTH_FILE 显式指定）。
2. 候选账号向设置页只返回匿名标识、昵称和来源类别，不包含 Access Token、Refresh Token、Cookie 和原始文件绝对路径。需要审核确认后才能导入。
3. 导入只在插件自己的 workbuddy-sources.json 中记录来源文件路径和账号标识，不复制 Token。源文件始终只读；导入账号默认停用，自动签到默认关闭。
4. 启用后，登录/校验与刷新会真正请求 /v3/config 核验授权，模型目录通过相同接口获取，对话直接请求 /v2/chat/completions，使用本轮 DSH 工具列表和 SSE 完整结束校验。
5. Access Token 即将过期时，可尝试 /v2/plugin/auth/token/refresh 续期。新令牌仅保存在当前进程内存，绝不回写桌面端原文件。重启后若原文件仍过期，需官方桌面客户端刷新登录。
6. 退出/解绑只删除插件自己的来源引用，不会退出或撤销 WorkBuddy/CodeBuddy 官方桌面会话，API 的 revokedUpstream 保持 false。
7. 从桌面文件读取的 domain 不可指定任意外部目标。正式请求目的地仅限已识别的 copilot.tencent.com 或 www.codebuddy.ai。

## 账号接入操作

1. 首先在官方 WorkBuddy/CodeBuddy 桌面客户端自行完成登录。
2. 在 DSH 设置 → 聚合路由 → 渠道账号中找到 WorkBuddy，点击“配置此渠道”。该操作创建默认停用的提供商草稿。
3. 在提供商页面启用 WorkBuddy 后点击保存；返回渠道账号页面，主动点击“扫描本机授权账号”。
4. 核对候选账号，点击“审核后导入”；新账号默认停用，手动启用后点击“登录/校验”检查上游可达性。
5. 在 DSH 模型选择器使用 native-router / direct:workbuddy:<真实模型ID>，或在模型链条中建立包含 WorkBuddy 模型的自定义链。模型目录更新后可能需要重启 DSH Host。

## 暂不支持及验收边界

- 插件内全新 OAuth/扫码登录尚未开发；本版使用官方桌面客户端已授权的登录状态。
- WorkBuddy 每日签到与领取额度接口尚未实现。每日签到页面应显示待适配，不能伪造成功记录。
- 未验证真实付费/免费额度、官方客户端版本兼容或线上模型请求的实际结果。
- 当前验证使用隔离的虚构授权文件、mock Fetch 和真实本机 TCP/HTTP 测试服务器，没有触碰真实用户凭据或访问上游。真实 DSH 宿主安装、图形交互、线上授权和模型调用仍待单独验收。

## 开源参考与许可

协议行为参考 lg22-long/workbuddy-bridge（MIT，LICENSES/workbuddy-bridge-MIT.txt）及 hulibuld/dsh-get-it-for-free 的只读桌面登录态发现思路。没有复制真实账号数据或第三方 vendor 大型包。仅支持用户有权使用的账号，不规避平台风控、付款限制或权限要求。

## 本机验证命令

- npm test
- node --test tests/workbuddy-native.test.mjs
- node --test tests/workbuddy-http.test.mjs
