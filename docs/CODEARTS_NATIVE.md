# CodeArts 原生渠道｜Alpha.4 阶段性验收与接入

本阶段实现无需外部网关的 CodeArts 原生签名请求和用户自建临时凭据账号池。真正的浏览器 OAuth2（PKCE/DPoP）授权、令牌加密持久化与自动刷新尚待下一阶段完成，不能将“凭据校验”说成网页登录成功。

## 已完成的原生能力

- 内置 codearts native-channel 驱动：注册时不扫描任何账号；仅用户点击“扫描本机授权账号”时读取明确配置的账号环境变量名称，不读取其他插件的 CodeArts 账号库或浏览器数据。
- 自建多账号池：CODEARTS_ACCOUNT_IDS 列出账号别名（例如 ALPHA,BETA）；每个别名有 3 个独立临时凭据环境变量。只向网页返回公开别名，用户审核后导入，导入默认停用、不自动签到。
- Huawei SDK-HMAC-SHA256：UTF-8 请求体 SHA-256、UTC X-Sdk-Date、host canonicalization、SignedHeaders、X-Security-Token、x-auth-token，以及 HMAC 签名。catalog 与 chat 各使用实际协议要求的请求头，签名覆盖完整请求。
- 签名 GET /v1/model/builtin 发现内置模型，解析上游 {builtinModels:[{model_id,model_name,enable,display_enabled}]}；忽略已被禁用/隐藏的模型。
- 签名 POST /api/v2/chat/completions，直接处理 OpenAI SSE 增量和本轮 DSH 工具白名单；请求中途断流的工具调用不允许进入宿主。福利模型不会仅根据名称推断免费，不会擅自使用 maas_type:benefit 或申领权益。
- 可对每个已导入账号单独启用/停用、刷新（使用远端签名目录探针）、退出/解绑。退出仅解除插件内关联，不撤销外部临时 AK/SK。
- 已准备标准 SHA-256 PKCE 和 ES256/low-S DPoP JWT 基础函数；**未连接 OAuth 授权流程，也不保存 DPoP 私钥**。

## 自建账号池环境变量约定

示例只展示变量名称，不包含真实密钥：

    CODEARTS_ACCOUNT_IDS=ALPHA,BETA
    CODEARTS_ALPHA_AK=<临时 Access Key ID>
    CODEARTS_ALPHA_SK=<临时 Secret Access Key>
    CODEARTS_ALPHA_TOKEN=<临时 STS Security Token>
    CODEARTS_ALPHA_EXPIRES_AT=2030-01-01T00:00:00Z
    CODEARTS_BETA_AK=<第二账号临时 AK>
    CODEARTS_BETA_SK=<第二账号临时 SK>
    CODEARTS_BETA_TOKEN=<第二账号临时 STS Token>
    CODEARTS_BETA_EXPIRES_AT=2030-01-01T00:00:00Z

上面的日期仅是格式示例，请填写凭据真实有效期。ID 只能使用大写英文字母开头、后接大写字母/数字/下划线，长度不超过 31；必须在启动 DSH Host 的进程环境内设置。凭据不写入本插件 JSON，但环境变量会传给继承环境的子进程，因此这只是阶段性通道，不应作为生产长期凭据存储方案。

## 使用步骤

1. 使用有权访问 CodeArts 的账号，通过合规授权流程获得有效临时 AK/SK/SecurityToken，并配置在仅 DSH Host 可见的进程环境中。
2. 在 DSH 账号总览找到 CodeArts，点击“配置此渠道”。其 native-channel 提供商草稿默认停用；用户主动启用并保存后，再返回账号页扫描。
3. 只返回已完整配置三件套的公开账号别名。点击“审核后导入”逐个导入，一次扫描可以审核多个候选。导入账号默认停用，按需启用。
4. 点击账号的“刷新”运行签名目录探针。只有真实上游目录请求成功才显示已连接；这不是 OAuth 登录过程。
5. 从 native-router / direct:codearts:<实际返回的模型ID> 或配置好的模型链使用；没有真实已发现模型就不会伪造模型。

## 保持禁用的能力

- `CodeArts OAuth2/PKCE/DPoP` 浏览器交互、STS 授权码交换、专用密钥安全落盘、自动续期、多进程刷新锁：尚未实现。
- 福利权益领取/签到、真实余额、动态费用、模型时段倍率：尚未实现，不会声称免费、已签到或余额充足。
- 真实 CodeArts 云端请求/真实账号在线验证、DSH 真实宿主权限/工具链/UI 视觉验收：尚未完成。
- 特殊模型的累计快照 SSE、福利路由头，以及所有 CodeArts 模型兼容差异仍需要真实在线验收。

## 验证与开源参考

已用隔离虚构账号、Node crypto 独立签名验证和本机真实 TCP/HTTP 服务测试协议：模型目录、两账号、授权失败、失效凭据、工具调用、断流和免费模式误判均有覆盖；不访问真实云端账号。

- Huawei CodeArts 官方 AK/SK 认证文档：https://support.huaweicloud.com/intl/zh-cn/api-devcloud/codearts_03_0004.html
- 社区参考：https://github.com/elegant01/dsh-codearts（MIT；LICENSES/dsh-codearts-MIT.txt）
- 社区账号池参考：https://github.com/hulibuld/dsh-get-it-for-free（MIT；LICENSES/dsh-get-it-for-free-MIT.txt）

## 下一阶段

优先完成：1. CodeArts 授权码登录与 DPoP 回调防重放；2. DSH/Windows 安全凭据存储；3. 自动续期并防止并发刷新覆盖；4. 福利/费用与模型目录联动；5. 在用户明确批准的隔离 DSH Profile 下真实体验验收。
