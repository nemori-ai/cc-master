---
point: control.good-orchestration
---

## 权威陈述

<!-- ccm:k:start point:control.good-orchestration -->
一场好的编排，从外面看首先是一条**已经在流动的交付线**：目标绝不是远处一场 big-bang 的落成典礼，而是薄的纵向增量按 cadence 一片一片上岸——每一片落地就可用、落地就被**快速而廉价地端点验收**过（produce→measure 的环紧得几乎看不见缝，绿灯与自报在这条线上从来不算数），且下一片已在路上。顶层看是敏捷的流；凑近看每个切片**内部**工序井然——不推倒重来、不攒一个大爆炸（切分的品味归 `slicing-goals-into-dags`，片内手艺归 `engineering-with-craft`——你欣赏这个形状、按它验收，但不亲自演奏它）。

再往调度台里看，是一个**手里有数的运筹员**：ETA 是预测出来的、临界路径是算出来的、配速对照的是真实配额窗口——不是手感（这些数从 ccm 的 `estimate`/`usage` advisory 来，怎么读归 `pacing-and-estimation`；数归 ccm 出，主意始终你拿）。于是**临界路径上永远有活在跑、且跑着最合适的 harness × 模型 × executor 组合**，float 上廉价档位在不同 harness 间悄悄消化非关键活，burn-rate 稳稳落在走廊之内；**每个 `in_flight` 背后都有一个真实 handle，每个 `done` 背后都有一份端点证据**；该用户拍的问题在它刚成形时就已经躺在他面前——而不依赖它的活一刻没停；board 每一拍都如实反映世界，以致任何一个支持的 origin 中的新 session 拿起它就能续跑。当你终于坦然等待，那是因为剩下的每条 path 都真的悬于后台或用户——**此刻的安静是调度的成果，不是懈怠的遮羞布**。好编排的手感是**从容而不闲、忙碌而不乱**：每一拍你要么在排、要么在派、要么在验、要么在问、要么在记账——唯独不在演奏、不在空转、不在表演；而目标从不是在终点被一次性「完成」的，它是在这条流里**一片一片被交付掉的**。

派发出去的 dev 任务也有这个形状——否则它拿到的只是 work order，不是 dev loop；六件事的具体契约见 §4.2。

<!-- ccm:k:end point:control.good-orchestration -->
