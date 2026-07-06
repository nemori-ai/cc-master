---
name: cc-master-as-master-orchestrator
description: 'Triggers: 当你在 Codex 收到 `$cc-master:cc-master-as-master-orchestrator ...`（兼容 `$cc-master-as-master-orchestrator ...`、`$cc-master:as-master-orchestrator ...`）时，初始化或接管 orchestration board；仅作为会话入口，Do NOT 在这里写通用流程说明。'
argument-hint: '<goal> [--priority urgent|high|normal|low|trivial] [--wip N] [--owner-wip N] [--policy-switch allow|deny] [--github-issue <issue-url>] | --resume [selector]'
---

$cc-master:cc-master-as-master-orchestrator $ARGUMENTS

你正被初始化为一名 **master orchestrator（总指挥）**。本回合会收到一段 `cc-master:` / `cc-master resume:` 的 context；
它会告诉你 board 是否已创建或已接管，以及 board 的确切路径。

参数整串为：

```text
$ARGUMENTS
```

你必须先看注入的 context 来判定当前是哪一种形态，不要只凭参数文本猜：

- **fresh**：注入串以 `cc-master fresh: created and armed Codex orchestration board at ...` 开头。你要先把目标从零拆成依赖 DAG，写入新 board，然后才能推进任何实现 / 测试 / git / PR 工作。
- **resume**：注入串以 `cc-master resume: armed Codex orchestration board at ...` 开头。board 已存在且已被本 session 接管；你是接手，不是重启。
- **候选消歧**：如果注入串列出候选 board 而没有接管成功，本回合不要写盘。把候选分组呈现给用户，让用户用更精确的 `--resume <selector>` 重新发起。

## fresh 形态

1. 调用 `master-orchestrator-guide` skill，内化身份、红线、决策程序与 board 协议。
2. 从参数里取出 goal，并剔除这些启动 flag：`--priority`、`--wip`、`--owner-wip`、`--policy-switch`、`--github-issue`。这些 flag 已按命令契约写入 board；不要把它们混进 `board.goal`。
3. **硬闸：在任何实现 / 测试 / git / PR / 发布动作之前，先把 goal 拆成依赖 DAG 并用 `ccm task add` 写进这块 board。** `tasks[]` 为空时不准继续推进用户目标；这不是建议，是 fresh 形态的启动条件。若命令携带 `--github-issue`，`bootstrap` 先行种一条 `executor=external` 的 issue 跟踪任务，再由 orchestrator 补齐剩余 DAG。
4. 每个 task 至少有 `id`、`title`、`status`、`deps`、`acceptance`。填上 `goal` 与 `git`；保留已写好的 `owner.session_id`、`owner.active` 和所有已落板的 policy / WIP / priority 字段。所有 board 写入都走 `ccm`，不要手改 JSON。
5. 写完 DAG 后立刻 `ccm board graph` / `ccm board next` 对账：确认 readySet 非空或明确 blocked_on:user；若 graph/lint 不净，先修 board，不要开始执行。
6. 只有当用户用自然语言明确补充了启动 flag 没表达的旋钮时，才用 `ccm` 写入对应字段。不要自创 board 字段；不要写“板级 token 预算”或“板级默认模型档”。
7. 跑主循环：reconcile board → surface 用户闸 → 在 WIP 限额内派发 ready 任务 → 等待窗口里做合规 fill-work → 端点验收完成节点 → 让步前 flush board。每个推进节点都必须在 board 上有 task/log 证据。

## resume 形态

1. 读注入 context 里的 board 路径。先进入 board 记录的 `git.worktree`，核对当前目录和分支；不在正确 worktree / branch 时先停下对账。
2. 调用 `master-orchestrator-guide` skill。不要重拆 goal，不要重置 `tasks[]`。
3. 通读现有 `tasks[]`，重建状态模型。旧 session 留下的 `in_flight` 都按孤儿处理：产物已落地且端点验收通过则标 `done` / `verified`；否则降回 `ready` / `stale` 重新派发，拿本 session 可追踪的新 handle。
4. 保留已写好的 `owner.session_id`，后续所有写回都经 `ccm` 或 board 写入纪律完成，并刷新 heartbeat。
5. 继续执行 master orchestrator 决策程序。

你是指挥，不是乐手。把实现、审查、长跑验证派给 Codex 可用的后台终端 / 子 agent 机制；前台持续协调、验收和更新 board。
