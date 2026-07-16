kimi-code 下 watchdog 先是 board 里的 liveness 契约：记录“什么时候该回来 recon、回来查什么、超时如何处置”。它不等于已经存在一个 kimi-code-native 的 CronCreate/ScheduleWakeup 工具。需要自动唤醒时，降级到 background Bash-floor 或外部调度，并把句柄写进 board。
