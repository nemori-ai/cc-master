executor 值定了“谁负责”；在 Codex 下，真把活跑起来用这些 **agent runtime 可用**机制，按可追踪性优先：

- **Codex subagents / parallel agents** —— 默认并行派发方式。明确要求 Codex spawn subagents，并说明拆分方式、是否等待全部结果、每个 subagent 要返回什么 artifact / summary。记录 agent id / thread / run 引用作 handle。
- **后台 terminal session** —— 适合长跑 shell 命令、watch loop、构建/测试、轮询外部谓词。Codex agent runtime 已验证能启动后台 shell 并返回 session id，后续可 poll 输出与退出码；把 session id、命令、工作目录、停止条件、recon 方法写进 board。不要把“我发起了命令”当完成，只有 session 退出并经端点验收后才折回 `done`。
- **Codex cloud task** —— 用 `codex cloud exec` 把独立工作 offload 到 Codex Cloud；用 `codex cloud list/status/diff/apply` recon。记录 cloud task id / env id / prompt 摘要。
- **外部 scheduler / CI job** —— 用 cron、systemd timer、GitHub Actions、CI scheduler、issue/PR bot 等承担 session 外工作。记录 run id / URL / 取消方式。
- **Codex app thread automation** —— 官方支持 attached-to-thread 的 heartbeat wake-up；适合长命令检查、轮询 GitHub/Slack、继续 review loop。当前 agent runtime / CLI 没有稳定 automation 创建命令，所以只有当当前环境已经提供或用户能配置它时才把它作为 wakeup handle；不要伪造成 agent 可直接调用的 CLI primitive。

每个 `in_flight` task 必须有真实 handle。没有真实 handle，只能保持 `ready` / `blocked`，或标成 `external` 并写清 recon 方法。
