---
name: cc-master-stop
description: 'Triggers: 当你在 Codex 收到 `$cc-master-stop` 时，确认后归档当前 board 并标记 orchestration 停止；Do NOT 将其与 Codex 内置 `/stop` 混淆。'
argument-hint: '[--board <board-path-or-stem>]'
---

$cc-master-stop $ARGUMENTS

归档当前 cc-master board，停用这场 orchestration。不要调用 Codex 内置 `/stop`，它停的是 Codex background terminal，不是 cc-master board。

参数：$ARGUMENTS

先按 `--board` / `CC_MASTER_BOARD` / active board 扫描定位目标 board。展示将被归档的 board、goal、仍在飞或未完成任务；若有 `in_flight` 或未完成任务，明确说明归档会让这些工作失去本 session 看管。

必须获得用户明确确认后，才运行：

```bash
ccm board archive --board "<board-path>"
```

不要手改 board JSON。归档是可逆的，后续可用 `$cc-master-as-master-orchestrator --resume <selector>` 复活。
