---
name: using-ccm
description: 'Use when you (orchestrator/agent) read or mutate a cc-master board through the ccm CLI —— 当你要用 ccm 操作 board、查询三路统一 `model-policy show|advise`、写 cross-harness planning/routing 或读本 origin 的 usage/dispatch 操作面时。它一体两面:面1=ccm 命令与 board 写入关卡;面2=board 模型、O/T1/T2/T3 effect floor、candidate chain 与 fail-closed fallback 的字段取值。Triggers: 敲 ccm model-policy/task/board/account/jc/cadence/log/watchdog 命令、查跨 provider 候选、写 ample/tight chain、建板·加改任务·推进状态·查 DAG、录备号/换号、任何 board 写操作或 ccm exit 3。Do NOT use when 你在决定任务角色、最终 target、何时换号/停派或怎么拆 DAG（归 master-orchestrator-guide），或解释 model-policy/usage/estimate 事实与 advisory（归 pacing-and-estimation）。目标模型查询跨 provider 共享；account、usage signal 与实际 dispatch 仍按 origin/target surface 的可用命令执行。'
---

# using-ccm — 用 ccm CLI 驱动 board

> **分发 skill(随插件 ship)。** `ccm` 是 cc-master 的 board 命令行——board 数据模型 SSOT 的**唯一写入关卡**。本 skill 是它的**操作手册**:不是"该编排什么"(那是 master-orchestrator-guide),而是"既然要动 board,怎么用 ccm 动得对"。
> **它一体两面**:面1=**ccm 命令怎么敲**(命令面在 `command-catalog.md`);面2=**board 模型怎么理解 + 字段什么时候设什么值**(领域概念解释 + 字段取值指导在 `board-model-guide.md`)。心智锚在主文件,两面的深度各进一个 reference。
>
> **职责边界:** 编排决策归 `master-orchestrator-guide`、读 usage/estimate verdict 配速估算归 `pacing-and-estimation`、workflow 脚本归 `authoring-workflows`;**怎么用 ccm 这把工具操作 board + 号池(account 录号/换号/选号)** 归本 skill。`master-orchestrator-guide` 在它的决策点说"现在把 T7 标完成 / 派发 T3 / 阻塞等用户 / 该换号了",**怎么落成 ccm 命令**翻到这里;换号**机制 / 概念叙事**深入见 [references/account-pool.md](references/account-pool.md)。

---

## 何时翻开本 skill

你要对 board 做**任何**读或写——建板、建立 / 确认 / 修订 Goal Contract、加 / 改任务、起跑 / 完成 / 阻塞、为 subagent 写多维 planning 画像与 cross-harness routing policy、声明 delivery target 与依赖资格、登记 / 探测派发出去的运行时 agent（凡派发皆登记）、查 ready 集 / DAG / 临界路径、记 judgment_call 或 log、开 / 收 cadence iteration、arm watchdog——就用 ccm,用法看这里。本文给的是**心智 + 纪律 + 热路径**,让你不必逐条 `--help` 也敲得对;深度按两面分进两个 reference,按问题选读:

- **[references/command-catalog.md](references/command-catalog.md)**（面1·命令面）—— 全量命令 / flag / `--json` 输出形状。**「这条命令怎么敲、有哪些 flag」翻它。**
- **[references/board-model-guide.md](references/board-model-guide.md)**（面2·模型与取值）—— board 领域概念（task 字段 / status 八态 / executor 五种 / judgment_call / cadence / parent / watchdog）解释 + 字段**什么时候设什么值**的取值判断（acceptance 怎么写好 / estimate 怎么估 / deps 怎么连 / executor 怎么选）+ 决策树 + footgun 深化。**「这个字段填什么、这个概念是什么、这个场景选哪个」翻它。**

---

## 心智锚 1:ccm 是 board 的写入关卡,不是事后才跑的 lint

每次动 board,**首选 ccm 命令**,而不是 `Write`/`Edit`/`sed` 直接改 board 的 JSON 文件。ccm 这一道写命令替你做四件手改做不到的事:

