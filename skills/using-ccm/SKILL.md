---
name: using-ccm
description: 'Use when you (orchestrator/agent) read or mutate a cc-master board through the ccm CLI —— 当你要用 ccm 操作 board:建板 / 加改任务 / 起跑·完成·阻塞 / 查 ready·DAG·临界路径 / 记 judgment_call·log / 收 cadence iteration / arm watchdog 时。它一体两面:面1=ccm 操作手册(命令面 + board 状态机心智 + 写入关卡纪律:status 走生命周期 verb 不用 --set、🔒 字段走专属命令、ccm 缺则降级 Write);面2=board 模型与字段取值指南(领域概念 task/status/executor/judgment_call/cadence/parent/watchdog 是什么 + 字段什么时候设什么值:acceptance 怎么写、estimate 怎么估、deps 怎么连、executor 怎么选 + 全部 FMT/GRAPH/BIZ 校验规则速查,一次写对不撞 exit 3)。Triggers: 敲 ccm task/board/account/jc/cadence/log/watchdog 命令、"怎么把任务标 done / 加依赖 / 查临界路径 / 阻塞等用户"、录备号 / 换号切配额 / 选号怎么敲 ccm account、什么是 judgment_call/cadence·acceptance 怎么写·executor 选哪个·status 何时转哪态·某字段填什么、任何 board 写操作、ccm 报 exit 3 / illegal transition / load-bearing 字段被拒。Do NOT use when 你在决定"该编排什么 / 怎么拆 DAG / 何时换号 / 该不该换号"(那是 orchestrating-to-completion)、读 usage/estimate verdict 怎么配速估算(那是 pacing-and-estimation)、写 workflow 脚本(authoring-workflows)——本 skill 只管"怎么用 ccm 这把工具(含 account 号池操作)",不管"该让 ccm 做什么"。'
---

# using-ccm — 用 ccm CLI 驱动 board

> **分发 skill(随插件 ship)。** `ccm` 是 cc-master 的 board 命令行——board 数据模型 SSOT 的**唯一写入关卡**(ADR-013/014)。本 skill 是它的**操作手册**:不是"该编排什么"(那是 orchestrating-to-completion),而是"既然要动 board,怎么用 ccm 动得对"。
> **它一体两面**:面1=**ccm 命令怎么敲**(命令面在 `command-catalog.md`);面2=**board 模型怎么理解 + 字段什么时候设什么值**(领域概念解释 + 字段取值指导在 `board-model-guide.md`)。心智锚在主文件,两面的深度各进一个 reference。
>
> **职责边界(红线3):** 编排决策归 A、读 usage/estimate verdict 配速估算归 `pacing-and-estimation`、workflow 脚本归 B;**怎么用 ccm 这把工具操作 board + 号池(account 录号/换号/选号)** 归本 skill。A 在它的决策点说"现在把 T7 标完成 / 派发 T3 / 阻塞等用户 / 该换号了",**怎么落成 ccm 命令**翻到这里;换号**机制 / 概念叙事**深入见 [references/account-pool.md](references/account-pool.md)。

---

## 何时翻开本 skill

你要对 board 做**任何**读或写——建板、加 / 改任务、起跑 / 完成 / 阻塞、查 ready 集 / DAG / 临界路径、记 judgment_call 或 log、开 / 收 cadence iteration、arm watchdog——就用 ccm,用法看这里。本文给的是**心智 + 纪律 + 热路径**,让你不必逐条 `--help` 也敲得对;深度按两面分进两个 reference,按问题选读:

- **[references/command-catalog.md](references/command-catalog.md)**（面1·命令面）—— 全量命令 / flag / `--json` 输出形状。**「这条命令怎么敲、有哪些 flag」翻它。**
- **[references/board-model-guide.md](references/board-model-guide.md)**（面2·模型与取值）—— board 领域概念（task 字段 / status 八态 / executor 五种 / judgment_call / cadence / parent / watchdog）解释 + 字段**什么时候设什么值**的取值判断（acceptance 怎么写好 / estimate 怎么估 / deps 怎么连 / executor 怎么选）+ 决策树 + footgun 深化。**「这个字段填什么、这个概念是什么、这个场景选哪个」翻它。**

---

## 心智锚 1:ccm 是 board 的写入关卡,不是事后才跑的 lint

每次动 board,**首选 ccm 命令**,而不是 `Write`/`Edit`/`sed` 直接改 board 的 JSON 文件。ccm 这一道写命令替你做四件手改做不到的事:

1. **持锁**(`.lock`·O_EXCL 原子抢占)——串行化写入,防两个写者撕裂文件。
2. **校验不变式**——FMT/GRAPH/BIZ 规则在落盘前跑;有 hard error 直接 exit 3 拒绝,坏 board 写不进去。
3. **守状态机**——非法状态转移(见锚 2)当场挡下。
4. **盖 derived 字段**——`task start` 自动盖 `started_at`、`task done` 盖 `finished_at`;手改 status 这些字段会被你漏掉,board 就此说谎。

