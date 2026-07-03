Codex 有内置 slash commands（如 `/status`、`/usage`、`/skills`、`/plugins`、`/resume`）；Codex plugin 当前不分发自定义 `/cc-master:*` command artifact。cc-master 在 Codex 下的命令面是 **prompt-first hook + plugin skills + `ccm` CLI**：

- **初始化 / 续跑** — 用户可用 `$cc-master-as-master-orchestrator <goal>` 触发 Codex UserPromptSubmit hook 新建 board；也可用 `--resume <board-stem>` 把旧 board 重新武装到当前 Codex session。
- **状态 / 图** — 不要调用 Codex 内置 `/status` 来查 cc-master board；它查的是 Codex session。要查 board，用 `ccm board show --json`、`ccm board lint --json`、`ccm board graph --json`、`ccm board next --json`，用量快照用 `ccm usage advise --json`。
- **停止 / 交接** — 不要调用 Codex 内置 `/stop`；它停的是背景终端。cc-master 停用是先确认目标 board，再用 `ccm board archive --board <board-path>` 归档；交接时先 quiesce/drain，写 handoff 文档，`ccm log add ... --kind handoff --detail <path> --board <board-path>`，再 archive，并告诉用户用 `$cc-master-as-master-orchestrator --resume <selector>` 接手。
- **可视化** — 本 skill bundle 携带 `scripts/view-server.js` / `scripts/view.html` / `scripts/vendor/`；在能定位本 skill 目录时，用 `CC_MASTER_BOARD=<board-path> node <skill-dir>/scripts/view-server.js` 起本地只读 viewer。
- **用户决策讨论** — `decision_package` 是 board 上的上下文包；Codex 下让用户直接在当前线程或另起线程围绕该包回答，把结论写成 append-only `.decision.md` sidecar，再由你 recon 消化，不依赖 Claude Code 的 discuss slash command。
