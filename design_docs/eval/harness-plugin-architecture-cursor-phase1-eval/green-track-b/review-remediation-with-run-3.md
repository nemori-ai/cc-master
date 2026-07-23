# Independent-review remediation with-skill run 3

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` only

## Final response

# Merge-Readiness Memo：Lumen（第四个 host）

**决策：不可合并。** 这份 patch 展示的证据不满足本仓的 Track B 验收门，且包含一处违反 SAP 纪律的 canonical fork。「28 mapped surfaces green」只是 projection/drift 检查绿灯，不是能力等价的验收证据——按 `references/n-host-capability-parity.md`，Track A 的验收是「equivalence-class fixture + host-native dist」，Track B 是「Capability Card + 受影响 CONTRACT 齐备后再验收」，二者不能互相替代，也不能用一个 parity job 数字合并汇报。

## 按优先级的行动顺序

1. **冻结当前状态声明**：先明确「28 green」只覆盖 direct-mapping/projection 层，不覆盖下述三处已知语义分叉，避免把它当成「adapter published」的证据继续往前推。

2. **解决 `compatibility-matrix.md` 与 `lumen.md` 的冲突**：依据 `host-adapter-boundaries.md`——「如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base」。核实 Lumen 当前版本的真实 adapter 状态，把结论写回 `lumen.md`（host base），再回填 matrix，参照 matrix 里「当前支持状态」行对 Cursor 的写法（状态+host doc+probe+dist 一致引用）。

3. **撤销 canonical 正文 fork**：违反 `SKILL.md`「Skill adapter 纪律」（一份 canonical、partial_overlay 是最后手段）和 `host-adapter-boundaries.md`「Path token 策略」（canonical 不写 host 字面路径），也不满足 `design_docs/harnesses/capabilities/path-token-resolution.md` 的 acceptance #2。改为中性 slot，两个路径示例的差异下沉到 `adapters/lumen/strategy.yaml` 的 path rewrite/slot_replacements。

4. **把 beforeCondense、stop、batch-completion 三个 surface 重新归类为 Track B**：依 `n-host-capability-parity.md` 判据——事件名/生成成功不能单独决定 Track A，这三处都是「表面同名、语义不等价」（observe-only vs inject；suggestion vs hard-block；per-tool 拼凑 vs 原生 batch）。
   - `stop` 一项已有直接先例：`design_docs/harnesses/capabilities/stop-continuation-gate.md` 记录了 Cursor `followup_message`（非 hard block）的 declared divergence 写法（`rule/kind: protocol-capability-gap/affected_hosts/reason/compensating_mechanism/tracked_by`），并链接 `plugin/src/hooks/verify-board/CONTRACT.md`。Lumen「只能附加建议、不能 block」应比照同一模式补条目，不能让 patch 把 hard-block 静默降级为建议。
   - beforeCondense、batch-completion 在 `design_docs/harnesses/capabilities/` 下暂无对应卡片，需新增 Card（host-neutral intent、可测 acceptance、host mechanism 表、declared divergence + compensating_mechanism），并同步更新所有涉及的 hook `CONTRACT.md`。

5. **门禁**：Card 与受影响 CONTRACT 未同时齐备前，这三处的 host-native implementation 不得进入验收——`n-host-capability-parity.md` 明文规定。当前「direct-mapping tests green」不覆盖这三处分叉，不能当作已验收。

6. **补 Lumen 的可执行发布门**：若无官方 validator，参照 `plugin-release-system.md` 中 Cursor 的先例（sync + drift check + content tests + package 组成替代门），不能只靠 parity job 数字。

7. 剩余 25 个真等价 surface 可继续走 Track A 独立合并，但不得与上述未清理项混在同一条「adapter ready」结论里。35 分钟的时限不构成跳过 Card/CONTRACT 门槛的理由。
