---
point: slicing.board-landing
---

## 权威陈述

<!-- ccm:k:start point:slicing.board-landing -->
## 落到 board

- **一片纵切 → 一个 task**;若这片自身还需内部并行,做成一个 owner 父节点 + 若干 leaf 子节点(嵌套 depth=1)。
- **共享脊椎 → 那一个 foundation task**,纵切片依赖它;**死守它的依赖者最少**——只有真共享核心才连上去,别把半个 schema 层挂成全图前置。这根脊椎的 `--accept` 除了"端到端跑通",还要能答"这根线的最小设计先确认过了吗"——命中 `engineering-with-craft` sdd.md 里"值得 SDD"的场景(跨边界合约 / 多方消费者等)时,脊椎片先出一份最小设计或先过一轮 scoping,再动手实现,别让地基片在无人认可的设计上直接下场写代码。
- **远期的片先留粗粒度占位,不必一次切到底**:只有近期(下一个 cadence 窗口内要跑)的片才值得精切到"能并行 + 可验收"的粒度;远期 iteration 的需求大概率会变,现在精切等于投机——先占位(一个粗粒度 task 加一句意图描述),进了近期窗口再回来重切。这是 rolling-wave planning:粒度随时间距离渐进细化,不是一次性切完整个 epic。
- **近期准备交给 agent 的片，切完还要留下可路由画像**：把复杂度 / 风险 / 上下文 / 能力与预算评估、跨 harness candidates 和 ample/tight fallback 链写入 board 的 opt-in planning/routing contract；精确字段、启用条件与 dedicated writers 全归 `using-ccm` 的 board-model-guide §C.5。本 skill 只决定切片形状，不复制 routing schema，也不把远期占位提前精配到某个模型。
- **片分组进 `cadence`/`iteration` timebox**:每个 iteration 收口时至少 ship 一片可用增量(接 board 的 cadence 模块——节奏在这落地)。一轮里的 members 估时总量与关键路径要能放进 timebox;放不进时先重切/移出,不要把超载当成排期问题留给后面。
- **`estimate`** 回喂粒度调参(锚 3)。
- 切好的图怎么**写进** board(`ccm task add --deps ...`)→ using-ccm;怎么**排期 / 算临界路径** → master-orchestrator-guide 的 board 协议 reference。

---

<!-- ccm:k:end point:slicing.board-landing -->
