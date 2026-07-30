---
point: ccm.board.cadence
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.cadence -->
## I. cadence 与 iteration：节奏怎么定

**cadence 是在纯 DAG 调度之上叠加节奏约束**——给长跑编排设定「多久应该交付一次可见的价值」和「当前这轮包含哪些任务」。适合需要对外持续汇报进度、或要求定期 ship 的目标。

**两层概念：**

- **`target`**（节奏目标）：`ship_every`（多久 ship 一次，如 `3h`）+ `min_unit`（最小 ship 单元，如 `"1 PR"`）
- **`iteration`**（具体一轮）：`open` → `shipped` 的生命周期，有明确 goal + deadline + members

**怎么定节奏（操作侧）：**

```bash
# 先设节奏目标
ccm cadence update --ship-every 3h --min-unit "1 PR"

# 开一个具体 iteration
ccm cadence open I1 \
  --goal "完成 i18n 框架 + 2 个 locale" \
  --deadline 2026-06-25T18:00:00Z \
  --members T0,T1,T2

# iteration 结束时收口（members 必须全 done + verified）
ccm cadence ship I1
```

**deadline 必须严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）**：非此格式的 `deadline` 会触发 `FMT-CADENCE` warn，且 viewer 时间轴可能错误渲染。

**iteration members 的选取原则：**
- 只纳入**本轮真正能完成并验收**的 task（不要把「可能完成」的也放进去）
- 每个 member 要有 `estimate` + `acceptance`。缺 estimate 会让容量判断失明，缺 acceptance 会让「本轮 ship 了什么」不可验。
- `members` 估时总量、member 内关键路径、单个 oversized task 都会被 lint 作为 warn 提醒。看到 `BIZ-CADENCE-OVERBOOKED` / `BIZ-CADENCE-CRITICAL-PATH-OVER` / `BIZ-TASK-OVERSIZED-FOR-CADENCE`，优先拆小或移出本轮；不要靠强行 `ship` 掩盖超载。
- members 全部 `done + verified` 才能 `cadence ship`（`BIZ-CADENCE-SHIPPED`·hard error）
- 若 members 无法按时全部完成：提前从 iteration 里移出来，不要强行 ship 不完整的 iteration

**无 cadence 时（纯 DAG 模式）：** board 只有 tasks 和 deps，ccm 按 readySet 调度，没有时间约束。cadence 是可选的节奏层，缺失时 ccm 正常运转。

---

<!-- ccm:k:end point:ccm.board.cadence -->
