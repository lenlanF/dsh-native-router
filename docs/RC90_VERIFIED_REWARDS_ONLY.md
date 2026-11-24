> 历史版本记录（非当前支持范围）：rc.116 起退役渠道及其专属实现、测试均已独立归档；下列历史验收内容不得作为当前版本的接入或执行说明。

# RC.90 — 严格按真实官方积分到账证据展示渠道活动

## 目标与不可妥协的范围
本次正式活动页不再承载未经核实的活动宣传清单。任务存在、接口可调用、账号已登录、签到成功、领取 POST 返回 200、服务端 `claimed:true`、模拟测试通过或额度自动恢复，**均不得单独证明某一笔奖励已到账**。不需要人工可感操作、不消费额度、无付费或购买的免费接口才允许尝试领取，且**没有明确到账证据的任务不展示**。

## 全渠道兼容政策
- 已内置的十个每日免费来源（CodeArts/Buddy/LobsterAI/Qoder/QoderCN/Trae/Loomy/Raccoon/MiniMax/ZCode）、独立 WorkBuddy CN/Global、Lingxi、豆包等原有签到执行功能保持不变，活动页不凭 `checkinSupported` 或 `checkinState=success` 推算奖励。任务回执仍留在每日积分任务中心供排错。
- **Raccoon 每日积分**：仅使用确切账号登录状态 + 官方正数 `todayCredit` + 账单 `todayCheckedIn` 的同日组合出具 `official_daily_grant_bill` 证明；隔天失效，一次性登录任务仅有 claimed 而无账单时不可显示。
- **Loomy 八项新手任务**：官方 GET `/onboarding/tasks` 的 `claimed` 仅证明任务状态。必须再有官方钱包 `/points/records` 领取前后余额精确增加该任务的正积分，才向持久回执写入 `proof=official_wallet_delta` 与核验时点。钱包不能读取、未增额或 POST 结果不明则本轮立即停止，任务不显示，也不会重发。此前没有领取前余额的旧回执不能事后伪造到账证明。
- **WorkBuddy 独立赠送与补偿**：`claimed:true` 之外同样严格读取官方积分包总余额，只有本笔活动领取前后余额正增量恰等于官方 `credit_num`，才标记 `official_wallet_delta` 证明并显示。网络断流的旧回执仅在保留领取前余额、重新 GET claimed 与钱包增额吻合时结清；未到账继续隐藏。
- **Cline、Gemini、MiMo 等**：官方额度自然恢复、账户余额查询及模型可调用不构成积分活动；未取得正数官方到账事件，页面只保留渠道空表，不列活动或理论积分。

## 证明的隐私及防重复属性
持久哈希回执使用渠道+账号+凭据引用+任务种类+积分/到期信息绑定，领取请求之前写入 `baselineBalance` 及任务哈希；新核验的 `proof`、`verifiedAt` 仅存放在本机 `reward-claims.json`，不存储凭据正文。官方回查仅经本插件当前登录账号进行，不利用旧宿主私有资料替代在线核验。支持跨重启恢复，旧确认记录缺少钱包对照证明时继续不可见，不能为了填充 UI 迁移成“已到账”。

## 验收证据分级
| 级别 | 条件 | 是否在「渠道活动」页展示 |
|---|---|---|
| 任务发现 | 官方任务可领取、标称奖励存在 | 否 |
| 领取提交 | 官方返回已接受、POST 200/claimed:true | 否 |
| 已确认到账 | **确切账号 + 官方任务已完成 + 官方积分账单或精确钱包正增量** | 是 |
| 不可核实 | 401/超时/连接失败/官方缺少账单或领取失败 | 否 |

## 真实环境边界
真实在线验收必须通过已认证的 DSH Owner 会话访问最新安装版本与该版本的积分任务流程；不允许用历史签到、模拟官方接口或绕过 401 的方法来冒充验收。安装版本不符合新版本或自动开关关闭时，不擅自修改生产 DSH、凭据、自动执行开关、Host 或后台进程。上述情况如实标记未完成；升级后的真实账号验证只能在授权运行环境可访问时执行。

## 自动化验收
- tests/reward-proof-end-to-end.test.mjs：Raccoon 确认账单在 source/owner/catalog 间传递；WorkBuddy 任务 claimed 但没有钱包证明时隐藏。
- tests/loomy-rewards.test.mjs、tests/loomy-source-integration.test.mjs：官方任务状态与 `/points/records` 钱包前后精确变动，八项独立积分、不可达钱包零 POST、待确认跨重启不重复。
- tests/workbuddy-vault-independent.test.mjs：官方领取标志但钱包未变化时不显示；官方 503 后真实增额对账恢复。
- tests/channel-activities.test.mjs：所有未核实奖励、过期奖励、错渠道奖励、无效时间戳及跨北京时间日签到隐藏；仅正数到账证明进表。
- tests/ui-panels.test.mjs：每渠道独立空表和官方回查展示。
- 发布前执行全量 npm test、公开源码隐私审计、Windows 和 Ubuntu CI、npm pack 与凭据特征扫描。
