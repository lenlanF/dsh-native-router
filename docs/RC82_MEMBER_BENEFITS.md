# RC.82 — 账号事实、积分账本、自然恢复与活动领取综合验收

## 生产实况（原 Windows 实机只读）
生产 rc.81 已保存 8 Provider / 10 个账号：Lingxi、WorkBuddy CN 2、Global 2、Loomy、ZCode、CodeArts、MiMo、豆包；仅 Lingxi 的静态 config 具有昵称，其余所有账号需从官方实时 API 获取。10/10 身份缓存在线并非真实额度及推理验收。本轮不修改生产账号、宿主、费用或默认关闭的自动签到。

## 接入官方服务，完全使用插件自有凭据
- WorkBuddy：对照本机已安装的 dsh-connect-workbuddy v5.24.14 与 MIT 仓库 dingminhua/dsh-connect-workbuddy 源码，新增真实个人昵称、个人周期剩余积分及赠送包、企业已用额度差额。国内 billing 使用 www.codebuddy.cn，全球限定已签名授权品牌域。独立使用自有凭据、续期 UID/UIN/企业信息。先读官方 compensation-status 与 check-gift-claimed，仅对 active=true 且 claimed=false 的活动发送 claim-compensation/claim-gift，随后再次读取实际 claimed，结果不确定不重复。活动自动领取只在用户开启全局且对应账号自动签到时运行；默认不开启。
- MiMo Desktop：根据 magpie-community/plugins 的 MiMo 独立实现，增加同源 SSO 的 GET /api/user/usage，读取自然恢复的七日额度剩余百分比和 resetDate；与 Desktop 订阅、商业 API Token Plan 严格分账，即使订阅 current=null 也不会掩盖真实自然免费额度；仅有合法 resetDate 时才给出百分比，0% 是官方明确的实际用尽。
- 豆包：保留官网会员订阅的套餐、5小时、周及赠送额度分账（不能相加）；账号资料刷新时只读查活动组及每日签到实际状态，只有 checkedInToday=false 才尝试领取；网页需人工验证或网关拒绝、状态不明确则停止自动重试；回查已签到后才能标记成功。
- 其他来源通道：增强身份、个人资料多层只读白名单和明确剩余/可用/积分字段。不同单位不混加；含糊的 total 不当作余额。不触碰用户原有渠道插件进程或私有账号文件。

## 实际验收边界
源代码、官方协议 mock、真实独立 Cordis Host 以及原 DSH 自带 Node 的物理包验证是研发验收。当前没有 Owner 权限的真实 DSH 管理页会话，故不能冒称已读取用户十个账号的实时积分或在生产实际领取活动。未知费率模型调用零次。用户后续只从合并后的 main 手动升级，本次不直接部署。
参考项目 https://github.com/dingminhua/dsh-connect-workbuddy 及 https://github.com/magpie-community/plugins/tree/main/packages/mimo。