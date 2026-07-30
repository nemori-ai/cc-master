---
point: slicing.value-risk
---

## 权威陈述

<!-- ccm:k:start point:slicing.value-risk -->
## 心智锚 4:按 价值 × 风险 排序

切完是一组片,**先做哪片**有讲究:

- **价值优先(节奏)**:把用户**最早能用上**的那片排前面——让"第一个可用增量"尽快落地,而不是攒到最后大爆发。
- **风险优先(去风险)**:把**最不确定 / 最可能翻车**的集成,用一根 spike / walking skeleton 早早穿过去——把"做不出来"的发现提前到便宜的时候。
- 二者常合一:**最薄的那根线,往往既穿过最险的路径、又交付一小条可用价值**——这就是 walking skeleton 该选的方向。

> **落地**:硬先后(脊椎必须先于依赖它的片)用 `--deps` 编码进 board;但**同为 ready 时先派哪片**(价值还是风险优先)是 **dispatch 决策、归 A**(`master-orchestrator-guide`),不是 board 上的某个字段。本 skill 负责切出"谁依赖谁"的结构,A 负责在就绪集里挑先后。

---

<!-- ccm:k:end point:slicing.value-risk -->
