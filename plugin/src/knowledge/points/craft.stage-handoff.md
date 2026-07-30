---
point: craft.stage-handoff
---

## 权威陈述

<!-- ccm:k:start point:craft.stage-handoff -->
## 设计 → 开发 → 测试：何时取哪把刀

| 阶段 | 主用理论 | 这一刀回答什么 | 深度 reference |
|---|---|---|---|
| **动手前（硬闸）** | SDD | 命中值得 SDD 的场景、且无已认可 spec → 停下先产出 / 先要 spec，再动手写产码 | [references/sdd.md](references/sdd.md) §硬闸 |
| **设计** | DDD + SDD | 领域怎么划 / 建模？合约先长什么形？ | [references/ddd.md](references/ddd.md) · [references/sdd.md](references/sdd.md) |
| **开发** | OOP + SDD | 类 / 对象怎么写到品味线？实现怎么对齐 spec？ | [references/oop.md](references/oop.md) · [references/sdd.md](references/sdd.md) |
| **测试** | TDD | test-first 这条纪律具体怎么执行？ | [references/tdd.md](references/tdd.md) |
| **横跨三阶段** | 五条根 + 红线 | 始终成立的脊椎 | 本文 |

**四理论是接力，不是并列**：SDD 冻结合约形状 → DDD 在其上划 bounded context 与不变式所有权 → OOP 实现到合约 → TDD 对着合约红绿。这条接力顺序管的是「哪种手艺在哪阶段**领跑** + 合约先行」，**不是**「相位闸、不许回头」——它是**典型领棒次序**，**不是瀑布**。

把它放进三个尺度看得更清——**顶层敏捷 · 片内有序 · 任务内迭代**，同一种工程良知在三层反复出现，三层都反对『大设计先行、攒到最后才见反馈』的重型瀑布：①**顶层：敏捷迭代**（目标纵切薄增量 / walking skeleton / 按 cadence 交付·见 slicing-goals-into-dags）；②**片内：纪律化顺序**（每薄片端到端走 SDD→DDD→OOP→TDD 四棒·给典型领棒次序 + 合约先行，但**不锁相位、不禁回头**，故**不是瀑布**——『局部瀑布』直觉指的正是这份 order-ness，它与重型瀑布差在三轴：范围=一薄片非整个项目 / 反馈在每片边界就回来非攒到最末 / 与下一层任务内迭代共存）；③**任务内：迭代优化**（片里每个 dev 任务按 propose→measure→adjust 逼近验收·见 dev-as-ml-loop）。dev-as-ml-loop 的迭代循环在每一棒**内部**跑，与接力的阶段次序不同尺度、不打架。

---

<!-- ccm:k:end point:craft.stage-handoff -->
