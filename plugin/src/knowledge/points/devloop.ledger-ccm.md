---
point: devloop.ledger-ccm
---

## 权威陈述

<!-- ccm:k:start point:devloop.ledger-ccm -->
## 用 ccm 管住优化目标

每次 board 写入前先问一个优化问题:

- **objective 变了吗?** 模糊 loss 被你锐化后,把新的 acceptance / 非目标 / 验收方式落回 board。
- **instrument 变了吗?** 新增 repro、benchmark、endpoint check 或人工验收清单时,把它作为 ref / artifact / log 留下。
- **hypothesis 变了吗?** 从 explore 进入 exploit、从方案 A 换到方案 B、或发现旧假设被测量推翻时,记录理由。
- **gradient 值得保留吗?** 只保留会改变下一轮方向的读数;长输出放 artifact,board 里放结论和指针。
- **该 restart 了吗?** 判定 plateau 时,留下旧路径为什么不继续、新起点是什么、用什么测量确认它更好。
- **真的收敛了吗?** endpoint validation 通过后,把 `done + verified + artifact` 的组合语义写完整;未验收就不要把任务标成完成。

不要把 ccm 当事后文书工具。ccm 是你把优化目标、读数和停机条件变成 durable state 的写入关卡。
<!-- ccm:k:end point:devloop.ledger-ccm -->

## 失效类型

`prosthetic`（主体：事实方法） —— 这套自检问题的作用是把优化状态（目标/测量/假设/梯度/重启/收敛）持续写进可跨上下文读取的地方；不在当前上下文被提醒，压缩或换人后这些中间推理状态会直接丢失。

主体是把 objective/instrument/hypothesis/停机条件在写入关卡外化成 durable state，作用是跨压缩保住优化状态。

## 边界

只适用于状态真的发生变化的时刻——没有任何一问触发变化时不必写；频繁写入未变化的状态本身会制造噪音，让真正的变化点被淹没在无意义更新里。

## 失败形态

任务最终交付时状态是对的，但中途换过一次方案、推翻过一次假设，这些转折完全没有留痕——回看记录像是一条直线走到底，实际走的是折线，接手者会以为原假设从头到尾都成立。
