---
point: slicing.board-landing
---

## 权威陈述

<!-- ccm:k:start point:slicing.board-landing -->
## 落到 board

- **一片纵切 → 一个 task**;若这片自身还需内部并行,做成一个 owner 父节点 + 若干 leaf 子节点(嵌套 depth=1)。
- **共享脊椎 → 那一个 foundation task**,纵切片依赖它;**死守它的依赖者最少**——只有真共享核心才连上去,别把半个 schema 层挂成全图前置。这根脊椎的 `--accept` 除了"端到端跑通",还要能答"这根线的最小设计先确认过了吗"——命中"值得 SDD"的场景(跨边界合约 / 多方消费者等)时,脊椎片先出一份最小设计或先过一轮 scoping,再动手实现,别让地基片在无人认可的设计上直接下场写代码。
- **远期的片先留粗粒度占位,不必一次切到底**:只有近期(下一个 cadence 窗口内要跑)的片才值得精切到"能并行 + 可验收"的粒度;远期 iteration 的需求大概率会变,现在精切等于投机——先占位(一个粗粒度 task 加一句意图描述),进了近期窗口再回来重切。这是 rolling-wave planning:粒度随时间距离渐进细化,不是一次性切完整个 epic。
- **近期准备交给 agent 的片，切完还要留下可路由画像**：把复杂度 / 风险 / 上下文 / 能力与预算评估、跨 harness candidates 和 ample/tight fallback 链写入 board 的 opt-in planning/routing contract；本 skill 只决定切片形状，不复制 routing schema，也不把远期占位提前精配到某个模型。
- **片分组进 `cadence`/`iteration` timebox**:每个 iteration 收口时至少 ship 一片可用增量(接 board 的 cadence 模块——节奏在这落地)。一轮里的 members 估时总量与关键路径要能放进 timebox;放不进时先重切/移出,不要把超载当成排期问题留给后面。
- **`estimate`** 回喂粒度调参(锚 3)。

---
<!-- ccm:k:end point:slicing.board-landing -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删除后,agent 不知道纵切片该怎么落地成 board 结构——不知道一片一 task、脊椎节点要死守依赖者最少、远期该占位近期才精切,容易把每片的粒度和依赖网都切错。

主体是本项目 board 的落地事实——task/foundation 映射、--accept/--deps/estimate、cadence 模块、planning-routing contract 归 using-ccm。

## 边界

本节假定目标已启用 cadence/iteration 节奏来区分近期/远期;若是纯 DAG 模式没有 timebox 概念,远近粒度分级失去客观锚点,只能改按依赖紧迫度分级,不是按时间窗口。

## 失败形态

把远期片提前精切到能并行+可验收的粒度,美其名曰未雨绸缪,实则拿现在的确定性去赌未来会变的需求;或把脊椎节点的依赖者悄悄扩大到半个 schema 层,美其名曰更保险,实则把非共享内容错焊成全图前置。
