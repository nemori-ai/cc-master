---
point: multilayer.admission-and-escalation
---

## 权威陈述

<!-- ccm:k:start point:multilayer.admission-and-escalation -->
不是每个节点都需要这一层——它有成本（执行者要先发现规范、要维护文档）。够格的节点特征：

- **长程、工作量大** —— 一个 sub-agent 一口气吃不下、自然要分阶段。
- **内部天然多步** —— 节点内部本身就是个有先后、有中间产物的小规划问题。
- **需可追溯** —— 中途的决策 / 取舍要留痕，不能只有最终 diff。
- **需可跨 session 续跑接手** —— 万一中途换 session / 换执行者，下一个人得能从计划文档接上手。

反面：**小而原子、一次性可验**的节点不需要这一层。给一个十分钟能跑完、一次端点验收就能判 done 的节点强加一套项目 planning 流程，是镀金——成本超过它省下的。粒度判断本身见 `decomposition.md` §4。

---

## 与 escalation 的边界：纵深消化 vs 炸开成顶层并行

这一层和 `dispatch.md` 的 escalation 机制**分工不同、不是替代**——别搞混什么时候纵深消化、什么时候 escalate。

- **节点*内部*用「项目自己的 planning 层」纵深消化复杂度，是常态。** 执行者在节点内按项目规范分步、留计划文档，把复杂度在**这一个节点之内**走完。大多数够格的大节点走这条路。
- **escalate 回 cc-master 的 workflow 层，只在复杂度高到值得把它拉回顶层做横向并行 fan-out 时。** 执行者发现自己其实是一张 sub-DAG → STOP + 返回 escalation map → 你 supersede 该节点、seed 一个 workflow（机制 SSOT 在 `dispatch.md`「靠 escalation 重新定位」，此处不复述）。

一句话区分：

> **项目 planning 层 = 在一个节点内纵深走完；escalation = 把一个节点炸开成顶层并行子图。**

判据是**值不值得拉回顶层并行**：内部多步但本质串行（一步喂下一步、并行度 T₁/T∞≈1）→ 纵深消化，留在节点内；内部其实是一张可并行的 sub-DAG（多条独立道值得 fan out）→ escalate。前者用项目计划文档把纵深走完，后者用 board + workflow 把横向铺开。

---

<!-- ccm:k:end point:multilayer.admission-and-escalation -->

## 失效类型

`capability_gap`（主体：事实方法） —— escalate需要停下来写escalation map、等顶层响应,而继续在节点内部往下钻感觉是在"持续推进";删掉这条阈值判据,agent身处复杂节点深处时,容易靠着沉没成本继续闷头串行做完,即便内部其实是可并行的sub-DAG。

主体是准入判据与「纵深消化 vs 炸开成顶层并行」的分界标准，缺的是判断框架。

## 边界

仅适用于board节点已经开工、执行者身处其中发现复杂度超预期的时刻;切分阶段本就该判断出的可并行结构,不属于这条规则要处理的情形。

## 失败形态

执行者在节点内部埋头走了很久,期间其实已经拆出了三条彼此独立的子任务,却因为已经深入其中而继续串行推进而不escalate;活最终做完了、进度看起来正常,只是这条本可并行的sub-DAG被拉成了串行线,从交付结果上完全看不出低效。
