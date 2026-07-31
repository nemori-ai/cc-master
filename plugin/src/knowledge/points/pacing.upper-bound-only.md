---
point: pacing.upper-bound-only
---

## 权威陈述

<!-- ccm:k:start point:pacing.upper-bound-only -->
## 只在上界收紧

pacing 没有“额度空闲所以自动加速”的欠用侧。`healthy` / `hold` 只表示当前已证明的承重窗口未触发收紧；
它不覆盖模型准入、任务质量、权限或安全条件。`tight` / `throttle` 表示需要决策层评估减速；
`exhausted` / `stop_*` 表示该 target 的承重窗口已进入硬边界。unknown 永远不等于 healthy。

按精确 target 解读：

- **Claude Code**：5h 与 7d 都承重；`switch_candidate` 是喂给后台容量管控层的机器事实，不是发给你的换号许可——换哪份配额不由你决定。
- **Codex**：只接受 7d hard gate；5h、`stop_5h`、`switch` 与 `switch_candidate` 不属于有效 Codex pacing
  合同。Codex 自动换号永久禁止；rolling-24h 只作 burn-risk advisory。
- **Cursor**：IDE 与 Agent 各自只接受自己的 billing-period posture；`stop_billing_period` 只约束对应
  surface。Cursor 自动换号永久禁止，两条 surface 不互相兜底事实。

<!-- ccm:k:end point:pacing.upper-bound-only -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这套 verdict 按 target 精确区分（Codex 只认 7d、Cursor 按 surface 各自独立），可能套用旧的双侧走廊心智，或把某个 target 的信号误用到另一个 target 上。

主体是各 target 的 posture 取值语义与承重窗口合同（Codex 只认 7d、Cursor 两 surface 不互补），属本项目约定事实。

## 失败形态

隐蔽违反：当前 target 的 verdict 是 tight/throttle，但因池子里另一个候选账号显示 healthy，就混在一起汇报成'整体健康'——引用了 healthy 这个词，实质引用的是别的 target 的状态。
