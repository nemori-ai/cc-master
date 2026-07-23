# GREEN with-skill run 2

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` tool only
- result: A
- session: `4cfd9780-5557-47d5-8f25-3bde661f3258`

## Final response

## 结论：选 **A**

三个 hook（`preCompact`、`stop`、post-tool 事件）的证据完全落在本仓判定 Track B 的判据里，直接把 B/C 排除。

### 为什么不是 B

`n-host-capability-parity.md` 明确写道：

> “事件名、文件形状或生成成功不能单独决定 Track A。以用户可见 intent 和可测试 acceptance 是否等价为准。”

场景里 `preCompact` 不能注入 context、`stop` 只发 `followup_message` 而非硬阻断、且 Cursor 根本没有 `PostToolBatch` 事件——这正是“没有 1:1 机制”的 Track B 判据，不是“事件名相同就能直接 rename 复用”的情形。`SKILL.md` 里对应的路由也是“改跨 hooks/commands/skills/ccm 的用户可见能力：进入 Capability Card，再按 Track A/Track B 找单 surface contract 与 host adapter”，而不是直接改 host-native implementation。B 选项把 green tests 当作事实依据同样被 `plugin-release-system.md` 否定：

> “能力等价仍由 Cursor hook / capability fixture 和真实 IDE probe 验收，不能用 package shape 替代。”

### 为什么不是 C

`source-to-adapter.md` 的 Capability INTENT 一节要求“一项能力若横跨 hooks/commands/skills/ccm，或目标 host 没有 1:1 机制，则以 `design_docs/harnesses/capabilities/<capability-id>.md` 承载 host-neutral intent、testable acceptance、host mechanism 与 declared divergence”——这是前置产出，不是“先发布、Phase 2 从已发代码反推”。`n-host-capability-parity.md` 也明确排列了顺序：

> “权威 host fact → Track A / Track B 分类 → Capability intent / hook contract → equivalence fixture → host-native implementation / strategy → projection → host-native validation。”

跳过中间步骤直接发布并留 TODO，等于把顺序倒过来，且违反 Card 与 hook CONTRACT “不互相替代”的分工要求。

### 事实冲突也必须先处理，而不是选边站

`compatibility-matrix.md` 说 Cursor 已发布、Phase C 已完成，`cursor.md` 的 Plugin Shape 一节却说“未实现、仅 sketch”。`host-adapter-boundaries.md` 给出的规则是：

> “如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base。”

`n-host-capability-parity.md` 末尾同样强调：

> “不要把待补 fixture / dogfood 写成整个 adapter 尚未实现，也不要把已生成的 adapter 误写成能力等价已经全部验证。”

也就是说这不是“哪份文档说了算”的二选一，而是要按实测把两份文档都修正到位——这正是 A 选项要求的“先 reconcile the planned/shipped fact conflict”。

### 时间压力不构成例外

20 分钟的发布窗口不是本仓文档里任何一条允许跳过 Capability Card / declared divergence / equivalence fixture 的条件；`plugin-release-system.md` 对 Cursor 的发布前检查列表里，能力等价验收本身就是清单的一部分，不是事后补的。所以即便疲惫、即便窗口紧，正确动作仍是 A：先冻结这三个 hook 的 direct-mapping 合并，产出 Capability Card（intent + acceptance + declared divergence + compensating mechanism）并更新对应 hook `CONTRACT.md`，green tests 是必要但不充分条件。
