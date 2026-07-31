---
point: devloop.ledger-when
---

## 权威陈述

<!-- ccm:k:start point:devloop.ledger-when -->
## 什么时候必须写 ledger

简单任务可以只靠 task 的 `acceptance` / `artifact` / `verified`。一旦出现下面任一信号,你就把优化状态显式写进 board:

- acceptance 被锐化过:原目标模糊,你补了指标、非目标、端点验收方式。
- instrument 不是显然的单条测试:你要求搭 repro、fixture、benchmark、人工验收清单。
- 同一任务可能跨 compaction / 长等待 / 多个 subagent。
- 出现 plateau / restart / 方案换向。
- explore 阶段并行比较过多个 hypothesis,后续要知道为什么选 A 不选 B。
- endpoint validation 与训练读数不一致,你需要保留差异。

不要等 subagent 做完才补 ledger。外层 loop 的 objective / instrument / stop 条件没有先落 board,subagent 就是在优化一个口头 loss。

<!-- ccm:k:end point:devloop.ledger-when -->

## 失效类型

`capability_gap`（主体：事实方法） —— 知道哪些信号该触发写 ledger，但在“先把活干起来”的冲动下会把这件事往后拖，告诉自己“等真遇到 plateau 再回填”，而这恰恰是这条知识明令禁止的事后补票。

主体是一组「什么时候必须显式落 ledger」的触发判据，缺了就没有标准去区分简单任务和需要显式记录的任务。

## 失败形态

任务做到一半才回头把 ledger 补上，内容读起来完整、字段都填了，但其实是靠事后回忆重建的——真正需要它的那些窗口（中途 compaction、subagent 掉线）发生时 ledger 其实是空的，补票的时点掩盖了它从未真正起过作用。
