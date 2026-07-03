**清掉对应 wakeup handle**：若是后台 terminal session，就停止/确认退出并记录 exit；若是外部 scheduler，就禁用 cron/systemd/CI job；若是 Codex app automation，就停止或更新 automation；若没有真实 handle，就不要写成已 armed；
