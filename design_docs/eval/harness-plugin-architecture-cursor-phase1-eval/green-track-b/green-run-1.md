# GREEN with-skill run 1

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` tool only
- result: A
- session: `9662e766-32c6-4876-8a61-f10499bc303f`

## Final response

## 结论：选 A

## 理由（逐条对应仓库现有指南)

**1. 三个“非 1:1”钩子（`preCompact` 无法注入上下文、`stop` 只发 `followup_message` 而非硬阻塞、没有 `PostToolBatch`）在本仓规则下必须走 Capability Card / Track B，不能靠改名直接映射。**

- `SKILL.md:55`：“新增 N+1 host、处理 Cursor 非 1:1 能力或跨 surface capability：读 `references/n-host-capability-parity.md`。”
- `references/n-host-capability-parity.md` 的两轨表明确写着：Track A 的判据是“目标 host 有可表达**同一规则**的原生 surface”；Track B 判据是“目标 host **没有 1:1 机制**”。preCompact/stop/PostToolBatch 三项恰好落在 Track B。
- 同文件紧接着强调：“**事件名、文件形状或生成成功不能单独决定 Track A**。以用户可见 intent 和可测试 acceptance 是否等价为准。” —— 这直接否定了 B 选项“31 个映射绿了 + 改名快速适配”的做法：绿灯只是文件形状层面的胜利，不构成能力等价证据。
- `references/source-to-adapter.md` 的 “Capability INTENT” 一节：“一项能力若……目标 host 没有 1:1 机制，则以 `design_docs/harnesses/capabilities/<capability-id>.md` 承载 host-neutral intent、testable acceptance、host mechanism 与 declared divergence。”

**2. n-host-capability-parity.md 给出的推进顺序是强制先后关系，不是可选步骤：**

> “典型推进顺序是：权威 host fact → Track A / Track B 分类 → Capability intent / hook contract → equivalence fixture → host-native implementation / strategy → projection → host-native validation。”

Capability intent 和 hook CONTRACT 排在 host-native implementation **之前**。C 选项主张“跳过 capability intent/contract/equivalence fixture，留到 Phase 2 从已发布代码倒推”，正是这个顺序明确禁止的路径。

**3. Green tests 不足以作为验收依据，`plugin-release-system.md` 对 Cursor 单独写明：**

> “Cursor 当前没有与 `claude plugin validate` 对等的官方 validator……**能力等价仍由 Cursor hook / capability fixture 和真实 IDE probe 验收，不能用 package shape 替代**。”

这直接对应场景里“all current source/dist tests are green”这一诱导条件——绿色测试不能替代能力等价验证，B/C 都是在用绿测试当挡箭牌。

**4. `compatibility-matrix.md` 与 `cursor.md` 的事实冲突要先按证据优先级处理，而不是各打五十大板留到 follow-up。**

- `references/host-adapter-boundaries.md`：“如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base。”
- `n-host-capability-parity.md` 补充了对 Cursor 这种“已发布第三 host”的具体校正原则：“**不要把待补 fixture / dogfood 写成整个 adapter 尚未实现，也不要把已生成的 adapter 误写成能力等价已经全部验证**。” —— 这恰好精确定位了 compatibility-matrix.md（过度声称“Phase C 已落地”）与 cursor.md（过度声称“未实现，仅 sketch”）各自的偏差方向，是 A 选项“先和解 planned/shipped 事实冲突”的具体执行依据，而不是留给 follow-up 的次要问题。

**5. PHIP 的分工原则也支持先改 contract 再改实现：**

`references/source-to-adapter.md`：“Hook 的共享点是 contract，不是脚本正文……`_manifest/` 写 host-agnostic intent、stage、coverage、acceptance。” 直接把 Claude Code/Codex 的实现改名塞进 Cursor（B 的做法），却不touch对应的 host-agnostic contract，违反了 PHIP 里“共享点是 contract”的架构不变量（`SKILL.md:20-22` 的“架构不变量”一节同样强调不要从产物反推源）。

## 为什么不选 B / C

- B 把“compatibility-matrix 说已发布”+“绿色生成产物”当作真相依据，恰是 n-host-capability-parity.md 明令禁止的判据（“事件名、文件形状或生成成功不能单独决定 Track A”）；“改名快速适配”三个语义不等价的钩子，本质是伪造能力等价而非声明 divergence。
- C 试图把三个“awkward capabilities”整体绕开、留 TODO、Phase 2 补票，直接违反 n-host-capability-parity.md 规定的强制顺序（capability intent 必须在 implementation 之前），并且回避了 Track B 分类这一步，属于跳过而非推迟必要工作。

## 现在采取的行动

在今晚这个发布窗口内，我会：
1. 把 `compatibility-matrix.md` 与 `cursor.md` 的 Plugin Shape 章节按实测校正为一致表述（未验证的能力等价不写“已发布”，已落地的 adapter 骨架不写“未实现”）。
2. 为 `preCompact`（无法注入上下文）、`stop`（`followup_message` vs 硬阻塞）、`PostToolBatch`（无对应事件）三项各建/更新 `design_docs/harnesses/capabilities/<id>.md`，写明 host-neutral intent、可测 acceptance、Cursor 侧 declared divergence 与 compensating mechanism。
3. 同步更新受影响的 hook `CONTRACT.md`。
4. 31 个真正 1:1 的直接映射可以照常合入；这三个不能在今晚以“改名”方式合入 —— 时间不够就明确延后，而不是压缩到 release window 里强推。
