Codex 没有经过 cc-master 验证的 background-shell `until` 派发语义。你可以在普通 shell 里启动外部 watcher，但那只是外部调度的一种实现：必须把 PID、日志、取消命令和检查项写进 board，且不要依赖它向当前 Codex thread 自动回注结果。
