Cursor 下 cc-master 的命令面是 **host-native command markdown + plugin skills + `ccm` CLI**（外加 beforeSubmitPrompt bootstrap）：

- **初始化 / 续跑** — 用户触发 as-master-orchestrator 命令 / prompt；bootstrap hook 建板或 `--resume` 再武装。
- **状态 / 图** — 用 `ccm board show/lint/graph/next --json`；用量用 `ccm usage advise --json`（billing_period）。
- **停止 / 交接** — 用 `ccm board archive` 与 handoff 纪律；不要把 Cursor 内置 `/stop` 当成 cc-master 停用。
- **可视化** — `ccm web-viewer open`。
- **用户决策讨论** — `decision_package` 在当前线程 surface；不依赖 Claude Code discuss slash command。
