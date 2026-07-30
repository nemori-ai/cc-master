---
point: goal.deadline-and-brief
---

## 权威陈述

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
