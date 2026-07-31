---
point: devloop.ledger-handoff
---

## 权威陈述

<!-- ccm:k:start point:devloop.ledger-handoff -->
## continuous handoff

不要把 handoff 理解成 compact 前的一次动作。你无法可靠知道 compact 什么时候发生。把 handoff 理解成**持续维护 durable state**:每当优化状态发生 load-bearing 变化,立刻用 ccm 写回 board。

至少在这些时刻写一次:

1. 派发 / 开始实现时:acceptance 是否清楚、instrument 是什么、当前 hypothesis 是什么。
2. 每次测量后:读数是什么、loss 有没有下降、下一步 probe 什么。
3. 目标 / 约束 / artifact 变化时:变了什么、为什么变、谁依赖这个变化。
4. 触发 restart 时:为什么判定 plateau、旧路径为什么不继续、下一起点是什么。
5. 停机时:哪个 endpoint validation 证明收敛、artifact 在哪、还有哪些非目标故意没做。

handoff 必须短,但不能只写"继续优化"。合格 handoff 至少包含:

```text
objective: <当前验收 / 指标 / 非目标>
instrument: <测试/benchmark/repro/endpoint check>
hypothesis: <当前相信的下降方向>
last_gradient: <最近一次测量说明了什么>
next_probe: <下一步最小有用动作>
stop_or_restart: <继续 / 收敛停机 / restart 的条件>
```

如果这六行写不出来,说明 loop 状态还没被你理解清楚;不要把模糊状态留给 after compact 的自己猜。

<!-- ccm:k:end point:devloop.ledger-handoff -->

## 失效类型

`motivation_conflict`（主体：行为约束）

主体是「每次 load-bearing 变化都立刻写回 board」这条纪律，持续写 ledger 明显比闷头继续干活费力，动机完美的执行者知道了就会照做。

## 为什么它随模型变强而更重要

不写回的理由总是很有说服力，而且越有能力越有说服力：我清楚记得整条链路、这次变化还不算 load-bearing、等结论稳定了一次写更干净。能力越强，「现在还不到时候」越能被论证得滴水不漏，load-bearing 的门槛也越容易被自己悄悄抬高。但截断从不与你记得多牢商量。这条约束真正拦的不是遗忘，是那套论证——它要求写回由状态是否变化触发，而不是由你判断自己是否还撑得住。
