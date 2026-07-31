---
point: board.worked-example
---

## 权威陈述

<!-- ccm:k:start point:board.worked-example -->
```json
{
  "schema": "cc-master/v2",
  "meta": { "template_version": 1 },
  "goal": "Internationalize the app to 6 locales (i18n framework + per-locale translation + locale routing)",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30:00Z" },
  "git": { "worktree": "/repo/.worktrees/i18n", "branch": "feat/i18n-rollout" },
  "wip_limit": 4,
  "num_account": 1,
  "watchdog": {
    "armed_at": "2026-06-05T12:30:00Z", "fire_at": "2026-06-05T13:15:00Z", "mechanism": "cron", "job_id": "cron-9f",
    "checklist": ["recon T1 handle vs git/工具结果（phantom?）", "T1 过 p95 无 liveness 则 hedge/降级"]
  },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "mechanism": "sub-agent", "handle": "bg-3c", "artifact": "commit a1b2c3", "verified": true, "created_at": "2026-06-05T11:00:00Z", "started_at": "2026-06-05T11:05:00Z", "finished_at": "2026-06-05T11:48:00Z", "observability": { "total_tokens": 93159, "duration_ms": 119255, "tokens_per_min": 46896, "tool_uses": 21, "source": "completion-event" } },
    { "id": "T1", "status": "in_flight", "deps": ["T0"], "mechanism": "sub-agent", "handle": "bg-7a", "created_at": "2026-06-05T11:00:00Z", "started_at": "2026-06-05T12:18:00Z" },
    { "id": "T3", "status": "ready", "deps": ["T0"], "created_at": "2026-06-05T11:00:00Z" },
    { "id": "T9", "status": "blocked", "deps": ["T1"], "blocked_on": "T1", "created_at": "2026-06-05T11:00:00Z" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "Split the PR into two?", "created_at": "2026-06-05T11:30:00Z" },
    { "id": "F1", "status": "ready", "deps": [], "kind": "fill-work", "justification": "produces-reusable-artifact", "title": "Pre-draft the PR description skeleton", "created_at": "2026-06-05T11:30:00Z" }
  ],
  "log": [
    { "ts": "2026-06-05T11:05:00Z", "kind": "dispatch", "task": "T0", "summary": "Dispatched i18n framework scaffold" },
    { "ts": "2026-06-05T11:48:00Z", "kind": "verify", "task": "T0", "summary": "Endpoint-verified scaffold (tests green)", "refs": ["commit a1b2c3"] }
  ]
}
```
<!-- ccm:k:end point:board.worked-example -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型缺乏真实 board 的结构参考，会凭想象构造字段、漏掉 wakeup/observability 等关键块、或用错字段类型。

删掉后失去本项目 board JSON 的具体字段形状与合法取值样例。
