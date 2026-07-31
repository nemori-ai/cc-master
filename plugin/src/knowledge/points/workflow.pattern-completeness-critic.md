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

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道『派 critic 寻找漏洞』而非『验证已做』这个模式，会过度强调肯定式检验（『有没有这个』），遗漏否定式检验（『漏了什么』），导致遗漏的 gap 藏在交付物里

主体是一个方法框架——事后派 critic 专问「漏了什么」并把缺口变成下一轮工作，缺了就只会确认已找到的东西。

## 边界

只适用于『发现遗漏』比『验证已做』更重要的场景。不适用于纯验收工作（你已经知道该检什么，只需要做一遍检查）；或问题空间太小以至于『想不出漏什么』本身没有价值。必须与某个『发现 loop』（如 multi-modal-sweep）配对。

## 失败形态

工作流水账式地『逐条验收项验证』，最后交付的 artifact 隐藏着『这不是我没想到，我真的没问』的坑。critic 这一步被跳过或流于形式（critic agent 看了一眼就说『看起来完整』而不是严肃地寻找漏洞）。下游发现者诧异『为什么这个角度之前没扫到？』。
