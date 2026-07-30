---
point: devloop.ledger-ccm
---

## 权威陈述

<!-- ccm:k:start point:devloop.ledger-ccm -->
## 用 ccm 管住优化目标

每次 board 写入前先问一个优化问题,再让 `using-ccm` 负责命令细节:

- **objective 变了吗?** 模糊 loss 被你锐化后,把新的 acceptance / 非目标 / 验收方式落回 board。
- **instrument 变了吗?** 新增 repro、benchmark、endpoint check 或人工验收清单时,把它作为 ref / artifact / log 留下。
- **hypothesis 变了吗?** 从 explore 进入 exploit、从方案 A 换到方案 B、或发现旧假设被测量推翻时,记录理由。
- **gradient 值得保留吗?** 只保留会改变下一轮方向的读数;长输出放 artifact,board 里放结论和指针。
- **该 restart 了吗?** 判定 plateau 时,留下旧路径为什么不继续、新起点是什么、用什么测量确认它更好。
- **真的收敛了吗?** endpoint validation 通过后,把 `done + verified + artifact` 的组合语义写完整;未验收就不要把任务标成完成。

不要把 `using-ccm` 当事后文书工具。ccm 是你把优化目标、读数和停机条件变成 durable state 的写入关卡。

<!-- ccm:k:end point:devloop.ledger-ccm -->
