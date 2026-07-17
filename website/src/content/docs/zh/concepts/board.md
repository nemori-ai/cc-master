---
title: board
description: 一个 JSON 文件就是一场编排的单一真相源——也是 hook 唯一被允许读的状态。
section: concepts
order: 1
deeper:
  - label: board.md —— 协议叙事与长程操作纪律
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/master-orchestrator-guide/canonical/references/board.md
  - label: ADR-003 —— board 的 narrow waist
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-003-board-narrow-waist.md
---

每场编排都活在一块 **board** 上：一个 JSON 文件，装着一张带状态的任务依赖图，外加目标、审计日志和运行时花名册。它是扛得住 context compaction 的记忆、session 之间交接的凭证，也是 hook 观察世界的唯一窗口。

board 集中放在 `${CC_MASTER_HOME:-$HOME/.cc_master}/boards/`，一场编排一份，文件名形如 `<UTC-timestamp>-<pid>.board.json`，并发开跑也不撞名。home 是 harness 中立的——它不随 `CLAUDE_CONFIG_DIR` 或任何 harness 配置搬家。

## narrow waist（窄腰）

只有少数固定字段是**机制契约**——hook 恰好只依赖这些，别无其他：

- `schema`、`goal`、`owner`（session id、active 标志）、`git`（worktree、branch）
- `tasks[]` 的 `{id, status, deps}` 和 status 枚举

其余一切——估算、决策包、协调块、可观测字段——都是 **agent-shaped**：orchestrator 可以自由塑形，hook 绝不读它。这就是 narrow waist：协议保持极小极稳，agent 的规划自由度才能保持极大。动一个窄腰字段，必须在同一个 PR 里同步改全部 hook 和测试。

## 任务状态：八态

| status | 含义 |
|---|---|
| `ready` | 依赖全部满足——现在就可派发 |
| `in_flight` | 已派发、正在跑（必须对应一个真实 handle） |
| `blocked` | 在等依赖（自动门控）或在等语义阻塞源（比如一个用户决策） |
| `done` | 完成**且**验收——见下 |
| `escalated` | worker 返回了超出其能力范围的升级请求 |
| `failed` | 本次 attempt 失败；retry 会开一个全新 attempt |
| `stale` | 上游产物变了；需要重跑 |
| `uncertain` | 做了但还没验收 |

你绝不手改 `status`。生命周期 verb（`ccm task start|done|block|unblock|retry`）负责合法转移，而 `ready`/`blocked` 在每次写入时按 `deps` 自动门控——依赖全部完成的任务会自己翻回 `ready`。

## `done` 就是真做完

任务进 `done` 必须同时有 `verified: true` **和**非空 `artifact`。裸 `done` 会在写入关卡被引擎拒绝（exit 3）。自报、绿灯 CI、跑完的 worker 进程都只是证据——不是验收。验收发生在 orchestrator 自己的端点，而 artifact 链接让结果日后可审计、可续跑。

## 一切写入经 ccm

每一次 board 变更都要过 `ccm` CLI 的写入关卡：文件锁 → 变更 → 依赖重门控 → **82 条不变式**（schema、图、业务规则）lint → 原子落盘。两个 hook 从外侧把守同一条边界：

- **board-guard**（PreToolUse）拦下任何直接对 `*.board.json` 的 `Write`/`Edit`/shell 重定向，并告诉你该换哪个 `ccm` verb。
- **board-lint**（PostToolUse）是软性兜底，兜住漏网之鱼。

结果：board 对下一个读者永远可信——无论那是 viewer、另一个 session 里的 resume，还是一个正在判断你能不能停的 hook。
