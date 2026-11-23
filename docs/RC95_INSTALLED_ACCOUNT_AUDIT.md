# rc.95 · 已安装 rc.94 的真实运行审计与账号信息闭环

## 证据边界
本报告依据 2026-11-23 本机 `DeepSeek Harness` 已安装 `dsh-native-router@1.0.0-rc.94` 的匿名化状态、公开账号事实缓存、账号验证状态、签到历史与活动回执作**只读核查**。没有读取或打印完整账号标识、私密昵称、Cookie、密钥、Token、账号金额；没有主动发起模型收费调用或奖励领取。全局设置未做任何修改。安装状态不等于当前 GitHub 主分支的最新代码。

## 生产 rc.94 实况

| 项目 | 安全读取得到的结果 | 可信含义 |
|---|---|---|
| 已安装包 | 1.0.0-rc.94，文件在本机 DSH profiles/desktop 下；DSH 进程在安装后启动 | 已安装包版本是真实信息；不等于已经完成云端验收 |
| Provider / 自有账号 | 9 / 10；WorkBuddy CN 2、Global 2；Lingxi、Loomy、ZCode、CodeArts、MiMo、豆包各 1 | 配置计数，**不是十个成功模型回复** |
| 已缓存真实账号名称 | 6/10（WorkBuddy 4、MiMo 1、豆包 1） | Lingxi、Loomy、ZCode、CodeArts 缺少公开姓名；不可由账号 ID 或“账号1”代替 |
| 已缓存可用余额数值 | 8/10（MiMo、豆包未返回可核对数值） | Loomy 和 CodeArts 数值没有可信单位；不能默认为积分 |
| 身份验证缓存 | 10 个账号均存在近期 online 认证状态 | 只表示已完成近期身份探测；和**正式 DSH 模型回复**、余额到账是不同证据 |
| 当前 24 小时真实模型推理 | 账号验证缓存无足够近的模型成功证明 | 之前的 Host smoke 中部分频道曾真实回复，但不能算作本次 rc.94 端到端实测 |
| 全局自动签到与活动 | `checkin.autoEnabled=false` | 即便渠道及账号单独开启，也**绝不会运行定时签到/活动**；手动操作另计 |
| 今日签到历史 | 无新记录 | 没有 rc.94 新增真实签到成功证据 |
| 持久活动回执 | reward-claims.json 不存在 | 当前无可核实的 rc.94 新增活动真实领取或已到账回执 |
| 手动模型链 | 0 条 | 已安装账号与直接 Provider 不等于用户已配置模型链 |

## 本轮修复（与真实缺口一一对应）

1. **自有来源账号名字**：`src/source-channel-driver.mjs` 从同一身份、同一来源池、经过官方远程状态认证的精确账号项补齐安全昵称；优先官方账号身份、不允许未认证来源、不使用“账号1”一类人工序号。对 Loomy、ZCode、CodeArts 等原本无公开姓名的账号，只在自有池确实存在安全名称时改善，**不能保证渠道本身没返回姓名时就造出来**。
2. **WorkBuddy 今日免费资格只读可见**：`src/channels/workbuddy.mjs` 在账号资料刷新过程中并行调用原有官方 `dailyStatus`，缓存当日 `claimable/claimed/not_offered` 资格和查询时间；`src/account-center.mjs` 只转发 15 分钟内的明确信号。官方资格为可领取时可以在 rc.94 的活动中心显示 `valid`，绝不直接算 `completed`，也不触发签到 POST。
3. **Loomy 多包余额单位**：`src/source-account-facts.mjs` 只有所有官方包的单位一致、正当剩余额合计与官方账号已返回的总余额完全一致，才从完整官方包账本恢复缺失单位；混合单位、缺数据、总额不一致仍按单位未知展示。CodeArts 不强行标成积分。
4. **UI 真实状态说明**：`client.js` 按 UI UX Pro Max 指导，免费活动页明显区分官方“可领取”与“已到账”证据；全局自动活动关闭时明确显示原因、自动范围与手动可用性；签到管理同步提示；余额无单位时不省略状态，而是标注单位待核实。
5. **可重复只读诊断**：`node tools/audit-installed-state-readonly.mjs` 仅访问 `.dsh/plugins/dsh-native-router` 的配置、公开事实、认证状态、签到/哈希回执，以及安装包版本。输出匿名渠道计数、缺失数、证据日期及自动开关；无外网、无账户姓名／数字余额／token，不修改任何文件。`tests/rc95-installed-audit.test.mjs` 通过模拟生产树、字段绑定隔离和原始文件字节对比断言零写入。
6. **红绿测试**：`tests/rc95-account-facts-activity-preflight.test.mjs` 重现并修复来源名字丢失、官方名字优先和无资格不伪造，以及 WorkBuddy 官方资格从账号刷新贯通到活动中心但不写入奖励；`tests/source-account-facts.test.mjs` 新增单位多包对账情况。

## 仍需真实云端继续验收
- **目前不应自动开启生产全局自动签到**：该开关是用户明确设置的 false；代码不会改写。未经用户授权，不执行任何付费模型、用户可见创作任务、花费积分或参与抽奖。
- 按真实账号逐渠道核对官方账号名及余额；MiMo/Doubao 的官方额度响应、Loomy/CodeArts 当前单位，只有真实官方响应能消除缺口。
- WorkBuddy CN 的成长中心和豆包额外活动虽然通过官方协议参考及模拟端到端测试，**当前用户真实账号没有新的领取/到账回执**。要持续寻找有效资格并用安全授权账单核实。
- 模型推理：需要在明确零费用/获赠额度且预算上限明确的账号下再执行正式 DSH Host 真实调用、检验完整结束事件；本轮本机状态只读核查不能替代这一点。

## 验收
必须运行全量 `npm.cmd test`、Windows Chrome 嵌入布局校验、`python tools/audit-public-tree.py`、隔离 Host 源通道真实 runtime 集成、pack tar 清单校验与 GitHub Windows/Ubuntu CI；任何结果仅以实际命令输出为准。
本地独立 DSH Host 集成脚本 `node tools/verify-existing-dsh-host-channels.mjs` 本轮已经尝试，但项目工作树没有 `@deepseek-ai/cordis` 等 DSH Host peerDependencies，直接报 `ERR_MODULE_NOT_FOUND`。该命令**未通过，因此不计入已验收项**；公开 npm registry 查到的 `@deepseek-ai/dsh-llm@0.0.1-rc.1` 也不满足本项目要求 `>=0.2.0-rc.2`。本轮已通过真实代码单测和 Chrome UI，不把缺依赖的宿主验证说成成功。后续在兼容 DSH Host SDK 的隔离环境继续验证；不触碰当前已安装插件。
