---
point: pacing.pool-vs-usage
---

## 权威陈述

<!-- ccm:k:start point:pacing.pool-vs-usage -->
## 与 `usage advise` 的关系

selected-target `usage advise` 是绝对配额压力轴：这个池有多满、是否该 throttle / stop / 考虑该 target 支持的重 lever。pool-aware own row 是相对分配轴：在同一个已证明池里，本板相对 sibling 该让还是该接。只有一块 active board 时，相对分配退化成单板 verdict，不制造额外协调噪音。

优先级权重是固定校准值：`urgent=8`、`high=4`、`normal=2`、`low=1`、`trivial=0.5`。低优 board 只有 fair-share floor，不能靠轮转抢占高优 work；这防止低优任务饿死，但不会把它提升成同等紧急。

<!-- ccm:k:end point:pacing.pool-vs-usage -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型会把「配额紧不紧」和「相对同池该让还是该接」混成一件事，也不知道具体的优先级校准权重，删掉后会在多板场景下用错误依据做抢占/避让判断。

主体是绝对配额轴与相对分配轴的区分及固定优先级权重数值，属本系统事实。

## 边界

只在多块板确实共享同一份配额池时才有意义；若板与板之间用的是彼此独立、互不竞争的资源，就没有「该让还是该接」这回事，两个轴都不适用——这不是退化成单板 verdict 的那种情形，而是相对轴根本无从谈起。

## 失败形态

引用绝对轴上「还没触发硬闸」的事实，直接当成相对轴上「轮到我了」的理由来用——两个引用各自看起来都没错，论证形式齐全，但把「还没到硬闸」和「该我优先」这两件不同的事悄悄画了等号，实质答非所问。
