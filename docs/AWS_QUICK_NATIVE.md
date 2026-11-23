# RC84 — Amazon Quick 独立会员原生适配

来源：MIT 项目 https://github.com/httpdone/magpie-aws-quick ，锁定协议参考提交 `adf163c11bdffc74`（以完整上游提交/许可证与 vendored 文件实际校验为准）。保留源许可证在 `src/channels/aws-quick-vendor/LICENSE`。

## 产品边界
- 新来源 `own_aws_quick`，非 Amazon 商业 API Key 收费通道，不要求 Magpie 或 Quick Desktop 常驻。
- 双路径：明确授权的本机 Windows 凭据一次性接管；独立浏览器 OAuth PKCE。身份以官方 user-info 同账号 ARN/邮件/租户一致性核验，刷新后的授权存储于 DSH 私有 vault。
- 四档 `fast/balanced/smart/advanced` 是 Amazon Quick 的动态路由模式，非经官方确认的固定计费倍率；未知费用不得标成免费。原生 Quick 双向 WebSocket 推理须取得终止帧才能记成功。
- 会员额度从 `getAvailableEntitlementUnits` 只读接口返回，展示小时数与有效窗口，不把未知读取错误误记为 0，也不把同池重复的额度相加。
- 本机凭据只读导入；退出时仅撤销本插件私有绑定，不删除原客户端凭据。不在公共配置、日志、前端响应、GitHub 发布包中暴露真实认证资料。

## 自动化验证与待验
- `node --test tests/aws-quick-native.test.mjs tests/aws-quick-security.test.mjs`：9/9，包含模拟 WebSocket 真正走 DSH 正式 Adapter、会员小时额度及公开账户页、账号事务回滚、OIDC 发现地址注入保护、OAuth 完成与取消竞态、过期回执不能撤销已提交账号、桌面凭据一次性导入不修改原客户端。
- `npm test`：707/707（含既有全部渠道回归）。上游原始 `npm test`：102/102。发行包、隐私扫描、隔离 DSH Host、双平台 CI 需分别验收。
- **尚未经过用户真实 Amazon Quick 账号云端推理或真实额度回执验证**。模拟端到端不等同 AWS 上游真实调用；未知倍率不当作免费。上游明确警告非官方内部协议存在服务条款和账号限制风险。
- 生产插件维持用户当前安装版本，不自动升级、不复位现有渠道账号/签到/故障切换配置。