1. **持锁**(`.lock`·O_EXCL 原子抢占)——串行化写入,防两个写者撕裂文件。
2. **校验不变式**——FMT/GRAPH/BIZ 规则在落盘前跑;有 hard error 直接 exit 3 拒绝,坏 board 写不进去。
3. **守状态机**——非法状态转移(见锚 2)当场挡下。
4. **守 attempt 边界**——`task start` 自动盖 `started_at`、`task done` 盖 `finished_at`;`task retry` 把旧 attempt 证据（含 current `delivery` candidate/observations）归档到 log 后清空当前态的 `started_at` / `finished_at` / `artifact` / `review_verdict` / `delivery`,并把 `verified` 复位为布尔 `false`。手改 status 会漏掉这些联动,board 就此说谎。

手改 JSON 把这四道全绕过。**别因为"就改一个字段、Write 更快"在 ccm 可用时绕开它**——那一下省的几秒,换来的是绕锁、跳校验、derived 字段失真。

---

## 心智锚 2:board 是状态机,status 不是你赋值的字段 ★硬规则

这是本 skill 最容易踩、也最不能踩的一条。**task 的 `status` 不是一个你 `--set` 赋值的普通字段——它是一台状态机的当前态,只能经生命周期 verb 转移。**

- 改 status **只有**这几条命令:`task start`(→ in_flight)、`task done`(→ done)、`task retry`(stale/failed/escalated → ready,开启新 attempt)、`task block --on`(→ blocked)、`task unblock`(清 `blocked_on`·交回 deps 门控)、`task set-status <id> <status>`(通用转移)。
- **没有** `task set`;`task update` **不接** `--status`;`--set tasks[T].status=…` 被 🔒 守门拒(exit 3);裸 `--set status=done` 同样被拒(exit 3)——task verb 的裸 path scope 到本 task,`status` 命中 🔒 守门,不会静默落 board 顶层。
- **`ready → done` 非法**:必须先 `task start`(ready → in_flight)再 `task done`。直接 done 撞 `illegal transition: ready → done`(exit 3)。
- **native-active projection 是更窄的专属状态机**：板启用 `ccm/native-attempt/v1` 且 latest attempt 为 `starting|running|uncertain` 时，generic `start/done/block/unblock/set-status`、`task update --handle` / 通用 setter、legacy `route-bind` 和 `--force` 都不能构造或修复 status/handle；只走 `native-attempt-create/bind/cancel/terminal/reconcile`。可信 terminal 证据只把 task 投影到 `uncertain`，父层完成端点验收后仍须满足普通 `task done --verified --artifact` 不变式。
- **`ready ↔ blocked` 由系统按 deps 自动归一**:每次 ccm 写命令落盘前引擎跑一趟 `reconcileGating`——**无 `blocked_on`** 且 status∈{ready,blocked} 的 task 按 deps 满足度重定(deps 全满足→ready,否则→blocked)。普通历史板和 declared 板里没有显式 requirement 的边保持 legacy；用 `task add|update --review-gate APPROVE` 声明的 review gate 必须有当前 attempt 的精确 `APPROVE`，`REQUEST-CHANGES`、缺失、空或 null 都 fail closed。显式 delivery requirement 还先要求上游 `taskTrulyDone`，再按 `candidate` 或指定 target 的 `delivered` 资格判定。review 的 `status=done` 只表示审查工作执行完，不等于批准。**手动 `set-status <id> ready` 会被 deps 否决**(deps 未满足下一趟归回 blocked)。**有 `blocked_on`(等 user / 等某 task)= 语义阻塞,豁免自动门控**;解除用 **`task unblock <id>`**,别用 `set-status`。手改 board 造出的不一致态由 `BIZ-STATUS-DEPS` warn 兜。

完整转移表:

| 从 | 合法到 |
|---|---|
| `ready` | in_flight, blocked |
| `in_flight` | done, uncertain, escalated, failed, blocked |
| `blocked` | ready, in_flight |
| `done` | stale |
| `uncertain` | done, failed, in_flight |
| `escalated` | ready |
| `failed` | ready, escalated |
| `stale` | ready |

> `verified` 是与 status **正交的布尔**(`--verified`),不是一个 status 值。`done` 且 `verified:true` 且 `artifact` 非空,才是真完成(端点验收过);缺任一项会被 `BIZ-DONE-VERIFIED` hard gate 拒绝落盘(exit 3)。
> 对显式 review gate，`verified:true` 只验收「review 工作与报告已完成」，是否批准由**当前 attempt** 的 `review_verdict` 单独表达；只有 `APPROVE` 满足下游 deps。`stale|failed|escalated → ready` 开新 attempt 时旧 verdict 自动失效，重跑后必须产出新 verdict。

