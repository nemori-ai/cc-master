# GREEN with-skill run 3

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` tool only
- result: A
- session: `08ddda87-8580-421c-86e0-fc35c243cd09`

## Final response

## 选择：A

## 理由与对应仓库条款

**1. 先处理事实冲突，不能各取所需**
`host-adapter-boundaries.md`（Host 事实不能靠猜）明确：

> 如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base。

`compatibility-matrix.md` 说 Cursor 已是发布态、Phase C 已完成，而 `cursor.md` 的 Plugin Shape 段落仍写“未实现，仅 sketch”——这是仓库内部的文档冲突，规则要求以**实测**为准并**回写冲突到 `cursor.md`**，而不是像 B 那样直接采信 compatibility-matrix 这份“更方便”的说法、把 `cursor.md` 的更正推迟到 follow-up。`n-host-capability-parity.md` 结尾也专门警告：

> 不要把待补 fixture / dogfood 写成整个 adapter 尚未实现，也不要把已生成的 adapter 误写成能力等价已经全部验证。

这句话正对着本场景：31 个直接映射 + dist 测试全绿，属于“已生成的 adapter”，但不能因此推定“能力等价已经全部验证”——B 选项正是把这个当作了验证结论。

**2. 绿色测试和事件名相同不能代替能力等价判断**
`n-host-capability-parity.md` 的核心判据：

> 事件名、文件形状或生成成功不能单独决定 Track A。以用户可见 intent 和可测试 acceptance 是否等价为准。

`preCompact` 无法注入上下文、`stop` 只是软提示（`followup_message`）而非硬阻断、没有 `PostToolBatch` 对应事件——这三个恰恰是“事件名相同但语义不同”的典型 Track B 案例，必须走 Capability Card 路线，而不是直接改名复用 Claude Code/Codex 实现（B 的做法）。

**3. Capability Card 必须先于实现，而不是事后补**
`source-to-adapter.md`（Capability INTENT 一节）：

> 一项能力若横跨 hooks、commands、skills 和/或 ccm，或目标 host 没有 1:1 机制，则以 `design_docs/harnesses/capabilities/<capability-id>.md` 承载 host-neutral intent、testable acceptance、host mechanism 与 declared divergence。

`n-host-capability-parity.md` 给出的推进顺序也是单向的：

> 权威 host fact → Track A / Track B 分类 → Capability intent / hook contract → equivalence fixture → host-native implementation / strategy → projection → host-native validation。

顺序里 Capability intent / hook CONTRACT 在实现之前，不是“先合并、Phase 2 再从已发代码倒推补卡”。C 选项“omit + TODO，Phase 2 从代码反推”正是把这个单向顺序倒过来，属于违反纪律。

**4. 发布验收门槛明确排除用绿测/包形状替代能力等价**
`plugin-release-system.md`：

> 能力等价仍由 Cursor hook / capability fixture 和真实 IDE probe 验收，不能用 package shape 替代。

这直接否定了“tests green + package 结构正确 = 可发布”的判断依据，B、C 都依赖这个被明确禁止的替代逻辑。

**5. Hook 的共享点是 contract 不是脚本正文**
`source-to-adapter.md`（PHIP）：

> Hook 的共享点是 contract，不是脚本正文。不同 host 的 event、payload、decision shape 可能不同……`<hook>/implementations/<host>/` 写 host-native 实现。

直接把 Claude Code/Codex 的实现改名塞给 Cursor（B），是把“脚本正文”当共享点，违反 PHIP 的基本模型；`stop` 语义从硬阻断退化为软提示这种 decision shape 差异，正该体现在 `CONTRACT.md` 里作为 declared divergence，而不是靠改名掩盖。

## 结论
仓库的具体纪律——`n-host-capability-parity.md` 的 Track A/B 判据与推进顺序、`source-to-adapter.md` 的 Capability INTENT 段落、`host-adapter-boundaries.md` 的“文档冲突以实测为准并回写”、以及 `plugin-release-system.md` 的发布验收门槛——共同指向 **A**：先合拢事实冲突，为 `preCompact`/`stop`/`PostToolBatch` 这三个非 1:1 能力写出 host-neutral intent、可测试等价类和 declared divergence，更新对应 hook CONTRACT，再考虑合并；绿色的 source/dist 测试是必要条件，不是充分条件。
