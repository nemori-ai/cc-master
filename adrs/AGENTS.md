# adrs/ — Architecture Decision Records (decision snapshots)

> This file is the navigation entry point and authoring discipline for `adrs/`.
> An ADR (Architecture Decision Record) = a **decision snapshot**: it answers
> "why X and not Y / when may this be overturned." It is a **structural-decision
> record carrying Status + Date**, kept strictly separate from `design_docs/`
> (evergreen description of the current state).
> The ADR-vs-design_docs test is in §3 — read it before creating a new ADR.

---

## 1. What this directory is

`adrs/` carries cc-master's **structural architecture decisions**. Each ADR is an
immutable / explicitly-superseded snapshot that answers one of:

- **Structural shape** — a root form choice that constrains the whole plugin
  (e.g. ADR-001 hooks are pure bash, ADR-003 the board narrow waist).
- **Scope boundary** — what cc-master deliberately does *not* do, and why
  (e.g. ADR-002 ship-anywhere excludes agent-teams / scheduled routines).
- **Supersession history** — when an earlier stance is retired, record explicitly
  "when and why it can be overturned" (e.g. ADR-004 `/loop`·`/goal` dissolution).

If something is "how it currently works / where the boundary is right now," it is
**not an ADR** — it goes in `design_docs/`. See §3.

### Existing ADRs