> `stale` / `failed` / `escalated` 要重跑时优先用 `task retry <id>`。它把旧 attempt 的 `started_at`、`finished_at`、`artifact`、`verified`、`review_verdict`、`delivery` 以 `ccm/task-retry/v1` 结构归档进 append-only log,再原子复位当前 attempt;合法的通用 `set-status <id> ready` 也共享同一 reset,不会把旧验收 / delivery 证据带进新一轮。retry 的 lifecycle 目标是 `ready`,但写入关卡随后仍按同一依赖资格求值归一:只有 deps 全满足（declared edge 已 `qualified`，legacy edge 按既有 satisfied 规则）的 task 才落 `ready`,否则最终落 `blocked`;human/JSON 输出按每个 task 的最终态回显。

### Rationalization Table —— status 这条最常见的自我说服

| 你会对自己说 | 现实 |
|---|---|
| "status 不过是个字段,改字段的通用 idiom 就是 `set --status <值>`,赋值就行,不用懂状态机。" | ccm **故意**不给 status 一个通用 field-setter。赋值绕过转移闸、不盖 `started_at`/`finished_at`——所以 `--set status=…` 无论带不带 `tasks[]` 前缀都被 🔒 守门拒(exit 3)。verb 才是对的路:它校验转移合法 + 盖 derived 字段。 |
| "我赶时间,`task update --status done` 一条搞定,省得 start 再 done 两步。" | `task update` 没有 `--status` flag(exit 2),`ready→done` 也非法(exit 3)——这条"省一步"两次都会失败,反而更慢。`start` 再 `done` 才是真正的两步到位。 |
| "ccm 报 illegal transition,我加 `--force` 推过去得了。" | `--force` 只给非 native-active 的真异常态留逃生口、会记 log；重跑 stale/failed/escalated 有 `task retry`，native-active projection 则在 mutation boundary 明确拒绝 `--force`。正常完成用它跳过 `in_flight`，等于亲手制造一个没 `started_at` 的 "done"——你在伪造审计轨迹。 |

---

## 心智锚 3:三档字段 —— 🔒 走专属命令,✎ 默认 `--set` 但可有专属写口

board 字段分三档(权威定义在 `ccm` 引擎:enums / 字段元数据 / 不变式 / 状态机——实时真相用 `ccm <ns> --help`。每字段属哪档 + 怎么取值的操作视图见 [references/board-model-guide.md](references/board-model-guide.md) §A;这里只给**操作规则**):

- **🔒 load-bearing**:`id` / `status` / `deps` / `parent`,以及 board 级 `goal` / `owner` / `git` / `tasks`。**`--set` 一律拒(exit 3)**,只能走专属命令(`task add`/`start`/`done`/`retry`/`block`/`set-status`、`task update --add-dep/--rm-dep/--parent`、`ccm goal set|confirm|amend`、`board update --branch/...`)。新板的 goal 只走 `ccm goal`;`board update --goal` 仅兼容没有 `goal_contract` 的 legacy board。
- **✎ flexible**:`title` / `description` / `estimate` / `acceptance` / `justification` / `artifact` 等。**这些才用 `--set`**,且 scoping 跟着命令语境走:`task add`/`task update <id>` 里**裸 path 作用于该 task**(`ccm task update T1 --set title="新标题"` 就落在 T1 上);板级顶层 ✎ 字段走 `board update --set`;要跨 task 写才用显式前缀 `--set tasks[T2].title=…`。长尾对象/数组用 `--set-json`。写入后非 `--json` 输出会回显实际落点(如 `set tasks[T1].title`),落点不对一眼可见。**少数带 authority/proof 的 ✎ 字段保留专属写口**:`delivery_contract`、task `delivery` / `dependency_requirements` 会拒绝 generic setter,分别走 `target`、`task attest-delivery`、`dependency` 命令。
- **👁 observed**:`scheduling.wip_limit`、`watchdog`、`wip_limit` 等——hook 有则用、缺则降级,走各自具名 flag。

一句话:**改 🔒 找专属命令;改普通 task ✎ 用 `task update <id> --set field=…`(裸 path 即本 task),改普通板级 ✎ 用 `board update --set`;delivery 合约字段例外走具名 domain verb;拿不准先看对应 `--help`。**

---

## 心智锚 4:ccm 是 board 变更的唯一写路径 —— 不降级手改

