---
point: devloop.ledger-antipatterns
---

## 权威陈述

<!-- ccm:k:start point:devloop.ledger-antipatterns -->
## anti-patterns

| 反模式 | 现实 |
|---|---|
| "board 里有任务状态就够了,细节留在聊天上下文。" | 聊天上下文会被压缩;board 才是跨 compaction 的 durable memory。 |
| "我把所有测试输出都贴进 log,越多越安全。" | ledger 不是原始日志仓库。只记会改变下一轮优化方向的读数,长输出放 artifact,board 里放指针和结论。 |
| "先让 subagent 做,做完再补 board。" | 外层 loop 的 objective / instrument / stop 条件不先落 board,subagent 就在优化一个隐形 loss。 |
| "restart 就是把任务打 failed。" | failed 只是状态;optimization restart 还需要留下旧 hypothesis 为什么不再走、新起点是什么、用什么测量确认它更好。 |
| "等 compact 前再总结一次。" | 你通常不能预知 compact。持续写 board 才是跨 compact 保护。 |
| "compaction 后我大概记得。" | 记忆不是协议。写 handoff 是把优化状态从短期上下文提升到 board。 |
<!-- ccm:k:end point:devloop.ledger-antipatterns -->

## 失效类型

`prosthetic`（双重性质·方法部分补不回来，它才是承重结构） —— 删掉后 agent 会在压力下真的按表中列出的借口去做——把细节留在聊天上下文、把测试原始输出整段贴进 log、做完再补 board——因为这些借口在当下听起来都合理。

主体是聊天上下文会被压缩、board 才是跨 compaction 的 durable memory，针对的正是跨边界失忆。

## 边界

只覆盖“该不该写进 board ledger”这一层判断;具体该写哪些字段内容不在此列。无真实例外。

## 失败形态

agent 确实往 log 里写了字,格式看起来正常,但内容是“已完成大部分工作,细节见对话历史”这种指回聊天上下文的占位句——写了 board,却没写下任何真正扛得住 compact 的信息。
