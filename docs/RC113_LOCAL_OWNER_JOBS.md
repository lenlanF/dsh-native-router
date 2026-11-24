# 本机 Owner 验收任务（rc.113）

默认关闭。仅在本人明确授权时启用，以当前操作系统用户的私有目录作为权限边界；同一 OS 用户运行的其他进程具备同样权限，不要在不可信本机环境中启用。管理员不是隔离边界。无新增 HTTP 监听、无凭据读取、无任意命令执行。支持 inventory、catalog、free-models、channel-activity、all-channel-activity，仍由原插件执行器校验官方资格、账号绑定、重复领取和免费模型限制。

从已安装插件 package 目录运行：

```
node tools/local-owner-jobs-cli.mjs enable --consent
node tools/local-owner-jobs-cli.mjs submit catalog --consent
node tools/local-owner-jobs-cli.mjs status <requestId>
node tools/local-owner-jobs-cli.mjs revoke
```

默认定位本机用户标准 DSH 插件数据目录。非标准配置路径使用既有正式 DSH Connection 入口。每次提交明确 consent，过期拒绝执行，已消费 ID 不重复执行。complete 仅表示任务已结束，须逐渠道核对结果。禁止打印原始账号或认证资料；状态未知时不自动重发领取请求。
