# RC.26：MiMo 与豆包工作独立来源

## 交付原则（2026-11-20 的明确要求）

目标是**可工作的、原生、自有凭据的渠道**，不能因为某个参考仓库的一条路线有限制便认定技术上所有路线不可行。持续搜寻 GitHub/Gitee 的替代实现、同步有用的 upstream 更新；没有成熟实现时在安全与兼容范围内自行实现、测试，再做实际账号验收。研究结论不是交付，真实推理、授权续期、原插件停用后的独立运行才是交付标准。

## MiMo：多路并行、不能只认定一种

1. 官方开放平台 API Key / Token Plan：`own_mimo` 独立凭据、显式密钥接入、`MIMO_API_KEY`/`MIMO_BASE_URL` 环境变量（需用户确认后复制到私有凭据库）、本机 `auth.json` 授权复制、模型枚举、OpenAI 兼容流式推理；桌面端关闭后仍能使用（前提是官方密钥有效）。2. 桌面 SSO 引擎：独立发现官方 `Xiaomi MiMo.exe` 及随机端口，为聚合路由创建隔离标签的短期本机令牌；只触发于显式候选接管，依赖官方桌面客户端运行，不依赖原 DSH MiMo 插件。
3. 自主 SSO/Passport、桌面会话安全转移/续期：**开放路线，尚待基于新开源或官方协议继续自研和真实验证**，不能以某个插件的“关闭客户端后失效”当作其它方案都无效的证明。

来源：`guiling875/dsh-mimo-connect`（MIT），独立派生实现保留在 `src/channels/mimo-engine.mjs`、`src/channels/mimo.mjs`，`LICENSES/dsh-mimo-connect-MIT.txt`。

## 豆包工作：从原插件分离

`own_doubao`：独立 Chromium 扫码登录（一次性临时 profile / CDP）或显式粘贴 Cookie，各账号独立保存在 DSH Credentials；不读取原插件数据。账号官方身份、动态普通聊天模型、会员套餐/活动窗口余额、SSE 流、会话连续性与本插件账号退出由自有驱动处理；`window_type=4` 代表新版套餐额度。原插件卸载不应影响已接管的 Cookie。

源代码使用 `hulibuld/dsh-get-it-for-free` 3.5.0 MIT 来源 `src/doubao/client.js` 与 `src/doubao/login.js`（衍生实现见 `src/channels/doubao-upstream.mjs`、`src/channels/doubao-login.mjs`，许可证见 `LICENSES/dsh-get-it-for-free-MIT.txt`）。交叉参考 `Wahwayhale/dsh-connect-doubao` 的多轮、动态目录、额度修复，以及 `ProvidersPlugin/Agent2Providers`，不会直接引入他们的运行依赖。

**未通过真实执行验收：** 豆包工作任务所需的本地执行器和真正的 Tool Calls 不能用“伪成功”模拟，故当前只暴露普通聊天模型。官方活动网页会话可能无法领取签到任务；当前驱动能回查已完成状态，未领取的桌面客户端限制返回 `client_required`，不得称成功。下一阶段继续找可用官方客户端上下文或安全自研方案，达到真实领奖后才开启自动化。

## 实际验收记录与后续检查

- 2026-11-20 本机 Windows `mimoDesktopProcessCount=0`；缺少能在当前隔离环境中使用的真实用户授权，**尚未执行真实 MiMo 或豆包在线推理/扫码全链路**。这不是放弃；必须保留替代实现方向并继续实测。
- 可复现模拟：`node --test tests/mimo-native.test.mjs tests/doubao-native.test.mjs`；项目完整 `npm test`。模拟通过不等于官方服务验收。
- 发行前逐项验证：实号登录、真实模型请求、SSE/Tool Calls、双账号隔离、客户端关闭/重启、刷新和撤销、套餐额度、签到回执、旧 DSH 原插件停用/卸载后的独立运行，隐私/许可证审计。每项均标代码通过 / 离线模拟 / 真实在线通过三个层次。
- 不启动额外网关、常驻 Node 子进程或独立定时服务；只能在用户显式授权时启动一次性的独立登录浏览器。
