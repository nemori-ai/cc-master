用户在前台敲这些 kimi-code slash commands；你该知道它们的存在与语义，好配合：

- **`ccm status-report show`** — 生成 board 状态报告（用户看进度 / 阻塞 / 待决策；CLI 与 viewer 共用同一 JSON schema）。
- **`cc-master:discuss <决策>`** — 用户对一个 `blocked_on:"user"` 决策开采访式讨论、结论回流；**你 prefetch 的 `decision_package` 在这被消费**（「该问就问」镜头）。
- **可视化** — 用 `ccm web-viewer open` 打开浏览器只读 DAG viewer。
- **`cc-master:handoff-to-new-session`** — 把编排优雅交给新 session（与 `--resume` 配对；写侧纪律见 `references/handoff.md`）。
- **`cc-master:stop`** — 归档 board（可逆·可 `cc-master:as-master-orchestrator --resume` 复活）。namespaced `cc-master:stop` 与任何内置命令都不撞。
- **`cc-master:retro`** / **`cc-master:distill`** — 复盘与蒸馏候选教训。
- （`cc-master:as-master-orchestrator` = 点火，你已在其中。）
