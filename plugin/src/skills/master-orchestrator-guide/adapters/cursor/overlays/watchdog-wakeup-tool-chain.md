1. **后台 Shell（universal floor）** —— 适合同一 session 内的长跑 shell / watch loop：Shell + `block_until_ms: 0`，拿 shell id，后续 AwaitShell；board `wakeup` 记录 shell id、命令、工作目录、predicate、取消方式。
2. **外部 scheduler + 手动/脚本 recon** —— cron、systemd timer、CI scheduler 等提示回来 recon board、检查 predicate、更新 task。适合跨 session 无人值守，但这是外部调度，不是 Cursor-native in-thread timer。
3. **manual recon（诚实兜底）** —— 没有真实 wakeup handle 时，把 watchdog 写成 board 里的可续约定：下一次检查时间、predicate、负责人、取消条件。不要伪造 CronCreate / ScheduleWakeup。
