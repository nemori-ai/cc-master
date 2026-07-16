取消 watchdog 时，同时取消真实机制：删 cron / 停 CI schedule / 停 systemd timer / 停 后台 Bash 任务（按 Bash 任务 id）。只改 board 不停真实机制，会留下重复唤醒和误报。