手改 JSON 把这四道全绕过。**别因为"就改一个字段、Write 更快"在 ccm 可用时绕开它**——那一下省的几秒,换来的是绕锁、跳校验、derived 字段失真。

---

## 心智锚 2:board 是状态机,status 不是你赋值的字段 ★硬规则

这是本 skill 最容易踩、也最不能踩的一条。**task 的 `status` 不是一个你 `--set` 赋值的普通字段——它是一台状态机的当前态,只能经生命周期 verb 转移。**

- 改 status **只有**这几条命令:`task start`(→ in_flight)、`task done`(→ done)、`task block --on`(→ blocked)、`task set-status <id> <status>`(通用转移)。
- **没有** `task set`;`task update` **不接** `--status`;`--set tasks[T].status=…` 被 🔒 守门拒(exit 3);`--set status=done`(无 `tasks[]` 前缀)更坏——它静默写一个 board 顶层 junk 字段、exit 0 但**根本没碰任务**。
- **`ready → done` 非法**:必须先 `task start`(ready → in_flight)再 `task done`。直接 done 撞 `illegal transition: ready → done`(exit 3)。

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

> `verified` 是与 status **正交的布尔**(`--verified`),不是一个 status 值。`done` 且 `verified:true` 且 `artifact` 非空,才是真完成(端点验收过)。

### Rationalization Table —— status 这条最常见的自我说服

| 你会对自己说 | 现实 |
|---|---|
| "status 不过是个字段,改字段的通用 idiom 就是 `set --status <值>`,赋值就行,不用懂状态机。" | ccm **故意**不给 status 一个通用 field-setter。赋值绕过转移闸、不盖 `started_at`/`finished_at`、还可能落进静默 junk(`--set status=` 那条 exit 0 但没改任务)。verb 才是对的路:它校验转移合法 + 盖 derived 字段。 |
| "我赶时间,`task update --status done` 一条搞定,省得 start 再 done 两步。" | `task update` 没有 `--status` flag(exit 2),`ready→done` 也非法(exit 3)——这条"省一步"两次都会失败,反而更慢。`start` 再 `done` 才是真正的两步到位。 |
| "ccm 报 illegal transition,我加 `--force` 推过去得了。" | `--force` 是越闸逃生口、会记 log,留给真异常态(比如复活 stale)。正常完成一个任务用 `--force` 跳过 `in_flight`,等于亲手制造一个没 `started_at` 的"done"——你在伪造审计轨迹。 |

---

## 心智锚 3:三档字段 —— 🔒 走专属命令,只有 ✎ 能 `--set`

board 字段分三档(权威定义在 **board 协议 SSOT = `ccm` 引擎 `@ccm/engine` 的 board-model**:enums / 字段元数据 / 不变式 / 状态机——实时真相用 `ccm <ns> --help`;`board.md` 是 orchestrator 侧派生叙事、非 SSOT。每字段属哪档 + 怎么取值的操作视图见 [references/board-model-guide.md](references/board-model-guide.md) §A;这里只给**操作规则**):

- **🔒 load-bearing**:`id` / `status` / `deps` / `parent`,以及 board 级 `goal` / `owner` / `git` / `tasks`。**`--set` 一律拒(exit 3)**,只能走专属命令(`task add`/`start`/`done`/`block`/`set-status`、`task update --add-dep/--rm-dep/--parent`、`board update --goal/--branch/...`)。
- **✎ flexible**:`title` / `description` / `estimate` / `acceptance` / `justification` / `artifact` 等。**这些才用 `--set`**,且**必须带 task 作用域前缀**:`--set tasks[T1].title="新标题"`(裸 `--set title=…` 会落到 board 顶层,不是任务上)。长尾对象/数组用 `--set-json`。
- **👁 observed**:`scheduling.wip_limit`、`watchdog`、`wip_limit` 等——hook 有则用、缺则降级,走各自具名 flag。

一句话:**改 🔒 找专属命令,改 ✎ 用 `--set tasks[ID].field`,拿不准先 `ccm task update <id> --help` 看有没有具名 flag。**

---

## 心智锚 4:ccm 可选 —— 缺则优雅降级,不是硬前置

ccm 是**主机预置的增强项**,不是 orchestration 的硬依赖(ADR-014)。

- **`ccm` 在 PATH**(常态):一切 board 读写**首选 ccm**,拿全套写关卡保障。
- **`ccm` 不在**(优雅降级):退回 `Write`/`Edit` 直接改 board JSON,**改完手动跑一次 lint**(`ccm board lint` 若还能跑;或本 session 的 PostToolUse lint hook 经 spawn ccm 自动校验)。降级是 ccm 缺席时的兜底,**不是**"嫌 ccm 麻烦"的借口——ccm 在就用 ccm。

判断有没有 ccm:`command -v ccm`。

---

## 热路径速查(canonical flows)

