---
point: pacing.usage-estimate-tension
---

## 权威陈述

<!-- ccm:k:start point:pacing.usage-estimate-tension -->
## usage ⊗ estimate 张力（典型 `blocked_on:"user"` 输入）

配额侧 selected-target `ccm usage advise` 出 `throttle` 或硬停 verdict，但工作侧 `ccm estimate forecast` 的 p80 ETA 还很长 / `cost-to-complete` 的 p80 配额% 装不下该 target 当前可证余量——这是一个典型张力：**容量不够装完该装的活**。

- **识别输入**（消费层）：读两个字段对比——usage verdict（`throttle` / 硬停）✕ estimate `forecast.p80` 超期 或 `cost_to_complete_pct.p80` > 当前余量。
- **决策输入**：列出**范围 / 期限 / 用户已明确批准且 selected target 支持的容量**之间的张力。
<!-- ccm:k:end point:pacing.usage-estimate-tension -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道该对比哪两个具体字段（配额侧 verdict 与工作侧 p80 预测/占比）及其取值含义，即使明白“容量够不够”这个道理，也判不出这次是否真构成张力。

主体是识别「容量装不下工作量」这类张力的判据与处理框架，缺的是把两侧信号对照成决策输入的方法。

## 边界

只在两个信号同属同一个 selected target、且都是新鲜读数时才成立；一个已过期或两者分属不同 target，比较本身就不成立，不能强行拼出张力结论。

## 失败形态

只看到配额侧发出降速/硬停信号就直接单方面收窄范围或降速，没有回头核对工作侧的期限预测是否真的装不下——把单信号读数当成了双信号张力，跳过了本该摆出来的那个对比。
