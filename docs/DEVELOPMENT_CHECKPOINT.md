# 开发续跑检查点

此处记录工程证据和可复用方法，生产状态每轮重新读取。

## rc.116 工作线

- 完整退役渠道实现保留 archive/doubao-channel。主线继续其他渠道真实验收，禁止未经确认将退役渠道恢复到自动免费池。
- rc.115 已合并 main。生产仍需升级并核验 Amazon Quick、Buddy、Loomy、LobsterAI；每次修复经 CI 后合并 main。

## rc.115 工作线

- rc.114 双平台 CI 通过并合并 main。生产 rc.113 的本机 Owner 任务已实际执行当日全渠道活动并撤销临时委托；CodeArts、Lingxi、TRAE、Raccoon、WorkBuddy 国内取得确认记录，Raccoon 新增官方账单积分证明。实际生产状态仍须重新审计。
- Buddy 官方状态契约已修，LobsterAI 槽位读取安全分类已补齐，Loomy 每日额度回查支持同周期正常消耗；三者仍需新版生产验收。
- 豆包当前活动规则限制电脑版参与并禁止第三方插件代领；不重复发送受拒绝的领取请求。保留官方账号任务状态及额度只读回查，官方端待处理独立统计。仅在官方提供明确支持的自动化渠道后才扩展自动领取。
- 后续：读取实际安装版本，通过已授权后台入口复验 Amazon Quick 自有目录、Buddy 与 LobsterAI 官方活动、Loomy 每日额度证明及尚未完成的免费推理；不重复领取当天已确认权益，不以自动化回归代替生产证据。

## rc.114 工作线

- rc.113 已合并 main；真实生产的本机 Owner 任务入口已验证，采用 catalog、inventory、指定渠道 free-models 与 channel-activity，无需桌面界面；临时授权在任务后撤销。每次生产仍重新审计。
- 已实际核验 WorkBuddy 国内、国际及 Loomy 的免费模型调用。WorkBuddy 部分请求 OUTPUT_LIMIT，rc.114 仅对已严格确认官方免费的 WorkBuddy 提高验收上限至128，不自动重试收费模型。
- Amazon Quick 账号所有权表遗漏已修，仍需真实复验授权及目录；Loomy 每日初始化待确认，LobsterAI 真实失败定位 LOBSTER_SLOT_READ。不要把历史到账重新计入新增，勿重复提交。

## rc.113 工作线

- rc.112 已合并 main，已有模型路由管理分离自有和外部只读目录，865 项回归通过。
- 生产安装版本、账号状态、余额、额度、近期模型证明必须通过只读审计重新读取；历史生产计数不写入公开仓库。
- 已确认领取的活动保留原始回执，不重复提交。Loomy 每日额度与 LobsterAI 固定失败阶段仍须生产复验。
- rc.113 新增默认关闭的本机 Owner 委托入口，沿用授权验收服务，不新增监听端口、不读取 DSH Cookie 或密钥；开发测试与生产授权严格分开。
- 下一步：运行只读审计确认生产版本；通过已授权的管理入口逐渠道查目录，记录官方模型数及免费候选，仅对官方零费率且资格明确的模型做最小真实推理；执行 Loomy/LobsterAI 官方活动并回查。未加载新版或未授权委托时保留未验收事项。
- 已验证命令：`node tools/audit-installed-state-readonly.mjs`、`npm test`、`node tools/verify-embedded-layout.mjs`、`npm pack --ignore-scripts`、`python tools/audit-public-tree.py`、`tools/verify-packed-distribution.ps1 -Version <version>`（按脚本使用独立临时目录）。
