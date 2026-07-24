# Goal Contract：从需求证据到不漂移的目标

`board.goal` 不是用户原话的收纳箱，而是当前 revision 的短目标摘要；`board.goal_contract` 记录 revision、assurance 与可选 Goal Brief 指针。原始 prompt、issue、聊天背景都是**需求证据**，不是可直接复制的 canonical goal。

## Fresh：先定目标，再切 DAG

<a id="ccm-k-point-goal-fresh-contract"></a>
<!-- ccm:k:start point:goal.fresh-contract -->
1. 汇总原始请求、背景、约束、issue 等证据，不先写 task。
2. 跑 **Goal Framing Test**。以下六项都能明确回答，目标才可进入 `asserted`：
   - **Outcome**：最终改变了什么，而非“做一些工作”。
   - **Scope / non-goals**：包含与明确不包含什么。
   - **Acceptance**：什么可观察证据证明真正完成；同时含功能、质量与交付形态。
   - **Constraints**：架构、兼容、期限、安全、流程等硬约束。
   - **Authority**：哪些可自主决定，哪些必须由用户批准。
   - **Fork / Done / Authority**：是否仍有会改变路线的未决分叉；“done”是否无歧义；不可逆边界的决定权是否明确。
3. 缺的是路线级信息时，生成一份完整 `blocked_on:"user"` `decision_package` 并停在 `pending`；不要用猜测填洞。缺的是低影响细节且有安全默认时，可明确记下假设后进入 `asserted`。
4. 把短、无歧义、可验收的摘要写入 revision 1：

```bash
ccm goal set --board <board> --summary "<normalized goal>" --assurance asserted
ccm goal check --board <board> --json
```

5. 用户明确确认了完整目标时，才把 assurance 升为 `confirmed`；这个授权标记只来自真实用户确认：

```bash
ccm goal confirm --board <board> --user-authorized
```

`pending` = 尚不可拆 DAG；`asserted` = agent 已基于证据完成无歧义改写，可逆地推进；`confirmed` = 用户明确确认当前 revision。不要为了追求 `confirmed` 对每个清晰请求机械追问。