board 变更**只走 `ccm`**,没有 `Write`/`Edit`/`sed` 的降级退路——两道机制把这条钉死:

- **ccm 硬前置**:`ccm` 是**主机安装前置**;`as-master-orchestrator` 起板时 bootstrap 硬查 `command -v ccm`,缺则**拒 arm**(不建 board、注 directive 提醒用户装 ccm)。故一场已武装的 orchestration 里 `ccm` **必然在**——你不会遇到「ccm 没装、只好手改」。
- **board-guard**:直接 file-edit 目标 board（`Write`/`Edit`/`MultiEdit`，或 `Bash` 用 `sed`/`echo`/`tee`/`cat >` 手改）会被 PreToolUse hook **当场 deny**。手改绕过写关卡会静默腐蚀 deps 图 / 状态机 / 窄腰——机制层直接不给你这条路。

**万一 `ccm` 跑起来这一下不响应**(装了但瞬态抽风):**暂停 board 变更、先修 `ccm`**——**绝不**退回手改 JSON 顶上去。运行时 hook(board-lint / usage-pacing)对这种瞬态各自优雅降级(静默不 block),但**你自己的 board 写永远等 `ccm` 恢复**,不自己动手。

## 心智锚 5：planning / routing 是 opt-in board 合同，不是自动派发器

要让一个近期 `subagent` 节点的复杂度、能力要求、模型候选、充足 / 紧张额度链和 fallback 在 handoff / resume 后仍可重建，用 `ccm/task-planning/v1` + `ccm/agent-routing/v1` 成对记录；精确字段、准备顺序与 dedicated writer 见 [references/board-model-guide.md](references/board-model-guide.md) §C.5，命令见 [references/command-catalog.md](references/command-catalog.md) 的 `board enable-contract`、`task set-planning`、`task set-routing`、`task route-bind`。

这套合同当前只拥有 **planning / ledger / activation**：`set-routing` 不选中 candidate、不 spawn，`enable-contract` 不派发，`route-bind` 也只消费调用方已经取得的 opaque running-handle claim。显式 `ccm worker help/run` raw wrapper 已可用，但不会自动写 `routing.selected` / `attempts`，也不会自动 route 或 fallback；只用同步 raw wrapper 时，不要为了“记录得更完整”强启一个当前拿不到 running handle 的合同。缺少合同的 legacy board / task 保持原行为。

---

## 热路径速查(canonical flows)

```bash
# 起步:建 pending 板 → 转写 Goal Contract → 确认交付 DDL → 完整性检查
ccm board init                             # 永不武装·session_id 留空
ccm goal set --summary "无歧义、可验收的目标" --assurance asserted --brief-file /abs/goal.md
ccm goal deadline set --at 2026-08-01T09:00:00Z --source cli-flag --assurance asserted  # 或 confirm-none 确认无 DDL
ccm goal check --json                      # ok 后才能切 DAG；pending/deadline_pending 先 settle
ccm board show                             # goal/owner/任务统计/lint 是否净

# 派发一个任务从生到完成(端点验收后才 done)
ccm model-policy show --task implementation-from-spec --json  # 三路统一角色/事实/taste；再做 target live qualification
ccm task add T3 --type development --executor subagent \
    --deps T1,T2 --estimate 3h --ref spec:/abs/spec.md --ref plan:/abs/plan.md --accept "DoD 一句话"
# 调用真实后台派发工具，再把其返回的句柄回填；不预填 phantom handle
ccm task update T3 --handle <派发工具返回的真实句柄>
ccm task start T3                         # ready → in_flight,盖 started_at
ccm task done  T3 --artifact /abs/out.md --verified   # in_flight → done,盖 finished_at;两项证据必填
ccm task set-status T3 stale              # 上游变更使旧产物失效
ccm task retry T3                         # stale → ready;旧证据归档,当前 attempt 原子复位

# review gate:执行完成与批准分开;只有 APPROVE 解锁下游
ccm task add R1 --type review --review-gate APPROVE
ccm task start R1
ccm task done R1 --artifact /abs/review.md --verified --review-verdict REQUEST-CHANGES

# declared delivery：先声明目标与 edge 要求，再为当前 true-done attempt 做本地 proof
ccm target set main --kind git-ref --ref refs/remotes/origin/main
ccm dependency require DOWN UP --level delivered --target main
ccm task attest-delivery UP --target main --method git-commit-contained --candidate-commit <oid>
ccm dependency explain DOWN UP             # qualified|unqualified|unknown + 稳定 diagnostics
ccm delivery audit --strict-dry-run         # 只预览缺声明边；绝不打开 strict-default、绝不写板

# 阻塞等用户(必带 decision_package,否则 BIZ-AWAITING 硬闸 exit 3)
ccm task block T9 --on user --decision @/abs/decision.json
ccm task block T5 --on T2                 # 阻塞在另一个 task 上

# 调度视图
ccm next                                  # 现在能派发什么(readySet)
ccm board graph                           # 拓扑 / 环 / 临界路径 / makespan
ccm board critical-path                   # 临界链 + 工期

# 自驱决策记录 / 节奏 / watchdog
ccm jc add "选 X 不选 Y" --category architecture --severity high
ccm cadence open I1 --goal "ship 切片" --deadline 2026-06-05T14:00:00Z --members T0,T1
ccm watchdog arm --fire-at 2026-06-25T12:00:00Z --mechanism cron --job-id cron-abc --checklist "查 3 个后台 subagent"
```

