Codex 下尤其要防“纸面 disarm”：如果 watchdog 记录的是外部 scheduler 或 Codex automation，`ccm watchdog disarm` 只更新 board，不保证外部机制已停。每次 disarm 都要同步处理真实 scheduler，并在 log 里写清结果。
