Stop hook 会在有 `in_flight` 任务却无健康 watchdog 时提醒你 arm；只有带 nonblank `job_id` 且未过期的 canonical `watchdog` / legacy `wakeup` 才会静默这条提醒。
