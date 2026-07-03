取消 watchdog 时，同时取消真实机制：删 cron / 停 CI schedule / 停 systemd timer / 关闭 Codex automation / 停 background terminal。只改 board 不停真实机制，会留下重复唤醒和误报。
