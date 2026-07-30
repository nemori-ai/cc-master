---
point: multilayer.handoff-contract
---

## 权威陈述

<!-- ccm:k:start point:multilayer.handoff-contract -->
核心驱动点在**派发那一刻**。当你派发一个够大够长的节点时，把这两件事作为**节点契约的一部分**写进派发指令：

1. **发现并遵循被编排项目的 planning 规范** —— 指令里要求执行者先去读该项目的 `CONTRIBUTING` / `AGENTS.md` / `CLAUDE.md` / 既有 design docs，把它约定的 planning 流程挖出来再按它推进。
2. **产出 / 维护该项目约定位置的计划文档** —— 在它内部分步时落下并持续更新计划文档（落点见下文）。

这与 `decomposition.md` §5「每节点契约」衔接——它是**那份契约在「大节点」这一档上的一条增项**，不复述 §5 已有的字段（Input deps / Output schema / Success predicate / Timeout+budget / Escalation condition）。换句话说：§5 定义一个节点被安全派发所需的契约骨架，这一层在「节点够大」时**往骨架里加一条**：把「发现并遵循本项目 planning 层 + 维护计划文档」也写进去。

---

<!-- ccm:k:end point:multilayer.handoff-contract -->
