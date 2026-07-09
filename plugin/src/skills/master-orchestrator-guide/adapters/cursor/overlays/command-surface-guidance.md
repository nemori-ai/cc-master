用户在前台敲这些 Cursor slash commands；你该知道它们的存在与语义，好配合：

- **`ccm status-report show`** — 生成 board 状态报告（用户看进度 / 阻塞 / 待决策；CLI 与 viewer 共用同一 JSON schema）。
- **`/discuss <决策>`** — 用户对一个 `blocked_on:"user"` 决策开采访式讨论、结论回流；**你 prefetch 的 `decision_package` 在这被消费**（「该问就问」镜头）。
- **可视化** — 用 `ccm web-viewer open` 打开浏览器只读 DAG viewer。
- **`/handoff-to-new-session`** — 把编排优雅交给新 conversation（与 `--resume` 配对；写侧纪律见 `references/handoff.md`）。
- **`/cc-master-stop`** — 归档 board（可逆·可 `/as-master-orchestrator --resume` 复活）。**不要**把 Cursor 内置 `/stop`（结束 Agent 回合）当成 cc-master 停用。
- **`/retro`** / **`/distill`** — 复盘与蒸馏候选教训。
- （`/as-master-orchestrator` = 点火，你已在其中。）
