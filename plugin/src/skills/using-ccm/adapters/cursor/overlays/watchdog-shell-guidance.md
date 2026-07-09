Cursor 没有 CronCreate / ScheduleWakeup。你可以启动 background Shell（`block_until_ms: 0`）做 until 轮询，但必须把 shell id、日志、取消命令和检查项写进 board，且不要依赖它向当前 Cursor thread 自动回注 Claude 式 task-notification。
