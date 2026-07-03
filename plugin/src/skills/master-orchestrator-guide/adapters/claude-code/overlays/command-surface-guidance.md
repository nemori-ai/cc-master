用户在前台敲这些 `/cc-master:*`；你该知道它们的存在与语义，好配合：

- **`/cc-master:status`** — 渲染 board 摘要（用户看进度 / 阻塞 / 待决策）。
- **`/cc-master:discuss <决策>`** — 用户对一个 `blocked_on:"user"` 决策开采访式讨论、结论回流；**你 prefetch 的 `decision_package` 在这被消费**（「该问就问」镜头）。
- **`/cc-master:view`** — 浏览器只读 DAG 可视化（每 2s 活轮询·零联网）。
- **`/cc-master:handoff-to-new-session`** — 把编排优雅交给新 session（与 `--resume` 配对；写侧纪律见 `references/handoff.md`）。
- **`/cc-master:stop`** — 归档 board（可逆·可 `--resume` 复活）。
- （`as-master-orchestrator` = 点火，你已在其中。）
