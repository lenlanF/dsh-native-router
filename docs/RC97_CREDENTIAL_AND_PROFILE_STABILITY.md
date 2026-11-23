# rc.97 — 已安装 rc.96 后的真实问题核查与账号稳定性修复

## 一、生产安装的只读实况

2026-11-23 北京时间约 22:14，在当前项目绑定 Windows Runner 上执行
`node tools/audit-installed-state-readonly.mjs`；读取的是用户实际已安装的
`dsh-native-router@1.0.0-rc.96` 的配置、公开事实缓存、验证状态、签到和活动回执。
没有读取私密 Cookie、账号 ID、用户昵称明文或明细金额；没有向远端发模型请求、领奖 POST；
没有关闭/重启 DSH。

| 维度 | 匿名审计 |
|---|---|
| Provider / 账号 | 9 / 10，全启用，用户手工模型链 0 |
| 已保存可读名称 | 6/10（WorkBuddy CN/Global 4、MiMo 1、豆包 1） |
| 可读数值余额 | 8/10（MiMo、豆包没有官方可确认数值） |
| 已缓存余额单位 | Loomy 已恢复；CodeArts 数值仍缺官方可信单位 |
| 最近 15 分钟鉴权 | online 8，expired 2（MiMo、豆包） |
| 近期完整模型推理成功回执 | 0/10（缓存证据缺失，不代表绝对不能调用） |
| 当日签到/活动已核实到账 | 0 条；全局自动签到开关 `false` |

**注意**：上述 expired 为已安装 rc96 的缓存状态，不足以单独证明官方账户已撤销。
rc.97 并未偷偷打开全局自动任务，未触碰生产登录记录。

## 二、红→绿复现与代码修改

### 1. MiMo、豆包：本地凭据服务不可读不等于云端授权到期

- `tests/rc97-local-vault-vs-official-expiry.test.mjs` 先重现错误：模拟 DSH Vault
  读取暂时抛错，MiMo 和豆包的 `refreshAccountStatus` 都把本地异常误记为 expired；
  两项测试最初 **RED**。
- `src/channels/mimo-desktop.mjs`：只有官方会员会话探测明确报 expired / AUTH
  才判定失效。无法读取本地 Vault 返回 error，交由 Host 正常延迟复核；
  已缓存公开名称仍由原本的账号事实缓存保留。
- `src/channels/doubao.mjs`：先成功读取独立加密凭据后，官方 401 或会员 UID
  不一致才映射为 AUTH→expired；若在读取 DSH 凭据时出错，则返回 unavailable，
  不再伪造账号登录失效。官方真实 401 仍严格失效，不绕过服务端鉴权。
- 四个验收场景最终 **GREEN**：本地 Vault 双渠道故障不误判；两渠道官方真实拒绝仍过期。
  完整账号使用者无须为了本地临时错误反复扫码。

### 2. Lingxi：新增官方账户名称查询和 WPS/KDocs 双集群只读回退

- 独立 `own_lingxi` 此前只调用两个 read-only GET：`/credits/balance` 和
  `/tasks`，没有请求官方 `/api/public/v1/account/profile`，因此可能余额
  有数字却显示“账号名待获取”。
