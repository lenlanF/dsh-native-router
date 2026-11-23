# rc.88 — Raccoon 免付费积分闭环与渠道活动回执修复

## 对照用户实际业务
本轮在 rc.87 每渠道独立免费活动清单上，补齐此前错误排除的 Raccoon（小浣熊）来源。仅在用户已有自动积分任务开关允许且账号属于 DSH 独立接管来源时执行；所有新增动作免购买、免充值、不调用任何计费模型。

## 有实证的免费自动流程
1. 一次性「桌面登录积分」：官方 `GET /api/web/points/v1/tasks` 必须精确返回 `desktop_login` 待领取，才能调用渠道包现有一次性 POST 领取器。POST **之前**写入账户及任务哈希持久回执；仅官方任务 GET 确认 completed 才视为已领取。若网络异常或重启，不能再发相同一次性 POST，而是复核官方任务状态后结清回执。
2. 每日免费积分：独立使用官方网页办公四个固定 GET 地址（user_info、online_activities、setting_info、projects），无任何充值、购买、下单、付费模型请求。随后通过渠道包官方账单中的 `daily_grant` 证明今日实际入账；若尚未确认则保留待核验。与桌面登录奖励分开执行，不再通过会自行切换领取对象的通用 claim 方法获取每日奖励。
3. 每日签到已完成并不意味着一次性登录奖励已领；反过来登录奖励已领也不能跳过每日积分。原签到成功后、重启后仍允许补齐另一类免费奖励。
4. 每个渠道活动表格中 Raccoon 分别展示每日免费积分及一次性登录积分。只有官方账单与领取回执有明确积分值时显示数值，未返回到期时间不能捏造时间。

## 防误领与稳定性
- 原 MIT 渠道包在 `/tasks` 网络错误时可能把 `loginRewardPending` 默认为 false，这不是已领证据。本插件独立验证官方任务响应，并与唯一启用账号的确切凭据引用绑定，失败只报 unknown。
- 批量官方资料核验采用有界 4 账号并发和 3.5 秒单账号超时；单账号确切任务领奖采用 9.5 秒超时；未核实不执行领取。
- WorkBuddy 官方 gift/compensation 如果上次提交网络异常但服务端已领取，下次只读查询 `claimed:true` 即自动结清该条待核验的持久回执，不再提交 POST。
- 保留所有现有来源九渠道签到、ZCode 晚间卡片和 CAPTCHA 防误发规则；Cline、Gemini、原始 WorkBuddy 来源尚无可验证每日签到，不伪造；其它平台需人工/消费/购买的活动不在自动列表。

## 验收与真实云端边界
- `tests/raccoon-rewards.test.mjs`：官方只读任务认证、任务状态精确解析、每日 GET 严格地址白名单、网络错误和敏感凭据过滤。
- `tests/embedded-pack.test.mjs`：官方一笔桌面登录 POST + 一套每日 GET、单账号授权、任务失败不发 POST、拒绝用默认 false 结清回执。
- `tests/source-checkins.test.mjs`：当日积分已到账仍领登录奖励、持久回执跨重启、待核验回执官方状态补确认。
- `tests/workbuddy-vault-independent.test.mjs`：上游 POST 已接收但回复 503 的官方状态补确认，不重发。
- `tests/channel-activities.test.mjs`：活动页同时有每日积分和登录奖励且明确标记待核验。
- 需要运行全量 `npm test`、Windows/Ubuntu CI 和 `npm pack --ignore-scripts`。目前真实用户 Raccoon 或 WorkBuddy 云端到账尚未在线逐账号验收，不能把本地模拟说成生产成功。禁止升级时修改用户正在使用的 DSH 凭据和配置。
