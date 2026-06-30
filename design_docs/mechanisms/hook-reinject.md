# 机制契约：`hooks/scripts/reinject.js`

> 类别：hook（`SessionStart`，matcher `startup|resume|compact`，node·require board-model + hook-common（board-v2 收编））。源码：`hooks/scripts/reinject.js`。compaction 后从外部重注「我是 orchestrator」身份。

## 触发输入
- `SessionStart` 事件（startup / resume / compact），stdin JSON 含 `session_id`。
- 读 home（`$CC_MASTER_HOME`，否则 `$CLAUDE_PROJECT_DIR/.claude/cc-master`）下的 `*.board.json`。

## 业务流
1. 从 stdin 取 `sid`。
2. **武装闸 `board_matches`**：board active AND（sid 空 → 降级匹配任一 active 板；否则 owner.session_id == sid）。`active`/`session_id` 只从 root owner 子对象读（`owner_region` awk 深度扫描），绝不全文 grep。
3. 收集**本 session** 的 active 板进 `<name> [<goal>]` 单行 listing；同时用 `dangling_nodes` 收集它们里 `status` 为 `stale`/`escalated` 的 task `id`（per-object 扫描，nested log 不泄漏）。
4. 无匹配的 active 板 → 静默 `exit 0`（无 active orchestration）。
5. 有 → 注入 `SessionStart` additionalContext：「你是 cc-master master orchestrator，板在 <home>，Active:<listing>，重读 board、调 orchestrating-to-completion skill、续决策程序，别重启已 done/verified 的活」。
6. 有 dangling stale/escalated 节点 → context 追加一句点名这些节点，提示 reconcile 后再排新活（空则 context 字节级不变）。

## 输出副作用
- 仅向 stdout 写 `SessionStart` additionalContext JSON。**不写 board。**

## 关键不变式
- **未武装一律静默**（红线 6）——`board_matches` 是闸，未武装无 active 板即 `exit 0`。
- 降级是非对称的：仅 stdin sid 空时才降级匹配任一 active 板（ADR-007 §2.3，compaction 边界）；空 board sid 不被收养（CODEX14 回退）。
- 只读 root owner 的 `active`/`session_id` 两个 pinned 字段——绝不全文 grep（防归档板 task/log 里的 `"active":true` 误武装·CODEX7）。
- 不绑定具体 board——agent 靠 goal 自识其板。

## 失败模式
- 别 session 的 active 板 → `board_matches` 不匹配 → 被忽略（不重锚、不 reconcile）。
- awk 解析失败 → `2>/dev/null` 吞掉、当无该字段（保守）。
