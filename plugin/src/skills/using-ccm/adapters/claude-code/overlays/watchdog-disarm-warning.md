**只做一件是错的：** 只 CronDelete 不 disarm，hook 仍以为有 watchdog armed（不再提醒），但任务也不会再 fire；只 disarm 不 CronDelete，外部调度任务还在，到点唤醒但 board 已无 wakeup 对象，徒增噪声。