```bash
# 起步:建板(home 不存在会自建)→ 看板
ccm board init --goal "目标一句话"        # 永不武装·session_id 留空
ccm board show                            # goal/owner/任务统计/lint 是否净

# 派发一个任务从生到完成(端点验收后才 done)
ccm task add T3 --type development --executor subagent --handle <后台句柄> \
    --deps T1,T2 --estimate 3h --ref spec:/abs/spec.md --ref plan:/abs/plan.md --accept "DoD 一句话"
ccm task start T3                         # ready → in_flight,盖 started_at
ccm task done  T3 --artifact /abs/out.md --verified   # in_flight → done,盖 finished_at

# 阻塞等用户(必带 decision_package,否则 BIZ-AWAITING 硬闸 exit 3)
ccm task block T9 --on user --decision @/abs/decision.json
ccm task block T5 --on T2                 # 阻塞在另一个 task 上

# 调度视图
ccm next                                  # 现在能派发什么(readySet)
ccm board graph                           # 拓扑 / 环 / 临界路径 / makespan
ccm board critical-path                   # 临界链 + 工期

# 自决台账 / 节奏 / watchdog
ccm jc add "选 X 不选 Y" --category architecture --severity high
ccm cadence open I1 --goal "ship 切片" --deadline 2026-06-05T14:00:00Z --members T0,T1
ccm watchdog arm --fire-at 2026-06-25T12:00:00Z --mechanism cron --checklist "查 3 个后台 subagent"
```

全量命令、每个 flag、`--json` 输出形状 → [references/command-catalog.md](references/command-catalog.md)。

---

## footgun 速查(踩过就记住)

| 现象 | 真相 / 怎么做 |
|---|---|
| `--set status=done` exit 0 却没改任务 | 它写了 board 顶层 junk。status 永远走 verb(锚 2)。 |
| `task done` 报 `illegal transition: ready → done` | 先 `task start`。`ready` 不能直接 `done`。 |
| `board update` 报"unknown option `--set`" | `board update` **不接** `--set`,只认 `--goal/--wip-limit/--owner-wip/--branch/--worktree`。 |
| `task show <id>` 返回 `data:null` 还 exit 0 | 读不存在的 id **不报错**——调用方自己判 null。 |
| `board lint` exit 3 但 stdout 是 `{"ok":true,...}` | 外层信封 `ok` 恒 true;**lint 是否净看 `data.ok` 与 exit code**(3=有 hard error)。 |
| `block --on user` 写进去了却被 lint 挡 | awaiting-user 节点**必须**带 `decision_package`(`--decision @file`),否则 BIZ-AWAITING 硬闸。 |
| ISO 时间字段被 lint warn | 一律严格 `YYYY-MM-DDTHH:MM:SSZ`(UTC 定宽),别用本地时区 / 带毫秒。 |
| 多个 active 板时命令报 Ambiguous | 用 `--goal <子串>` 或 `--board <path>` 消歧。 |

---

## Exit code 速记

`0` 成功 · `2` 用法错(缺 arg / 未知 flag) · `3` 校验拒绝(lint hard error / 非法转移 / `--set` 命中 🔒) · `4` 锁超时 · `5` 无 active board。**exit 2/3 是工具在拦你,读它的 stderr——几乎总是上面某条 footgun。**

---

## Pointers

- [references/command-catalog.md](references/command-catalog.md) —— 全量命令面:12 个 namespace（board/task/log/jc/cadence/watchdog/baseline/policy/peers/usage/estimate/account）每条命令的签名 / positional / flag 表 / 例子 / `--json` 输出形状。
- [references/account-pool.md](references/account-pool.md) —— 换号号池概念叙事:号池模型(指针 vs token 值)/ 录号 why / refreshToken 硬要求 / 选号方法论判据 / policy 硬闸 / vault 两形态 + 明文 floor 诚实局限。account 命令**怎么敲**看 command-catalog,**为什么这么设计**看这本。换号**决策**(何时换/谁拍板)归 orchestrating-to-completion。
- [references/board-model-guide.md](references/board-model-guide.md) —— 面2·board 模型操作指南:领域概念(task 字段 / status 八态 / executor 五种 / judgment_call / cadence / parent / watchdog)解释 + 字段取值判断(acceptance / estimate / deps / executor 怎么选)+ 决策树 + **全部 FMT/GRAPH/BIZ 校验规则速查**(一次写对不撞 exit 3)+ footgun 深化。命令怎么敲看 command-catalog,字段填什么、概念是什么、会撞哪条规则看这本。
- **orchestrating-to-completion**(SKILL A) —— 决策层:该编排什么、怎么拆 DAG、何时阻塞等用户、何时换号。本 skill 是它的"手怎么动"。注:**board 协议 SSOT 是 `ccm` 引擎 `@ccm/engine` 的 board-model**(enums / 字段元数据 / 不变式 / 状态机);A 的 board 协议 reference 是 orchestrator 侧的**派生叙事**(home 解析 / snapshot / supersession 等长程协议 narrative)、**非 SSOT**——二者本 skill 都不复述,只给操作视图。
- **authoring-workflows**(SKILL B) —— 在 workflow 脚本里编排并行时怎么写(那是脚本 DSL,不是 ccm CLI)。
- 实时真相永远以 `ccm <namespace> <cmd> --help` 为准——本文与 catalog 是地图,`--help` 是当前领土。
