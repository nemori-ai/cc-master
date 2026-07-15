# 模型档位事实 —— 可用性、相对成本与能力边界

> **何时读：** 需要确认当前 host 可用哪些档位、相对成本、能力边界、provenance 或不确定性时读取；把事实交给 `master-orchestrator-guide` 的 `references/model-allocation.md` 作具体分档、主线固定与容量动作。

## Claude Code 模型事实入口

运行 `ccm provider facts claude-code --json`。该命令返回 ccm 内置、带官方来源和有效期的模型事实快照；本页只教你消费字段，不维护第二份目录。

自动选型前同时要求：

1. `freshness:"fresh"` 且 `catalog_eligible_for_admission_check:true`；静态 snapshot 的 `eligible_for_automatic_selection` 必须保持 `false`，其 blockers 由后续 live admission 逐项补证；
2. `source[]`、`observed_at`、`valid_until`、`account_scope`、`confidence` 与 `unknown[]` 完整；
3. model 的 `source_refs` 可回指本次 snapshot，且 live entitlement 另有当前账号证据；
4. `conditional` 候选必须补齐计划/credits 资格，不能当成 globally available。

当前 official snapshot 应包含 **Sonnet 5**（`claude-sonnet-5`），并把 **Fable 5** 标为 `conditional`，而不是无条件 unavailable。Opus 等其它候选、价格与 supersession 关系以命令当次返回为准；snapshot 过期或任何未知项影响 eligibility 时 fail closed。

tier 只表达稳定调度类别：`economy` / `balanced` / `frontier`。具体任务怎么分档归 `master-orchestrator-guide` 的 `references/model-allocation.md`；本页不从 benchmark 或价格单独推出任务分配。
