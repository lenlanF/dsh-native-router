# RC84 — Amazon Quick 独立会员原生适配

来源：MIT 项目 https://github.com/httpdone/magpie-aws-quick ，锁定协议参考提交 `adf163c11bdffc74`（以完整上游提交/许可证与 vendored 文件实际校验为准）。保留源许可证在 `src/channels/aws-quick-vendor/LICENSE`。

## 产品边界
- 新来源 `own_aws_quick`，非 Amazon 商业 API Key 收费通道，不要求 Magpie 或 Quick Desktop 常驻。
- 双路径：明确授权的本机 Windows 凭据一次性接管；独立浏览器 OAuth PKCE。身份以官方 user-info 同账号 ARN/邮件/租户一致性核验，刷新后的授权存储于 DSH 私有 vault。
- 四档 `fast/balanced/smart/advanced` 是 Amazon Quick 的动态路由模式，非经官方确认的固定计费倍率；未知费用不得标成免费。原生 Quick 双向 WebSocket 推理须取得终止帧才能记成功。
- 会员额度从 `getAvailableEntitlementUnits` 只读接口返回，展示小时数与有效窗口，不把未知读取错误误记为 0，也不把同池重复的额度相加。
- 本机凭据只读导入；退出时仅撤销本插件私有绑定，不删除原客户端凭据。不在公共配置、日志、前端响应、GitHub 发布包中暴露真实认证资料。

## 自动化验证与待验
- `node --test tests/aws-quick-native.test.mjs`：5/5，通过本机模拟双向 WebSocket、账号接管及 DSH 原生路由、身份冲突、只读额度失败与事务回滚。
- `npm test`：703/703，包含既有渠道回归。
- **尚未经过用户真实 Amazon Quick 账号云端推理或真实额度回执验证**。本轮不得以模拟环境结果冒充真实会话可用性；发布前完成打包内容、公开敏感信息扫描、原生 Host 加载与 CI 核验。
- 生产插件维持用户当前安装版本，不自动升级、不复位现有渠道账号/签到/故障切换配置。
