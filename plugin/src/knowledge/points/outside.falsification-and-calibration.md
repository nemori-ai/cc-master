---
point: outside.falsification-and-calibration
---

## 权威陈述

<!-- ccm:k:start point:outside.falsification-and-calibration -->
把 falsification-first 的 pre-mortem 钉在具体决策步：它就搭 Goal Trace Test 那一拍——recon / dispatch / fill / 扩大投入之前。

先列出方案的承重假设，对每一个问：**哪一项外部事实若为真，会推翻它？该事实的校准成本有多低？** 取「高 stakes × 低校准成本」的那个，先验再投。

这**不是**「每步都验」。触发校准的是**三条全中**（见组件 F 的双侧闸）：承重（删掉它，方案 / DAG 形状就变）∧ 内部推断是唯一支撑 ∧ 门控大 / 不可逆投入。三条不全中，就记为假设、照常推进。

## 组件 C — 校准手段成本阶梯（选能落定这个假设的最便宜手段）

大致由廉到贵，但**按假设类型选、不是机械取最廉**：

1. **仓库 / 运行时事实**——grep / 读码 / 跑既有命令 / 翻本 board 的 `log` 与 `jc`。零用户成本、自助、最先试。
2. **用户澄清**——一次前台问题，可提前备好（prefetch）、与后台并行（见 `references/async-hitl.md`）。
3. **真实端点 dogfood / 可逆有限实验**——切一个 walking-skeleton 薄片真跑一遍接触现实，胜过纸上推演（切法见 `slicing-goals-into-dags`）。
4. **异质 reviewer**——换一个模型家族的第二视角（见 `references/resume-verify.md`）。**注意：它抓契约 / 同族盲区，不算真实外部证据**——只是阶梯里偏内部的一档，顶替不了 3 / 5 / 6。用「多找几个 agent 内部 review」冒充外部验证，正是本纪律要防的那种自欺。
5. **领域方 / stakeholder 反馈**——真实领域专家 / 需求方。
6. **权威资料 / spec / 标准**——官方文档 / 标准 / 版本 changelog。

阶梯不是「总取最便宜」，而是「取**能真正落定这个假设**的最便宜手段」。「这个接口到底怎么行为」只有 1 / 3 / 6 能答，问用户是白问；「用户要不要这个 scope / 格式」只有 2 / 5 能答，跑 dogfood 是白跑。**手段配假设类型，成本配 stakes。**

<!-- ccm:k:end point:outside.falsification-and-calibration -->
