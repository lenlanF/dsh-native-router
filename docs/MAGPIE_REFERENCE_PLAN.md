# Magpie 参考实现与移植清单

参考仓库：https://github.com/magpie-community/plugins ，MIT，实际阅读提交 `3feae3425239c2ed01bd8b2f745bd7dec911bf51`；枚举 116 个 packages 子目录。只参考代码和协议，不引入宿主运行依赖。上游 README 声明不是本插件真实验收证据。

| 参考目录 | 本轮所见 | 本插件处理及下一动作 |
| --- | --- | --- |
| packages/codearts | current/user 签名 GET、IAM 用户资料；CodeArts 与 OfficeAce 分离授权 | rc.147 已移植 current/user，自有账号正常授权刷新待验；OfficeAce 独立渠道候选，需单独核实权益与正常授权，不共用一次性刷新凭据 |
| packages/raccoon | available_points 与 daily_points 区分，账单窗口；README 描述余额接口不可用时的资料回退 | rc.147 每日积分接入赠送钱包，不猜测未知分项；后续评估回退与真实余额，只在授权范围内读取，注意资料接口可能触发日常赠送，不把它当纯读验收 |
| packages/workbuddy | 双区目录、明确免费模型开关、额度窗口及增长活动 | 已有双区和成长任务；进一步对比免费模型窗口、授权状态、钱包字段；不把社区估算上限当官方额度，不使用非零费率推理测试证明免费 |
| packages/loomy | 双钱包、官方每日额度/余额与过期、短信登录 | 已有独立渠道；继续对照响应解析及真实流异常，确认每日额度和永久余额分别展示。参考实现允许永久余额回退，不符合本项目免费限定，不移植该回退 |
| packages/zcode | Coding Plan 登录、独立 Trial 命名、赠送与付费区分 | 仅借鉴权益隔离原则；历史 Start Plan 仅官方客户端限制仍有效，不能把社区实现当作允许转接的证明；寻找官方授权的独立免费路线 |
| packages/mimo | 小米账号 SSO、七日额度、订阅与额度 | 已有对应独立渠道；对比正常授权刷新、可用权益接口和自然恢复窗口；不把独立订阅、活动或商业 API 混同 |
| packages/trae | CN/Global 分服务，模型、额度及日签到相关测试 | 评估分别注册与官方地域账号一致性，不能把同名模型目录混用 |
| packages/qoder | Global/CN/Team 和 QwenWork 独立入口、目录、签到及错误测试 | 对比现有 Qoder/Qoder CN/QwenWork 的授权主体、目录和额度；Team/Enterprise 不假定可免费接入 |
| packages/free-tokens | 第三方活动索引，本机读取且有专门授权 | 作为人工发现线索；不复制其数据源分发权，不作为可自动领取或免费调用证据 |
| packages/page-model-quota | 跨渠道额度窗口聚合 | 借鉴统一视图，官方剩余与估算分别展示，不虚构 token 余额 |

优先级：先完成已安装自有渠道的身份、官方额度和真实推理，其次新增具有明确授权和稳定免费额度的来源。每项移植遵循 MIT 许可、正常授权、确切账号绑定、非收费测试、活动幂等和证据边界。仅枚举未逐一审查其余插件目录，不将候选列为已接入。
