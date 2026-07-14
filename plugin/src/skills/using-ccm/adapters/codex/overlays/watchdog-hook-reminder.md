Codex hook 可以在 Stop / SessionStart 等事件里注入提醒；只有带 nonblank `job_id` 且未过期的 canonical `watchdog` / legacy `wakeup` 才算健康并静默提醒。hook 不能凭空创建未来唤醒：不要把提醒当成 durable timer，它只能在 Codex 再次触发相关事件时发声。