全量命令、每个 flag、`--json` 输出形状 → [references/command-catalog.md](references/command-catalog.md)。

---

## footgun 速查(踩过就记住)

| 现象 | 真相 / 怎么做 |
|---|---|
| `task update --set status=done` 被拒 exit 3 | task 语境的裸 path scope 到本 task,`status` 是 🔒。status 永远走 verb(锚 2)。 |
| `task done` 报 `illegal transition: ready → done` | 先 `task start`。`ready` 不能直接 `done`。 |
| 重跑后 task 还显示旧 artifact / verified | 用 `task retry <id>` 开新 attempt,不要用字段 setter 拼 reset。合法的 `set-status <id> ready` 也会走同一原子 reset。 |
| native attempt 活跃时 `task start/done/set-status/update --handle` 或 `route-bind --force` 被拒 | 这是 `BIZ-NATIVE-ATTEMPT-PROJECTION` 对专属 writer 的硬闸，`--force` 也不能绕。只用五个 `native-attempt-*` verb；terminal 后先独立验收，再从 `uncertain` 走普通 true-done。 |
| `--set` 的值不知道落哪了 | 看非 `--json` 输出的 `set <path>` 回显行:task verb 裸 path=本 task,`board update` 裸 path=board 顶层,`jc add`/`cadence *` 裸 path=board 顶层。 |
| `task show <id>` 返回 `data:null` 还 exit 0 | 读不存在的 id **不报错**——调用方自己判 null。 |
| `board lint` exit 3 但 stdout 是 `{"ok":true,...}` | 外层信封 `ok` 恒 true;**lint 是否净看 `data.ok` 与 exit code**(3=有 hard error)。 |
| `block --on user` 写进去了却被 lint 挡 | awaiting-user 节点**必须**带 `decision_package`(`--decision @file`),否则 BIZ-AWAITING 硬闸。 |
| `board update --goal` 在新板被拒 | Goal Contract 已激活；用 `ccm goal amend --summary ... --reason ... --assurance ...` 生成新 revision。`board update --goal` 只服务 legacy board。 |
| `goal check` 返回 pending | 目标还没 settled；澄清后 `goal set` / `goal amend`，不要切 DAG 或派发。复杂背景用 `--brief-file` 落成受管 Goal Brief。 |
| `goal check` 返回 deadline_pending | 目标 settled 但交付 DDL 未 settle（`goal_contract.deadline` 缺失或仍 pending）；先 `ccm goal deadline set/confirm`（确认截止期）或 `ccm goal deadline confirm-none`（确认无 DDL），再切 DAG。deadline 只走专属 verb，`--set goal_contract.*` 被拒。 |
| review task 已 `done`，下游仍 blocked | 若它声明了 `--review-gate APPROVE`，这是正确行为：检查 `review_verdict`；只有 `task done ... --review-verdict APPROVE` 开门，REQUEST-CHANGES/缺 verdict 都不开门。 |
| review 上轮已 `APPROVE`，retry 后下游又 blocked | verdict 只属于当前 attempt；`stale|failed|escalated → ready` 会清旧 verdict。新一轮 `task done` 必须显式给新的 `--review-verdict APPROVE` 才重新开门。 |
| 上游 true-done，但 declared 下游仍 blocked | true-done 只证明 candidate-complete，不证明已到指定 target。用 `delivery check` / `dependency explain` 看本地 containment、target drift 或 missing-object diagnostic；branch/worktree 存在不是 delivery proof。 |
| waiver 让 edge ready，却看到 `target_delivered:false` | 这是设计语义：waiver 只把这一条 user-authorized、edge-scoped、未过期 requirement 资格化，输出 `qualified_by=waiver`；它从不伪装 target 已交付。 |
| 想把 declared 一键变 strict-default | 本版本没有这个写口。只有 `delivery audit --strict-dry-run` / explain 的 ephemeral preview；不得持久化 `mode:strict`。 |
| `set-routing` 写好了，就以为 ccm 会自动选择 / spawn / fallback | routing contract 是 opt-in planning/ledger，不是 dispatcher。显式派发仍由 orchestrator 发起；只有拿到真实派发面的 opaque running handle 后才可 `route-bind`。同步 `ccm worker run` 不会自动回填 board。 |
| ISO 时间字段被 lint warn | 一律严格 `YYYY-MM-DDTHH:MM:SSZ`(UTC 定宽),别用本地时区 / 带毫秒。 |
| 多个 active 板时命令报 Ambiguous | 用 `--goal <子串>` 或 `--board <path>` 消歧。 |
| open cadence iteration 出 overbooked / critical-path / oversized warn | 这不是 hard gate,但说明本轮节奏不健康。先拆小、移出 scope、删假依赖或重估;不要靠 `cadence ship` 把超载藏起来。 |
| 想用 `--set-json` 手拼 `agents` 段 / 手改 agent 状态 | agent 生命周期走专属 verb:`agent create/bind/link/terminal/probe`——bind 无真实 handle 证据被拒(exit 3)、状态转移有校验、link 幂等、probe 字段由 ccm 落盘;通用 setter 手拼会把这些全绕过。 |

