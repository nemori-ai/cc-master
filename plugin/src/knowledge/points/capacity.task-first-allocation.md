---
point: capacity.task-first-allocation
---

## 权威陈述

<!-- ccm:k:start point:capacity.task-first-allocation -->
同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自全机 selected-target 候选集。

## floor 之后再深化分配

你先在 [`worker-routing.md`](worker-routing.md#确定-effect-floor) 定 floor，再用本页三轴检查边界案例。不要因为任务很长就升档，不要因为任务在 float 上就降档，也不要因为 master 坐在前台就把组织角色误当 O 资格。具体 target 必须再过 hub 的 [exact qualification](worker-routing.md#做-exact-qualification)；本页不维护型号、surface、窗口或价格目录。

<!-- ccm:k:end point:capacity.task-first-allocation -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删除后,agent 会自然地把耗时长直接等同于需要更强模型,忽略复杂性与风险才是型号信号——长而机械的任务被过度武装,短而不可逆的裁决反而没被识别为需要强模型。

删掉后缺少按复杂性/风险/duration 三轴与 floor 后再分配的选型判据。

## 边界

唯一客观做不到别的的例外是契约本身强制指定了唯一可用档位(外部要求、或该环境里该类任务只有一档模型可选),此时三轴判断没有选择空间,只能照单执行,不属于对本条的违反。

## 失败形态

决策记录里写着引用了复杂性/风险/duration 三轴,但实际论据全部只谈耗时长短——把 duration 换了个说法包装成复杂,本质仍是拿耗时当唯一信号,型号选择照旧被耗时长短牵着走。