| # | Topic | Status | One line |
|---|---|---|---|
| **ADR-001** | [hooks are pure bash](ADR-001-hooks-pure-bash.md) | **Superseded by ADR-006** | (historical) Hooks parse JSON with shell tools only — no `jq`/`node`. The "no node" rested on a model-backend vs CLI-host conflation; corrected by ADR-006. |
| **ADR-002** | [ship-anywhere scope](ADR-002-ship-anywhere-scope.md) | Accepted (partially narrowed by ADR-011; ship-anywhere 口径 amended by ADR-014) | Supported background **dispatch** mechanisms = background shell + sub-agent + workflow only; agent-teams and cloud scheduled routines stay out of scope (not reliably available everywhere). ScheduleWakeup/cron exclusion **narrowed by ADR-011** (local timer primitives unblocked for the watchdog). **「不依赖外部预置」口径 amended by ADR-014**（主机预置 `ccm` 二进制 + 进程边界；dispatch scope 不变）。 |
| **ADR-003** | [the board narrow waist](ADR-003-board-narrow-waist.md) | Accepted | A small, fixed set of pinned fields is the only contract the hooks read; everything else is flexible edges the agent shapes freely. |
| **ADR-004** | [`/loop`·`/goal` dissolution + goal-hook](ADR-004-loop-dissolution-and-goal-hook.md) | Accepted (supersedes the native-`/goal` integration stance) | Native `/goal` is unexecutable by an agent (Finding #2) and `/loop`/`ScheduleWakeup` break ship-anywhere; both are replaced by background shell + completion re-entry and a deterministic Stop hook (goal-hook). |
| **ADR-005** | [two-skill separation](ADR-005-two-skills-separation.md) | Accepted | `orchestrating-to-completion` (main-thread orchestration) and `authoring-workflows` (inside-the-script authoring) stay self-contained and non-overlapping. |
| **ADR-006** | [hooks may use node/JS](ADR-006-hooks-may-use-node-js.md) | Accepted (supersedes ADR-001) | Hooks may use bash + Node.js/JavaScript (JS only; `jq`/`python`/TS-direct still out) — Claude Code *is* a Node app, so `node` is guaranteed wherever a hook fires. Unblocks C2 usage-sensing as a hook + trivial JSON parsing. |
| **ADR-007** | [hook arming gate](ADR-007-hook-arming-gate.md) | Accepted | Every hook is dormant-until-armed; armed ⟺ home holds a `*.board.json` with `owner.active:true` AND `owner.session_id == stdin session_id` (degraded to any-active on empty sid). Reuses pinned waist fields (ADR-003 untouched); `bootstrap-board.sh` is the sole exempt ARM action; disarm = `/stop`. Disk is the only cross-compaction channel a hook can read. |
| **ADR-008** | [account-authoritative usage + script placement](ADR-008-account-authoritative-usage-and-script-placement.md) | Accepted | 账户权威 5h/7d `used_percentage`+`resets_at` 只在 status-line stdin → `statusline-capture.js` 捕获到 sidecar，`cc-usage.sh`/`usage-pacing.js` 优先读它（本地反推退 fallback，标 approx）；capture 不受武装闸（只缓存账户全局只读信号，无注入/无 block，红线 6 精神之外）；运行时带外脚本落 `skills/<skill>/scripts/`（随 skill 分发，`${CLAUDE_SKILL_DIR}` 引用），dev-only 留顶层 `scripts/`。Source: Finding #37/#38。 |
| **ADR-009** | [resume = explicit cross-session re-arm](ADR-009-resume-cross-session-re-arm.md) | Accepted (refines ADR-007) | `as-master-orchestrator --resume [selector]` 让全新 session **显式接管**一块已存在的 board（跨 session re-arm）——bootstrap（唯一武装豁免 hook）第二种 ARM 形态：盖 `owner.session_id`/`active:true`/`heartbeat`、保留 `tasks`/`log`/`goal`、**可复活 `/stop` 归档板**（`false → true`）；区分「ADR-009 显式命令接管 + selector + live 安全闸」vs「CODEX14 拒绝的隐式自动收养」（后者仍禁）。ADR-007 武装闸 + 其余 4 hook 一字不变；`/stop` 终态语义弱化为「显式可逆归档」。Source: 2026-06-15 resume-board 设计（fork #2/#4 用户拍板）。 |
| **ADR-010** | [two-sided pacing corridor](ADR-010-two-sided-pacing-corridor.md) | Accepted | pacing 从单边 ~75% 上限护栏改为双侧目标走廊（5h reset 落 ~70–90%，欠用侧轻推加速 / 临界侧轻推减速），7d 窗口当加速硬总闸；ADR-008 的账户权威用量口径是其加速侧决策的信号前置（非 refines）。Source: Track B 行为 eval（欠 pace 探针下两 agent 相反决策）。 |
| **ADR-011** | [self-wakeup watchdog](ADR-011-self-wakeup-watchdog.md) | Accepted (partially narrows ADR-002) | Idle-wait watchdog: before a `wait` blocked on in_flight background tasks, arm a self-wakeup (CronCreate one-shot / ScheduleWakeup / Monitor / background-shell floor) so silent failures (hang / death / phantom — no completion event) get reconned. Layered on harness auto-re-entry (补盲区非替换). Unblocks ScheduleWakeup + local `CronCreate` for the watchdog (cloud routines / agent-teams still out); `wakeup` is a soft-observed flexible edge — hard waist untouched (红线2). Source: Finding #17/#46 + 2026-06-16 idle-self-wakeup 设计（用户开放 ScheduleWakeup/cron）。 |
| **ADR-012** | [parent waist + rollup-aware Stop gate](ADR-012-parent-waist-and-rollup-aware-stop-gate.md) | Accepted (扩展 ADR-003 waist 集合) | `tasks[].parent`（子→父单值指针）升入 narrow-waist，承载 nested（max depth=1）调度图——一个扁平节点集背两条正交边（`deps` 调度 / `parent` 容器）；Stop gate 变 rollup-aware（父任务完成度由子任务汇总）。加一个 pinned 字段，不推翻「窄腰 + silent-on-unknown」原则。Source: D3 nested-DAG 设计稿（用户拍板走 hook 感知 rollup 路）。 |
| **ADR-013** | [board v2 data model + unified CLI](ADR-013-board-v2-data-model-and-cli.md) | Accepted (演进 ADR-003；CLI 定位/零依赖/hook-require 被 ADR-014 修订) | board 从「被动 JSON + 各消费者各自 bash 解析 + 只钉一小撮 waist」演进到「完整 JS 数据模型 SSOT + 统一 CLI 访问层」：narrow-waist 三档建模（🔒 load-bearing / 👁 observed / ✎ flexible）、JS model SSOT、CLI 唯一写入关卡、bash hook 收编 node、轻量 advisory 锁。**CLI 的「内部访问层 + 零依赖纯 stdlib + hook in-process require」三点被 [ADR-014] 修订**（board 契约本身不变）。Source: v0.10.0 board 重构需求发现（Epic #27 等）。 |
| **ADR-014** | [CLI 解耦为独立产品](ADR-014-cli-decoupling-as-independent-product.md) | Accepted (修订 ADR-013 CLI 定位；进一步修订 ADR-002 ship-anywhere 口径) | `ccm` CLI 解耦为独立安装的产品/引擎（`@ccm/engine` TS SSOT），cc-master plugin 降为消费方之一（未来 desktop/web 平行消费）；plugin hooks/skills 经 **shell 调全局 `ccm` 二进制 + JSON 契约**访问 board、**绝不 import 引擎**（进程边界 = 红线1 新落点）；ship-anywhere 从「单件自包含 + 零依赖」改为「主机预置 per-OS Node SEA 二进制 + 进程边界」（「宿主 vs 模型后端」之分同 ADR-006）。红线 1/2/3/4/6 精神不变。Source: 2026-06-24 三次 CLI pivot（用户拍板）。 |

---

## 2. ADR naming

```
ADR-NNN-<slug>.md
```

- `NNN` — three-digit zero-padded incrementing number (001, 002, ...); no gaps, no
  reuse, no skipping.
- `<slug>` — short kebab-case topic (e.g. `hooks-pure-bash`).
- The frontmatter block must carry: `Status` (Proposed / Accepted / Superseded /
  Deprecated) + `Date` (YYYY-MM-DD) + `Scope` (blast radius) + optional `Source`
  (the finding / interview / design review that triggered the decision) + optional
  `Co-signed` (when a decision needs explicit sign-off).

---

## 3. Writing an ADR vs writing design_docs

| | ADR | design_docs |
|---|---|---|
| Nature | **Decision snapshot** — carries a timestamp, Status, and an explicit supersede chain | **Evergreen description** — the live current fact, edited freely |
| Answers | "why X and not Y" + "when may it be overturned" | "what it is now / how it works / where the boundary is" |
| Mutability | Immutable (unless explicitly superseded) | Evolvable (revised continuously) |
| Trigger | Structural decision, cross-file impact, may be overturned later | State description, reference material, runbook |

**Checklist before writing an ADR** (run through it once):

- [ ] Is this a **structural decision** (not a state description, not reference
      material, not a runbook)?
- [ ] Does the decision have a clear **X-vs-Y alternative**? No alternative = it is
      not a decision, it is the current state.
- [ ] Does it have **cross-file / cross-component impact**? Touching a single
      design_doc / spec = just edit that design_doc.
- [ ] Does it carry **potential supersession value** (some day a new stance may
      overturn it and you want to keep "why we chose this then")?
- [ ] **Don't write a "phase kickoff ADR"** — phase progress is reflected naturally
      by `design_docs/plans/` (gitignored) plus the concrete ADRs/design_docs.

Any No → file it in `design_docs/` instead; do not create an ADR.

---

## 4. When to write a new ADR — workflow

1. **Decide**: run the §3 checklist; confirm it is worth an ADR.
2. **Claim the number**: grep `adrs/ADR-*.md` for the latest number + 1 (no reuse /
   no skipping).
3. **Write**: follow the template below.
4. **Review** (if the decision needs sign-off): record co-signers in frontmatter.
5. **Cross-ref back**: update related design_docs / other ADRs to cross-reference
   the new ADR; keep the relevant evergreen SSOT in sync.
6. **Commit message**: `adr(NNN): <slug> — <decision summary>`.

### ADR template

```markdown
# ADR-NNN — <Topic>

> Status: **Proposed | Accepted | Superseded | Deprecated**
> Date: YYYY-MM-DD
> Scope: <blast radius — which hooks / skills / files this constrains>
> Source: <the finding / interview / design review that triggered it>
> Co-signed: <only if the decision needs explicit sign-off>

---

## 1. Context

<background / current pain / why we are deciding now>

## 2. Decision

<the decision itself — say "we choose X" plainly — split into subsections>

## 3. Consequences

### 3.1 Positive

### 3.2 Negative

### 3.3 Neutral

## 4. Alternatives Considered

### 4.1 Alternative A: <...>

### 4.2 Alternative B: <...>

## 5. Related

<other ADRs / design_docs / findings cross-referenced>

## 6. References

<external references / pattern sources>
```

---

## 5. Relationship to other SSOTs (cross-ref)

| Concern | Where |
|---|---|
| Repo-wide navigation + the six design invariants (red-line SSOT) | [`../AGENTS.md`](../AGENTS.md) |
| Contribution dev loop + invariant pointer | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Plugin spec (intentional exclusions in §12) | [`../design_docs/spec.md`](../design_docs/spec.md) |
| Dogfood findings ledger (the anti-pattern record many ADRs cite) | [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) |
| goal-hook design spec (ADR-004 detail) | [`../design_docs/2026-06-08-goal-hook-design.md`](../design_docs/2026-06-08-goal-hook-design.md) |
