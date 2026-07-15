## Cursor 双 surface 模型事实入口

先运行 `ccm provider facts cursor --json`。该命令返回 ccm 内置、带 Cursor 官方来源和有效期的 snapshot；本页只教你消费字段，不维护第二份 selector allowlist。

### `cursor-ide-plugin`：IDE 原生 Task

若 `unknown[]` 仍含 `cursor_ide_task_model_catalog` 或 `cursor_ide_task_selector_acceptance`，IDE 的精确模型与 selector 就必须保持 `unknown` 并 fail closed。不得用 `cursor-agent-cli` 的 catalog、quota、entitlement 或 selector 补齐 IDE 事实，也不得因两者登录同一 Cursor identity 而声称 IDE Task 接受某个模型。

### `cursor-agent-cli`：headless worker

ccm facts 当前记录 Cursor first-party 的 Auto、Composer 2.5 与 Grok 4.5 selector；精确 selector 只读命令当次返回的 `models[].selectors`。自动候选还必须同时通过：

1. snapshot `freshness:"fresh"` 且 `catalog_eligible_for_admission_check:true`；静态 snapshot 的 `eligible_for_automatic_selection` 必须保持 `false`，不得跳过后续 live gates；
2. fresh `cursor-agent --list-models` catalog 与本次 selector 交集；
3. payer 为 Cursor subscription，quota provenance 绑定 `cursor-first-party` pool；
4. live entitlement、exact-model admission 与 accountable `run_ref` 全部绑定 `cursor-agent-cli` surface。

Auto 只能做 identity smoke，不证明 exact-model acceptance；`fast` 不是省配额档。任何 BYOK、on-demand、API、external-key、shared、unknown 或 ambiguous payer/quota provenance 都 fail closed。API fallback 永久禁止；真实 paid canary 只有在用户对该次调用给出新的明确批准后才可执行。
