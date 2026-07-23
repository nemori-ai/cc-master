# Track B with-skill run 3

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` only
- session: `fda06323-d5fc-447a-8015-02d205f59908`

## Final response

# Track B Merge-Readiness Memo：Lumen 第四 host

## 结论：**不可合并**

这份 patch 不能按当前形态进入 release branch。28/28 “green” 只是 source/dist 结构映射通过，不等于能力等价——`n-host-capability-parity.md` 明确写明“事件名、文件形状或生成成功不能单独决定 Track A”。证据包里至少有 4 处需要在合并前处理。

## 逐项依据与判定

**1. `compatibility-matrix.md` vs `lumen.md` 状态冲突**
`host-adapter-boundaries.md`：“如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base”；`n-host-capability-parity.md` 也把“目标 host 当前支持什么”的 SSOT 定为 `<host>.md`，冲突按该页证据优先级判定。当前没有任何一方给出实测证据，属于案例明确禁止的“编造缺失的 runtime evidence”——必须先补 probe，不能靠猜。

**2. `beforeCondense` 只能 observe/log，不能注入 recovery context**
对照最近实现（compaction 后注入 state）属于跨 surface 能力，能力不对等，按 `source-to-adapter.md` 的 Capability INTENT 规则，这不是单一 skill/hook 的 SAP/PHIP 适配，必须落到 `design_docs/harnesses/capabilities/` 对应 card（角色/上下文重注入一类），标注 divergence 类型（`event-unavailable`）与 `compensating_mechanism`，而不是直接改现有 implementation 冒充等价。

**3. `stop` 只能附带建议、不能硬阻断**
这直接对应现有 `design_docs/harnesses/capabilities/stop-continuation-gate.md`。原实现是“hard-block 直到 board state safe”的安全不变量，Lumen 降级为“建议”，属于用户可见语义弱化，很可能是 `protocol-capability-gap`。这不是可以静默合并的 cosmetic 差异——card 未更新前，不能声称该 surface green。

**4. 批处理靠复制最近实现 + opportunistic flush 近似**
PHIP 规则（`source-to-adapter.md`）：hook 共享点是 contract 不是脚本正文；Lumen 没有 batch-completion 原生事件，只能 per-tool callback，这是 Track B。当前做法是“复制实现”而非在 Capability Card 声明 divergence，且该 hook 的 `CONTRACT.md` 未记录 Lumen 的 host-native implementation 差异，acceptance 未经 equivalence fixture 验证，只是“生成成功”。

**5. 为改两个 path 示例，直接把 canonical 正文 fork 进 Lumen-only 文件夹**
明确违反 SKILL.md 的 Skill adapter 纪律：“一个 skill 的方法论只应该有一份 canonical”、“如果 host 需要改正文，优先用 slot/placeholder 或明确 patch，不要 fork 一份独立正文”；`host-adapter-boundaries.md` 也规定路径差异要用中性 slot 由 adapter 投影，对应 `path-token-resolution.md` capability。这是本次证据包里最明确的纪律违规，必须撤销。

## 有序动作
1. 补 Lumen 实测 probe，把冲突写回 `lumen.md`（host base），再回填 `compatibility-matrix.md`，消除权威性矛盾。
2. 撤销 canonical 正文的直接 fork，改用中性 path slot + `adapters/lumen/strategy.yaml` 的 path token rewrite。
3. 把 3、4、5 三个非 1:1 surface 走 Track B：新增/更新对应 Capability Card 的 intent、acceptance、declared divergence、compensating_mechanism；同步更新相关 hook 的 `CONTRACT.md` host-implementation 段。
4. 为这三个能力补 equivalence-class fixture，验证的是可测试 acceptance 而非结构映射，替换掉“28 green”这个不可靠信号。
5. 重新跑 projection + Lumen host-native validation（对应 Cursor 那套 sync/content test 的 Lumen 版本），确认无 drift。
6. 时间不足以在 35 分钟内做完 1–5 时，建议只合并确有等价证据的 25 个 surface，其余三项和 host 状态声明整体拆出，标记为未完成，不能整批放行。