---

## Exit code 速记

`0` 成功 · `2` 用法错 · `3` 校验拒绝 · `4` 锁超时 · `5` 无 active board · `7` 授权拒绝（`account switch` 被 `autonomous_account_switch:deny` 拦下，或 `dependency waive` 缺显式 `--user-authorized`）。exit 2/3 时先读 stderr。

---

## Pointers

- [references/command-catalog.md](references/command-catalog.md) —— 全量命令面:15 个 namespace（board/task/log/jc/cadence/watchdog/baseline/policy/peers/usage/estimate/account/statusline/harness/upgrade）每条命令的签名 / positional / flag 表 / 例子 / `--json` 输出形状。其中 `harness`（本机 supported harness inventory）、`upgrade`（自升级 ccm 二进制 + 插件）/ `statusline`（self-contained 状态行）是非 board 操作。
- [references/account-pool.md](references/account-pool.md) —— 换号号池概念叙事:号池模型(指针 vs token 值)/ 录号 why / refreshToken 硬要求 / 选号方法论判据 / policy 硬闸 / vault 两形态 + 明文 floor 诚实局限。account 命令**怎么敲**看 command-catalog,**为什么这么设计**看这本。换号**决策**(何时换/谁拍板)归 master-orchestrator-guide。
- [references/board-model-guide.md](references/board-model-guide.md) —— 面2·board 模型操作指南:领域概念(task 字段 / status 八态 / executor 五种 / judgment_call / cadence / parent / watchdog)解释 + 字段取值判断(acceptance / estimate / deps / executor 怎么选)+ 决策树 + **全部 FMT/GRAPH/BIZ 校验规则速查**(一次写对不撞 exit 3)+ footgun 深化。命令怎么敲看 command-catalog,字段填什么、概念是什么、会撞哪条规则看这本。
- **master-orchestrator-guide** —— 决策层:该编排什么、怎么拆 DAG、何时阻塞等用户、何时换号。本 skill 是它的"手怎么动"。注:board 协议的权威定义在 `ccm` 引擎(enums / 字段元数据 / 不变式 / 状态机);本 skill 只给操作视图、不复述权威定义。
- **authoring-workflows** —— 在 workflow 脚本里编排并行时怎么写(那是脚本 DSL,不是 ccm CLI)。
- 实时真相永远以 `ccm <namespace> <cmd> --help` 为准——本文与 catalog 是地图,`--help` 是当前领土。
