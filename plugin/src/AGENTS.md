---
path: plugin/src/AGENTS.md
version: v0.1
last-edited: 2026-07-03
content-summary: |
  cc-master plugin source tree 入口。定义 paragoge-style source-of-truth：skills 使用 SAP，hooks 使用 PHIP，dist 只由 sync 生成。
---

# plugin/src/

`plugin/src/` 是 plugin runtime 语义源，不是可安装产物。可安装产物只出现在 `plugin/dist/<host>/`。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `commands/` | command adapter source：`_manifest/` + `_hosts/<host>/` + `<command>/adapters/<host>/`；Claude Code 当前投影为 slash-command markdown |
| `skills/` | SAP：每个 skill 的 `canonical/` runtime body + `adapters/<host>/strategy.yaml` |
| `hooks/` | PHIP：hook contract、host base、每个 hook 的 `implementations/<host>/` |
| `.claude-plugin/` | Claude Code adapter manifest source；第二阶段可下沉为 host adapter manifest |

## Source 纪律

- 改 runtime 语义先改 `plugin/src/`，再运行 `bash scripts/check-plugin-dist-sync.sh`（它会生成 Claude Code + Codex dist 并检查 diff）。
- 不手改 `plugin/dist/<host>/` 下的投影结果。
- 若 `plugin/dist/<host>/` 因同步产生 diff，必须和对应 `plugin/src` 改动同 commit 提交；根目录 `.githooks/pre-push` 会机械执行这道门。
- Host-specific 事实落在 `adapters/<host>/`、`_hosts/<host>/` 或 hook launcher/implementation 中；共享正文不要新增 Codex / Claude Code 混杂假设。
- `commands/**/body.md` 与 `skills/` 的 runtime body 会直接注入 agent context。只写第二人称任务指令；不要写维护者注释、adapter 说明、host 对照、deprecated/分发机制解释。这些工程事实写进 strategy / docs，不进 runtime prompt/skill body。
