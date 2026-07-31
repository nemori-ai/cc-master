---
point: workflow.api-pipeline
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-pipeline -->
## `pipeline(items, ...stages) → Promise<any[]>`  — NO BARRIER

- **参数：** 先一个 `items` 数组，再跟一个或多个 stage 回调。
- **流式：** 每个 item 独立流过所有 stage——stage 之间没有 barrier。
- **Stage 签名：** 每个 stage 回调收到 `(prevResult, originalItem, index)`。
- **Failure：** 抛错的 stage 把那个 item 降为 `null`，并跳过它余下的 stage。
- **Cap：** 单次调用 ≤ 4,096 个 item。

<!-- ccm:k:end point:workflow.api-pipeline -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 在后续 workflow 里忘了「NO BARRIER」意味着各 stage 流式并行，前一个 stage 还在执行时后一个 stage 已开始；也忘了 4096 item 上限，超了 silent drop。

pipeline() 的流式无 barrier 语义、stage 签名与失败处理是接口事实。

## 边界

Workflow 的 pipeline primitive 合约。4096 item 上限是硬的，NO BARRIER 是核心设计选择（vs parallel 有 barrier 概念）。

## 失败形态

隐蔽形态：agent 写 pipeline，每个 stage 假设前一个已全部完成（如 stage 1 爬数据、stage 2 汇总），实际 NO BARRIER 导致 stage 2 开始时 stage 1 还在中间，汇总数据短缺。最诡异的：第一次跑 100 item 全成功，第二次跑 5000 item 前 4096 成功、剩 904 silent drop，user 看不到错、只觉得「最后一批数据怎么没了」，debugging 时以为是上游数据问题。
