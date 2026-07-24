# optimization ledger —— 把优化状态写进 board

你是 master orchestrator 时,board 不只是任务清单,也是外层 dev loop 的记忆。你不亲手写代码,但你必须让优化状态可续接:目标函数为何这样定义、当前 hypothesis 是什么、哪次测量给了什么梯度、为什么判定 plateau、下一轮打算 probe 哪条路。长程任务会跨 subagent、等待和 compaction;这些信息若只留在聊天上下文里,下一轮 agent 就会在一个隐形 loss 上重新猜。

把 optimization ledger 当成每个长程 dev task 的训练记录。你写它不是为了记流水账,而是为了让下一个读 board 的 agent 能从同一个优化状态继续下降。

compact 是机械动作,不是你能可靠预判的日程点。你通常只能在 after compact 后发现上下文已被压缩;那时再补写已经晚了。真正的跨 compact 保护,是你在任何工作时刻都把 load-bearing 的目标、产物、读数和下一步意图持续写进 board。after compact 的正确动作是从 board 恢复优化状态,不是从残余记忆里重建它。

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
<!-- ccm:k:start point:devloop.ledger-what -->
## 写什么

每次只写会改变下一轮优化方向的信息。你要让接手者一眼看出当前 loss、测量仪器、最近梯度和下一步 probe。

| 信息 | 写法 | 读它的人要能回答 |
|---|---|---|
| objective | task `acceptance` 或 spec ref | 目标函数现在是什么?哪些不是目标? |
| instrument | task ref / log / artifact | 用什么测量?读数可信到什么程度? |
| hypothesis | log / judgment_call / task description | 当前相信哪条改动会降低 loss,理由是什么? |
| gradient | log / artifact | 最近一次测量说明往哪调? |
| plateau | log / status / blocker | 为什么同一路线不再下降? |
| restart | new task / dependency / status transition | 换到哪个新起点?旧路径留下些什么? |
| validation | `verified` + artifact | 收敛是怎么被端点验收确认的? |

具体命令语法、字段取值、状态机合法转移都归 `using-ccm`。你在这里先判断**哪类优化状态必须落 board**;要敲命令时再切到 `using-ccm`。

<!-- ccm:k:end point:devloop.ledger-what -->
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
