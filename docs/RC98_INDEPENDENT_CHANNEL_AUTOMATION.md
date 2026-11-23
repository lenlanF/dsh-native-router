# rc.98 单渠道自动签到／免费活动：独立于全局，安全临时验收

## 需求与实机约束

用户明确指出，已有单渠道启停按钮，测试一个渠道时不应先开启所有渠道全局自动签到，应该只对一个渠道临时开启，验证其官方状态和免费到账后关闭。开发当时的实际安装为 rc96，匿名只读审计显示全局 autoEnabled=false、checkin.channels 未明确设置、10 个独立账号，未擅自改生产配置。

## 已复现的真实代码根因

- `createCheckinCenter.tick()` 在全局 `autoEnabled=false` 时无条件返回 disabled。
- 自有账号 `runActivities()` 和来源池 `configFor()`／`runFreeActivities()` 同样把全局关闭作为硬否决。
- UI 即使全局关闭仍将缺省的渠道状态显示成开启，活动页却说明所有渠道都不会运行。
- 如果直接忽略全局设置，旧配置里早已保存但不生效的 `checkin.channels[channel]=true` 会在升级时突然提交签到 POST，造成不经用户重新同意的自动执行。

## rc98 约束及实现

- 全局开启时仍保持旧规则：各渠道缺省开启，显式 channels[id]=false 则关闭。
- 全局关闭时 **必须同时满足** `checkin.channels[id]===true` 且 `checkin.independentChannels` 包含 id，才能独立运行。旧配置的 independentChannels 缺省为空，安全不触发。
- 在新版渠道开关打开时写入 channels[id]=true、独立授权 id；关闭时写入 channels[id]=false 并移除独立授权。未明确开启的其他渠道不执行，保存草稿后开关状态立即反馈。
- 自有账号仍须 autoCheckin=true，来源账号仍须 autoSourceAccounts=true，并须账号启用、Provider 启用、有真实签到执行器及相应免费活动可安全操作。
- 已确认的签到/到账不会重复 POST；请求不确定或需要验证码等用户交互，保持待确认或跳过；活动必须核对官方状态与账单证据。
- 按北京时间设定执行时间触发，来源渠道延续 10:05 / ZCode 19:00 的特殊活动窗口；手动逐渠道领取入口仍不受全局调度开关限制。

## 验收与限制

代码级复现已得到两个原本失败的测试，自有账号与来源池均实现单渠道独立运行、另一个渠道静默，以及恢复关闭后不发起新调用；新增 UI 实际勾选、保存、关闭、再保存的恢复测试。旧版 channels=true 无独立授权不触发。

2026-11-23 实际 Windows 验收：

- `npm.cmd test`：**803/803 PASS**；新版配置控制与 UI 保存还原专门测试也通过。
- `node tools/verify-embedded-layout.mjs`：Chrome 嵌入宽度 320/560/720/1024px 全部 **PASS**，无横向越界。
- `python tools/audit-public-tree.py` 与 `git diff --check`：**PASS**，未发现高置信度敏感信息与差异格式错误。
- `powershell.exe ... run-isolated-dsh-services.ps1 -ExistingHost/-SourcePool/-AgentLoop`：真实 DSH Cordis、LlmRuntime、WebServer、Connection、SourcePool、AgentLoop 合成账号与模型路径 **全部 PASS**，0 真实云端账号调用与凭据写入。
- `npm.cmd pack --ignore-scripts`：正式 `dsh-native-router-1.0.0-rc.98.tgz`，146 个文件，2,212,224 bytes，SHA256 `250a2d48bc9b3259edb929311ada083f163effcef1d954ffdc7805fea800d0fb`。
- `tools/verify-packed-distribution.ps1 -Version 1.0.0-rc.98`：从正式 tgz 独立安装 32 依赖，在 Windows `E:\\Temp` 以真实 DSH Host 验证加载/卸载、受保护 RPC、13 个独立适配器、宿主服务冲突防护及零真实账号调用，**PASS**。

**当前尚未做的生产云端验证**：已安装 rc96 不具备此修复；尚未在用户实际安装的 rc98 下临时开启某一个真实渠道、向真实官方渠道提交一次安全可领取活动、确认官方余额到账并恢复关闭。因此不能把模拟/合成服务端结果称为用户已经领取成功。正式测试必须先读取和备份原开关状态，成功/失败后均恢复，并且只在可证明免费、不要求人工操作、不会涉及付费模型调用的活动上提交一次；无可领取权益只报告官方查询状态。
