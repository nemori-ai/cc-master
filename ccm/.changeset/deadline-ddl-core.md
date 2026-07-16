---
"@ccm/engine": minor
"ccm": minor
---

交付 DDL（delivery deadline）核心（issue #149）：board 的 `goal_contract` 新增 👁 `deadline` 子对象（四态 settledness 状态机 `pending|asserted|confirmed|none` + `at`/`precision`/`kind`/`rev`/`provenance`/`updated_at`，与 goal `assurance` 正交、单一 SSOT、窄腰一字不动）+ 新 writer verb `ccm goal deadline set|confirm|confirm-none|amend|show`（带锁 + board.log 审计 + rev 单调递增；confirm/confirm-none/amend 强制 `--user-authorized`、amend 强制 `--reason`；deadline 写绝不 bump goal revision；`--precision day` 落当日末刻 23:59:59Z 且强制 `--tz-input`；`--at` 只收严格 ISO-8601 UTC，时区/自然语言归 agent）+ 三条新 lint 规则（`FMT-DEADLINE` hard 形状 / `BIZ-DEADLINE-PENDING` warn 未 settle 却有可执行任务 / `BIZ-DEADLINE-OVERDUE` warn 已过期未完成，`lintBoard` 加可选 `now` 注入）+ `ccm goal check` verdict 扩展（新增 `deadline_pending`·exit 0，`ok` 收紧为 goal settled 且 deadline settled，`malformed` 覆盖 deadline 形状错，`--json` 附 `deadline` 子块）+ 引擎新增 `readDeadline`/`isDeadlineSettled`/`isDeadlineWellShaped`/`normalizeDeadlineAt` 纯 helper 供下游 endpoint / hook 复用 + 泛型 `--set goal_contract.*` bypass 封堵。`goal amend` 现原样保留 deadline 子对象（scope 变更 ≠ deadline 变更）。legacy board 自动兼容（无 deadline 键三规则皆早返回）。
