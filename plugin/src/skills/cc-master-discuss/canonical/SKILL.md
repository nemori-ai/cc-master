---
name: cc-master-discuss
description: 'Triggers: 当你在 Codex 收到 `$cc-master-discuss <node-id>` 时，围绕 awaiting-user 决策包做讨论并写入 sidecar；Do NOT 用于非等待类节点或替代 board 面更新。'
argument-hint: '<node-id> [--board <board-path-or-stem>] [--home <path>]'
---

$cc-master-discuss $ARGUMENTS

围绕一个 awaiting-user 节点的 `decision_package` 做一次有准备的采访式讨论，并把结论写成 sidecar。

参数：$ARGUMENTS

解析 `<node-id>`，按 `--home` / `--board` / `CC_MASTER_BOARD` / active board 扫描定位 board，读取该节点的 `decision_package`。`--home` 要 quote-aware；`--board` 和 `<node-id>` 拼路径前必须做 path-safe guard，不能让 `/` 或 `..` 逃出 cc-master home。

你不是 orchestrator，不要派发任务、不要直接改 board。职责是：讲清上下文 → 帮用户把问题谈透 → 把结论写入 append-only sidecar。

讨论时围绕：

- `decision_package.question`
- `what_i_need`
- `why_it_matters`
- `options`
- `upstream` 输入 hash

若需要，先按当前 board / 代码现实刷新依据后再更新。若材料已过时，明确告诉用户重跑上游核验后再决断。

结束后写一个 sidecar，形态：

```text
<board-stem>--<node-id>--<YYYYMMDDTHHMMSSZ>[collision-suffix].decision.md
```

永不覆盖旧 sidecar；同秒碰撞时追加 `-2`、`-3`。frontmatter 至少包含 `node_id`、`resolved_at`、`inputs_hash_at_decision`、`ask_type`、`round`。写完把路径反馈给用户；master-orchestrator 下次 recon 时会消化它。
