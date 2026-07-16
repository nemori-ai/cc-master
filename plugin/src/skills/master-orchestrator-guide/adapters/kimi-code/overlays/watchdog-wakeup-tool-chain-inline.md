后台 Bash → 外部 scheduler + 手动 recon → manual recon；每档先拿真实 handle 再 arm，没有 handle 就记 blocked / recon 状态、不要伪造 CronCreate/ScheduleWakeup
