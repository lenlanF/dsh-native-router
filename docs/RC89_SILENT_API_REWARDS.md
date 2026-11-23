# RC.89：全渠道无感接口任务扩展及 Loomy 八项官方奖励

## 用户最终执行边界
只接受后台不被用户感知的官方接口操作：GET 活动资格、POST 官方任务完成/领取、GET 官方状态/到账。没有逐任务完成 API、必须模拟真人点击、发送内容、生成 PPT、建立定时任务、分享帖子、验证码、购买、充值或调用收费模型才能完成的活动，一律停止该路径；不以客户端模拟或伪造完成记录代替官方回执。

## 本轮真实新增
- 用 vendor/channel-pack/pack-native.js 已包含的官方协议核验 Loomy `/onboarding/tasks` GET 与 `/onboarding/tasks/complete` POST；精确 8 个任务，官方源可得奖励合计 10000 积分：first_message 500、pick_skill 1000、generate_ppt 1500、set_schedule 1000、install_skill 1500、configure_remote 1000、create_soul 1500、share_soul 2000。
- 所有任务只提交官方 `{key}` 完成接口，绝不执行每个任务对应的用户有感行为；平台若没有把某任务标记为 completed，停止当轮后续提交，不把 POST 200 视为入账。状态确认只认后续重新 GET 的 `tasks[key]===true`，失败为待确认。
- 每笔 POST 前按唯一渠道、账号、凭据绑定、任务种类与积分写入持久化 SHA256 防重回执；重启、网络错误、宿主重连后不能重复发送；已完成任务可凭新的 GET 自动结清历史待确认回执。账本上限 10000 行，满额不丢弃旧回执、不允许重发。
- Loomy 已纳入 source-account-center 的自动调度，与每日签到独立执行：当天已签到也能单独完成未领新手任务；每 30 分钟限一次巡检，切断或停用账号时拒绝旧结果。手动「积分任务」也会执行这一后台流水线。
- Loomy 官方 8 个奖励在「渠道活动」单独按账号展示，逐项列名称、积分、完成状态、到期时间（未公布显示官方未公布）。Cline 和 Gemini 等无独立免费领取端点的渠道显示具体原因，而不是空泛未知。

## 全渠道清单（以当前源码实际协议为准）
| 渠道 | 免费接口任务 | 本次处理 |
|---|---|---|
| CodeArts/Buddy/LobsterAI/Qoder/QoderCN/Trae/MiniMax/ZCode | 官方每日免费任务 / ZCode Start Plan | 保留已有校验+定时领用 |
| Loomy | 每日免费领取 + 8 项后台任务完成 API | 本次新增逐项自动执行、官方回查、防重启重复、活动目录 |
| Raccoon | 免费网页每日 GET + 一次性登录奖励 | 保留 rc88 的独立自动执行与回查 |
| WorkBuddy CN/Global（自有来源） | 每日签到、活动赠送、补偿积分 | 保留 rc86/88 的独立领取与回查；没有新增付费消耗 |
| 豆包（自有来源） | 每日签到；其他任务目前仅能查询 | 继续保留每日签到；不可直接 API 完成的其他任务排除 |
| Lingxi（自有来源） | 每日签到 | 保留 |
| Cline | 目前仅可查询 USD 账户余额，无可验证的免费完成接口 | 只读、不给不存在的任务发 POST |
| Gemini | 目前只能查询 5 小时／周额度窗口，不存在已验证单独领奖接口 | 自然恢复不算自动签到，不通过模型调用消耗额度 |
| MiMo/其他没有真实奖励 POST/GET 闭环的独立来源 | 可能自然恢复额度或暂无符合条件活动 | 原账号与限额功能保留，不冒充签到 |

## 测试及范围
- tests/loomy-rewards.test.mjs：8 项 10000 积分常量、精确 GET/POST、异常未完成不继续批量发、回执不重复、禁计费模型／购买／生成／发送／分享。
- tests/loomy-source-integration.test.mjs：双独立来源 16 个接口任务、原账号与赠送独立绑定、自动执行、跨重启去重、用户未启用时零 POST。
- tests/embedded-pack.test.mjs：通过私有账户池和 DSH Credentials 选择准确账号，不能访问其他账号或上传凭据。
- tests/channel-activities.test.mjs：Loomy 八任务按账号展示、到期时间不编造，Cline/Gemini 无活动空态及自然恢复说明。
- 所有外部状态、额度到账仍需要升级后用真实授权账号复核，模拟官方协议的测试通过不等于用户账号已经成功入账。本轮未改动当前生产插件或凭据。
