**本 host 机制（kimi-code）**：先认清 kimi-code 只有单一 origin surface，再选第二视角；同一个 kimi 模型再跑一遍不算异构。

- **kimi-code 内置 subagent 角色**：`coder` / `explore` / `plan` / `general` + Agent Swarm 都跑同一个 kimi 模型——**另开一个内置 subagent 不构成异构复核**（产出族 = 验收族）。不要把“再起一个 Task”自动算成异构；只有外部证据能证明产出族与验收族不同时才记为异构。
- **`kimi -p` CLI worker**：只有当 ccm 返回 fresh first-party catalog、subscription payer/quota provenance、live entitlement 与 exact admission 全部绑定，且候选模型档确与本任务产出族不同时，才把它当 review-only worker，记录 external `run_ref`；prose 里的 model 名或 selector 不能替代本次 admission。
- **其它 harness**：如果 ccm 给出一个独立、fresh、已准入的 Codex 或 Claude Code candidate，这才是真正的 cross-harness reviewer；记录 harness、surface、payer、quota pool、模型事实 revision 与 accountable handle。它不是 kimi-code 内置 subagent，也不能冒充 kimi-code 配额。

只给 reviewer diff + 验收契约。同族再跑一遍不算异构；事实过期、身份不明或需要 API/BYOK/on-demand 容量时 fail closed。真实付费 canary 仍须用户对该次调用明确批准。
