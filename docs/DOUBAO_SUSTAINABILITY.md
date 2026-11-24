# 豆包独立渠道可持续性评估（2026-11-25）

目标：独立授权、可长期补充的免费权益、确证的可用推理，且符合官方权益范围。登录成功、公开目录或第三方自述均不能替代生产验收。

## 官方权益边界

[豆包激励活动三期规则](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/incentive-campaign-rules/f7f2c423-c770-44e7-9be4-bd67a28f074e.html)：活动在官方 PC 双端开展，奖励仅限账号本人，规则明确限制非官方插件等参与。赠送额度不意味着获准通过第三方 API 使用；不得混同开放平台 API 与产品内权益。

## 公开开源方案筛选

| 来源 | 能力与限制 | 结论 |
| --- | --- | --- |
| [Agent2API issue 197](https://github.com/aimod-cc/Agent2API/issues/197) | 十月发布登录、目录、额度和领取实现；维护者十一月十三日确认调用暂不可用 | 不能作为稳定推理依据 |
| [Auto-Signin-Hub](https://github.com/Muverix/Auto-Signin-Hub) | 自述支持每日领取，未证明现行官方活动授权 | 不移植领取方案 |
| [dsh-connect-doubao](https://github.com/Wahwayhale/dsh-connect-doubao) | 自述有对话与额度读取；文档说明非官方接口、人工验证、无签到、模型身份验证限制 | 可参考状态分类，不能证明持续免费闭环 |
| [magpie-community/plugins](https://github.com/magpie-community/plugins) | 豆包工作通过桌面应用执行 | 不满足独立后台目标 |
| [dsweb-proxy](https://github.com/cv-superding/dsweb-proxy) | 自述网页对话转接，未证明 PC 赠额可用或获官方授权 | 不作为正式免费来源 |

结论：截至本次公开材料检索，未发现经过生产验收且符合官方权益边界的完整独立方案。既有账号及历史回执保留，PC 活动仅核查；不新增非官方领取或规避验证代码。待官方授权能力或可核验自然免费权益出现再评估。不得把开放平台付费方案冒充产品免费权益。