<!-- ccm:k:end point:goal.fresh-contract -->
<!-- ccm:k:nav:start point:goal.fresh-contract -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:goal.contract](../../../knowledge/modules/goal.contract.md#ccm-k-module-goal-contract)
<!-- ccm:k:nav:end -->
## 交付 DDL：识别、确认、过期

<a id="ccm-k-point-goal-deadline-and-brief"></a>
<!-- ccm:k:start point:goal.deadline-and-brief -->
**交付 DDL（delivery deadline）**是用户对「整块 board / 当前 Goal Contract revision 最终交付」承诺的挂钟时刻，是 Goal Framing Test 里 **Constraints（时间硬约束）** 这一维被提升为一等约束——落在 `goal_contract.deadline`（单一 SSOT，随目标 revision 走）。它与单个 iteration 的局部 timebox（`cadence.iterations[].deadline`）、ETA 预测（`ccm estimate forecast`）、task timeout / watchdog **严格区分**：DDL 只表达整块交付承诺。它有**自己的四态 settledness 状态机**，与 goal `assurance` 正交：

| `state` | 含义 | 能否拆 DAG |
|---|---|---|
| （deadline 键缺失） | 未询问（fresh 默认） | 门控（先识别 / 确认） |
| `pending` | 已识别候选但未 settle（歧义 / 冲突 / 待用户答） | 门控 |
| `asserted` | agent 从无歧义 evidence / 显式 `--ddl` 转写的候选，可逆推进 | 放行 |
| `confirmed` | 用户明确确认的截止期 | 放行 |
| `none` | 用户明确确认**无 DDL** | 放行（不再追问） |

**关键区分**：`none`（用户确认无 DDL·持久化·不再追问）**≠** 键缺失 / `pending`（未询问 / 未 settle）。

### Fresh：识别与确认

1. **显式 `--ddl` 优先于自然语言推断**。启动带 `--ddl <ISO-8601-UTC>` 时，board 初始化已 best-effort 落一个 `asserted` 候选；它仍走确认闸，不给一条绕过确认的旁门。
2. 从 goal evidence 提取候选 DDL——**只有日期 / 时间 / 时区 / 「最终交付」语义均无歧义**时才形成候选。用户给本地时刻（如「北京时间 8/1 下午5点」）由你换算成 UTC 后落板（原始表达与假定时区留痕供审计）；只有日期无时间、或「周五 / 尽快 / 本月底」这类歧义表达 → **主动询问用户**，在得到「明确交付时刻」或「用户明确声明无 DDL」前保持 deadline `pending`。
3. **多源冲突不得自选**（`--ddl` 与 evidence 里的 NL 日期不一致等）→ 生成 `decision_package` 向用户确认，别替他选一个。
4. 落候选 / 确认 / 确认无 DDL 各走专属 verb（要授权的强制 `--user-authorized`；agent 绝不自授权）：

```bash
ccm goal deadline set --board <board> --at <ISO-8601-UTC> --source cli-flag|goal-evidence|user-reply --assurance asserted
ccm goal deadline confirm --board <board> --user-authorized        # asserted/pending 候选 → confirmed
ccm goal deadline confirm-none --board <board> --user-authorized    # 用户确认无 DDL → none（持久·不再追问）
```

5. **DDL / no-DDL 确认完成后**，`goal check` 才返回 `ok`（而非 `deadline_pending`）→ 进入 DAG 拆解与派发。命令面细节与字段取值归 `using-ccm`。

### Resume / legacy / 已过期

- **resume**：保留原 DDL 与确认状态、**不重置**。但恢复执行前**补做一次 DDL / no-DDL 确认 + 一次 deadline-risk 刷新**，绝不沿用上个 session 的陈旧绿 verdict。
- **legacy board**（无 `goal_contract` / 无 deadline 键）：可读、可续跑、不因 schema 演进失效。`goal set` 激活 contract 后可 `goal deadline set` 补 DDL；恢复执行前补一次 DDL / no-DDL 确认。
- **已过期 DDL**（`state ∈ {asserted, confirmed}` 且 `now >= at` 且目标未完成）：**不当普通 resume 处理**。先向用户报告当前状态、剩余交付物、可选方案，再由用户决定**延期 / 缩范围 / 分阶段交付 / 终止**——延期走 `ccm goal deadline amend --board <board> --at <新 ISO> --reason "<why>" --user-authorized`，缩范围走 `ccm goal amend`，**均不静默**。deadline 的 amend 不改 `goal_contract.revision`（延期不是 scope 变更）。

DDL 一旦在场，它落到你排期 / 范围控制 / 风险升级 / 收口决策上的九条纪律见 `references/deadline-discipline.md`。

## 什么时候必须写 Goal Brief

短目标能完整承载语义时可 inline-simple。出现任一情况时，把完整需求与背景独立写成 Goal Brief：多子系统 / 多阶段；验收或非目标较多；高风险或长周期；需要跨 session 回顾；原始上下文很长；用户要求正式 spec/实施计划/评审策略。

先在临时文件写完，再让 ccm 复制到受管、不可变、带 hash 的 revision 路径：

```bash
ccm goal set --board <board> --summary "<normalized goal>" \
  --brief-file /absolute/path/to/goal-brief.md --assurance asserted
ccm goal show --board <board> --json
ccm goal check --board <board> --json
```

Goal Brief 至少包含：Outcome；背景与需求证据指针；in-scope / non-goals；验收标准；约束；用户权限边界；未决问题；评审与交付形态。不要写 token、凭证、个人信息等秘密。board 只保存相对 `ref` 与 `sha256`；Brief 文件在 `$CC_MASTER_HOME/goals/`，由 `ccm goal show` 给出真实路径。旧 revision 只读，绝不覆盖。

<!-- ccm:k:end point:goal.deadline-and-brief -->
<!-- ccm:k:nav:start point:goal.deadline-and-brief -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:goal.contract](../../../knowledge/modules/goal.contract.md#ccm-k-module-goal-contract)
<!-- ccm:k:nav:end -->
## 工作中：Goal Trace Test

<a id="ccm-k-point-goal-trace-and-delta"></a>
<!-- ccm:k:start point:goal.trace-and-delta -->
每次 dispatch、接纳 fill-work、扩大 review、增加 task 或准备完成前，跑 **Goal Trace Test**：

1. 这项工作直接兑现当前 revision 的哪一条 goal / acceptance / constraint？
2. 它将产生什么可验收证据？
3. 若删掉它，当前 acceptance 是否仍能全部满足？若“是”，它通常不应进入当前 DAG。

“有用”不等于“相关”。技术上漂亮、顺手清理、未来可能需要，都不是 scope 证据。无法追溯就先分类，绝不先做后解释。

## 新发现：Goal Delta Classifier

新信息只准进入四类之一：

| 分类 | 判据 | 动作 |
|---|---|---|
| `in-scope` | 只是当前语义的实现细化，不改变 outcome / acceptance / non-goals / authority | 用 `ccm log add "<fact>" --board <board> --kind finding --detail "<evidence>"` 记录新事实；必要时更新 task 的执行细节，revision 不变，不借机改写 Goal Contract 或成功状态 |
| `amendment` | 改变 outcome、scope、acceptance、关键约束或权限边界 | 先说明影响与需要的授权，再 `ccm goal amend`；revision +1 后重切受影响 DAG |
| `follow-up` | 有价值但当前 acceptance 不需要 | 独立 backlog / issue / 新 board，不混入本 DAG |
| `unrelated` | 与当前目标无可验证关系 | 停止，不制造 busywork |

显式修改目标：

```bash
ccm goal amend --board <board> --summary "<new normalized goal>" \
  --reason "<why semantics changed>" --assurance asserted \
  [--brief-file /absolute/path/to/new-goal-brief.md]
ccm goal check --board <board> --json
```

不得用 `ccm board update --goal` 绕过 revision。amend 后旧 task 不能自动继承正当性：逐个重跑 Trace Test，保留、改写、移出或取消，并让新的 revision 进入 completion fingerprint。

<!-- ccm:k:end point:goal.trace-and-delta -->
<!-- ccm:k:nav:start point:goal.trace-and-delta -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:goal.contract](../../../knowledge/modules/goal.contract.md#ccm-k-module-goal-contract)
<!-- ccm:k:nav:end -->
## 六个对齐检查点

<a id="ccm-k-point-goal-alignment-checkpoints"></a>
<!-- ccm:k:start point:goal.alignment-checkpoints -->
- **fresh**：Framing Test → `goal set` → 识别 / 确认交付 DDL（或确认无 DDL）→ `goal check` 返回 `ok`（非 `deadline_pending`）→ 才调用 `slicing-goals-into-dags`。
- **resume / compaction**：先 `goal check`，有 Brief 就读当前 revision；恢复执行前补一次 DDL / no-DDL 确认 + deadline-risk 刷新（不沿用陈旧绿 verdict），再 reconcile；hash 异常立即硬停。
- **recon / replan**：确认新发现已经过 Delta Classifier；不让 task 反向偷偷改写 goal。
- **dispatch / fill-work**：每个工作单元必须通过 Trace Test，handoff 写明 goal revision 与所兑现的 acceptance。
- **verify**：先验 task 的 local acceptance，再验当前 Goal Contract 的 global acceptance；局部全绿不等于目标完成。
- **stop / complete**：确认没有 board 外漏项、没有未分类 delta、Goal Brief hash 有效，并以当前 revision 生成验收证据。

Legacy board 没有 `goal_contract` 时保持可续跑；不要在恢复现场擅自迁移或改义。若确需纳入 lifecycle，把它当一次显式、可审计的目标确认/修订，而不是静默补字段。
<!-- ccm:k:end point:goal.alignment-checkpoints -->
<!-- ccm:k:nav:start point:goal.alignment-checkpoints -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:goal.contract](../../../knowledge/modules/goal.contract.md#ccm-k-module-goal-contract)
<!-- ccm:k:nav:end -->
