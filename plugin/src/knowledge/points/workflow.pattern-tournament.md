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
