# 跨 harness 目标事实 —— selected target 的只读解释

> **何时读：** 你已为一个候选 worker 取得 machine inventory、target-provider model facts 与 quota
> authority 输出，需要从任意 origin 按同一口径解释它们时。命令形状查
> [using-ccm 主动查询合同](${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/command-catalog.md#跨-harness-主动查询目标事实)；
> 是否派发交回 `master-orchestrator-guide`。

把每份 envelope 绑定到 **selected target**，不要绑定到当前 origin：

1. **Surface**：读取精确的 surface id、kind、binary/auth provenance 与 freshness。
   `cursor-ide-plugin` 和 `cursor-agent-cli` 是独立 surface；任一方 installed/authenticated 都不能补齐另一方。
2. **Model**：静态 provider facts 只证明 catalog snapshot 的来源、有效期与 admission-check 资格。
   `fresh` 不等于 live entitlement，也不等于 exact-model admission；`unknown[]` 与 blocker 必须保真。
3. **Quota**：store status 的 `available:true` 只证明本地 authority store 可读，**不等于 ample headroom**。
   只有 authority-bound preflight 的 freshness、payer/pool identity、decision、spawn limit 与 blockers 才能描述
   该候选的 quota state。
4. **Binding**：surface、provider、account/payer、pool、model 与 quota evidence 必须指向同一候选和同一
   freshness 时点；跨 surface、跨 payer 或跨 pool 拼接的“完整证据”仍是不完整证据。

把结果整理为 `eligible` 或 `insufficient` 的 advisory 输入，并附 provenance / freshness / unknown / blocker。
任何承重事实 unknown、stale、conflicting 或 tight 都保持 `insufficient` 并交给决策层 fail closed；不要在这里
启动、停止或验收 worker，也不要解释 worker 的执行终态与副作用。
