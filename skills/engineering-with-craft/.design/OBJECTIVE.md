# OBJECTIVE — engineering-with-craft

J_top: 执行 agent 在 design / build / test 动手写代码时，用**五条共享根**统驭 DDD/SDD/TDD/OOP——设计时**先找不变式、先定合约**再划边界（DDD bounded context / aggregate 由不变式定，SDD 合约先于实现）、开发时以**四柱 + SOLID-as-judgment + 组合优于继承**写类（不贫血、不 god class、不 idle wrapper）、测试时 **test-first + constraint parity**、全程守 **no-silent-failure / spec 不漂移 / 无虚造名 / 证据优于声称** 的红线。

baseline_reference:
  user_task: 给执行 agent 一个要动手设计 / 实现 / 测试的编码任务（如「给一个计费系统建领域模型并实现核心服务 + 测试」），看它的领域建模、类设计、spec / test 顺序、红线遵守是否到位。
  without_skill_floor: **诚实标注——这里的 floor 不是一个 pressure-RED。** 建本 skill 时跑的两个纪律向 baseline（TDD 铁律 / no-silent-failure）**都 GREEN**：强 agent 单步上默认守 test-first、不吞异常。floor 是「默认 agent 缺一套**统一的工程框架**」：单条决策大致对，但没有「先找不变式 / 先定合约 / 四柱透镜 / 组合优先」的连贯脊椎——容易产出贫血模型、god class、idle wrapper、随手起的事件名、对不上 spec 的实现、测了 mock 没测真约束（散落的坑，没有共同的根去系统性避开）。
  expected_uplift: 五条根让这些分散的工程判断有共同的脊椎——尤其「四理论一条脊椎」的 reframe（DDD/OOP/SDD/TDD 是同一组根的切面而非四张清单）、「不变式即锚」统一了边界 / 守卫 / 测试三个决策、「契约即 SSOT」把 spec-first 从仪式变成必然、「证据优于声称」把红线接到 cc-master gate-green≠passed。

strict_dims: [五根框架的连贯应用（设计先找不变式+定合约 / 写类守四柱+组合优先 / test-first+constraint-parity / 红线无违反）]

rationale: 本 skill 是 **Probe-A 增量**（装一套生产性工程框架）而非 **Probe-B 覆写**（堵一条会被合理化的纪律）——两个纪律向 baseline GREEN 证实 agent 单步纪律不缺、缺的是统一框架，故**不走 pressure baseline**（skillsmith 铁律只 gate 纪律 prose），红线段按 principle 陈述不伪造 RED 背书。strict 核心是「五根被连贯地应用」，单条 strict_dim，符合本仓「1-2 个 strict_dims」约束。

## 非目标（notes）

不是 DDD/OOP/SDD/TDD 的术语词典——术语是脚手架，**根与品味才是货**（不评判 agent 能不能背出「里氏替换」定义，评判它会不会**用约束对等去判子类**）。不绑任何语言 / 框架 / runner（项目无关分发 skill，例子语言中性）。不教编排 / 切分 / 执行循环 / ccm（那是 A/E/F/using-ccm）。纯理论课本查询（「SOLID 的 L 是什么」「CPM 算法原理」）**不该**触发——本 skill 教应用不教定义。
