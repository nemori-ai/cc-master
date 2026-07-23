# Post-fix Track B with-skill run 2

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- session: `e4055ec6-c32b-4b2d-9a5d-460c711b633e`

## Final response

## 结论：这个 patch 现在不能合并

尽管“28 个 mapped surfaces green”，但 `n-host-capability-parity.md` 明确写着“事件名、文件形状或生成成功不能单独决定 Track A”——parity job 绿灯只证明了 shape/mapping 层面对齐，不能替代 equivalence-class fixture 和 Capability Card/hook CONTRACT 的裁决。证据包里至少有三处硬阻断，一处 host-fact 冲突未解，一处违反 SAP 纪律。

## 按顺序要做的事

**1. 先解决 host-fact 权威性冲突。** `compatibility-matrix.md` 说 Lumen adapter 已 published，`lumen.md` 说还是 future sketch，二者矛盾且无说明。`host-adapter-boundaries.md` 规定“如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base”——在没有真实 probe 证据前，不能把 matrix 的“published”当作合并依据；必须先把冲突写回 `lumen.md`（host base），再决定哪份是权威。

**2. 把三个能力缺口显式归类为 Track B，不能走 Track A 直接 copy。**
- `beforeCondense` 只能 observe/log、不能注入 recovery context，而现有实现是 compaction 后注入 state——用户可见 intent 不等价。
- `stop` 只能附加 suggestion、不能 hard-block，现有实现是 hard-block until board state safe——同样不等价。
- 没有 batch-completion 事件，靠“copy 最近实现 + 机会性 flush”逼近——这是 protocol-capability-gap，不是已验证的替代。

按 `n-host-capability-parity.md`：“Track B 触及 hook 时，Capability Card 与所有 affected hook 的 `CONTRACT.md` 缺一不可”，任一缺失都不能让 green projection 代替契约。目前这三处既无 Capability Card 也未见 hook CONTRACT 更新，必须先补齐 host-neutral intent、testable acceptance、declared divergence（event-unavailable / protocol-capability-gap）与 compensating mechanism，再谈实现验收。

**3. 撤销 canonical 正文 fork。** patch 为了改两个 path 示例，直接把 canonical skill 正文复制进 Lumen-only 文件夹。这违反 SKILL.md 的 Skill adapter 纪律（“一个 skill 的方法论只应该有一份 canonical”，“partial_overlay 是最后手段，不是解除 stub 的捷径”）以及 `host-adapter-boundaries.md` 的 path token 规则（“跨 host canonical 里需要路径时，用中性 slot 或相对 runtime 约定，再由 adapter 投影”）。应改为在 `adapters/lumen/strategy.yaml` 里做 path token rewrite，恢复单一 canonical。

**4. 重新核算“28 green”里哪些才是真正等价验证过的 25 个 surface**，其余 3 个在 Card/CONTRACT 补齐并有 equivalence-class fixture + host-native dist 验证前，一律标为 pending，不计入 merge-ready 集合。

**5. 35 分钟窗口内的实际决定**：不整批合并。若仓库支持按 surface 拆分合并，可只放行确认等价的 25 个（且需先解决第 1 步的 host-fact 冲突记录），三个 Track B 缺口和 canonical fork 问题作为阻断项延后，不用今天的时间压力去豁免契约。
