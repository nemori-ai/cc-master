---
"@ccm/engine": minor
"ccm": minor
---

Agent Registry v1：board 新增 ✎ `agents[]` 运行时 agent 登记簿（凡派发皆登记的统一花名册·agent↔task join 存 agent 侧 `links[]`·id 遵守 run-store v2 ID 文法）+ 新 namespace `ccm agent` 七 verb（create/bind/link/terminal/probe/list/show·登记/探测/读取 noun，无任何 spawn/route/dispatch 语义）+ 按 handle 分级的活性探测与 reconcile（pid 存活 / codex·claude-code 会话文件 mtime / transcript mtime·拿不到即 unknown 保真·只写 agents[] 自己的 probe/lifecycle 字段）+ 两条 warn 级 lint（`FMT-AGENTS` 段形状 / `BIZ-INFLIGHT-AGENT` in_flight 未登记软提示）+ viewer agent 观测面。