- 参考公开 MIT 项目
  [RobbsLuo/Coding2API — Lingxi client.py](https://github.com/RobbsLuo/Coding2API/blob/main/src/provider/lingxi/client.py)
  及其测试，确认官方账户资料接口返回 `data.id`、`data.name`，并且
  相同用户 Cookie 可能只在 `lingxi.wps.cn` 或 `lingxi.kdocs.cn` 其中一个集群有效。
- `src/channels/private-owned.mjs`：账号资料、余额、每日任务三个官方 GET
  并发、同一 9.5 秒总时限；模型目录独立 GET 同样支持两个已确认的第一方域名
  在 401/5xx/网络错误下进行**仅只读**回退；对 403/429 不绕过。HTTP200 但业务
  code 为未授权或失败，也不会采信账户名称、额度。官方姓名必须有合法 profile id；
  仅余额成功可确认对应绑定的官方访问有效，但不杜撰用户名；
  仅 profile 成功也不会杜撰积分或已签到。
- `tests/rc97-lingxi-official-profile.test.mjs` 覆盖官网资料、单集群 401 回退、
  模型目录同身份回退、profile 错误码伪造防护、资料独立失效与余额独立失效。
  测试里从未发起模型推理或活动 POST；真实云端账户最终成功与否还需要安装新版后官方读取得到确认。

### 3. CodeArts、ZCode、Loomy 等：从本插件独立账号池补齐公开账户名

- `src/embedded-pack.mjs` 的 `listAccounts` 以前仅取 `row.nickname`，
  对独立账号池官方保存的 `accountName`、`username` 等字段直接丢弃；
  当昵称是“账号1”或自动生成的账号 ID 时，列表仍显示空白。
- 改为通过现有 `publicAccountName(row)` 进行过滤和补齐，
  **不拷贝账号池凭据、不暴露密钥**，每条记录仍是 `connectionState:not_checked`；
  只能由后续官方身份读取得到在线证明，不能把列表名字当成远端认证。
- `tests/embedded-pack.test.mjs` 新增原昵称为“账号1”、真实 accountName 可公开
  但凭据引用必须隐藏的防回归测试，红→绿通过。
- 这不是杜撰 CodeArts 的余额单位：没有官方单位时仍保持“待核实”。

## 三、执行验收与遗留工作

- `npm.cmd test` 全套（包括 rc97 新增测试）；
- `node tools/verify-embedded-layout.mjs`（Chrome 嵌入设置 320/560/720/1024px）；
- `python tools/audit-public-tree.py` 与 `git diff --check`；
- 独立真实 DSH Cordis + LlmRuntime / SourcePool / AgentLoop 合成端到端；
- 正式 `npm.cmd pack --ignore-scripts` 和从真实 tgz 重新安装的
  `tools/verify-packed-distribution.ps1`。
已实际执行结果：

- `npm.cmd test`: **801/801 PASS**（包含所有新增失败→通过回归）；
- `node tools/verify-embedded-layout.mjs`: Chrome **320/560/720/1024 px 均 PASS**，无横向溢出；
- `python tools/audit-public-tree.py`、`git diff --check`：**PASS**；
- `run-isolated-dsh-services.ps1 -ExistingHost`：真实 Cordis/LlmRuntime/WebServer/Connection + 合成 Qoder Provider，完整 stream finish、认证 401 防护、零凭据修改，**PASS**；
- `run-isolated-dsh-services.ps1 -SourcePool`：隔离原生 AccountPool，双合成账号精确选择、限流不串号，**PASS**；
- `run-isolated-dsh-services.ps1 -AgentLoop`：真实 DSH AgentLoop/SessionStore/ToolsService 故障切换、同会话工具执行及继续，合成网络调用，**PASS**；
- `npm.cmd pack --ignore-scripts`：正式 `dsh-native-router-1.0.0-rc.97.tgz`，**145 个文件、约 2.2 MB**，精确大小与 SHA256 以最终发行包复核记录为准；
- 从正式 tgz 在 E:\\Temp 安装 32 个依赖，运行真实 DSH 22.16 插件挂载、私有来源包、受保护 RPC、冲突、卸载和无生产写入，**PASS**。


**验收边界：** 单测的官方 HTTP 响应由测试夹具产生，不能视为当前用户 Lingxi、
MiMo、豆包、CodeArts、Loomy 等账号在真实云端已返回成功。
已安装 rc96 今天真实全渠道模型成功和积分到账仍缺实账号证据；
这两个闭环继续保留为**未完成**，不把“账号已登录”“有余额”当作“模型已可用”。
用户的生产 DSH 和当前自动开关在构建 rc97 时保持不变。
