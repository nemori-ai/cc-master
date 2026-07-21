---
"ccm": minor
---

kimi usage collector 主动刷新短命 access_token:过期时在跨进程 advisory 锁内重读凭证(并发赢家使本次成为 no-op)、仅当仍过期才用 refresh_token 换新并原子写回(temp+rename·保留 0600),使 kimi usage 在多 session 并发下可靠可读。token 只在内存、绝不进日志/输出。auto-refresh 是优化:失败时无损回退到既有 expired-recovery hint(`kimi -p 'hi'`·agent_authorized)——hint 据存储凭证原始态导出。`CCM_KIMI_AUTO_REFRESH=0` 逃生阀退回旧只读行为。
