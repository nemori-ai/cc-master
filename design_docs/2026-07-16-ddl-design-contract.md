# 交付 DDL 与截止期驱动编排——跨消费者设计契约与迁移方案

日期：2026-07-16
状态：Draft for review（实现前的跨消费者契约，issue #149 明确要求先产出）
需求来源：[issue #149](https://github.com/nemori-ai/cc-master/issues/149)「为 board/Goal Contract 引入交付 DDL 与截止期驱动编排」（含补充节「Hook 驱动的 DDL 风险评估与主动通知」）
关联决策：[`ADR-035`](../adrs/ADR-035-goal-contract-lifecycle.md)（Goal Contract 生命周期，DDL 建其上）· [`ADR-013`](../adrs/ADR-013-board-v2-data-model-and-cli.md)（board 三档模型）· [`ADR-024`](../adrs/ADR-024-single-sided-pacing-switch-stop.md)（引擎出 verdict + strength·hook 直接消费的先例）· [`ADR-020`](../adrs/ADR-020-hook-writes-flexible-board-via-ccm.md)（hook 经 ccm 写 ✎ runtime）· [`ADR-018`](../adrs/ADR-018-hook-agent-message-protocol.md)（注入标签协议）· [`ADR-015`](../adrs/ADR-015-estimation-and-pacing-engine.md)（估算引擎）· [`ADR-031`](../adrs/ADR-031-n-host-capability-parity.md)（N-host parity）
模板对齐：本文的结构、权威边界、验收编号、host parity 处理方式，刻意镜像 [`Goal Contract 生命周期规范`](2026-07-15-goal-contract-lifecycle-spec.md)——因为 DDL 是 Goal Contract 的一个约束维度，落在同一套 substrate 上。

---

## 0. 本文是什么 / 怎么用

本文是 **issue #149 的实现前跨消费者契约 + 迁移方案**，是下游全部实现任务的 plan 输入。它不写代码，只把设计拍板、数据/命令/hook/算法契约、以及每个下游任务的实施边界切到「拿到即可动手、不需再问路线问题」。

下游任务（本文 §11 给逐条任务书边界；§10 给验收 checkbox → 任务映射）：

| 任务 | 承担 | 版本线 |
|---|---|---|
| **D2** | ccm 引擎 DDL 核心：`goal_contract.deadline` 数据模型 + 三档/不变式 + `ccm goal deadline` writer verbs + 三条新 lint 规则 | ccm-v* |
| **D3A** | deadline-risk 算法 spike：precedence-only vs resource-aware 通道对比 + `--as-of` 回放校准 + 性能预算 + 阈值定标 | ccm-v*（spike 产出喂 D3B） |
| **D3B** | `ccm estimate deadline-risk --json` 只读 endpoint：单一 verdict SSOT（准时概率 / 分位 margin / risk band / 诚实字段 / top drivers） | ccm-v* |
| **D4A** | bootstrap / goal-flow DDL 流程：fresh `--ddl` 入口 + resume/legacy/已过期行为 + 注入流程 | plugin v* |
| **D4B** | deadline-risk hook：触发 / 节流 / 通知状态机 / durable `deadline_risk` 通知 / 三 host envelope | plugin v*（+ ccm-v* 的 notify kind） |
| **D5** | SKILL A 截止期纪律：九条 deadline-aware 纪律落点 + A/D/E/H 边界 | plugin v* |
| **D6** | viewer / estimate 展示：DDL + 剩余时间 + margin/risk band | 两侧 |
| **D7** | 集成：Capability Card / hook CONTRACT / parity fixtures / content 锁步 / release 门 | 两侧 |

---

## 1. 问题、目标、语义边界

### 1.1 痛点与目标（承 issue §背景/§目标）

cc-master 已有 `cadence.iterations[].deadline`（单个 iteration 的 timebox）与 `ccm estimate forecast`（ETA 预测），但 board/Goal Contract 缺一个「整场编排承诺何时交付」的一等 **交付 DDL（delivery deadline）**。缺它 → master orchestrator 启动时漏掉关键时间约束，也无统一依据倒排、预留验收缓冲、识别延期风险、抑制过度设计 / scope creep；长程执行可能临近截止才暴露不可交付。

目标：为 board model / Goal Contract 引入一等 DDL，让 fresh orchestration 在拆 DAG 前形成明确、可审计的截止期约束，并让 DDL 成为排期、范围控制、风险升级和验收收口的共同约束——外加一条 armed hook safety net 周期/事件驱动地重估延期风险、主动唤起 orchestrator。

### 1.2 四个「不是」——语义边界（承 issue §语义边界，落地为机械可查的字段分野）

DDL 必须与四个近邻概念严格区分，且每个区分在 board model 里有物理落点：

| 概念 | 是什么 | 物理落点 | 与 DDL 的关系 |
|---|---|---|---|
| **DDL（本文引入）** | 用户对**整块 board / 当前 Goal Contract revision 最终交付**的承诺 / 约束 | `goal_contract.deadline`（§3） | —— |
| **ETA** | 基于当前 DAG、吞吐、不确定性算出的**预测** | `ccm estimate forecast` 的 `forecast.p50/p80/p95`（只读、每次算） | DDL 是约束、ETA 是预测；deadline-risk = 比二者（§4.4） |
| **`cadence.iterations[].deadline`** | 单个 iteration 的**局部 timebox 末端**（喂 timebox 小时数 / overbooking lint） | `cadence.iterations[i].deadline`（已存在·👁·ISO-8601 UTC·`cadenceTimeboxHours` 消费） | 局部 vs 整块；DDL **不**替代它，二者并存、语义正交 |
| **task timeout / watchdog** | worker hard timeout / 单任务超时 / 自我唤醒 | `watchdog.*` / worker 机制（已存在） | DDL **不**用于替代任何超时机制 |

**非目标继承（issue §非目标，全数继承为硬约束）**：
- 不把 DDL 做成 cloud scheduler / scheduled routine，不引入破坏 ship-anywhere 的依赖（红线5）。
- 不为每个 task 自动生成 deadline；局部 timebox 继续由 cadence / iteration 表达。
- 不允许 agent 为「按期」静默降低用户明确要求的 acceptance、伪造完成、修改 DDL 或扩大自主授权。
- 不要求 hook 做开放式自然语言日期理解；hook 负责可靠触发和注入流程，语义判断归 agent，持久化与校验归 ccm。

---

## 2. 四个拍板问题的决策

issue §「需要在设计阶段拍板的问题」列了四条。每条给**推荐决策 + 备选 + 理由 + 可推翻性**。

### 2.1 Q1：DDL canonical 归属——Goal Contract constraint 还是 board 顶层字段？

**推荐决策：作为 Goal Contract 的约束字段——`goal_contract.deadline`（`brief` 的兄弟键）。单一 SSOT，不新增第二份可漂移 deadline。**

**理由**：
1. **语义归属正确**——DDL 约束的正是「整块 board / 当前 Goal Contract revision 的最终交付」（§1.2）；它就是 Goal Framing Test 里 **Constraints（时间硬约束）** 这一维被提升为一等公民（对照 [`goal-contract.md`](../plugin/src/skills/master-orchestrator-guide/canonical/references/goal-contract.md) 与 goal-contract-lifecycle-spec §6.1 的 Constraints）。
2. **单一 SSOT，零漂移**——`goal_contract` 已是 board 上目标语义的权威承载（👁 observed，`{schema, revision, assurance, brief?, updated_at}`，board-model.ts `FIELDS.board.goal_contract`）。把 deadline 嵌进去 → 它随目标 revision 走、复用同一 `updated_at` 审计头 + append-only `board.log`，绝不产生「board 顶层一份 + goal 一份」的双写漂移（issue 明令禁止）。
3. **零窄腰影响**（详见 §3.3）——`goal_contract` 是 👁 非窄腰字段；deadline 作为它的子对象继承此性质，narrow waist（🔒 = schema/goal/owner/git/tasks）**一字不动**（红线2 不破）。
4. **复用现成生命周期机制**——`ccm goal` 已有 set/confirm/amend 的带锁、审计、revision 语义（mutations.ts `goalSet/goalConfirm/goalAmend` + `appendGoalLog`）；deadline verbs 顺同一套骨架加（§4.1）。

**备选**：board 顶层 observed/flexible 字段 `board.deadline`，交叉引用 `goal_contract.revision`。**否决**：即使加交叉引用，也是两个物理落点、两份 updated_at，天然是漂移温床（goal amend 时哪份为准？）；issue 明确要「唯一 SSOT、不能形成两份可漂移 deadline」。

**关键子决策（deadline 生命周期与 goal revision 的关系）**：deadline 有**自己的**settledness 状态机（§3.2 四态），与 goal `assurance` 正交。
- deadline 的 set/confirm/amend **不 bump `goal_contract.revision`**（延长截止期不是目标 scope 变更），只更新 `goal_contract.updated_at` + 追加一条 `board.log` decision 条目（审计）。
- `goal amend`（scope 变更）**原样保留** deadline 子对象（含其确认态）——scope 改了不等于 deadline 改了，绝不静默丢弃；agent 应在 amend 后语义重估 deadline 是否仍成立，但那是 SKILL A 的判断、不是 ccm 自动动作。
- 这令 deadline 与 goal 两条生命周期**共址但正交**（单一 SSOT，独立状态机）。

**可推翻性**：若 dogfood 证明 deadline 需要脱离 goal_contract 独立存活（例如大量 legacy board 无 goal_contract 却需要 deadline），再考虑升为顶层字段 + 迁移；v1 无此证据，锁在 goal_contract 内。

### 2.2 Q2：是否新增显式 `--ddl` 入口 + 与自然语言 DDL 的优先级？

**推荐决策：新增 `--ddl <值>` 作为 fresh bootstrap 的显式启动 flag（复用现有 init-flag 机制）。优先级：显式 `--ddl` > 自然语言 goal evidence 里推断的 DDL；两者冲突时不得自选，必须向用户确认。**

**理由**：
1. **结构化输入优先于自然语言推断**（issue §入口流程 step 3 硬要求）——`--ddl` 给一条不经 NL 歧义的机读路径。
2. **复用已验证的机制**——bootstrap-board.sh 的 INIT-FLAGS 段（`--priority` / `--wip` / `--owner-wip` / `--policy-switch`）已是「建板后据用户亲手敲的 flag、经进程边界 `ccm` 写 ✎ 字段、best-effort 不 block 起跑」的成熟形态（ADR-020 §2.45）。`--ddl` 同形加入：建板后 `ccm goal deadline set --at <规范化值> --source cli-flag`，落地失败只记 note、不崩、不 block。
3. **不破 hook 的语义中立**——bootstrap（bash）**不猜自然语言日期**；`--ddl` 只接受已经明确的值（见下「规范化边界」），NL 推断仍归 agent。

**`--ddl` 取值与规范化边界**：
- 首选严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`，与 `isISOUTC` 同口径）。bootstrap 对 `--ddl` 值只做**形状轻校验**（是否 ISO-8601 UTC）——合法 → `ccm goal deadline set --at <值> --source cli-flag --assurance asserted`；不合法（如 `--ddl 8月1日`）→ 不落地、记 note，把原值作为 evidence 传给 agent，由 agent 在 framing 阶段规范化。**bootstrap 不解析本地时区 / 相对日期 / 模糊表达**（红线：语义归 agent）。
- `--ddl` 落地后 deadline 状态为 `asserted`（agent/用户输入的候选，可逆推进），**仍走 agent framing 的确认闸**升到 `confirmed`（§3.2）——一个 CLI flag 是显式用户意图但仍经统一确认路径，不给 `--ddl` 开一条绕过确认的旁门。

**冲突处置**：`--ddl` 与 goal evidence 里的 NL 日期都存在且不一致 → agent **不得自选**，生成 `decision_package` 向用户确认（issue step 3）。

**备选**：只靠 NL 推断、不加 `--ddl`。**否决**：放弃了唯一的无歧义机读入口，逼所有 DDL 都过 NL 规范化（更易错），且与现有 init-flag 家族不一致。

**可推翻性**：若 `--ddl` 使用率极低且 NL 规范化足够可靠，可在后续版本弃用 flag（纯 additive，弃用无迁移成本）。

### 2.3 Q3：DDL 是硬承诺，还是 soft/hard 两档？谁升降？

**推荐决策：v1 是单一硬承诺（一个 deadline 就是一个 deadline）。数据模型保留 `kind: 'hard' | 'soft'` 字段、v1 恒 `hard`；soft/hard 的差异化行为（risk band strength 衰减等）与升降授权作 follow-up（12h 冲刺外·§12）。升降权仅归用户——deadline 的任何实质变更走 `ccm goal deadline amend --user-authorized`，agent 绝不静默延期。**

**理由**：
1. **设计克制（12h 冲刺内最小完整形态优先）**——soft/hard 两档引入「谁有权升级 / 降级」的授权语义，那是一套独立的 policy 设计（谁能把 hard 降成 soft？降级本身是不是需要用户授权？），是 v1 的 scope creep。
2. **前向兼容零成本**——数据模型带 `kind`（默认 `hard`）；将来要两档只需给 `kind: 'soft'` 定义 risk 行为差异，字段名已预留、无迁移。
3. **直接兑现非目标**——「不允许 agent 为按期静默修改 DDL」：升降权仅归用户（`--user-authorized`），deadline amend 强制 `--reason` + `board.log` 审计（同 goal amend）。

**备选**：v1 即上 soft/hard 两档。**否决**：授权语义未定就上，会在 v1 无证据时制造复杂度与漏洞面（谁能降级 = 一条可被合理化利用的旁门）。

**可推翻性**：dogfood 证明真实需要「内部 soft 目标 vs 对外 hard 承诺」的两档区分时，用预留的 `kind` 字段落地行为差异 + 升降授权 policy。

### 2.4 Q4：deadline pending 做 `ccm goal check` 硬闸，还是独立 deadline check + dispatch gate？

**推荐决策：混合——把 deadline settledness 折进 `ccm goal check` 的 verdict（新增 `deadline_pending` verdict，exit 0，与现有 `pending` 同档，在 agent 层门控 dispatch），并加一条 lint warning `BIZ-DEADLINE-PENDING` 作 backstop。不做 exit-3 硬 block、不新增独立 check 命令。**

**理由**：
1. **单一 settledness oracle**——`goal check` 已是「我能不能拆 DAG / 派发了」的权威判据（`pending` verdict 已在 skill 层门控 DAG）。把 deadline settledness 也收进它 → agent 一次 `goal check` 就知道目标语义**和** deadline 是否都 settled。新增 verdict `deadline_pending`（goal 语义 OK 但 deadline 未 settle）与现有 `pending` 同为 **exit 0**（advisory·agent-gated），不是 exit 3（后者留给结构性损坏）。
2. **不过度机械 block**——现有 `BIZ-GOAL-PENDING` 是 **warn 非 hard error**（goal-contract-lifecycle-spec §4.3）；对称地，deadline-pending 也应是 warn。exit-3 硬 block 会误伤 legacy board、需求侦察板、以及 deadline 确实尚不适用的合法等待态。
3. **backstop 兜漏**——`BIZ-DEADLINE-PENDING`（warn）：board 已有可执行任务（status ∈ ready/in_flight/uncertain）却 deadline 仍 pending → 兜「agent 没 settle DDL 就开始建 DAG」这个 footgun（issue §board/CLI 建议「可执行 DAG 在 deadline pending 时启动」）。
4. **契合 issue 语义**——issue §入口流程 step 5「DDL / no-DDL 状态完成确认后，才允许 Goal Contract check 通过并进入 DAG 拆解与派发」：把 deadline 折进 goal check verdict 正是让「goal check 通过」同时意味着 deadline 已 settle。

**`goal check` verdict 扩展**（当前 verdict：`legacy | pending | ok | malformed | missing_brief | hash_mismatch`，goal.ts `GoalCheckResult`）：
- 新增 **`deadline_pending`**（exit 0）：goal 语义 settled（assurance ∈ asserted/confirmed）**但** deadline.state == `pending`（或 deadline 缺失 = 未询问）。
- `ok` 的定义收紧为：goal settled **且** deadline settled（state ∈ `asserted`/`confirmed`/`none`）。
- 结构性损坏（deadline 形状错）仍走 `malformed`（exit 3，由 `FMT-DEADLINE` 触发）。
- verdict 输出附 `deadline: { state, at?, ... }` 子块供 agent / viewer 读。

**备选**：完全独立的 `ccm goal deadline check` + 纯 skill-level dispatch gate，`goal check` 不变。**部分采纳但非主路**——独立 check 命令会分裂 settledness oracle（agent 要调两个命令才知道能不能派发），且 dispatch gate 若只靠 skill 自觉、无 lint backstop，压力下易被合理化。故选「折进 goal check + lint backstop」，**不**新增独立 check 命令（`ccm goal deadline show` 仍提供只读细节，但「能不能派发」的判据统一在 `goal check`）。

**可推翻性**：若折进 goal check 让 goal check 语义过载（deadline 关注点污染目标完整性检查），拆出 `deadline check` 并在 SKILL A 明确两道 gate 的调用顺序。

---

## 3. DDL 数据模型（D2 核心输入）

### 3.1 字段 / 子结构

DDL 落 `goal_contract.deadline`（`brief` 的兄弟键，board-model.ts `FIELDS.board.goal_contract`）：

```json
{
  "goal_contract": {
    "schema": "ccm/goal-contract/v1",
    "revision": 1,
    "assurance": "asserted",
    "brief": { "ref": "goals/<stem>/r0001.goal.md", "sha256": "sha256:<hex>" },
    "deadline": {
      "state": "confirmed",
      "at": "2026-08-01T09:00:00Z",
      "precision": "minute",
      "kind": "hard",
      "provenance": {
        "raw": "8月1日下午5点前（北京时间）",
        "source": "user-reply",
        "tz_input": "Asia/Shanghai"
      },
      "updated_at": "2026-07-16T10:30:00Z"
    },
    "updated_at": "2026-07-16T10:30:00Z"
  }
}
```

字段定义（六要素·对齐 board-model.ts `FieldMeta` 风格）：

| 字段 | 类型 | 缺省 | 谁读 | 谁写 | 何时 | 缺失降级 |
|---|---|---|---|---|---|---|
| `deadline.state` | enum `pending\|asserted\|confirmed\|none` | 缺整个 deadline 键 = 视同 pending（未询问） | goal check / deadline-risk endpoint / viewer / SKILL A | `ccm goal deadline set\|confirm\|confirm-none\|amend` | fresh framing / 用户确认 / 截止期变更 | 缺→pending（未询问）；enum 外→hard `FMT-DEADLINE` |
| `deadline.at` | ISO-8601 UTC（`isISOUTC` 口径） | 无（仅 state∈asserted/confirmed 时存在） | 同上 | 同上 | 有明确交付时刻时 | 缺但 state∈asserted/confirmed→hard `FMT-DEADLINE`；形状错→hard `FMT-DEADLINE` |
| `deadline.precision` | enum `minute\|day` | `minute` | deadline-risk endpoint（day → 落当日 UTC 末刻语义·见 §3.4） / viewer | writer | set/amend 时 | 缺→按 minute 解读 |
| `deadline.kind` | enum `hard\|soft`（v1 恒 hard·§2.3 预留） | `hard` | risk endpoint（v1 忽略差异） | writer | —— | 缺→hard |
| `deadline.confirmation_level` | *（不单列）* | —— | —— | —— | —— | 由 `state` 承载（asserted vs confirmed），不设冗余字段 |
| `deadline.provenance.raw` | string | 无 | 审计 / viewer | writer | set/amend 时透传原始表达 | 缺→无原始表达留痕（诚实） |
| `deadline.provenance.source` | enum `goal-evidence\|cli-flag\|user-reply` | 无 | 审计 | writer | set/amend | 缺→未知来源 |
| `deadline.provenance.tz_input` | string（IANA tz 名） | 无 | 审计（用户给本地时刻时的假定/解析时区） | writer | 用户给本地时间时 | 缺→假定已是 UTC |
| `deadline.updated_at` | ISO-8601 UTC | 无 | 审计 / dedup fingerprint 输入 | writer | 每次 set/confirm/amend | 缺→warn `FMT-DEADLINE`（不拦写盘·同 FMT-RUNTIME 风格） |

**审计不双写**：deadline 的变更历史**复用 `board.log`**（append-only decision 条目，`appendGoalLog` 同型），**不**在 deadline 子对象里再嵌 history 数组——避免第二份审计漂移（board-model.ts 的 `baseline.history[]` 是嵌入式审计的先例，但这里选 `board.log` 以复用 goal 生命周期已有的落点）。每条日志记 `{from, to, reason?, source, ts}`。

### 3.2 三态 + 四态状态机（issue 三态的严格实现）

issue 要求区分 `pending` / `confirmed deadline` / `confirmed no-ddl`，且「no-ddl 已确认」≠「未询问」。落地为 **4 态 `state` 机**（镜像 goal `assurance` 的 pending/asserted/confirmed + 增 `none`）：

| `state` | 含义 | `at` | dispatch 门控 | 对应 issue 三态 |
|---|---|---|---|---|
| **（deadline 键缺失）** | **未询问**（fresh skeleton 默认） | 无 | 门控（= pending 语义） | pending 的一种 |
| `pending` | 已询问 / 已识别候选但未 settle（歧义、冲突、待用户答） | 可无 / 可有暂定候选 | **门控**（不 settle 不派发） | pending |
| `asserted` | agent 从无歧义 evidence / `--ddl` 转写的候选，可逆推进 | 有 | 放行（可逆） | confirmed deadline（弱） |
| `confirmed` | 用户明确确认的截止期（`--user-authorized`） | 有 | 放行 | confirmed deadline（强） |
| `none` | 用户明确确认**无 DDL** | 无 | 放行（不再追问） | confirmed no-ddl |

**关键区分**：`none`（用户确认无 DDL·持久化·不再追问）**≠** 键缺失/`pending`（未询问 / 未 settle）。这正是 issue「no-ddl 已确认 ≠ 未询问」的机械实现——`none` 是一个显式持久状态，`goal check` 见它即 `ok`（不 `deadline_pending`）。

**`asserted` 的存在理由**：完全镜像 goal `assurance` 的 `asserted`——清晰、低风险的截止期（如用户 `--ddl` 一个完整 ISO，或 goal evidence 里毫无歧义的绝对时刻）allow agent 转写后可逆推进，不必为每个清晰输入机械追问用户确认（对照 goal-contract-lifecycle-spec §6.2 分级确认）。高风险 / 歧义 / 冲突才停 `pending`。

**dispatch 门控口径**：门控态 = `pending`（含键缺失）。放行态 = `asserted | confirmed | none`。这与 goal `assurance` 的门控（pending 门控、asserted/confirmed 放行）完全同构，agent 心智负担为零。

### 3.3 tier 选择 + narrow waist 影响论证

**tier：👁 observed（嵌在已是 👁 的 `goal_contract` 内）。narrow waist（🔒）一字不动。**

论证：
1. **不是 🔒 load-bearing**——deadline-risk hook **读** `goal_contract.deadline.at` 与 forecast 比，但 hook 在 deadline 缺失时**优雅降级**（无 DDL → risk band `unknown`/`n/a`、静默），符合 👁「hook 若有则用、缺则降级」的定义，不符合 🔒「hook 机器依赖、缺则语义崩」。
2. **deadline 值由 ccm goal deadline verbs 写**（agent/用户 authority），deadline-risk hook **只读不写** deadline——hook 唯一写的是 ✎ `runtime.*` 簿记（§4/§5）。故 deadline 字段不进任何 hook 的写路径。
3. **零窄腰改动**——`goal_contract` 本就是 👁 非窄腰（ADR-035 §3.3）；hook 已在解析 `board.goal_contract`（identity-nudge.js `buildGoalText` 读 `board.goal_contract.schema/revision/assurance`），读多一个 `.deadline` 子键**不新增窄腰依赖**。红线2 真正保护的 🔒 子集（schema/goal/owner/git/tasks + task.{id,status,deps,parent}）**完全不变**。

**「若必须动窄腰」清单**：本设计**不动窄腰**，故无受影响 hook 清单。（对照：真要把 deadline 设成 🔒 才需同 PR 改全 hook + 测试——本设计刻意避开。）

### 3.4 规范化 ISO-8601 UTC + provenance + 语义边界

- **规范化**：`deadline.at` 落板一律**严格 ISO-8601 UTC**（`YYYY-MM-DDTHH:MM:SSZ`，`isISOUTC` / `ISO_UTC_RE` 口径，board-model.ts:1281）。用户给本地时刻（如「北京时间 8/1 下午5点」）→ **agent 负责换算成 UTC** 后经 `--at` 传入 ccm，原始表达存 `provenance.raw`、假定时区存 `provenance.tz_input`（审计可回溯）。ccm 只校验 ISO-8601 UTC 形状 + 语义合法性，**不做时区换算 / NL 解析**（语义归 agent）。
- **precision=day 语义**：用户只给日期无时间（`--precision day`）→ 落 `at` 为该日 UTC 的**约定末刻**（`YYYY-MM-DDT23:59:59Z`）+ `precision:day` 标记，让 deadline-risk endpoint 知道这是「当日交付」而非精确到秒的承诺（避免把「8/1 交付」误当「8/1 00:00 交付」而虚增紧迫）。具体末刻约定（当日末 vs 次日 0 点）由 D2 定并写进 `board-model-guide.md`。
- **provenance**：`raw`（原始表达）+ `source`（goal-evidence/cli-flag/user-reply）+ `tz_input`——三者供审计，不参与 risk 计算。
- **与 cadence/ETA/timeout 的语义边界**：见 §1.2 表；机械上 deadline-risk endpoint 只读 `goal_contract.deadline`，从不读 `cadence.iterations[].deadline` 当 DDL（防混淆）。

---

## 4. CLI 面（D2 + D3B 输入）

### 4.1 专属 writer verbs：`ccm goal deadline <verb>`

**namespace 归属**：nest 在 `goal` 下（deadline 是 goal_contract 约束）——`ccm goal deadline set|confirm|confirm-none|amend|show`。三级命令有先例（`ccm coordination subscription register` / `ccm coordination inbox list`）。**禁止**用泛型 `ccm board update` / `ccm board set-param` 改 deadline（同 `board update --goal` 在 contract 激活后被拒的先例，mutations.ts:151）——`set-param` 白名单只含 `runtime.*`，board update 无 deadline arg，故天然封堵。

签名草案（对齐 goal.ts / mutations.ts 现有 verb 骨架 + runWrite 带锁管线）：

```bash
# set：设候选/断言截止期（fresh framing 或 legacy 首次；state → asserted 或 pending）
ccm goal deadline set --board <path> --at <ISO-8601-UTC> \
  [--precision minute|day] [--provenance-raw "<原始表达>"] \
  [--source goal-evidence|cli-flag|user-reply] [--assurance asserted|pending] [--json]
#   · --at 严格 ISO-8601 UTC；--assurance 缺省 asserted（清晰）；pending 用于「识别到候选但仍歧义」
#   · 幂等重设候选允许（未 confirmed 前）；已 confirmed 后 set 拒绝、指向 amend

# confirm：把当前 asserted/pending 候选升为 confirmed（要 --user-authorized·镜像 goal confirm）
ccm goal deadline confirm --board <path> --user-authorized [--json]
#   · 缺 --user-authorized 拒绝；agent 不得自授权（红线：绝不自授权）
#   · 无候选 at 时拒绝（不能确认一个不存在的截止期）

# confirm-none：用户明确确认「本目标无 DDL」（state → none·要 --user-authorized）
ccm goal deadline confirm-none --board <path> --user-authorized [--json]
#   · 持久化 none·此后 goal check 见 none 即 ok（不再 deadline_pending·不再追问）

# amend：变更已确认截止期（延长/改期/改精度·要 --reason + --user-authorized）
ccm goal deadline amend --board <path> --at <ISO-8601-UTC> --reason "<why>" \
  --user-authorized [--precision minute|day] [--json]
#   · 强制 --reason + --user-authorized（agent 绝不静默延期·issue 非目标）
#   · 记 board.log {from, to, reason, ts}·不 bump goal_contract.revision（§2.1 子决策）

# show：只读当前 deadline 子对象 + 派生（time_remaining 等）
ccm goal deadline show --board <path> [--json]
```

**授权与审计**：`confirm` / `confirm-none` / `amend` 强制 `--user-authorized`（`goalConfirm` 已有 `userAuthorized !== true → throw` 先例）；`amend` 额外强制 `--reason`（`goalAmend` 已有 `reason` 非空校验先例）。每次写追加 `board.log` decision 条目 + 刷 `deadline.updated_at` + `goal_contract.updated_at`。全程 runWrite 带锁 + 写后 lint（撞规则 → exit 3）。

### 4.2 新增 lint 规则清单（当前 83 条 → 86 条）

当前规则总数 **83**（FMT=45 / BIZ=30 / GRAPH=8，board-model.ts `INVARIANTS`）。新增 3 条：

| 规则 id | family | level | 判据 | 落点 |
|---|---|---|---|---|
| **`FMT-DEADLINE`** | FMT | **hard** | deadline 子对象存在但形状错：`state` 不在 enum；`state∈{asserted,confirmed}` 但缺 `at` 或 `at` 非 `isISOUTC`；`state∈{pending,none}` 但带 `at`（none 不该有 at）；`precision`/`kind` 非法枚举 | 扩 goal_contract well-shaped 谓词（board-lint-core.ts:157-176）或新 `lintDeadline`；`updated_at` 形状错走 warn 分支（同 FMT-RUNTIME 风格·不拦写盘） |
| **`BIZ-DEADLINE-PENDING`** | BIZ | **warn** | deadline 未 settle（键缺失或 state==pending）**且** 存在可执行任务（status ∈ {ready, in_flight, uncertain}）——「可执行 DAG 在 deadline pending 时启动」 | 镜像 `BIZ-GOAL-PENDING`（board-lint-core.ts:275-295） |
| **`BIZ-DEADLINE-OVERDUE`** | BIZ | **warn** | `state∈{asserted,confirmed}` 且 `now >= at` 且全局 acceptance 未完成（board 未归档 / 有未完成任务）——「DDL 已过期」 | 新 `lintDeadline` 分支（`now` 经 lint 的时间源/`--now` 注入·backtest 一致） |

**为什么 OVERDUE 是 warn 非 hard**：已过期是一个需要处置的真实态（issue §resume：先报告状态/剩余交付物/方案、由用户决定延期/缩范围/分阶段/终止），不是结构性损坏；hard block 会卡死一个合法的「已过期待用户决策」态。overdue 的**主动唤起**由 deadline-risk hook 的 `overdue` band 承担（strong·§5），lint 只作静态 backstop。

`FMT-DEADLINE` 为 hard 使 `goal check` 在 deadline 形状损坏时返回 `malformed`（exit 3·§2.4）。三条规则都遵循「present 才校验 / 缺则早返回」——**legacy board 自动兼容**（无 deadline 键 → 三规则皆早返回、板仍合法）。

### 4.3 `ccm estimate deadline-risk --json` 输出 schema（D3B 契约）

新增只读、确定性、零写 endpoint（`estimate` namespace·`read: true`·runRead·消费 `@ccm/engine` 算法层不重写·同 forecast/risk 先例）。它是 issue 补充节要求的**单一 deadline-risk JSON SSOT**——hook 只搬运、绝不重算（红线3）。

命令面（registry.ts estimate 段加一条）：
```bash
ccm estimate deadline-risk --board <path> [--scope home|this-repo|this-board] \
  [--as-of <ISO>] [--runs <n>] [--seed <n>] [--effective-n <n>] [--json]
```

`--json` 输出 `{ ok: true, data: {...} }`，data 形态：

```jsonc
{
  "deadline": "2026-08-01T09:00:00Z" | null,     // goal_contract.deadline.at（state∈asserted/confirmed 时）
  "deadline_state": "confirmed" | "asserted" | "pending" | "none",
  "as_of": "2026-07-16T10:30:00Z",
  "time_remaining_hours": 356.5 | null,          // (deadline - as_of)/3600000·null when no confirmed/asserted DDL

  "on_time_probability": 0.82 | null,            // P(finish <= DDL)·核心·经校准 MC 经验 CDF·null=unknown
  "forecast": { "p50": "<ISO>", "p80": "<ISO>", "p95": "<ISO>" } | null,  // 复用 forecast ETA
  "margin": { "p50_h": 40.0, "p80_h": 12.5, "p95_h": -6.0 } | null,       // DDL - forecast_pX（小时·负=越过 DDL）

  "risk_band": "on_track" | "watch" | "at_risk" | "likely_late" | "overdue" | "unknown",
  "strength": "weak" | "strong",                 // ADR-018 力度·引擎按 band emit（watch=weak；at_risk/likely_late/overdue=strong）·hook 直接填

  "channels": {                                   // 双通道显式暴露（issue 补充节要求·不能把 lower bound 当承诺）
    "precedence_only": {                          // 无资源约束·乐观下界（estimateDagMonteCarlo）
      "on_time_probability": 0.90,
      "makespan_p50_h": 120.0, "makespan_p80_h": 160.0, "makespan_p95_h": 210.0
    },
    "resource_aware": {                           // 资源约束/吞吐保守通道（throughputMonteCarlo 或 RCPSP-in-trial·D3A 定）
      "on_time_probability": 0.70,
      "source": "throughput-mc" | "rcpsp-in-trial",
      "days_p50": 15.0, "days_p80": 20.0, "days_p95": 27.0
    } | null
  },
  "channel_disagreement": 0.22 | null,           // dualChannelConsistency deviation·超阈值→禁无条件 on_track
  "coverage_pct": 60,                             // 未完成任务里有 estimate 的占比
  "confidence": "high" | "medium" | "low",
  "history_n": 42,
  "scope": "home",

  "top_drivers": [                                // 先动哪里（issue 补充节 §4 风险驱动因子）
    { "id": "T7", "criticality": 0.80, "sensitivity": 0.62, "reason": "critical" },
    { "id": "T3", "reason": "blocked", "detail": "blocked_on:user 12h" },
    { "id": "T9", "reason": "wip-aging", "detail": "age 30h > SLE p95" }
    // reason ∈ critical | sensitive | blocked | escalated | wip-aging | resource-conflict
  ],
  "runs": 2000, "seed": 42,
  "source": "calibrated" | "estimate",
  "notes": ["...诚实降级从句..."]
}
```

**风险分层判据**（初始假设·issue 补充节表·D3A 校准后固化，非拍脑袋写死）：

| band | 初始判据（概率优先·分位作可解释镜像） |
|---|---|
| `on_track` | `on_time_probability` 高（初始 `p95 <= DDL` 即 P≈≥0.95）**且** 通道不严重分歧 **且** 置信/coverage 足 |
| `watch` | `p80 <= DDL < p95`（P 中高） |
| `at_risk` | `p50 <= DDL < p80`（P 中） |
| `likely_late` | `DDL < p50`（P 低） |
| `overdue` | `now >= DDL` 且全局 acceptance 未完成 |
| `unknown` | 无 DDL（deadline_state ∈ pending/none）/ 图含环 / 无有效预测 / coverage·history 太弱 / 双通道严重分歧——**绝不映射成绿**（false-green 禁令） |

**诚实字段硬要求**（issue 补充节 §6）：`coverage_pct` / `confidence` / `history_n` / `channel_disagreement` / `source` / `notes` 全部随输出；低 coverage、低 confidence、通道冲突、图错误、预测不可用 → `risk_band: unknown` 或带低置信标记，**绝不 false-green**。若 precedence-MC 与 resource/throughput 通道偏差超 consistency 门槛（`dualChannelConsistency` 默认 0.2）→ 不报无条件 `on_track`。

**关键引擎缺口（D2/D3B 必须补·载重）**：`estimateDagMonteCarlo`（mc-scheduler.ts）与 `throughputMonteCarlo` **当前只返回分位数**（p50/p80/p95），**不暴露经验 CDF / 原始样本**——内部 `makespanSamples` / `daysSamples`（Float64Array）算完分位就丢。要出 `on_time_probability = P(finish <= DDL)` 必须新增一个纯引擎 helper：**`empiricalCdfAtOrBefore(sortedSamples, target)`**（返回 ≤ target 的样本占比），供两通道复用；或给 `estimateDagMonteCarlo`/`throughputMonteCarlo` 加可选 `target` 参数直接返回 `on_time_probability`。推荐前者（最小·seeded·确定性·零算法重写）。比较时须把 DDL 换成同单位的「距 as-of 的剩余量」：precedence 通道 `P(makespan_hours <= time_remaining_hours)`、resource 通道 `P(throughput_days <= time_remaining_days)`。**wall-clock ↔ work-hours 映射诚实性**：现有 forecast 已用 `addHoursISO`（假设连续执行）把 makespan 小时映射成挂钟 ETA——这个「makespan 小时是否连续消耗」的假设是已知校准隐患，D3A 必须度量并在 notes 诚实标注。

### 4.4 bypass 封堵

- deadline 只能经 `ccm goal deadline` verbs 写；`ccm board update` 无 deadline arg，`ccm board set-param` 白名单只含 `runtime.*`（不含 deadline）→ 天然封堵泛型写。
- board-guard（ADR-025）已拦 agent 直接 file-edit board JSON → deadline 手改同样被拦、指向 `ccm goal deadline`。
- deadline-risk endpoint 是 `read: true`（runRead·零写·不抢 board-lock），与 forecast/risk 同级——纯 compute。

---

## 5. Hook 层设计（D4B 输入）

### 5.1 扩展现有 periodic-prompts hook vs 新独立 deadline-risk hook

**推荐决策：扩展现有 periodic-prompts hook（物理文件 `identity-nudge.js`，概念上已是周期提示表 `[identity, goal, critpath]`），加一条 `deadline-risk` 周期条目；且当存在已确认 DDL 时，deadline-risk 条目 supersede critpath-nudge 的「按期/落后」从句。绝不保留两套重复计算 / 重复通知（issue 硬要求）。**

论证：
1. **去重计算**——critpath-nudge 现调 `ccm board critical-path` + `ccm estimate evm` 报「临界链 X/Y + on-track/behind」，但它 **DDL 无感**（只看 baseline SPI/SV，不看 DDL）。deadline-risk 是 DDL-aware 的超集。让二者共存会产生两条「进度如何」通知。故：**deadline-risk 条目仅在 `deadline.state ∈ {asserted, confirmed}` 时 fire，且 fire 时抑制 critpath-nudge 的 schedule 从句**（critpath-nudge 退为纯 X/Y 计数，schedule verdict 交给 deadline-risk）；无 DDL 时 critpath-nudge 保持现状。一次 `ccm estimate deadline-risk` 调用替代 DDL 场景下的独立 `ccm estimate evm` 调用。
2. **复用单一 substrate**——一个 hook = 一道武装闸（`runHook` arm:'boards'）、一份 dedup sidecar、一套 `periodicNudge` cadence 框架、一个 Stop 事件、一个 `stop_hook_active` preGate。新独立 hook 会复制这一切 + 新注册项 churn。
3. **CONTRACT 归位**——deadline-risk 的业务规则加进 `identity-nudge/CONTRACT.md`（该 hook 的 CONTRACT SSOT），新增 `rule-deadline-risk-*` + PARITY anchors。

（备选「新独立 `deadline-risk` hook」保留为可推翻项：若 deadline-risk 的触发/节流/通知状态机复杂到与 periodic 提示表格格不入，D4B 可拆独立 hook——但 CONTRACT 必须显式声明它与 critpath-nudge 的去重边界，证明无重复计算/通知。）

### 5.2 触发设计（有界 hybrid·issue 补充节 §触发）

1. **周期检查**——Stop 事件，经 `periodicNudge` 读 `runtime.last_deadline_risk_check` 判 cadence。基础周期复用 critpath cadence 量级（默认 2h），但**自适应缩短**：随 `time_to_ddl` 减小、risk band 升高、预测波动增大而缩短（具体自适应函数由 D4B 定，engine 可在 endpoint 里回一个建议 `next_check_after_sec`）。
2. **变更触发（risk-input fingerprint）**——DDL revision、task status/deps/estimate、WIP/owner-WIP、blocked/escalated、baseline、可用资源发生足以改 forecast 的变化后，在下一个安全 hook point 重估。**fingerprint 从 board 结构算**（窄腰 tasks[].{id,status,deps} + goal_contract.deadline + scheduling.wip_limit 的稳定摘要），**绝不**靠脆弱 shell 字符串解析猜 ccm mutation（issue 明确）。fingerprint 存 `runtime.last_deadline_risk_fingerprint`。
3. **恢复 / resume 检查**——SessionStart / resume 后、继续派发前刷新一次 risk（不沿用上个 session 的陈旧绿 verdict）。落点：resume 分支的注入 + 首个 Stop 强制重估（清 `last_deadline_risk_check` 使首个 Stop 必 due）。

### 5.3 节流 + 通知状态机（issue 补充节 §触发/§通知）

**计算去重**：`runtime.last_deadline_risk_check`（ISO·经 `ccm board set-param` 白名单键·同 last_critpath_remind）+ `runtime.last_deadline_risk_fingerprint`（risk-input 摘要）。输入未变且未到 freshness ceiling → 不重算。`ccm estimate deadline-risk` 调用有 timeout（10s·同 critpath spawn）+ 固定 seed + bounded runs + 明确 latency budget。

**通知去重（hook-owned sidecar·非 board）**：记 last risk band / on_time_probability / notification fingerprint。仅在以下才（再）通知：
- 首次进入风险（band 从 on_track/unknown → watch+）；
- band 恶化（watch → at_risk → likely_late → overdue）；
- 准时概率 / margin 显著下降（阈值 D4B 定·如 ΔP ≥ 0.1 或 margin_p80 由正转负）；
- top driver 改变（先动哪里变了）；
- 高风险长期未处理达 reminder interval（防「一次通知后就沉默」）。
- **风险恢复**允许发一次 recovery 通知（band 回落）。
- **ack 不吞后续更严重新风险**：新的更严重 band = 新 durable notification id → 新 unconsumed（coordination inbox `deliverCoordinationNotification` 以 id 幂等·新 id 不被旧 ack 吞·inbox.ts supersession 按 kind，故须让「恶化」产生新 id 而非 supersede 旧的·见下 durable 语义）。

**durable notification（复用 coordination 通道）**：
- 新增第 9 个 notification kind **`deadline_risk`**（加进两处 closed-enum SSOT：`ENUMS.notificationKind`·board-model.ts:66-76 + `NotificationKind` union·inbox.ts:3-11）。
- 生产路径复用 usage-pacing 的 `deliverDurablePacing` 同型：`ccm coordination notify --kind deadline_risk --summary <...> --strength <weak|strong> --payload <json> --expires <ISO> --json --board <p> --home <h>`（handlers/coordination.ts）。
- **exactly-once-visible**：coordination inbox 已有 id 幂等（`inbox.has(id)`）+ dedup + supersession（同 kind 保留 ≤1 unconsumed）。**supersession 分区抉择**（inbox.ts `supersessionKey`）：deadline_risk 默认按 kind supersede（同一板同一时刻只留最新一条 deadline_risk）——**这正是我们要的**（旧 watch 被新 at_risk supersede·世界模型只留最新 band）。但「ack 不吞更严重新风险」要求：恶化时产生**新 id**（新 unconsumed）而非静默改旧条 → 用 payload 带 band/fingerprint，恶化 = 新 id·supersede 旧 unconsumed（旧的标 superseded_by·不再 surface），新的必须被 agent 重新看到（未 ack）。若同一板需要并存多条（一般不需要），才在 `supersessionKey` 加 payload 分区（同 quota_state_change 的 scope_digest 先例）——v1 按 kind 足够。
- **直接注入 + durable inbox 双通道**：deadline-risk hook 既在 Stop 直接注入（即时可见），又经 durable inbox 留痕（跨 session）。定义一个 notification fingerprint（band + top_driver + rounded on_time_probability + deadline）作 exactly-once-visible key——同一回合不让同一风险出现两遍（hook 侧：本回合已直接注入的 fingerprint 不再从 inbox 重复 surface；inbox 侧 coordination-inbox hook 的 `selectItemsToSurface` 900s cooldown 已兜重复 surface）。

**三 host envelope**（issue 补充节 §通知通道·ADR-031 parity）：
- 内容/力度/去重/cadence 三 host 等价，只 envelope 不同。author advisory/directive 文本在 host-neutral core，非 Claude host emit `{kind:'system', message}` 让 launcher 选原生封套：
- **Claude Code** Stop → `additionalContext`（`runHook` `{additionalContext}`）。
- **Codex** → `systemMessage`（core emit `{kind:'system'}`·`_hosts/codex/launcher.js` `emitHostResult` map）。
- **Cursor** → `followup_message`（`_hosts/cursor/launcher.js` map 任一 Stop 结果）——注意 followup_message 自动续跑 agent，风险恰是产品要求（通知须到达 agent）。
- **kimi-code 作条件项**：若届时已接入，加第 4 列 host 实现 + Capability Card 声明；未接入则 CONTRACT 显式标注 out-of-scope（不沉默省略）。

**注入 taxonomy（ADR-018）**：`watch` → `<advisory strength="weak">`；`at_risk` / `likely_late` / `overdue` → `<advisory strength="strong">`。**默认不机械 block Stop、不直接改板**（issue 补充节：若要 block 须另行证明不阻塞等待用户/外部依赖的合法态——v1 不 block）。coordination-inbox hook 的 `tagged()` 现把 pacing_stop/hitl_turn → directive、其余 → advisory；deadline_risk 走 advisory 默认路径（除非 D4B 论证 overdue 该升 directive——须过 pressure baseline，见 §8）。

**通知内容**（至少含·issue 补充节）：DDL / as-of / time remaining；p50/p80/p95 ETA + 各分位 margin + on_time_probability；risk band / confidence / coverage / source / disagreement；top critical/sensitive/blocked drivers；自上次评估发生了什么变化；**明确动作提示：立即优先做一次全局 DAG reconcile / replan**（不是继续局部推进）。通知只给决策输入与优先级，**不替 orchestrator 决策**（红线3/4）。

### 5.4 红线落点

- **红线1**：hook bash + node/JS·纯 stdlib + spawnSync `ccm`（进程边界·非 import 引擎·非 python/jq）。
- **红线2**：只读窄腰 owner.active/session_id 判武装 + 读 👁 `goal_contract.deadline` + 读窄腰 tasks[].status 算 fingerprint；写只写 ✎ `runtime.*`（经 ccm set-param）。窄腰一字不动。
- **红线3（关键）**：**所有图算法 / 估算 / 风险 verdict 归 ccm 引擎**——hook 只 `ccm estimate deadline-risk --json` + 校验结构化响应 + 搬运。**hook 不重写 CPM / Monte Carlo / RCPSP / 分位 / 风险阈值**（issue 补充节强制架构边界）。
- **红线4**：advisory·永不 block Stop·不替主线决策（只给决策输入）。
- **红线5**：ccm 缺 / spawn 失败 / lock timeout / 坏 JSON → 静默降级（feature 等同关闭·不报错·不 block·不污染 board·不伪造 verdict）；按 freshness 后续重试。
- **红线6**：dormant-until-armed（`runHook` arm:'boards'·未武装静默）。
- **防 Stop re-entry 循环**：`preGate(ctx){ return ctx.obj?.stop_hook_active === true }`（先于武装·同 usage-pacing/identity-nudge）+ notification fingerprint 去重（Codex systemMessage / Cursor followup_message 会续跑 agent·靠 fingerprint + sidecar cooldown 不制造无限循环·无数字 loop counter·靠 stop_hook_active + id-keyed sidecar cooldown + 引擎 supersession 三重兜）。
- **唯一允许的持久写**：经 ccm 写 hook-owned `runtime.*` 簿记 + durable `deadline_risk` 通知；不手改 board JSON。

**runtime.* 白名单新增键**（ADR-020·`ccm board set-param` least-privilege·扩 lintRuntime board-lint-core.ts:1142-1183 + FIELDS type + FMT-RUNTIME）：
- `runtime.last_deadline_risk_check`（ISO·cadence 节流·同 last_critpath_remind）
- `runtime.last_deadline_risk_fingerprint`（string·risk-input 摘要·计算去重）——注意这是 string 非 ISO，lintRuntime 对它做 string 校验非 badTimestamp。

---

## 6. 算法 spike 任务书（D3A 照此执行）

**目标**：先做算法设计 spike，不凭感觉硬编码阈值（issue 补充节明确）。产出喂 D3B endpoint 定形 + 阈值固化。

### 6.1 对比矩阵（三通道）

| 通道 | 机制 | 现状 | 产出 | 成本 |
|---|---|---|---|---|
| **A. precedence-only MC** | `estimateDagMonteCarlo`（forward pass·log-normal·无资源闸） | **已有**（mc-scheduler.ts·只回分位·缺经验 CDF） | 乐观下界 `on_time_probability`（假设无界并行） | 低（已在跑） |
| **B. RCPSP-in-trial** | 每个 MC trial 内跑 resource-feasible schedule（serial SGS·min-slack/LFT·WIP=k）+ 采样时长 → resource-feasible finish | **不存在**（`rcpspSchedule` 是确定性单趟·未入 MC 循环·rcpsp.ts） | 资源约束 `on_time_probability`（真实 WIP 下） | **高**（2000 trials × RCPSP·须实测是否越 latency budget） |
| **C. 吞吐保守通道** | `throughputMonteCarlo`（#NoEstimates·历史吞吐 bootstrap·不依赖 per-task 估值） | **已有**（只回天数分位） | resource-aware 保守 `on_time_probability`（÷effective-n 已支持并行度） | 低 |

**spike 必须比较并记录**（issue 补充节 §1-3）：
1. **概率式准时判定**——每 trial 得 resource-feasible finish → 直接 `P(finish <= DDL)`，而非只比一个确定性 CPM 点估。
2. **资源约束**——优先评估 B（RCPSP-in-trial）；若性能 / 模型数据不足做不到，必须同时暴露 A（precedence lower bound）+ C（resource/throughput 保守通道）+ 两者分歧 + 明确 `unknown` / low-confidence，**绝不把 lower bound 当承诺**。
3. **分位 margin**——`margin_p50/p80/p95 = DDL - forecast_pX`，同时保留原始 ETA / `coverage_pct` / `confidence` / history source / 双通道 disagreement。

**推荐落点（spike 未证明前的默认）**：endpoint 双通道 = **A（precedence lower bound）+ C（throughput 保守）**，`resource_aware.source: throughput-mc`；B（RCPSP-in-trial）作为 spike 评估项——若实测在 latency budget 内且校准更优，则 D3B 切 `resource_aware.source: rcpsp-in-trial`；否则 C 留作保守通道 + 显式 disagreement + unknown 降级。

### 6.2 `--as-of` 回放校准（issue 补充节 §7）

复用已有 backtest 基建（`corpusAsOf` / `isDoneAsOf` / `nowMsOf` / `loadScopedCorpus` 的 `--as-of`·estimate.ts）：
- 用已有 board 的 `--as-of` 回放，评估 `on_time_probability` 的 **calibration**（reliability diagram）、**Brier score**、不同 risk band 的 **false-negative（漏报延期）** 与 **alert fatigue**。
- 阈值经 **OBJECTIVE / holdout 证据固化**，不凭一次样例拍脑袋（防过拟合·对照 `grounding-skill-evals` 的 predict-then-validate）。
- band 分层判据（§4.3 初始假设表）是 **spike 校准的起点、非最终合同**——校准后可调（如 on_track 用 P≥0.9 而非机械 p95<=DDL）。

### 6.3 性能预算

- **seeded**（Sfc32·固定 seed·确定性·复现）+ **bounded trials**（默认 2000·可 cap）+ 明确 **latency budget**（hook 以 10s timeout 调·须远低于·留 headroom）。
- **B 通道风险**：RCPSP-in-trial 在 2000 trials × N 任务下可能爆预算——这正是 spike 要实测的关键发现。若爆 → 降级 C。
- endpoint 可回一个建议 `next_check_after_sec`（自适应 cadence 输入·§5.2）。

### 6.4 交付收口建模（issue 补充节 §5）

- DDL 约束的是**通过全局 acceptance 后的最终交付**。集成 / review / 修复 / 文档 / 发布等 load-bearing 收口工作**必须进入 DAG**——不能用「实现完成 ETA」冒充「交付完成 ETA」。
- 若另设 project buffer（复用 `sizeProjectBuffer` / CCPM），必须说明它与 DAG 内**显式收口任务**的关系，**避免双算 buffer**（DAG 里已有显式 review/发布任务 + 又加 project buffer = 重复计）。spike 须给出「显式收口任务 vs project buffer」的取舍建议。

### 6.5 诚实降级（issue 补充节 §6）+ 验收口径

- 无 DDL、图含环、无有效预测、coverage/history 太弱、模型通道严重分歧 → `unknown` 或低置信标记；**绝不把「算不出来」映射成绿色**。
- 验收：选中的通道在 latency budget 内 + calibration 可接受（Brier / reliability）；若 B 太慢，用 C 作 resource-aware 保守 + 暴露 disagreement + unknown；阈值固化有 holdout 证据。
- 研究锚点（issue 补充节列的三篇·spike 参考·非硬依赖）：Vanhoucke《Project Management with Dynamic Scheduling》（无资源/资源约束排程连续闭环）· Song & Vanhoucke（MC schedule risk·CI/CRI/SSI·corrective action）· 不确定工期 RCPSP heuristic（probabilistic constraints）。

---

## 7. bootstrap / goal-flow 契约（D4A 输入）

原则（承 ADR-035 §7.3 hook 边界）：**hook 只做可靠触发与注入流程；语义判断（NL 日期识别 / 冲突消歧 / 确认）归 agent；持久化与校验归 ccm。**

### 7.1 Fresh bootstrap

1. bootstrap 保留 positional `<goal>` / `--goal` 的原始 evidence，向 agent 注入来源信息（现已做）；hook **不猜自然语言日期**。
2. **`--ddl` init flag**（§2.2）：建板 + 盖 sid 后，据用户亲手敲的 `--ddl` 值，best-effort `ccm goal deadline set --at <值> --source cli-flag --assurance asserted`（同 `--priority`/`--wip` INIT-FLAGS 段·bootstrap-board.sh·失败只记 note·不 block 起跑）。`--ddl` 非 ISO-8601 UTC → 不落地、记 note、原值作 evidence 传 agent。
3. bootstrap 注入 context 要求 agent 在 Goal Framing 阶段：从 goal evidence 提取候选 DDL（只有日期/时间/时区/「最终交付」语义均无歧义时才形成候选）；显式 `--ddl` > NL 推断；多源冲突不得自选、须向用户确认；未识别到 / 只有「周五/尽快/本月底」等歧义 → 主动询问用户，在得到「明确交付时刻」或「用户明确声明无 DDL」前保持 deadline pending。
4. **DDL / no-DDL 确认完成后**才允许 `goal check` 通过（返回 `ok` 而非 `deadline_pending`）→ 进入 DAG 拆解与派发。`none`（确认无 DDL）持久化、不再重复追问。

### 7.2 Resume / legacy / 已过期

- **resume**：保留原 DDL 与确认状态、**不重置**（bootstrap-board.sh resume 分支只 re-stamp owner 窄腰·不碰 goal_contract·天然保留 deadline）。但 master orchestrator 在恢复执行前**补做一次 DDL / no-DDL 确认 + 一次 deadline-risk 刷新**（§5.2 resume 检查·不沿用陈旧绿 verdict）。
- **legacy board**（无 goal_contract / 无 deadline）：可读、可迁移、不因 schema 演进直接失效（三条新 lint 规则 present 才校验·缺则早返回·§4.2）。`goal set` 激活 contract 后可 `goal deadline set` 补 DDL；恢复执行前补一次 DDL/no-DDL 确认。
- **已过期 DDL**（`state∈{asserted,confirmed}` 且 `now >= at` 且未完成）：**不当作普通 resume**。`BIZ-DEADLINE-OVERDUE` warn + deadline-risk band `overdue`（strong）主动唤起。agent 先向用户报告当前状态、剩余交付物和方案，再由用户决定**延期 / 缩范围 / 分阶段交付 / 终止**（issue §resume）——延期走 `ccm goal deadline amend --user-authorized`，缩范围走 `ccm goal amend`，均不静默。

### 7.3 三 host 一致（Capability Card·§13）

Claude Code / Codex / Cursor 的 fresh bootstrap 均保留 positional `<goal>` / `--goal` evidence 并触发一致的 agent 解析 / 确认流程（issue 验收项）。机制差异经 Capability Card 声明补偿（如 Cursor 无动态重注 → alwaysApply rule 常驻 + command 先 framing）。

---

## 8. skill 纪律任务书（D5 照此执行）

issue §「截止期驱动的编排哲学」列九条 deadline-aware 纪律。落点原则：**SKILL A 主文件只留薄锚（reinject 重注友好·越短越好·增量极小）；方法论正文下沉 reference；A/D/E/H 单向引用不复述**（红线3 skill 边界）。

### 8.1 九条纪律落点

| # | 纪律 | 落点 |
|---|---|---|
| 1 | 从验收和 DDL 反向规划（先锁最小可验收 outcome/non-goals·再从 DDL 倒排集成/验收/修复/交付窗口） | SKILL A 决策程序加一个 deadline-aware 分解锚 → 详情下沉 `references/deadline-discipline.md`（新）或并入 `decomposition.md` |
| 2 | 按时交付优先于扩张产出（最小完整纵切主线·新增能力先做 Goal Trace Test·增强进 defer/follow-up） | SKILL A 薄锚 + 引用 `slicing-goals-into-dags`（E·纵切）+ Goal Trace Test 已在 goal-contract.md |
| 3 | 简单性是进度正则项（YAGNI·最小可行·避免为未来假设建抽象） | SKILL A 薄锚 + 引用 `engineering-with-craft`（G·简单性）/ `dev-as-ml-loop`（F·简单性=正则） |
| 4 | 关键路径 + slack 管理（持续比 forecast p50/p80/p95 与 DDL·观察 float/阻塞/返工/剩余缓冲） | SKILL A 薄锚 → 消费机制引用 `pacing-and-estimation`（H·读 deadline-risk verdict）+ `decomposition.md`（CPM/float） |
| 5 | 尽早暴露延期风险（分级阈值·越阈值立即 surface·不等确定延期） | SKILL A 薄锚（呼应 hook safety net）→ 阈值语义引用 H；hook 主动唤起是机制层（§5） |
| 6 | 用 decision package 升级（预计延期→给有证据的选项·不自行改承诺/砍验收/伪造绿色） | SKILL A（决策 + 范围裁决归 A）+ 引用 `async-hitl.md` decision_package + goal-contract.md Delta Classifier |
| 7 | 增量 ship 与提前收口（尽早 walking skeleton·保留 final integration/review/文档/发布/回归缓冲） | 引用 `slicing-goals-into-dags`（E·walking skeleton）+ §6.4 收口建模 |
| 8 | 重新规划但不漂移目标（forecast/关键路径变→重排 DAG 记 replan·DDL/scope 实质变走用户确认 + amendment） | SKILL A（replan 决策）+ goal-contract.md（Delta Classifier / amendment）+ `ccm goal deadline amend`（D） |
| 9 | 停止过拟合（达当前 revision 全局 acceptance 即收敛停·剩余「顺便做」不占交付窗口） | SKILL A 薄锚 + 引用 `dev-as-ml-loop`（F·收敛即停·别过拟合）+ goal-contract.md（Goal Trace Test） |

### 8.2 A/D/E/H 单向引用边界（红线3）

- **A**（master-orchestrator-guide）：决策、排期、风险升级、范围裁决——deadline-aware **决策**锚 + 何时 surface/升级/replan。A 单向引用 D/E/H/F/G，不复述其机制正文。
- **D**（using-ccm）：`ccm goal deadline` 命令面 + deadline 字段取值 / lint 规则速查（§9 锁步）。
- **E**（slicing-goals-into-dags）：怎么把「从 DDL 倒排 + 收口任务进 DAG」切成纵切薄增量（纪律 1/2/7 的切分手艺）。
- **H**（pacing-and-estimation）：消费 `ccm estimate deadline-risk` 只读 verdict（读 band/margin/on_time_probability/诚实字段·**ccm 出 verdict、A 决策**）——纪律 4/5 的消费机制。

### 8.3 TDD-for-skills（§6 AGENTS 纪律）

九条纪律多为 judgment-bearing（agent 压力下能合理化掉，如「按时交付优先于扩张产出」在 sunk-cost 下易被「再做一点更完整」合理化）。**D5 每条纪律型 prose 落地前必须先跑 subagent pressure baseline**（三压：time + sunk cost + exhaustion·看无该段时选错·再写堵漏）。若某条 RED 未复现（capable 模型已自守），**不发明未发生的失败**（skillsmith iron law·对照 ADR-024 的 no-busywork baseline 处置）——改落 reference 词汇而非魂的纪律段。§8 eval（Track A description + Track B 行为）作改前后定量对比。

---

## 9. 迁移方案

### 9.1 legacy board 兼容

- 无 goal_contract / 无 deadline 键 → 三条新 lint 规则 present 才校验、缺则早返回 → **旧板仍合法**（board-model 的「validate only if present」+ degrade 机制·**无需 schema bump**·schema 仍 `cc-master/v2`）。
- deadline-risk endpoint 见 `deadline_state ∈ {pending, none, 缺失}` → `risk_band: unknown` / `n/a`（不 false-green）。
- legacy 板 `goal set` 激活 contract 后可 `goal deadline set` 补 DDL；恢复执行前补一次 DDL/no-DDL 确认（§7.2）。

### 9.2 版本线归属（本变更两侧都动·§11 版本线解耦）

- **ccm 线（`ccm-v*` changeset）**：`@ccm/engine` 的 `goal_contract.deadline` 模型 + 三档 + 三条 lint 规则 + `empiricalCdfAtOrBefore` helper + `ccm goal deadline` verbs + `ccm estimate deadline-risk` endpoint + `notificationKind` 加 `deadline_risk` + `runtime.*` 白名单加两键。凡进 SEA 二进制的物走 ccm 线。
- **plugin 线（裸 `v*`）**：bootstrap `--ddl` init flag + deadline-risk hook（扩 identity-nudge）+ hook CONTRACT + SKILL A/D/E/H prose + README×2 + CHANGELOG。凡随 plugin zip 分发的物走 plugin 线。
- 两侧各自 bump、各打各的 tag（glob 互斥·零交叉触发）。D7 集成时按「这次该 bump 哪条线」分别处理。

### 9.3 `ccm ⟷ using-ccm` 锁步清单（§6 抗漂移硬约束·同 PR）

改 ccm 命令面 / lint 规则 → 同 PR 同步 `using-ccm` 两份 reference：
1. **`references/command-catalog.md`**：加 `ccm goal deadline set|confirm|confirm-none|amend|show`（逐命令 flag 对得上）+ `ccm estimate deadline-risk`（含 `--json` 形态）。
2. **`references/board-model-guide.md`**：加 `goal_contract.deadline` 字段取值指南（四态状态机 / precision=day 语义 / ISO-8601 UTC 口径）+ 三条新校验规则速查（`FMT-DEADLINE` hard / `BIZ-DEADLINE-PENDING` warn / `BIZ-DEADLINE-OVERDUE` warn·规则总数 83→86）+ `goal check` 新 `deadline_pending` verdict。
外加受影响的 `SKILL.md` 心智锚 / footgun 速查 / `evals/trigger.json`。

### 9.4 glossary 影响（§6 术语锁步）

`design_docs/glossary.md` 加承重术语（若判定有漂移风险·closed-set 克制）：
- **`delivery deadline` / 交付截止期（DDL）**——canonical 措辞，与 `ETA`（预测）/ `cadence.iterations[].deadline`（局部 timebox）/ `task timeout`（超时）严格区分；禁用变体收明确错形（如把 ETA 写成 DDL 的混用）。是否登记由 D2/D7 按 closed-set 原则判（宁缺毋滥·先证明现有集不够用）。

### 9.5 hook N-host 锁步（§6·ADR-031·D7）

deadline-risk hook 是跨 `ccm`/board/hook/skill/三 host envelope 的能力 → 按 Track B 处理：先建 **Capability Card**（§13·host-neutral INTENT + testable acceptance）+ 更新受影响 hook CONTRACT（identity-nudge CONTRACT 加 `rule-deadline-risk-*` + PARITY anchors）→ 再做 host 实现 + equivalence fixtures。`scripts/gen-hook-parity-matrix.sh` / `gen-capability-parity-matrix.sh` 生成只读矩阵。`scripts/check-hook-parity-touch.sh` 兜 PR-diff 存在性。

---

## 10. issue 验收 checkbox → 实施任务映射表

### 10.1 主验收标准

| # | issue 验收项 | 任务 |
|---|---|---|
| 1 | board-model SSOT 定义 DDL 字段/tier/默认/reader-writer/退化/不变式·与 Goal Contract 单一权威 | **D2**（§3/§4.2） |
| 2 | 明确记录与 `cadence.iterations[].deadline`/ETA/task timeout 的区别 | **D2**（board-model-guide）+ 本文 §1.2 |
| 3 | 三 host fresh bootstrap 保留 `<goal>`/`--goal` evidence + 一致 agent 解析/确认流程 | **D4A**（§7）+ **D7**（parity） |
| 4 | 无/歧义/冲突 DDL 时拆 DAG 前主动确认·明确 no-DDL 可持久化不重复追问 | **D4A**（§7）+ **D5**（§8·纪律 1/5）+ **D2**（none 态·§3.2） |
| 5 | DDL set/confirm/amend 经 ccm 带锁专属 writer·变更审计·agent 不能静默延期 | **D2**（§4.1） |
| 6 | resume/legacy/已过期 DDL 有明确定义 + 测试覆盖 | **D4A**（§7.2）+ **D2**（lint/兼容）+ **D7**（fixtures） |
| 7 | `master-orchestrator-guide` 加 deadline-aware 决策 + 风险升级纪律·A/D/E/H 单向引用 | **D5**（§8） |
| 8 | forecast 能算并暴露相对 DDL 的 margin/风险·viewer 或只读输出可见 | **D3B**（§4.3 endpoint）+ **D6**（viewer/展示） |
| 9 | 覆盖时区/相对日期/只有日期无时间/多日期/来源冲突/明确 no-DDL/amendment/已过期 测试 | **D2**（引擎测试）+ **D4A**（entry fixtures）+ **D7** |
| 10 | source-to-adapter 产物同步·cross-harness contract/content tests 全绿 | **D7**（release 门） |

### 10.2 补充验收标准（hook safety net）

| # | issue 补充验收项 | 任务 |
|---|---|---|
| a | ccm 提供单一 deadline-risk JSON SSOT（DDL/准时概率/分位 margin/band/诚实字段/top drivers）·hook 不重算 | **D3B**（§4.3） |
| b | 算法 spike 对 precedence-only vs resource-constrained MC/RCPSP 对比·backtest/calibration 定阈值和性能预算 | **D3A**（§6） |
| c | 低 coverage/低 confidence/通道冲突/图错误/预测不可用不产生 false-green | **D3B**（§4.3 unknown 降级）+ **D3A**（校准） |
| d | armed hook 在风险首次出现/恶化时主动通知·明确要求优先 reconcile/replan 整体 DAG | **D4B**（§5.3） |
| e | 通知有 fingerprint/节流/恢复提醒/跨 session durable·相同风险不 spam·恶化风险不被旧 ack 吞 | **D4B**（§5.3）+ **D2**（`deadline_risk` kind） |
| f | hook 调 ccm 超时/失败不 block/不污染 board/不伪造 verdict·按 freshness 重试 | **D4B**（§5.4 fail-safe） |
| g | 三 host 业务 contract 等价·host envelope divergence 有 Capability Card/CONTRACT/equivalence fixtures/真实 dist 验证 | **D4B** + **D7**（§13） |
| h | 测试覆盖 green→watch→at_risk→likely_late/恢复/DDL 临近任务不变/关键路径变/WIP cap resource delay/低置信/resume 陈旧/重复 Stop 防循环 | **D3A**（算法 fixtures）+ **D4B**（hook fixtures）+ **D7** |

**集成类（D7）**：主 #10 + 补充 g/h 的 cross-harness/parity/release 部分统归 D7（Capability Card + hook CONTRACT + parity fixtures + content 锁步 + `run-tests.sh`/`check-plugin-dist-sync.sh`/`plugin validate` 全绿 + 生成 dist 与 source 同 commit）。

---

## 11. 下游任务书边界总表

每个任务「拿到即可动手、不需再问路线」所需的边界。**复用点 / 引擎缺口**是载重信息。

### D2 — ccm 引擎 DDL 核心（ccm-v*）
- **产出**：`goal_contract.deadline` 数据模型（§3·四态·👁·嵌 goal_contract）；`FIELDS.board.goal_contract` 扩子键 + `ENUMS` 加 `deadlineState`/`deadlineKind`/`deadlinePrecision`；`INVARIANTS` 加 3 条（§4.2·83→86）；`board-lint-core.ts` 加 `lintDeadline` 或扩 goal_contract 谓词（:157-176）；`ccm goal deadline set|confirm|confirm-none|amend|show` verbs（mutations.ts 加 `deadlineSet/Confirm/ConfirmNone/Amend` + goal.ts handler + registry `goal.deadline.*`·runWrite 带锁）；`goal check` verdict 加 `deadline_pending` + `ok` 收紧（goal.ts `inspectGoal`）；`runtime.*` 白名单加 `last_deadline_risk_check`(ISO) + `last_deadline_risk_fingerprint`(string)（扩 lintRuntime :1142-1183·set-param 白名单）；`board update --goal` 式绕过封堵（deadline 只走专属 verb）。
- **复用点**：`isISOUTC`/`ISO_UTC_RE`(:1281)·`badTimestamp` graceful-degrade·`goalSet/goalConfirm/goalAmend`+`appendGoalLog`(mutations.ts:205-307) 骨架·`lintPolicy`(:929) present-then-validate 模板·`goalConfirm` 的 `--user-authorized` 硬校验先例。
- **边界**：不动窄腰（§3.3）·无 schema bump（additive·§9.1）·审计走 board.log 不双写·deadline amend 不 bump goal revision（§2.1）。
- **锁步**：同 PR 更新 using-ccm 两 reference（§9.3）。

### D3A — deadline-risk 算法 spike（ccm-v*·产出喂 D3B）
- **产出**：三通道对比矩阵（§6.1·A precedence / B RCPSP-in-trial / C throughput）实测报告；`--as-of` 回放校准（Brier/reliability/false-negative/alert fatigue·§6.2）；性能预算实测（B 是否越 latency budget·§6.3）；band 阈值定标建议（holdout 证据）；交付收口建模建议（显式收口任务 vs project buffer·§6.4）；诚实降级口径。
- **复用点**：`estimateDagMonteCarlo`(mc-scheduler.ts·A)·`throughputMonteCarlo`(C)·`rcpspSchedule`(rcpsp.ts·B 的确定性单趟·须改造进 MC 循环)·`dualChannelConsistency`·`corpusAsOf`/`isDoneAsOf`/`nowMsOf`(backtest)·Sfc32(seeded)。
- **引擎缺口（载重）**：MC 只回分位不回经验 CDF → 需 `empiricalCdfAtOrBefore(sorted, target)`（§4.3）；RCPSP 未入 MC 循环（B 通道须新建 per-trial resource-feasible 调度或复用 rcpspSchedule 逐 trial）。
- **边界**：spike 是设计验证·不定最终合同（阈值/通道选择留证据固化）。

### D3B — `ccm estimate deadline-risk` endpoint（ccm-v*）
- **产出**：`estimate deadline-risk` handler（estimate.ts·runRead·read:true）+ registry 项（§4.3）；输出 schema（§4.3 全字段·含双通道/诚实字段/top_drivers/strength）；band 判据（用 D3A 定标）；`empiricalCdfAtOrBefore` helper（若 D3A 未落则此处落）；unknown 降级（无 DDL/含环/低置信/通道冲突→绝不 false-green）。
- **复用点**：forecast handler 的双通道 + criticality_index + notes 降级模式·`addHoursISO`/`addDaysISO`(wall-clock 映射·诚实标注 caveat)·`--scope`/`--as-of`/`--effective-n`。
- **边界**：读 `goal_contract.deadline`（D2 落）·从不读 cadence.iterations[].deadline 当 DDL·strength 由引擎 emit（hook 直接填·ADR-024 先例）。

### D4A — bootstrap/goal-flow DDL 流程（plugin v*）
- **产出**：bootstrap `--ddl` init flag（§7.1·INIT-FLAGS 段同型·best-effort·三 host）；fresh/resume/legacy/已过期注入 context（§7.1-7.2）；agent 语义协议 prompt（识别/冲突/确认/none 持久化）。
- **复用点**：bootstrap-board.sh INIT-FLAGS(`--priority`/`--wip`) 模板·resume 分支保留 goal_contract·`ccm goal deadline set --source cli-flag`(D2)。
- **边界**：bash 不猜 NL 日期（语义归 agent）·`--ddl` 非 ISO → 不落地记 note 传 evidence·hook 只触发+注入·持久化校验归 ccm。

### D4B — deadline-risk hook（plugin v*·+ ccm-v* notify kind）
- **产出**：扩 identity-nudge periodic 表加 deadline-risk 条目 + supersede critpath schedule 从句（§5.1）；触发 hybrid（周期/fingerprint/resume·§5.2）；节流+通知状态机（§5.3）；durable `deadline_risk` 通知（§5.3·复用 `deliverDurablePacing` 同型·ccm 侧加 kind）；三 host envelope（§5.3）+ kimi-code 条件；runtime 白名单两键；identity-nudge CONTRACT 加 `rule-deadline-risk-*` + PARITY。
- **复用点**：`runHook`/`periodicNudge`/`advisory`/`ambient`·`spawnCcmJson`/`spawnCoordinationNotify`/`durableKindFor`(usage-pacing)·`stop_hook_active` preGate·fingerprint sidecar(`readSwitchState`/`mergeSwitchState` 同型)·coordination-inbox `selectItemsToSurface` 900s cooldown。
- **边界**：hook 绝不重算算法（红线3·只 `ccm estimate deadline-risk`）·advisory 不 block Stop·ccm 缺静默·fail-safe。

### D5 — SKILL A 截止期纪律（plugin v*）
- **产出**：SKILL A 九条 deadline-aware 纪律薄锚 + `references/deadline-discipline.md`（或并入现有 reference·§8.1）；A/D/E/H 单向引用（§8.2）；reinject 重注友好（增量极小·delta 下沉 reference）。
- **复用点**：goal-contract.md(Framing/Trace/Delta)·decomposition.md(CPM/float)·async-hitl.md(decision_package)·slicing/dev-as-ml-loop/engineering-with-craft/pacing-and-estimation 引用。
- **边界**：判断力/方法论归 A·消费机制引用 H·切分引用 E·操作引用 D（不复述）·**每条纪律型 prose 先跑 pressure baseline**（§8.3·TDD-for-skills）·RED 未复现则不发明失败。

### D6 — viewer / estimate 展示（两侧）
- **产出**：viewer 展示 DDL + 剩余时间 + forecast 与 DDL 的 margin/risk band（不只展示日期·issue §board/CLI 建议）；estimate 只读输出让用户看见 margin/风险（`estimate deadline-risk` 人读渲染）。
- **复用点**：web-viewer goal 读模型·estimate handler 人读渲染模式。
- **边界**：只读展示·不写·消费 D3B endpoint + D2 deadline 字段。

### D7 — 集成（两侧）
- **产出**：Capability Card `deadline-risk-safety-net`（§13）；hook CONTRACT 更新 + PARITY；三 host equivalence fixtures + parity matrix；content 锁步（using-ccm/glossary/README×2/CHANGELOG）；release 门全绿 + dist 同 commit；版本线各自 bump（§9.2）。
- **边界**：集成类验收（主 #10 + 补充 g/h·§10）统归此处。

---

## 12. 最大实现风险 top3 + 显式砍掉/推迟清单

### 12.1 最大实现风险 top3

1. **on_time_probability 的资源约束建模 + 校准（D3A/D3B）**——现有 MC 是 precedence-only 乐观下界（无资源闸），直接拿它比 DDL 会系统性乐观；RCPSP-in-trial 是正解但可能爆 latency budget（2000 trials × RCPSP）。若退到 throughput 保守通道，calibration 未必够（历史语料稀疏时 Brier 差）。**缓解**：双通道 + 显式 disagreement + unknown 降级 + holdout 校准，宁可 unknown 不 false-green。**这是全设计最不确定的一环。**
2. **wall-clock ↔ work-hours 映射失真**——makespan「小时」映射成挂钟 ETA 假设连续执行（无日历/空闲/时区），但真实编排有夜间空转、等待用户、跨天。DDL 是挂钟时刻，二者口径不齐会让 margin 失真。**缓解**：D3A 度量并在 notes 诚实标注；precision=day 语义避免把「当日交付」误当精确秒。
3. **通知状态机的 spam vs 漏报平衡（D4B）**——「首次进入/恶化/恢复/长期未处理 + ack 不吞新风险」是多条件状态机，节流太松 = spam（狼来了稀释）、太紧 = 漏报恶化；Codex systemMessage / Cursor followup_message 还会续跑 agent（循环风险）。**缓解**：fingerprint 去重 + sidecar cooldown + stop_hook_active + 引擎 supersession 三重兜；band 恶化产生新 id（不被旧 ack 吞）。

### 12.2 显式砍掉 / 推迟清单（12h 冲刺外·标 follow-up）

- **soft/hard 两档 DDL 的行为差异 + 升降授权 policy**（§2.3）——v1 只保留 `kind` 字段恒 hard；两档行为 + 谁能降级作 follow-up。
- **RCPSP-in-trial 作为 endpoint 默认通道**——若 D3A 实测越预算，默认退 throughput 保守通道；RCPSP-in-trial 作 spike 评估 + 后续优化项。
- **per-task 自动 deadline**（issue 非目标·砍）——局部 timebox 继续由 cadence/iteration 表达，DDL 只在 board/goal 级。
- **deadline 独立 revision / 内嵌 history 数组**（砍）——审计复用 board.log，不给 deadline 单独 revision（deadline amend 不 bump goal revision）。
- **overdue 升 directive 或 block Stop**（推迟）——v1 overdue 是 strong advisory + lint warn，不机械 block（block 须另证不阻塞合法等待态·issue 补充节）。
- **独立 `ccm goal deadline check` 命令**（砍）——settledness 折进 `goal check` verdict + lint backstop；不新增独立 check 命令（§2.4）。
- **DDL 感知的自适应 cadence 精细函数**（部分推迟）——v1 给一个粗自适应（随 time_to_ddl/risk 缩短）；精细定标随 D3A 校准。
- **kimi-code host 实现**（条件推迟）——若届时未接入，CONTRACT 显式标 out-of-scope（不沉默省略）；接入后补第 4 列 + Capability Card。
- **glossary DDL 术语登记**（按需·closed-set 克制）——若无实测漂移风险则不登记（宁缺毋滥）。

---

## 13. Capability Card 骨架（D4B/D7 输入·`deadline-risk-safety-net`）

按 `design_docs/harnesses/capabilities/` 格式，D7 落 `deadline-risk-safety-net.md`：

- **Intent（host-neutral）**：armed hook safety net 周期/事件驱动重估延期风险；风险存在或恶化时主动、克制地唤起当前 orchestrator，要求优先做全局 DAG reconcile/replan；所有算法/verdict 归 ccm、hook 只搬运。
- **Acceptance（可测等价类）**：① green→watch→at_risk→likely_late 逐级唤起且 strength 正确；② 风险恢复发一次 recovery；③ DDL 临近但任务不变（time_to_ddl 缩短触发）；④ 关键路径变（fingerprint 变触发）；⑤ WIP cap 致 resource delay（resource 通道 vs precedence 分歧）；⑥ 低置信/无估值 → unknown 不 false-green；⑦ resume 陈旧 verdict 被刷新；⑧ 重复 Stop / followup 防循环；⑨ 相同风险不 spam、恶化不被旧 ack 吞；⑩ ccm 缺/超时 fail-safe 不 block/不污染/不伪造。
- **Host mechanisms**：claude-code = Stop hook additionalContext（implemented）；codex = turn_complete/stop systemMessage（implemented）；cursor = afterAgentResponse followup_message（implemented-track-b）；kimi-code = 条件/待接入。
- **Declared divergence**：Cursor followup_message 自动续跑（product 要求通知到达 agent·靠 fingerprint + loop_limit 去重）——同 identity-nudge/coordination-inbox 的 cursor envelope 先例。
- **Equivalence fixtures**：同一 host-neutral fixture stdin 跑三 host 真实现·断言 band/strength/去重落同等价类（`tests/hooks/test_parity-fixtures.sh` 同型）。
- **Linked surfaces**：command `as-master-orchestrator`（`--ddl`）；skills A/D/E/H；hooks `identity-nudge`(deadline-risk 条目) + `coordination-inbox`(deadline_risk kind delivery)；ccm `goal deadline *` + `estimate deadline-risk` + `coordination notify --kind deadline_risk`；spec 本文；decision ADR（D7 若新写 ADR 则链接）。
