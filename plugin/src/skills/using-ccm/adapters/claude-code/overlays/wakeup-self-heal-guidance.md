如果 board 有 `wakeup` 但 `fire_at` 已过期（比现在早），Stop hook 会把它当「未 armed」处理，重新提醒你 arm。这是对「arm 后忘了退役」的自愈机制。
