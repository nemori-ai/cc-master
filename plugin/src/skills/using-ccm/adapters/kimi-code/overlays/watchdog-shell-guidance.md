kimi-code 没有 CronCreate / ScheduleWakeup。你可以启动 background Bash 后台任务做 until 轮询，但必须把 Bash 任务 id、日志、取消命令和检查项写进 board，且不要依赖它向当前 kimi-code thread 自动回注 Claude 式 task-notification。
