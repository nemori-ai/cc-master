1. **后台 Bash 任务（universal floor）** —— 适合同一 session 内的长跑 shell / watch loop：Bash 后台任务，拿真实 task id，后续轮询任务输出；再用 `--mechanism shell --job-id <task-id>` arm，并把命令、工作目录、predicate、取消方式写入 checklist。
2. **外部 scheduler + 手动/脚本 recon** —— cron、systemd timer、CI scheduler 等提示回来 recon board、检查 predicate、更新 task。创建成功并拿 scheduler id / run URL 后，用 `--mechanism cron --job-id <handle>` arm。适合跨 session 无人值守，但这是外部调度，不是 kimi-code-native in-thread timer。
3. **manual recon（诚实兜底）** —— 没有真实 wakeup handle 时，**不要 arm watchdog**；把下一次检查时间、predicate、负责人、取消条件记进 blocked / recon 状态与 log。不要伪造 CronCreate / ScheduleWakeup。
