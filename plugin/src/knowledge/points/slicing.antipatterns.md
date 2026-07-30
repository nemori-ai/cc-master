---
point: slicing.antipatterns
---

## 权威陈述

<!-- ccm:k:start point:slicing.antipatterns -->
## anti-pattern 速查

| 反模式 | 为什么坏 / 怎么改 |
|---|---|
| **横切分层**(schema 层→API 层→UI 层) | serial 瓶颈 + 价值堆到最后。改纵切薄增量(锚 1)。 |
| **大爆炸节点**(一个 task = 半个系统) | 并行度=1、没法验收。按"能并行 + 可验收"再切(锚 3)。 |
| **单片吞掉 cadence**(一个 task 估时大于 `ship_every`) | 这通常不是薄纵切。默认拆成几个可验收切片;真不能拆时写明不可拆理由。 |
| **瀑布顺序**(先把全部设计 / schema 定完再实现) | 投机的大设计先行 + 推迟集成风险暴露。改 walking skeleton(锚 2)。 |
| **镀金地基**(把共享 foundation 做到"完整完美"才往下) | 你还不知道下游要什么;前置只放最小脊椎(锚 2)。 |
| **过度切碎**(几十个微任务) | 协调开销 > 干活。estimate trivial 的并回去(锚 3)。 |
| **假串行边**(为"稳"给无真实数据依赖的片画依赖) | 人为掐死并行。只画真实数据依赖边(排期细节归 master-orchestrator-guide)。 |

---

<!-- ccm:k:end point:slicing.antipatterns -->
