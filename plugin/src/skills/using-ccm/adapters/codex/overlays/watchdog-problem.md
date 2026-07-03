Codex 下 watchdog 先是 board 里的 liveness 契约：记录“什么时候该回来 recon、回来查什么、超时如何处置”。它不等于已经存在一个 Codex-native 的同名 wakeup/cron agent 工具。需要自动唤醒时，必须选择当前 host 真实可用的外部机制，并把句柄写进 board。
