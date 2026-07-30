---
point: workflow.api-meta
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-meta -->
## `meta`（必需的脚本头）

第一条语句必须是 `export const meta = { ... }`，且是一个**纯字面量**（不含标识符、调用、
模板字面量或 spread）。必填 key：`name`（string）、`description`（string）。
`phases: [{ title }]` 是惯例，它的 title 应当匹配你的 `phase()` / `opts.phase` 字符串。
**以上全部由 harness 强制**——`meta`（纯字面量 + 必填 key）在 launch 时校验；determinism /
caps / escape-hatch 违规在 runtime 抛错。没有独立的 linter——权威的检查就是 runtime。
<!-- ccm:k:end point:workflow.api-meta -->
