---
point: pacing.selected-target-facts
---

## 权威陈述

<!-- ccm:k:start point:pacing.selected-target-facts -->
把每份 envelope 绑定到 **selected target**，不要绑定到当前 origin：

1. **Surface**：读取精确的 surface id、kind、binary/auth provenance 与 freshness。
   `cursor-ide-plugin` 和 `cursor-agent-cli` 是独立 surface；任一方 installed/authenticated 都不能补齐另一方。
2. **Model**：静态 provider facts 只证明 catalog snapshot 的来源、有效期与 admission-check 资格。
   `fresh` 不等于 live entitlement，也不等于 exact-model admission；`unknown[]` 与 blocker 必须保真。
   用 `ccm model-policy show --task <task-taxonomy> --json` 把四路 provider facts、项目角色证据与社区 advisory
   投影成所有 origin 相同的 read model；三层仍须分开，不能用社区 taste 补 role certification。
3. **Quota**：先用 `quota status --machine-wide` 的 target-bound cached posture 看所有本机候选；
   `state:"healthy"` 仍只证明该 target 的承重窗口未触发收紧，unknown / stale / missing 不能补成 healthy。
   普通 store status 的 `available:true` 只证明本地 store 可读，**不等于 headroom**；只有 authority-bound
   preflight 的 freshness、payer/pool identity、decision、spawn limit 与 blockers 才能授权具体 spawn。
4. **Binding**：surface、provider、account/payer、pool、model 与 quota evidence 必须指向同一候选和同一
   freshness 时点；跨 surface、跨 payer 或跨 pool 拼接的“完整证据”仍是不完整证据。

把结果整理为 `eligible` 或 `insufficient` 的 advisory 输入，并附 provenance / freshness / unknown / blocker。
任何承重事实 unknown、stale、conflicting 或 tight 都保持 `insufficient` 并交给决策层 fail closed；不要在这里
启动、停止或验收 worker，也不要解释 worker 的执行终态与副作用。

本页不复制 provider CLI flags、model
catalog 或 model/effort 参数，也不把易腐的 provider 命令面改写成 ccm 标准参数。
<!-- ccm:k:end point:pacing.selected-target-facts -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删除后,agent 在某一项事实 unknown/stale 时,会倾向于拼凑不同候选、不同时点的其它证据凑出一个看起来完整的 eligible 结论,而不是老实判 insufficient 交给决策层 fail closed。

主体是 surface/model/quota/binding 四类证据在本项目的具体语义与命令面（fresh≠entitlement、available≠headroom），fail-closed 只是附加条款。

## 边界

唯一客观成立的例外是系统里当下只存在一个候选(没有其它 target 可供误拼),此时跨候选拼接的风险本身不存在,binding 要求天然满足,不需要额外交叉核验同一 freshness。

## 失败形态

输出的 eligible 结论格式上齐全——附了 provenance、freshness,每个字段单独看都不为空,但细究会发现 surface 取自候选 X 的最新读数、quota 却是候选 Y 几分钟前的缓存,两者从未在同一 freshness 时点共同成立。
