---
point: workflow.shape-tree
---

## 权威陈述

<!-- ccm:k:start point:workflow.shape-tree -->
## 2. 范式决策树

照 work 的**形状**选，不是凭口味。（完整语义见 `references/mechanism.md`；完整 pattern
目录见 `references/patterns.md`。）

- **任务互相独立，且你要把全部结果一起收齐** → **fan-out**
  （`parallel()`，一道 barrier）。模板：`assets/templates/fan-out.js`。
- **多阶段、阶段之间无须同步** → **pipeline**
  （`pipeline()`，流式——**默认就用它**；item A 可以走到 stage 2，而 item B 还在 stage 1）。
  模板：`assets/templates/pipeline.js`。
- **数量未知** → **loop**：
  - 深度要随一个 `'+Nk'` budget 伸缩 → **loop-until-budget**
    （`assets/templates/loop-until-budget.js`）。
  - 规模未知的发现（找出*所有*某类东西）→ **loop-until-dry**
    （`assets/templates/loop-until-dry.js`）。
- **连 work-list 都还不知道** → **scout-then-fanout**：先派一个 scout agent 把这份 list
  枚举出来，再对它 pipeline / parallel。这是现实里最常见的入口形状。
  模板：`assets/templates/scout-then-fanout.js`。

> **默认用 `pipeline()`。** 只有当下游某个 stage 真的要拿*整批*前一阶段的集合时（dedup /
> merge、按 count 提前退出、「跟其余全部比一遍」），才换成 barrier（`parallel()`）。「代码更
> 整齐」不是理由——barrier 的 latency 是实打实的。见 `references/mechanism.md` §3 的
> smell-test。

> **真实的 workflow 会把这几种形状叠在一起。** fan-out 里套一个 loop、scout 之后接一个
> verify stage、pipeline 当中夹一道 self-repair gate——这些组合形态（bug-hunt-loop、
> pr-issue-triage、dep-upgrade-sweep 等）住在 `references/patterns.md`，并整套 ship 在
> `assets/examples/` 里。当你的 work 套不进任何一个裸形状时，从最接近的那个组合 example
> 起手。

<!-- ccm:k:end point:workflow.shape-tree -->
