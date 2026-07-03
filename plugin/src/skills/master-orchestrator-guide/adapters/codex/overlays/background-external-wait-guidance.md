Codex agent runtime 可用后台 terminal session 等外部状态，但没有其他 harness 那种“后台 shell 完成后自动唤醒主线”的同名语义。等外部状态时，优先用可追踪后台 session；需要跨 session / 定时唤醒时，再用 scheduler：

```bash
# 由系统 cron / CI / systemd timer 等外部 scheduler 执行，用于跨 session watchdog
codex exec resume --last "cc-master watchdog: recon board, check <predicate>, update task handles"
```

同一 session 内的长跑命令记录后台 session id；跨 session 的 watchdog 记录 scheduler 名称、命令、run id、取消方式和 checklist。也可以在 Codex app 里创建 thread automation，让当前 thread 按分钟/每日/每周 cadence 醒来检查；但只有当前环境真实提供时才依赖它。不要只写“稍后回来”。
