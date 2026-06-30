---
description: '归档 cc-master board 并停用 orchestrator（不删除 board）。'
---

干净地收尾 cc-master 编排。停用一块 board 是**破坏性的**（它会归档这次 orchestration），所以要先认准对的那块 board，并在写入前确认。

1. **认准 board。** Board 集中住在 cc-master home 下的 `boards/` 子目录，以 `<timestamp>-<pid>.board.json` 命名。home 解析：`$CC_MASTER_HOME` 优先，否则 `$CLAUDE_CONFIG_DIR/cc-master`（`CLAUDE_CONFIG_DIR` 默认 `$HOME/.claude`）——全局、用户级、不再 per-project。列出 `<home>/boards/`，读取每一块 `owner.active` 为 `true` 的 board。
   - 若恰好只有一块 active，它就是候选。
   - 若有多块 active，把每块 board 的 `goal` 字段与你一直在推进的目标做匹配，取匹配上的那块。
   - 若多块匹配、无一匹配、或你无法无歧义地确定 board，**向用户询问该停哪块 board**（列出候选及其 `goal` 与文件名），不要靠猜——停错 board 会归档掉别人的 orchestration。
2. **孤儿闸（归档前先查在飞 / 未 done 子任务）。** 跑 `ccm board show --json` 看 `statusCounts`（有几个 `in_flight` / 未 `done` 任务）+ `ccm board lint --json` 看 R7 rollup 一致性（owner 节点与其子任务的卷积是否对齐）。**若还有 N 个 in_flight / 未 done 任务，明确点名告诉用户「归档会孤儿化 X 个在飞任务」**——它们的后台 handle 会随本 session 失去看管（归档后全套 hook 对这块板休眠、不再有人盯它们）。让用户带着这个事实再决定停不停。
3. **停用前先确认。** 说明你将要停的是哪块 board（它的 `goal` 与文件名）+ 上一步的孤儿提示，并请用户确认。归档让全套 hook 对这块 board 休眠（停用即休眠）——这是一次**显式可逆的归档**而非永久终态：board 文件保留，日后想续跑可经 `/cc-master:as-master-orchestrator --resume <选择器>` 在新 session 里把它复活（`active:false → true` + 重盖 owner，`tasks`/`log`/`goal` 全留）。即便如此，停用仍是会改变状态的一步，没有用户确认，不要停用。
4. **确认后，跑 `ccm board archive` 归档**（多块板时加 `--board <path>` 钉死你认准的那块）。这条 verb 走引擎**带锁**翻 `owner.active=false`——**绝不要手编辑 board JSON 改这个字段**：手编辑与 Stop hook 的带锁写并发会 torn-write、毁掉 board 状态（ADR-020）。归档非破坏：`tasks`/`log`/`goal`/`git` 全留作审计记录、文件不删。就这一步即完成停用（hooks 只把 `owner.active:true` 的 board 当活的，没有另外的标记文件要清）。
5. 给用户一段话的收尾说明：什么完成了（带 artifacts）、什么还在飞（被孤儿化的那些）、什么仍阻塞在他们身上。
