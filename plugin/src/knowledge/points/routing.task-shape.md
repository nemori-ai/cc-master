---
point: routing.task-shape
---

## 权威陈述

<!-- ccm:k:start point:routing.task-shape -->
先看责任与控制形状，再看数量。五个 executor 是跨 compaction 的规划语义：

| 任务形状 | executor | 你要守的边界 |
|---|---|---|
| 一条终端推理 / 实现链，能一次独立验收 | `subagent` | 默认把可外包实现交出去；叶子发现自己其实是 sub-DAG 时停止并返回 scope map，不自行 fan out |
| 多个叶子需要确定性 fan-out / join、共享 schema 或 stage | `workflow` | 它描述结构化多叶责任；是否有同名 runtime 另看下一节 |
| 调度、reconcile、端点验收、整合、replan | `master-orchestrator` | 只保留真正不可外包的指挥职责，不借此亲手实现或 review |
| 需要用户判断、授权或拍板 | `user` | 立即 surface；不依赖答案的 ready 工作仍照常派发 |
| session 外已有工作或事实源需要追踪 | `external` | 记录 issue、run、URL 或其它 tracking anchor；外部 closed 只是待验收信号 |

先辨认图的真实形状：只有下游会直接消费某个上游 artifact / hash 时才画依赖边；一条串行临界链不要为了“并行”强拆 fan-out，独立叶子也不要因预算紧而画假串行边。若只需把确定性多叶判成 `workflow` 并写出 routing record，本页下一节已经足够；仅因场景含 fan-out / join，不得继续打开 `dispatch.md`。只有还要在 routing record 之外计算 work/span、`T₁/T∞`、lane、escalation、隔离或 admission 细节时，才读 [`dispatch.md`](dispatch.md#两个尺度上的-dataflow--为何这些高度是自相似的)。

派 dev worker 的 handoff 至少给齐：objective（含 acceptance / non-goals）、measurement、artifact、constraints、stop-or-restart、所需 skill pointers。非原子或不能一次验收的节点，再给一份已认可 spec，或先派 scoping；不要把未决架构偷偷交给实现 worker 猜。

<!-- ccm:k:end point:routing.task-shape -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道有这五种 executor 及其对应的责任/控制形状划分，容易只会用一种默认方式（全部丢给 subagent，或全部自己上手），既不会按任务形状分流，也不知道该在哪个点上向用户 surface。

主体是按责任与控制形状分五类 executor 的分类判据与依赖边举证方法。

## 失败形态

一个任务其实需要多个叶子共享 schema、协同产出——本该判成结构化多叶责任，却被拆成几个互相独立的终端派发各自完成；每个派发单看都是「确实交出去了」，形式上符合把实现外包的原则，实际上叶子之间从未对齐过 schema，各自产出悄悄漂移成了不兼容的结果。
