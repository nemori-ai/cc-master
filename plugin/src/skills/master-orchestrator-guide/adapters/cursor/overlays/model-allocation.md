## Cursor 双 surface 分配

每次分配先记录目标 surface，不要因两者同属 Cursor 而共享模型事实：

- **`cursor-ide-plugin` / IDE 原生 Task**：IDE 的模型 entitlement、catalog、selector 与任务能力映射当前是 `unknown`。没有 IDE-local 证据时 fail closed：不强制精确模型、不从 CLI catalog 推断可用性，也不声称完成了跨 family 复核。
- **`cursor-agent-cli` / headless worker**：只有 ccm headless admission 已将候选绑定到该 surface、fresh first-party catalog 与 subscription pool 时才可派发。先读 `pacing-and-estimation/references/model-tiers.md`；它给出可选性与边界，不证明某个 family 适合某类任务。未有独立 benchmark 或验收证据时，不做任务能力映射。记录 external `run_ref` 而不是 IDE Task id。

准入事实不完整时停止该 worker 路线的分配并重新读取合同。自动换号永久禁止；真实 paid canary 仍须用户对该次调用给出新的明确批准。
