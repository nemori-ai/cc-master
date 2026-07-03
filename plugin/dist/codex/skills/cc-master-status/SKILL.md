---
name: cc-master-status
description: 'Triggers: 当你在 Codex 收到 `$cc-master-status` 时，以只读方式展示 board 概览、阻塞与用量快照；Do NOT 在本 skill 中改写 board。'
argument-hint: '[--board <board-path-or-stem>]'
---

$cc-master-status $ARGUMENTS

读取 cc-master board，渲染一份当前 orchestration 的紧凑状态摘要。不做 board 写操作。

参数：$ARGUMENTS

按优先级定位 board：`--board <path-or-stem>` → 当前 session 的 `CC_MASTER_BOARD` → cc-master home 下唯一 active board → 让用户在候选中选择。不要猜。

只读生成一份紧凑、可扫的状态摘要，不修改 board。用这些权威命令取数据：

- `ccm board show --json`
- `ccm board lint --json`
- `ccm board graph --json`
- `ccm board next --json`
- `ccm usage advise --json`

输出结构：

- header：goal / 进度 / branch / pacing
- 任务分组：`blocked-on-user`、`in_flight`、`blocked-on-task`、`ready`、`done`、异常状态
- 结构校验问题 / 过度调度 / 未答用户决策 / 预算快照
- 下一步可派发任务

等待用户拍板的节点要给出可继续讨论的入口：`$cc-master-discuss <node-id> [--board ...]`。
