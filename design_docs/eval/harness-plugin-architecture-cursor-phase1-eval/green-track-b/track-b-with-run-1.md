# Track B with-skill run 1

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` only
- session: `2eab57bf-2649-4c77-855f-dcefd59282d5`

## Final response

# Merge-Readiness Memo：Lumen（第四 host）Track B Patch

## 结论：不可合并（现状）

这份 patch 不满足 `n-host-capability-parity.md` 与 `SKILL.md` 的最低纪律，“28 个映射 surface 绿” 不能作为合并依据——`n-host-capability-parity.md` 明确写明“事件名、文件形状或生成成功不能单独决定 Track A”，本例三处已知机制不对等（beforeCondense、stop、batch）恰恰证明这批“绿”很可能只是 surface 存在而非行为等价。

## 依据

1. **权威冲突未解**：`compatibility-matrix.md` 称 Lumen adapter 已 published，`lumen.md` 仍称 future sketch，无说明哪个为准。`host-adapter-boundaries.md` 规定“如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base”——这是合并前必须先解决的阻塞项，因为后续所有“parity 已达成”的判断都建立在 host 事实之上。
2. **beforeCondense（只能 observe/log，无法注入 recovery context）**：这是缺少 1:1 机制的能力差异，按 ADR-031 属 Track B，必须落到 `design_docs/harnesses/capabilities/<id>.md`（本仓已有同族卡片如 `role-substrate-reinject.md`），写明 host-neutral intent、declared divergence 与 compensating_mechanism。未写卡片前不能标记 parity。
3. **stop（Lumen 只能挂建议、无法 hard-block，现有实现是 hard-block 直到 board state 安全）**：这是安全语义丢失，不是风格差异，同样是 Track B（对应能力族群应类比 `stop-continuation-gate.md`）。在时限压力下把它算作“绿”是最高风险项，必须显式声明 divergence 并经评审，不能静默合并。
4. **batch completion（无原生批量事件，“复制最近实现 + opportunistic flush”）**：违反 PHIP 纪律——“Hook 的共享点是 contract，不是脚本正文”（`source-to-adapter.md`）。需要先有该 hook 的 `CONTRACT.md` acceptance，再证明 opportunistic flush 在等价类 fixture 下满足该 acceptance，而不是直接照抄邻近实现了事。
5. **canonical 正文被直接 fork 进 Lumen-only 文件夹改两处路径示例**：直接违反 `SKILL.md`“如果 host 需要改正文，优先用 slot/placeholder 或明确 patch，不要 fork 一份独立正文”以及 `source-to-adapter.md` 的 SAP 规则。这会立刻产生 drift，且“direct-mapping tests 绿”无法检测这种正文分叉。

## 有序行动

1. 先在 `compatibility-matrix.md` 与 `lumen.md` 之间裁定并留痕权威结论（`host-adapter-boundaries.md`），阻塞其余判断。
2. 把 beforeCondense、stop、batch 三项从“green surface”改判为 Track B，分别落 Capability Card（`n-host-capability-parity.md` 分轨判据 + `capabilities/README.md` 字段），stop 一项因涉及安全 hard-block 需单独评审，不随本次合并放行。
3. 撤销 canonical 正文 fork，改为 slot/placeholder 或 `strategy.yaml` patch（`SKILL.md` Skill adapter 纪律、`source-to-adapter.md` SAP 规则）。
4. 为 batch 场景补 hook `CONTRACT.md` acceptance 与 equivalence-class fixture，验证 opportunistic flush 是否真等价（PHIP）。
5. 重新跑 projection 并对 `plugin/dist/lumen` 做 host-native 校验（`plugin-release-system.md` 发布前检查/Drift 防线），而非只看生成成功与测试绿。
6. 25 个确认等价的 surface 可继续保留为 Track A 候选，但不得与上述三项打包为同一次“parity 已达成”结论对外合并。
