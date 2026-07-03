---
name: cc-master-handoff-to-new-session
description: 'Triggers: 当你在 Codex 收到 `$cc-master-handoff-to-new-session` 时，按接替流程 quiesce/drain、写 handoff 并归档 board；Do NOT 在未确认时直接结束或遗漏迁移信息。'
argument-hint: '[--board <board-path-or-stem>]'
---

$cc-master-handoff-to-new-session $ARGUMENTS

把当前 orchestration 干净交接给一个新 session：停止派发、排空在飞任务、写 handoff、归档 board，并给用户一条可续跑命令。

参数：$ARGUMENTS

定位目标 board 后按顺序执行：

1. **Quiesce**：本回合起停止派发新任务。
2. **Drain**：让当前 `in_flight` 工作尽量收敛，并做端点验收。无法及时收敛的 straggler 要以风险写入 handoff。
3. **Write**：在 cc-master home 写一份叙事层 handoff 文档。不要复写整张 DAG；board 是真相源，handoff 只写接手者需要的叙事、风险和下一步。
4. **Log**：用
   `ccm log add "<summary>" --kind handoff --detail "<handoff-path>" --board "<board-path>"`  
   记录 handoff 指针。
5. **Archive**：用 `ccm board archive --board "<board-path>"` 归档 board；不要手改 JSON。
6. **Tell**：告诉用户 handoff 路径，以及新 session 要执行的
   `$cc-master-as-master-orchestrator --resume <selector>`。
