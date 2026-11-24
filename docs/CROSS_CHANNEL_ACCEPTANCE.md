> 历史版本记录（非当前支持范围）：rc.116 起退役渠道及其专属实现、测试均已独立归档；下列历史验收内容不得作为当前版本的接入或执行说明。

# 全渠道一致性验收矩阵 — DSH Native Router rc.25
本文件是发行门禁，不是线上“已验证”声明。来源必须通过一致的数据、身份和模型调用验收；渠道未返回字段时不得虚构姓名、余额或签到。

## 覆盖范围

- 内置独立来源包：`codearts, buddy, workbuddy, lobsterai, qoder, qodercn, trae, cline, loomy, raccoon, minimax, zcode, gemini`（13 个）。
- DSH 参考渠道：`codearts, workbuddy, qoder, trae, raccoon, lobsterai, minimax, zcode, loomy, mimo, doubao`（11 个）。
- 附加独立来源：本机原插件账号接管的 Lingxi、WorkBuddy CN/Global；普通 DSH Host Provider 应继续使用其宿主认证和模型目录。
- 是否支持自动签到由**真实适配器能力**定义；独立来源只有内置 `SOURCE_DAILY_SIGNIN_PROVIDERS` 列表中的渠道允许签到，来源的积分/余额能力不能推断为签到能力。

## 必须统一的规则

| 维度 | 共享判定 | 禁止的错误 |
|---|---|---|
| 账号来源 | 强证据（渠道 + 原生账号 ID + 凭据来源），保留自主登录、接管和复用 | 根据 `own_*` 或相同昵称认定为自主登录或同一账号 |
| 账号名称 | 最新上游公开用户名优先，其次安全原插件显示名，最后留空 | 显示 `账号 1`、随机身份摘要或把令牌当用户名 |
| 余额 | 只允许非负有限数值，严格保留上游返回单位和更新时间 | 所有平台都标成“积分”、缺值当 0、过期值标记为实时 |
| 鉴权 | 上游真实只读查询证明可用；失效与超时有明确状态 | “有模型目录”即当作账号鉴权成功 |
| 模型 | 账号与适配器都可用才展示独立路由候选；失效立即撤下 | 过期凭据对应模型仍可选 |
| 签到 | 独立区分自动开关、账号授权、已领取、未领取、无任务、待确认 | 用积分套餐 `active=false` 认定“今日无任务”；HTTP 200/受理即称成功 |
| 待确认 | 20 分钟后必须明确标记为确认超时；重试不得无限循环 | 永久显示“请求已发送等待服务端确认” |
| 同账号备援 | 只使用同一真实账号、已启用且经鉴权的备用来源；输出开始后禁止重放 | 停用/失效来源仍被标记可用或切到不同账号 |
| 异常隔离 | 各账号只读查询并发有界、每个最多 8 秒，失败不影响其他卡片 | 单个渠道阻塞整个配置页或暴露错误中的凭据 |
| 配置与 UI | 账号页与签到页使用同一事实规范，动态反映全局自动签到关闭 | 一个页面显示已签到，另一页显示永久待确认 |

## 本地实际验收

运行：

```powershell
node --check src/account-facts.mjs
node --test tests/account-facts-matrix.test.mjs
node --test tests/*.test.mjs
python tools/build-native-channel-pack.py --check
python tools/build-standalone-channel-pack.py --check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/audit-release-package.ps1 -ExpectedVersion 1.0.0-rc.22
```

发行包还需在**真实 DSH 托管 Node 环境的隔离目录**完成安装、模型元数据注册、冲突检测和卸载验证。以上离线测试通过**不等于**实际用户已完成生产升级、授权回查或各渠道云端推理测试。真实在线接口、积分查询、签到写操作必须单独记录结果和授权，禁止把无法执行的在线测试视为通过。

## 持续交付纪律

每次修复先确定根因，再对所有相关来源/页面做横向检查；有共用数据规则的改共用层并添加跨渠道矩阵用例。确认没有未经授权修改真实账号、没有敏感信息泄漏，最后以非强制快进方式提交对应 GitHub `lenlanF/dsh-native-router` 主分支并核对远端 SHA。
