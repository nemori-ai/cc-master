---
point: tdd.completion-gate
---

## 权威陈述

<!-- ccm:k:start point:tdd.completion-gate -->
## Completion Gate：证据优于声称

> 回扣根5（证据优于声称）：「done」是关于世界的声称，要事后证据，不接自述。

「完成了」「全绿了」「已修复」——这些都是关于世界当前状态的**声称**，声称需要**证据**，而证据必须在**最后一次编辑之后**生成。

**Completion Gate 三步**：

1. **有范围的回归运行**：在最后一次改动之后，运行测试，完整读输出——不是截断版，不是 summary，是实际运行产生的日志里的 FAILED/ERROR 行。`grep -E "FAILED|ERROR"` 零命中 + Results 尾行摘要一致。
2. **质量 gate**：lint（代码风格检查）、静态类型检查（pyright / tsc / mypy 等，按项目配置）、格式检查——这些是**不同的检查**，缺一不可（格式通过 ≠ lint 通过 ≠ 类型检查通过）。
3. **报告观察到的事实**：日志说什么，报什么；跳过的步骤，**明说跳过了，原因是什么**，不用「其余部分应该没问题」代替。

**一个 worker 的自报「全绿」不是证据。** 有据可查的是：你在最后一次编辑之后实际运行了测试，读了输出，对输出有所引述。自述、感觉、「我相信应该通过了」——都不是证据。

整合者（orchestrator 或 reviewer）**不信任 self-report，独立重验**。这不是不信任 worker，而是方法论的一部分：verification 与 implementation 分离，才能给「green」这个词任何意义。

---

<!-- ccm:k:end point:tdd.completion-gate -->
