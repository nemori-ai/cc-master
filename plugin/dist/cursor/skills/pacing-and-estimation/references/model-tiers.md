# 模型档位事实 —— 可用性、相对成本与能力边界

> **何时读：** 需要确认当前 host 可用哪些档位、相对成本、能力边界、provenance 或不确定性时读取；把事实交给 `master-orchestrator-guide` 的 `references/model-allocation.md` 作具体分档、主线固定与容量动作。

## Cursor 双 surface 模型事实

### `cursor-ide-plugin`：IDE 原生 Task

当前没有 IDE-local 证据可以证明 `cursor-ide-plugin` 的模型 entitlement、catalog、Task 可接受 selector 或任务能力映射；这些轴一律保持 `unknown` 并 fail closed。不得用下方 `cursor-agent-cli` 的 quota、catalog、entitlement 或 selector 补齐 IDE 事实，也不得因两者登录同一 Cursor identity 而声称 IDE Task 接受某个精确模型。

### `cursor-agent-cli`：headless worker

以下 first-party 自动候选合同只适用于 `cursor-agent-cli` headless worker，不适用于 IDE 原生 Task。

自动候选必须同时通过五闸，缺一即拒绝：

1. `plan_payer_topology.state` 是 fresh `known`，且 `payer` 精确为 `subscription`。
2. quota fact fresh，`source` 精确为 `cursor-agent:first-party-quota`。
3. `quota.provenance` 精确为 `provider:cursor`、`payer:cursor-subscription`、`quota_pool:cursor-first-party`、`source:cursor-agent:first-party-quota`，且唯一 `pool_ref` 是 `cursor:subscription:first-party`。
4. 每次候选选择先为 `cursor-agent-cli` 读 `cursor-agent --list-models` 零请求 catalog；其 `source` 必须精确为 `cursor-agent:--list-models` 且仍 fresh。selector 名不能替代 catalog 或 provenance，不能靠字符串猜 family。
5. live entitlement 的每个 model ref 都同时出现在下列 allowlist 与本次 catalog 中。

唯一 selector allowlist：

- `auto`
- `composer-2.5`
- `composer-2.5-fast`
- `cursor-grok-4.5-low`
- `cursor-grok-4.5-medium`
- `cursor-grok-4.5-high`
- `cursor-grok-4.5-low-fast`
- `cursor-grok-4.5-medium-fast`
- `cursor-grok-4.5-high-fast`

动态 smoke selector 不能证明 exact-model / model-identity acceptance。Composer 2.5、Grok 4.5 low/medium/high 及其 `fast` 变体只是 `cursor-agent-cli` 通过合同准入的可选性事实，不是任务能力映射；`fast` 不是省配额档。未有任务类型的独立证据前，不得把任一 family 固定分配给某类任务。

任何 BYOK、on-demand、API、external-key、shared、unknown 或 ambiguous payer / quota-pool provenance 都 fail closed。API selector 一律 deny；API fallback 永久禁止。真实 paid canary 只有在用户对该次调用给出新的明确批准后才可执行；否则只跑 hermetic/offline corpus。
