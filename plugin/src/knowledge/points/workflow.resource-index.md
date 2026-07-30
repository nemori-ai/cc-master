---
point: workflow.resource-index
---

## 权威陈述

<!-- ccm:k:start point:workflow.resource-index -->
## 4. Reference 索引——动手猜之前先读

- **`references/mechanism.md`**——**对引擎下任何判断之前**先读它。已确认的契约 vs 内部
  未知；7 个 primitive 的真实语义；`parallel`（barrier）vs `pipeline`（streaming）+
  smell-test；`Date.now()` 为什么会破坏 resume；resume =「最长未变前缀」；硬 caps
  （16 并发 / 1,000 总量 / 单次调用 4,096 / 512 KB）。
- **`references/patterns.md`**——挑*形状*：控制流 primitive（fan-out+synthesize、
  pipeline-by-default、loop-until-{count,budget,dry}、scout-then-fanout）、质量 pattern
  （adversarial-verify、perspective-diverse-verify、judge-panel、multi-modal-sweep、
  completeness-critic、migrate→transform→verify）、组合形态（bug-hunt-loop、
  pr-issue-triage、dep-upgrade-sweep、test-generation-and-repair、tournament-bracket、
  self-repair-loop、staged-escalation）。顶部有一份 section TOC；每节都讲清*何时*用 +
  骨架 + 由哪个 bundled 资产演示。**每个形状都有一个 bundled 文件演示**——没有只剩 prose
  的空壳形状。
- **`references/api-reference.md`**——primitive 签名、`agent()` 的每个选项
  （`label`/`phase`/`schema`/`model`/`isolation`/`agentType`）、cache-key 四要素、failure
  语义。没有任何编造的选项。
- **`assets/templates/`**——5 个控制流骨架（copy → fill）。

### `assets/examples/`——12 个完整、真实-prompt 的 workflow（分别何时读）

| Example | 何时读 |
|---|---|
| `review-adversarial-verify.js` | 跨多个维度 review 改动的代码，再在出报告前逐条 refute 每个 finding（adversarial-verify 的典范组合）。 |
| `design-judge-panel.js` | 生成 N 个独立设计方案、用一个 judge panel 打分、从胜者综合。 |
| `research-multimodal-sweep.js` | 从多个搜索角度研究一个问题 → dedup → deep-read → completeness critic。 |
| `migrate-discover-transform-verify.js` | 一场迁移：先发现 site，在隔离 worktree 里逐个 transform，再 gate-verify（唯一用 `isolation:'worktree'` 的资产）。 |
| `bug-hunt-loop.js` | 全仓搜 bug 直到连续 K 个 dry round，再对每个幸存者 adversarially verify（loop-until-dry + adversarial-verify）。 |
| `pr-issue-triage.js` | scout 打开的 PR/issue、fan out 一个分类器、用 judge 把这批排成优先级队列（scout-then-fanout + judge-panel）。 |
| `dep-upgrade-sweep.js` | 发现过时的 dep，在隔离 worktree 里逐个 upgrade、gate，只保留转绿的 bump。 |
| `test-generation-and-repair.js` | 给每个 module 生成 test，再在 attempt cap 之内把每个失败的 suite self-repair 到绿。 |
| `tournament-bracket.js` | 靠两两淘汰从众多候选里选出一个胜者（相对比较，不是绝对打分）。 |
| `self-repair-loop.js` | 把一个 artifact 驱动到通过某个 gate，把失败诊断喂回有界的重试。 |
| `staged-escalation.js` | 先用便宜的 pass 试每一项；只在信心低的地方升级到强模型。 |
| `nested-workflow-composition.js` | 用 `workflow()` 把一个 saved/file workflow 当子步骤组合进来（共享 budget/caps、一层嵌套、逐项 catch-and-degrade，唯一用 `workflow()` 的资产）。 |

每个 bundled template 和 example 都是照 harness 契约写的，随便挑一个都是 known-good 的
起点。
<!-- ccm:k:end point:workflow.resource-index -->
