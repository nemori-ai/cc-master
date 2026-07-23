# Independent-review remediation with-skill run 1

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` only

## Final response

## Merge 判定：**不 ready，不合并**

依据本仓的 Track A/Track B 与 SAP/PHIP 纪律逐条核对，这个 patch 目前有四类未闭合的门禁，且都直接挂在 `n-host-capability-parity.md`、`source-to-adapter.md`、`host-adapter-boundaries.md`、`plugin-release-system.md` 已写明的验收条件上，不是我个人经验判断。

**1. compatibility-matrix 与 lumen.md 的矛盾必须先按规则收敛，不能悬置。**
`host-adapter-boundaries.md`："如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base。" lumen.md（host base）说 future sketch，compatibility-matrix（生成/汇总产物）说 published——按此规则应以 lumen.md 为准，且必须把这次冲突显式记录进 lumen.md，而不是让 "published" 未加说明地留在 matrix 里。这是合并前的硬性动作，不是可选项。

**2. 三处非 1:1 能力（beforeCondense 只读、stop 只能建议不能 block、无 batch-completion 事件）都是 Track B，尚未走完 gate。**
`n-host-capability-parity.md` 明确："事件名、文件形状或生成成功不能单独决定 Track A。" 已有的三张 Capability Card（`stop-continuation-gate.md` 的 `stop-hard-block-envelope`、`role-substrate-reinject.md` 的 `reinject-full-substrate-on-compact`、`usage-pacing-midflight.md` 的 `usage-pacing-post-tool-batch-sampling`）是同形状先例，说明这三处必须补 Capability Card（host-neutral intent + testable acceptance + declared divergence + compensating_mechanism），并**同时**更新所有受影响 hook 的 `CONTRACT.md`。规则原文："Card 与 affected CONTRACT 二者齐备前，host-native implementation 不得进入验收。" 当前 patch 只是"复制最近实现 + 机会性 flush"，没有这两份文档，属于未过 gate 的实现，不能因为 package 是绿的就算数。

**3. 直接 fork canonical 正文改路径示例，违反 SAP 纪律。**
`SKILL.md`："默认模式是 canonical + slot/overlay...一个 skill 的方法论只应该有一份 canonical""partial_overlay 是最后手段"；`source-to-adapter.md`："如果 host 需要改正文，优先用 slot/placeholder...不要 fork 一份独立正文"；`host-adapter-boundaries.md` 路径策略："不要把某个 host 的 path token 写成共享 canonical 事实...用中性 slot...再由 adapter 投影。" 这份 patch 恰好是被明确禁止的做法，必须撤回，改成 canonical 里的中性 slot + Lumen adapter `strategy.yaml` 的 path rewrite。

**4. "28 个 mapped surfaces 绿" 不是能力等价的证据。**
`n-host-capability-parity.md` 的 Artifact 表把"实现是否兑现同一能力"的证据定为 equivalence-class fixture + host-native probe/validator + 生成后 dist，`plugin-release-system.md` 对 Cursor 也重申"能力等价仍由 capability fixture 和真实 host probe 验收，不能用 package shape 替代"。25 个匹配面和 direct-mapping tests 只证明了结构同步，在没有等价类 fixture 前不能写成已验证的 parity。

**结论与顺序：** ①先在 lumen.md 记录并纠正状态冲突 →②为三处 Track B 能力补 Card + 对应 hook CONTRACT，缺一不合并 →③撤回 fork 的 canonical 正文，改用路径 slot →④为已声称匹配的 25 项补等价类 fixture 前不写"parity 已验证"。35 分钟内四项都做不完，本次不合并；如需赶窗口，只能把有真实 fixture 的子集拆出单独走，其余随后续 PR。
