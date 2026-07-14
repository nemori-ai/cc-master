**只做一件是错的：** 只 CronDelete 不 disarm，board 里仍有 nonblank handle + future `fire_at` 时读侧仍会认为 healthy，但任务不会再 fire；只 disarm 不 CronDelete，外部调度任务还在，到点唤醒但 board 已无 watchdog / legacy wakeup 字段，徒增噪声。
