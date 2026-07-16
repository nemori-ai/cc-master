如果 board 有 `wakeup` 但 `fire_at` 已过期（比现在早），kimi-code Stop hook / recon 会把它当「未 armed」处理，重新提醒你选择真实可用的 wakeup handle。这是对「arm 后忘了退役」的自愈机制。
