---
point: workflow.pattern-tournament
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-tournament -->
## tournament-bracket

**何时：** 你有很多候选，想靠两两淘汰、而非绝对打分选出单一胜者（judge-panel 是*绝对*
打分；bracket 是*相对*比较）。跑若干 round：把候选两两配对、一个 judge agent 挑出每对的
胜者、把场地减半、如此重复到只剩一个。每个 round 就是对各对的一次 `parallel()`；round 之间
的 loop 是一句朴素的 `while (field.length > 1)`。当相对比较比绝对 0–10 分更可靠、且场地大到
给每个都打分太浪费时，用它。

**由谁演示：** `assets/examples/tournament-bracket.js`。

---

<!-- ccm:k:end point:workflow.pattern-tournament -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道『两两淘汰相对比较』这个模式，会误用『给每个候选绝对打分 0–10 再排序』或其他不必要的复杂方案，浪费算力且结果不如 bracket 稳健

主体是何时该用两两淘汰的相对比较而非绝对打分，以及 bracket 的实现骨架。

## 边界

只适用于『有很多候选且相对比较比绝对打分更可靠』的场景。不适用于：候选很少（n<4）时开销不值；绝对打分更可靠或更易解释时（用 judge-panel）；候选间不能两两比较的场景（如维度各不相同）。

## 失败形态

用绝对打分给每个候选评分再排序（球队 tournament 里常见的『每队对每队都比赛一次』耗尽资源）；或设计复杂的加权评分系统，而没有意识到『两两比较』本身更简洁稳健。代码形式上『高级』，实质浪费了联系。
