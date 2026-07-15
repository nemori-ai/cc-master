**本 host 机制（Cursor）**：先区分两个 surface，再选择第二视角；同属 Cursor 不代表共享模型目录或 selector。

- **IDE 原生 Task**：IDE 的模型目录、selector 接受面与精确身份当前保持 `unknown`。不要给 Task 强塞 GPT、Claude 或 CLI selector，也不要把“另开一个 Task”自动算成异构复核；只有 IDE-local 证据能证明产出族与验收族不同时才记为异构。
- **`cursor-agent-cli`**：先读 `ccm provider facts cursor --json`，再要求 fresh first-party catalog、subscription payer/quota provenance、live entitlement 与 exact admission 全部绑定到 CLI surface。只有 ccm 返回 fresh 且候选已准入时才选 review-only worker，记录 external `run_ref`；prose 中的 family 名或 selector 不能替代本次 admission。
- **其它 harness**：如果 ccm 给出一个独立、fresh、已准入的 Codex 或 Claude Code candidate，可把它作为 cross-harness reviewer；记录 harness、surface、payer、quota pool、模型事实 revision 与 accountable handle。它不是 Cursor IDE Task，也不能冒充 Cursor 配额。

只给 reviewer diff + 验收契约。同族再跑一遍不算异构；事实过期、身份不明或需要 API/BYOK/on-demand 容量时 fail closed。真实付费 canary 仍须用户对该次调用明确批准。
