executor 值定了“谁负责”；在 Cursor 下，真把活跑起来用这些 **agent runtime 可用**机制，按可追踪性优先：

- **Task subagents** —— 默认并行派发方式。用 Task tool 启动（`generalPurpose` / `explore` / `shell` 等），把返回的 subagent id 记录为 handle。没有真实返回值，就不要把 board task 标成 `subagent` / `in_flight`。
- **后台 Shell** —— 适合长跑 shell 命令、watch loop、构建/测试、轮询外部谓词。用 Shell + `block_until_ms: 0`，后续 AwaitShell / notify_on_output；把 shell id、命令、工作目录、停止条件、recon 方法写进 board。不要把“我发起了命令”当完成，只有 session 退出并经端点验收后才折回 `done`。
- **外部 scheduler / CI job** —— 用 cron、systemd timer、GitHub Actions、CI scheduler、issue/PR bot 等承担 session 外工作。记录 run id / URL / 取消方式。

每个 `in_flight` task 必须有真实 handle。没有真实 handle，只能保持 `ready` / `blocked`，或标成 `external` 并写清 recon 方法。**不要**调用 Claude Code Workflow / CronCreate / ScheduleWakeup。
