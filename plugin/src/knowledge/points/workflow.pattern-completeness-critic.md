---
point: workflow.pattern-completeness-critic
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-completeness-critic -->
## completeness-critic

**何时：** 你想知道自己*漏了*什么，而不只是确认自己找到了什么。工作做完后，派一个 critic
agent 去问「漏了什么——哪个角度没横扫、哪条主张没核实、哪个来源没读？」它揪出来的就是下
一轮的工作。和 multi-modal-sweep、以及任何发现 loop 都天然配对。

```js
const gaps = await agent(
  `Given these findings, what is MISSING — an unswept angle, an unverified claim, an unread source?\n${JSON.stringify(findings)}`)
```

**由谁演示：** `assets/examples/research-multimodal-sweep.js`（它最后那个 `Critique`
phase 正是这个 critic）。

---

<!-- ccm:k:end point:workflow.pattern-completeness-critic -->
