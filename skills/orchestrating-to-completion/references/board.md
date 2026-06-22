# Board —— 编排存档文件

> **服务愿景：C1**（异步并行 + 完整落地）**· C4**（拆解 / 管理 / 更新 / 规划）。**何时读：** 触碰 board 契约时——narrow-waist schema、status enum 路由、柔性边（含 soft-observed 的 `wip_limit` / `wakeup`）、快照、可配置 home + 每编排一份 board 文件、flush 纪律、单一真相源、supersession、`log` 段。

**本质**：编排者跑长任务时的"存档文件"——一张带状态的**任务依赖图（task dependency graph）**。它身兼两职：① 跨 compaction 存活的记忆，② hook 唯一能读到的那扇编排状态窗口（hook 是个 shell——它读不到 agent 的 context，也读不到内建的 `Task` 工具）。

## 目录

- [关键决策](#关键决策)
- [narrow-waist 原则](#narrow-waist-原则)
- [单一真相源](#单一真相源)
- [读 / 写 / flush 纪律](#读--写--flush-纪律)
- [Supersession —— 显式状态](#supersession--显式状态非隐式-gc)
- [`log` 段 —— 轻量审计](#log-段--轻量审计)
- [board lint —— 自检真相源](#board-lint--自检真相源)
- [示例](#示例与-boardexamplejson-一致)

---

## 关键决策

- **名字**：`board`。**单一真相源。** **可配置的 home + 每编排一份唯一命名的 board 文件。** home 取 `$CC_MASTER_HOME`（若设了），否则 `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master/`——这是一个用户存储偏好，不再是硬编码路径。每场编排拿到自己那份可按时间排序的文件 `<UTC-timestamp>-<pid>.board.json`（如 `20260605T101821Z-54324.board.json`），这样多场并发编排永不相撞。bootstrap（UserPromptSubmit）hook 负责创建该文件、并注入它的精确路径；**哪个 board 是你的，由你自己认领**——compaction 之后，靠列出 home 并匹配 `goal` 把它重新找出来。Gitignored。
- **存储 = 可变快照（每编排一份命名 board 文件）**：每一回合，把整个文件 `Write` 出去（narrow waist 很小，一次 edit 不会把它写坏）；markdown 视图按需生成。

---

## narrow-waist 原则

别把整张表都钉死——只钉死 hook 所依赖的那份最小契约。这既给了 agent 自由，又让手工维护保持安全。

### 被钉死的 waist

```
top-level: schema, goal, owner { active, session_id, heartbeat }, git { worktree, branch }
tasks[ { id, status, deps } ]
```

（这些字段与 `board.template.json` / `board.example.json` 一一对应：`schema`、`goal`、`owner.active`、`owner.session_id`、`owner.heartbeat`、`git.worktree`、`git.branch`，以及 `tasks[]` 数组。）

### Status enum（各自在 DAG 里路由不同）

`ready / in_flight / blocked(blocked_on:"user"|"<taskid>") / done / escalated / failed / stale
/ uncertain`

| status | 路由 |
|---|---|
| `ready` | 依赖已满足——在 WIP cap 内派发。 |
| `in_flight` | 已派发、正在后台跑——把 `dispatched_at` 对照任务类的 p95 追踪（见 `async-hitl.md`）。 |
| `blocked` | 在等 `blocked_on`——要么 `"user"`（一条异步的用户依赖），要么 `"<taskid>"`（一个上游任务）。 |
| `done` | 完成并已验——content-hash 可记账，可跳过 / 可续。 |
| `escalated` | 一个 sub-agent 返回了 escalation 结果——supersede 该节点、再 seed 一个 workflow。 |
| `failed` | 该节点失败了——按它的 escalation 条件路由。 |
| `stale` | 一个上游产物变了——重跑（见 `resume-verify.md` 的依赖 pinning）。 |
| `uncertain` | 做了但未验——路由到一个验证节点 / 在端点验。 |

> **`uncertain` vs `blocked_on:<verify>` —— done-but-unverified 的标法**：当一个 done-but-unverified 节点的 verify 任务**已在飞**（产物在盘、正等一个具名的下游 verify 裁决）时，宜把它标 `blocked_on:<verify-task-id>` 而非裸 `uncertain`。两者在「等外部裁决」这一态上语义重叠，但 goal-hook（Stop hook）对裸 `uncertain` **每拍主动提醒**「resolve uncertain」、对 `blocked_on:<具名依赖>` 不提醒——标 `blocked_on:<verify>` 既消掉这层每拍噪声、又把「在等谁」写明确（可被 recon / 续跑读出），语义也更准（不是「我不确定该怎么办」，而是「产物已在、正等一个具名的下游 verify 裁决」）。裸 `uncertain` 留给「verify 尚未派出 / 真不确定下一步」的态。来源 [[Finding #47]]。

### 柔性边（agent 可自由塑形）

`title / artifact / created_at / started_at / finished_at / hitl_rounds / mechanism / handle / kind /
justification / output_schema / dep_pins / notes / log` —— 外加示例字段 `verified`、`blocked_on`，以及 top-level 的 `meta`（含 `meta.template_version`）、`wip_limit`、`wakeup`。

> **旧时间戳别名（legacy）**：`started_at` ≡ 旧 `dispatched_at`、`finished_at` ≡ 旧 `completed_at`（语义等价、只是重命名）。**prose 一律用新名**；view.html 的读取层仍保留旧名 read-fallback（`started_at ?? dispatched_at`、`finished_at ?? completed_at`），让 `--resume` 复活的归档旧板 / 用户手写的旧戳照样渲染。新板别再盖旧名。

钉死的 waist 之外，agent 尽可按任务需要随意塑造这些柔性边。但柔性边里要再分两档（hook 对它们的态度不同）：

- **大多数柔性边 = hook 完全忽略**：上面绝大多数字段，hook 一概不读、不依赖，纯属 agent-shaped。

#### 三个时间锚柔性边 —— `created_at` / `started_at` / `finished_at`（progress / 时长可观测）

三者都是 **optional / agent-shaped / 非 waist / hook 不可见**的遥测字段——hook 一概不读、不依赖，缺失时（默认即字段缺省、不写=null）任何读者（如 board 视图 / timeline）best-effort 渲染、优雅降级（不引入新失败模式）。它们存在的意义是让「进度」与「执行时长」可被观测、并回喂未来规划：

| 字段 | 何时盖（盖戳纪律） | 默认 |
|---|---|---|
| **`created_at`** | 任务**首次写进 `tasks[]`**（建任务那刻） | 缺省 |
| **`started_at`** | 任务**派发 / 起跑**那刻（转入 `in_flight`，或本地起跑） | 缺省 |
| **`finished_at`** | 任务**完成并验**那刻（转入 `done` / `verified`） | 缺省 |

- **格式纪律**：三者**一律严格 ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ`**（秒精度、`Z` 后缀、定宽——对齐 `wakeup.fire_at`）。定宽 + Z 使字典序 == 时间序、跨天 orchestration 算时长不会错（短时钟串 `"12:18Z"` 锚到「今天」、跨天会算错——别再用）。
- **盖戳纪律**：建任务盖 `created_at`、派发盖 `started_at`、done/verified 盖 `finished_at`。`finished_at` **不分** done 与 verified（一个戳 = 验收完成那刻；要区分「已验」用既有的 `verified` 柔性边标记，不另加时间戳）。
- 一个任务的**执行时长**因此可推导（`finished_at − started_at`，in_flight 用 `now − started_at`），用于事后看哪类任务真实多慢、回流到对任务类 p95 与并行度的估计。`created_at` 与 `started_at` 之差 = 排队等待时长（在队列里等，不算「在跑」）。
- **命名 / 兼容**：`started_at` ≡ 旧 `dispatched_at`、`finished_at` ≡ 旧 `completed_at`（见上「旧时间戳别名」注）。新板用新名；旧板的旧戳由 view.html read-fallback 认出。

#### telemetry 柔性边 —— `hitl_rounds`（人工成本可观测）

- **`hitl_rounds`**（整数，per task，默认 / 缺省 = 0）：同样 **optional / agent-shaped / 非 waist / hook 不可见**。这个任务**累计绕过几轮 human-in-the-loop**——即它被 surface 给用户拍板（`blocked_on:"user"`）、用户答复后又 resume 的次数。每发生一次这样的循环就 +1。它把单个任务上的**人工介入成本**显性化——某个任务反复 HITL 往往揭示编排拆图 / 决策预取（prefetch）模式有缺陷，是回流改进编排的素材。

#### `decision_package` 柔性边 + `<board-stem>--<node-id>.decision.md` sidecar —— awaiting-user 节点的采访式决策

为「上下文缺失 / 决策依据缺失 / 时效性失效」三种把用户空投到失上下文决策点的失败形态而设的一对配套结构（采访包准备 + 消化两条纪律的方法论在 `async-hitl.md`，此处只钉协议）。两者都是 **agent-shaped / optional / 非 waist / hook 一概不读**——narrow waist 完全不变（守红线 2）：`decision_package` 是普通柔性边（hook 完全忽略，同上面绝大多数字段），`.decision.md` 是带外 sidecar（连 board 都不进）。

- **`decision_package`**（per-task 柔性边，挂在 `blocked_on:"user"` 节点上）：master 在 idle / 创建 awaiting-user 节点时为该节点预备的一份采访包（agent-shaped，on-board，webview 可直接渲染富决策卡）。canonical 契约（字段名 / 枚举值钉死，勿改）：

  ```json
  "decision_package": {
    "prepared_at": "<ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ>",
    "inputs_hash": "<sha256:<hex>——算法见下方 MVP 定义>",
    "freshness": "fresh | stale",
    "ask_type": "decision | advice | solution",
    "context_md": "<自说明叙事 markdown：cc-master 走到这一步、为什么卡这>",
    "question": "<一句话问题>",
    "what_i_need": "<按 ask_type 我需要你给什么>",
    "why_it_matters": "<下游影响 / 不答焊死哪条临界路径>",
    "options": [ {"id":"opt-1","label":"...","rationale":"...","tradeoffs":"..."} ],
    "enter_cmd": "/cc-master:discuss <node-id>"
  }
  ```

  - **`enter_cmd` 生成规则**（master 端钉死）：discuss 是用户在**新终端**起的独立 session，未必继承本次编排的 `CC_MASTER_HOME`——故复制命令要**自带选择器，不靠 env / 不靠自动消歧**。**默认带上 `--board <board-stem>`**（`<board-stem>` = 本板文件名去 `.board.json`）——这样用户即便同 home 下还开着别的 orchestration board，新开 session 跑复制命令也**绝不窜板**（不依赖「node-id 落在哪块板」的自动判断、不弹交互追问）。home 为默认（`.claude/cc-master/`）时 `enter_cmd = "/cc-master:discuss <node-id> --board <board-stem>"`；home 非默认时再 **对路径加 shell 引号**追加 `--home`——`enter_cmd = "/cc-master:discuss <node-id> --board <board-stem> --home '<绝对 home 路径>'"`（单引号包整路径，使含空格的 home 如 `/Users/me/My Project/.cc-master` 不被截断）。**home 路径含字面单引号 `'` 不支持**——POSIX `'...'` 内无法转义内层单引号（唯一办法是 `'\''` break-out，而 discuss / smoke.sh 的 quote-aware 解析端都按「取到配对同种引号为止」实现、不认这个 break-out，两端只对「不含字面单引号的路径」对齐）：master 生成端遇到 home 含 `'` 时**直接报错、拒绝吐 `enter_cmd`**，提示用户「请把 home 移到不含单引号的路径、或在 discuss 的新 session 里设同样的 `CC_MASTER_HOME` 后手敲命令」（比两端都撑起 `'\''` 全套解析便宜得多，且 home 含字面单引号极罕见）。webview 复制按钮原样复制 `enter_cmd` 整串，自带 `--home` 即天然带上；discuss 第 1 步按同一 `--home` **quote-aware 解析**（跟引号则取到配对引号、剥外层引号；否则取下一 token）、优先级最高（覆盖 env / 默认）——生成端加引号 ⟺ 解析端 quote-aware，两端逐字对齐。
  - `ask_type` ∈ `{decision, advice, solution}`——明确告诉用户要「决策 / 建议 / 方案」哪一种。
  - `freshness` ∈ `{fresh, stale}`——复用既有 `stale` 心智：采访包是**缓存**，discuss 入口重算 `inputs_hash` 比对做 freshness-check，过期则 re-ground。
  - **生命周期闸**：discuss 用决策包**前**先验节点仍 `blocked_on:"user"`（status `blocked` 且 `blocked_on:"user"`）——master 已消化、清掉用户闸但 `decision_package` 残留时（freshness 只查输入、不查节点状态），discuss 据此停手、不再对已解决节点重开讨论或落 sidecar。
  - `options` 在 `ask_type:"decision"` 型**必填非空**；`advice` / `solution` 型可为 `[]`。
  - **`inputs_hash` MVP 定义（算法钉死，准备端与校验端必须逐字一致，否则永远误判 stale）**：对该节点 `deps[]` 里每个直接 dep，**按 `deps` 顺序**依次串接 `<dep-id>` + `\n` + `<artifact 的 UTF-8 字节长度>` + `\n` + `<artifact 内容>` + `\n`（某 dep 无 `artifact` 则 artifact 计空串、长度 0）；末尾再串接 `goal` + `\n` + `<goal 的 UTF-8 字节长度>` + `\n` + `<goal 内容>`；对最终 payload 的 UTF-8 字节取 **SHA-256**，记为 `sha256:<hex>`。**长度前缀 + dep-id 一起锁死依赖边界**——纯裸串接会让 `["ab","c"]` 与 `["a","bc"]` 产生同字节流（不同上游状态算出同 hash → 把过期采访包误判 fresh），加长度前缀（2,1 vs 1,2 不同）后区分开。discuss 入口按同一算法重算此值与采访包里的比对——不一致即采访已过期、先刷新（这是用户「时效性」痛点的正面解）。纯 node 实现（`crypto.createHash('sha256')`，红线 1 禁 jq/python）。

- **`<board-stem>--<node-id>--<STAMP>.decision.md` sidecar**（带外文档，写在 board home 同目录，**由独立 discuss session 写、绝不写 board**——保单写者纪律，避免与 orchestrator 的 board 写并发 torn-write）：discuss 谈完的产物。命名三段：**`<board-stem>` = board 文件名去 `.board.json` 后缀**（如 `20260619T052456Z-14584.board.json` → stem `20260619T052456Z-14584`）——带 board-stem 是因为共享 home 下可有多块 active board（或两板复用同一 node id），少了它不同板的 sidecar 会互相覆盖、被错误的板 recon 误消化；**`<STAMP>` = discuss 收尾那刻的紧凑 UTC 时间戳 `YYYYMMDDTHHMMSSZ`**（无 `:`，path-safe、字典序即时间序）。**挂 decision_package 的 node id 应 path-safe（`[A-Za-z0-9._-]`，且非 `.`/`..`）**——它要拼进 sidecar 文件名；含 `/` 或 `..` 会建嵌套文件甚至逃出 board home，故 discuss 落 sidecar 前会 guard 校验（不安全即报错停手，不拼路径）。
  **版本化 append-only（为什么带 STAMP）**：每次 discuss 写一份**新** sidecar、绝不覆盖该 node 已有的——天然不丢历史。「一个节点聊过 N 次」= 它名下 `*--<node-id>--*.decision.md` 文件数，全部历史可回溯；webview 据此显示「已讨论 N 次」+ 逐次结论。少了 STAMP（旧的同名覆盖）会把上一次结论冲掉、历史归零。**同秒碰撞兜底**：STAMP 是秒精度，同节点同 UTC 秒收尾时 discuss 写前先存在检查、给 STAMP 追加 `-2`/`-3`… 后缀直到不撞（后缀只去重、字典序仍排裸 STAMP 之后，view-server 解析端逐字对齐），永不覆盖。结构：
  - **frontmatter**：`node_id` / `resolved_at`（ISO-8601 UTC）/ `inputs_hash_at_decision` / `ask_type` / `round`（可选，本节点第几次讨论 = 写时已有该 node sidecar 数 + 1）。
  - `## TL;DR`——要点摘要（master 消化时先读这段）。
  - `## 决策结论`——选定 option id 或自由结论。
  - `## 完整决策文档`——讨论梳理出的依据 / 取舍 / 边界。
  - `## 对话记录指针`——transcript 引用。

  master 在 recon / idle 拾取它消化（先 TL;DR 再全文 → replan → 把短摘要折进节点 `notes`（master 写、on-board）+ 清 `blocked_on:"user"`）——消化纪律见 `async-hitl.md`。

- **少数柔性边 = soft / optional 的「hook 可观察」字段**：hook **若有则用、缺失则静默关闭对应行为（graceful degrade，不报错）**——它们既不是硬 waist（hook **要求**存在的字段），也不是「hook 完全无视」。两个例子（同一模式、两条独立可观察行为）：
  - top-level 的 **`wip_limit`**：`posttool-batch.sh` best-effort 读它，当 `in_flight` 数超过 `wip_limit` 时注入一条 **C5 过调度软警告**（非阻塞）。board 没有 `wip_limit`、或它非数字时，该警告按设计**静默关闭**——省掉 `wip_limit` 就等于关掉 C5 过调度警告。
  - top-level 的 **`wakeup`**：`verify-board.sh`（Stop 完成态握手）best-effort 读它——当 board 有 `in_flight` 任务、**却没有** `wakeup`（或 `wakeup` 非对象）时，注入一条提醒「为可能静默失败的 in_flight 任务 arm a watchdog wakeup」（非阻塞，ADR-011）；**已有 `wakeup` 则静默不提醒**。`wakeup` 的语义见下方独立小节；它驱动的 watchdog 心智在 `async-hitl.md` §等待前 arm watchdog + `dispatch.md` §watchdog/liveness。

  **这是「读」不是「要求」**：上面两个字段缺失 / 类型不符时对应行为按设计静默关闭（不报错、不影响其它行为）——知情即可，不是错误。

> **硬 waist vs soft observed —— 别混淆**：hook **要求**的字段（`schema` / `goal` / `owner.session_id` / `git` / `tasks[{id,status,deps}]` + status enum）才是受红线 2 保护、动它必须同 PR 改全部 hook + 测试的**硬 narrow-waist**；`wip_limit` / `wakeup` 这类**「hook 若有则用」的 soft observed 字段不在硬 waist 内**——把它提进硬 waist 是结构性改动、需人审，不要顺手做。未来改 board 者：增 / 删一个 soft observed 字段只影响它驱动的那条可观察行为（如删 `wip_limit` = 关 C5 警告、删 `wakeup` = 关 watchdog 提醒），不动硬 waist 契约。

### `wakeup` —— watchdog 自我唤醒的 soft 边（schema）

top-level 可选对象，存在 = 已 arm 一个 watchdog（等待前给可能静默失败的 `in_flight` 任务配的安全网，ADR-011）：

```json
"wakeup": {
  "armed_at": "2026-06-16T12:30:00Z",
  "fire_at": "2026-06-16T13:15:00Z",
  "mechanism": "cron" | "loop" | "monitor" | "shell",
  "job_id": "<CronCreate 返回的 job id / handle>",
  "checklist": ["recon T1 handle vs 地面真相", "验 T3 产物是否落盘", "..."]
}
```

- `fire_at` = watchdog 预定 fire 的时刻，**严格 ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ`**（秒精度、`Z` 后缀、定宽）。定宽 + Z 后缀使字典序比较 == 时间序，所以 hook 用纯 bash 字符串比较即可判过期（无需 date 运算）。`armed_at` 同格式。
- `checklist` = 被唤醒后要逐个 recon / 确认的事项清单（双层记录里的「实质」层——指针层是易朽的 wakeup prompt，见 `async-hitl.md`）。
- soft-observed 读法（同 `wip_limit` 模式）：`verify-board.sh` best-effort 读 top-level `wakeup`——有 `in_flight` 且**无已 armed `wakeup`** → 注入 watchdog 提醒；**已有「未过期的」`wakeup` 对象 → 当作「已 armed」、静默不提醒**。
- **expiry-aware self-heal（簇#2）**：hook 不只看 `wakeup` 在不在，还看它**过没过期**。当 board 仍有 `in_flight`、且 root `wakeup` 是对象**且** `fire_at` 是合法 ISO-8601-UTC**且** `fire_at < now`（已过期）——这说明一个本该 fire 的 watchdog 早该回来 recon，可任务还 in_flight，**这本身就是静默失败信号**——hook 把这种**陈旧** wakeup 当作「未 armed」，照常重新注入提醒（self-heal，不被陈旧残骸压住）。
- **graceful-degrade（红线 2，`wakeup` 是 soft-observed / agent-shaped，非硬 waist）**：只有「对象 + 合法 fire_at + 已过期」三者齐备才判陈旧。`wakeup` 对象在但**缺** `fire_at`、或 `fire_at` 不匹配严格 `YYYY-MM-DDTHH:MM:SSZ` 格式 → 按既有行为当作「已 armed」、静默——绝不因一个旧的 / 格式不合的 board 弄坏它。
- **退役 watchdog 必须从 board 移除 / 清空 `wakeup` 对象（不只 CronDelete 那个 job）**：hook 把一个**未过期的**（或缺 `fire_at` / `fire_at` 格式不合的，见上方 expiry-aware + graceful-degrade 两条）`wakeup` 对象当 armed 而静默——所以一具**未过期残骸**会让 hook（与 compaction 后的你）误判仍有 watchdog armed，于是下一次「有可能静默失败的 in_flight」等待时本该发出的 watchdog 提醒被静默掉，重开静默失败盲区。（注意与上方 self-heal 的边界：一具**带合法且已过期 `fire_at`** 的残骸不会被静默——hook 会判它陈旧、照常重新提醒；但仍属该清而未清，仍要退役。）**不变式：当前无 watchdog armed 时，`wakeup` 必须 ABSENT**——退役 = CronDelete job **且** 删 `wakeup` 对象，两件一起做（[[Finding #56]]）。
- 何时写它、何时清它（watchdog fire 后退役 = CronDelete + 删 `wakeup` 对象 + 处置静默失败）、工具降级链：见 `async-hitl.md` §等待前 arm watchdog（§被唤醒后—退役 watchdog 两件一起做）+ `dispatch.md` §watchdog/liveness。**绝不进硬 waist**（红线 2）。

### `meta.template_version` —— board 模板代际（agent-shaped，timeline 版本门）

top-level `meta` 是一个 **agent-shaped 命名空间对象**，收纳未来的 board 级元数据，避免 top-level 字段膨胀。本轮起它内含 `meta.template_version`：

```json
"meta": { "template_version": 1 }
```

- **含义**：这块 board 由**哪一代 bootstrap 模板**建的（整数，单调递增；本轮 release = `1`，旧板无此字段 = 隐含「本变更之前」）。`bootstrap-board.sh` 建板时 seed 它（模板文件 + fallback printf 都写）。
- **读者只有 timeline（view.html）**：timeline 用 `(meta.template_version || 0)` 当**版本门**——只有「带版本号的本-release-或更新」的板才信「时间戳普遍缺失 = 真没盖」、据此启用真实时间轴；旧板（无 `meta` / 无版本号）即便零星几个旧戳也**不**贸然切真实时间轴（避免少数戳把多数无戳节点挤成一坨），继续走拓扑深度轴。
- **绝不进硬 waist（红线 2）**：它**不是** pinned 的 `schema`（那是 hook 契约 / 窄腰，content 测试断言 === `'cc-master/v1'`，动它 = 动窄腰）。`meta.template_version` 与「waist 协议版本」正交，是纯 agent-shaped 字段、**零 hook 读它做分支**。若未来有 hook 想据它分支行为，那一刻它就从 agent-shaped 升为 soft-observed，须按下方「硬 waist vs soft observed」走人审——本变更不引入任何这种读取。

### `owner.heartbeat` —— 从「pinned 但无人读」到「resume 探测信号」

`owner.heartbeat` **一直是 pinned 的 waist 字段**（见上面的「被钉死的 waist」+ `board.template.json` / `board.example.json`），但在 ADR-009 之前它只是个被钉着、**没有读者也没有固定写者**的字段。ADR-009 给了它首个用途：

- **resume 探测读它**——`as-master-orchestrator --resume` 时 bootstrap 在重盖前读 TARGET 板的 `owner.heartbeat`（连同文件 mtime）判断「这板是否看起来仍有活 session」，新鲜则先警告、要 `--force-takeover` 二次确认（接管安全闸）。
- **活 session 每回合 flush 时写它**——本回合起，活的 orchestrator 在每次 flush board 时把 `owner.heartbeat` 更新为当前时间戳（命令体 resume 段的纪律），给下一次 resume 探测留下可读信号。

这**不新增 waist 字段、ADR-003 不动**——只是首次赋予一个既有 pinned 字段一个读者（resume 探测）和一个固定写者纪律（活 session flush）。

### `owner.session_id` 与武装 / 续跑（SSOT 在 ADR-007，此处只给落地心智）

`owner.session_id` 是 hook **武装闸**读的那个字段（见 §红线 6 / ADR-007）。续跑视角要点（细节别在此复述，去 ADR-007）：

- **平台 resume（`claude --resume` / `-c`）与 compaction 都保留原 `session_id`**——`SessionStart` 分别以 `source:"resume"` / `"compact"` 触发、`session_id` 不变。故武装与 reinject **跨平台 resume / compaction 照常工作**，无需特殊处理。
- **全新独立会话（无平台 `--resume`，必拿新 `session_id`）对别人的 active 板按设计休眠**——这是红线 6 防跨会话污染，**不是**续跑失效。
- **未盖 `session_id`（空串 `""`）的 active 板保持休眠**（红线 6：不武装不相关 session）——合法续跑因 resume / compaction 保留 `session_id`、板带原 `session_id` 故照常匹配武装；异常的 blank 板（bootstrap 在缺 sid 的 stdin 上建板）由**显式 re-arm**（重跑 `as-master-orchestrator` → bootstrap 重盖 `session_id`）认领。对称收养空 board sid 曾试过并回退（CODEX12 → CODEX14：会武装任意不相关 session，破红线 6），SSOT 见 ADR-007 §2.3 / §4.5。board sid **非空且 ≠ 本会话 sid** 同样休眠。
- **`as-master-orchestrator --resume` = 显式跨 session re-arm（ADR-009）**——和上面那条平台 `--resume`（保留 sid，是 Claude Code 的 resume）**不是一回事**：这是用本插件的命令、让一个**全新 session** 显式**接管**一块别的 session 的（或已归档的）board。bootstrap（唯一武装豁免 hook，ADR-007 §2.5）会把选定旧板的 `owner.session_id` **盖成新 sid**、`owner.active` 置 `true`（**可复活 `/stop` 归档的板**，`false → true`），并**保留 `tasks` / `log` / `goal` / `git`**。这是经 `as-master-orchestrator` + 用户显式 `--resume` 授权的合法武装形态（区别于 CODEX14 拒绝的「隐式自动收养空板」），落在红线 6 精神内——SSOT 在 ADR-009，对「显式 vs 隐式」与「复活归档板为何合规」的论证去那里读，此处不复述。

---

## 单一真相源

内建的 `Task*` 工具至多是一面 in-session 的草稿镜像——**不权威**。唯有 home 里你那份 board 文件，才是一次断电、一次关机、一个 hook 都还认得的存档文件。两者打架时，board 文件赢。

---

## 读 / 写 / flush 纪律

- **每回合写整个文件** —— 快照很小。
- **在决策程序 step 7 flush**（每回合收尾），也可选在 PreCompact 时再 flush 一次。
- hook 只读 board（它改不了编排状态），所以写这件事由 agent 独占。

---

## Supersession —— 显式状态，非隐式 GC

一个节点被重新定位（re-altitude）、或被一个上游变更顶替时，体现为一个**显式 board 状态**（`escalated` / `stale`），而不是隐式的垃圾回收。被顶替的节点带着它被设的状态留在 board 上，好让历史可审计。

---

## `log` 段 —— 轻量审计（append-only）

回溯与审计骑在柔性边那个轻量的 `log` 段上——它**不是**一套完整的 event-sourcing 存储（YAGNI）。有值得记的事发生时追加一条简短条目即可；保持便宜。

- **append-only 纪律**：log 条目**写下即不可变——只增不改不删**。每回合 flush 整个 board 时，已有条目原样保留、只在尾部追加新条目。它是一条不可改写的事件轨迹（与可变的 `tasks[]` 状态相对）——回溯、审计、跨 compaction 重建「发生过什么」都靠它的不可变性。**绝不**回头编辑或删旧条目（要更正就追加一条新的修正条目）。
- **富条目 schema**（除 `ts` + `summary` 外皆可选，保留自由度）：

  ```json
  {
    "ts": "2026-06-05T12:18:00Z",        // 必填 · 严格 ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ
    "kind": "dispatch",                   // 可选 · dispatch|recon|verify|finding|decision|replan|handoff|note
    "task": "T1",                          // 可选 · 关联的 task id
    "summary": "Dispatched per-locale pass", // 必填 · 一句话
    "detail": "6 locales under one handle",  // 可选 · 展开细节
    "refs": ["commit a1b2c3", "bg-7a"]      // 可选 · 关联产物 / handle / 链接
  }
  ```

  - `kind` 枚举：`dispatch`（派发）/ `recon`（侦察对账）/ `verify`（端点验收）/ `finding`（发现）/ `decision`（决策）/ `replan`（重规划）/ `handoff`（交接）/ `note`（杂记）。
  - 读者（view.html 的 activity 段）对富对象条目按 schema 渲染；对**裸字符串**旧条目向后兼容（仍直接显示）。

---

## board lint —— 自检真相源

board 是单一真相源、也是 hook / viewer / resume 三条链路的共同输入。写坏它（不合法 JSON、缺窄腰字段、`status` 拼错、dep 指向不存在的 id、deps 成环）大多**静默**出问题——尤其 viewer 会永久冻结在上一帧好的渲染却不报错。一套 **board lint** 在 board 被写坏的那一刻（或你随时手动）校验它的结构 / 语法 / 格式正确性。

**两道自检：**

- **自动（PostToolUse lint hook）**：你用 `Write` / `Edit` 改本 session 的 active board 后，lint hook 自动校验；若发现结构 / 语法 / 格式错，会注入一条点名「违了哪条规则 + 哪个字段 / task + 怎么修」的非阻断提示——**看到就当回合修掉，别带病往下跑**。
- **手动（随时跑 lint 脚本）**：当你用 **`Bash`（`sed` / `echo` / `cat >` / 脚本）改了 board**（lint hook 看不见这类编辑），或任何想确认 board 健康的时刻，主动跑：

  ```
  node ${CLAUDE_SKILL_DIR}/scripts/board-lint.js <你的-board-路径>
  ```

  无参时它 lint home 里那块唯一的 active 板（多块则要你传路径）；`--json` 出结构化 `{errors, warnings}`。退出码非 0 = 有 hard fail，按报告修。

**lint 校验什么**：合法 JSON、窄腰字段齐全且类型对（`schema` / `goal` / `owner{active,session_id}` / `git` / `tasks[]`）、每个 task 的 `{id,status,deps}` + `status` 在 enum 内、**deps 图完整（无悬挂引用 / 无自环 / 无环）**。

**lint 绝不约束你的自由（红线 2）**：你给 task 加任何柔性字段、省略任何柔性边（`title` / `artifact` / `wip_limit` / 三时间戳…）——lint 一律不报错（silent-on-unknown）。它只在窄腰被破、JSON 不合法、或 deps 图坏了时出 hard fail；柔性边（`blocked_on` 指向未知、时间戳格式不合、`wip_limit` 非数字…）至多 warn、从不 fail。

**何时务必手动跑**：① 刚用 `sed` / `echo` 等 Bash 手段改过 board；② 大改 `tasks[]`（重规划 / supersession 批量改 status / 重接 deps）后；③ compaction 后重建模型、对 board 健康存疑时；④ `--resume` 认领一块旧板后（确认它没在归档期间被写坏）。

## 示例（与 `board.example.json` 一致）

```json
{
  "schema": "cc-master/v1",
  "meta": { "template_version": 1 },
  "goal": "Internationalize the app to 6 locales (i18n framework + per-locale translation + locale routing)",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30:00Z" },
  "git": { "worktree": "/repo/.worktrees/i18n", "branch": "feat/i18n-rollout" },
  "wip_limit": 4,
  "wakeup": {
    "armed_at": "2026-06-05T12:30:00Z", "fire_at": "2026-06-05T13:15:00Z", "mechanism": "cron", "job_id": "cron-9f",
    "checklist": ["recon T1 handle vs git/工具结果（phantom?）", "T1 过 p95 无 liveness 则 hedge/降级"]
  },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "artifact": "commit a1b2c3", "verified": true, "created_at": "2026-06-05T11:00:00Z", "started_at": "2026-06-05T11:05:00Z", "finished_at": "2026-06-05T11:48:00Z" },
    { "id": "T1", "status": "in_flight", "deps": ["T0"], "mechanism": "sub-agent", "handle": "bg-7a", "created_at": "2026-06-05T11:00:00Z", "started_at": "2026-06-05T12:18:00Z" },
    { "id": "T3", "status": "ready", "deps": ["T0"], "created_at": "2026-06-05T11:00:00Z" },
    { "id": "T9", "status": "blocked", "deps": ["T1"], "blocked_on": "T1", "created_at": "2026-06-05T11:00:00Z" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "Split the PR into two?", "created_at": "2026-06-05T11:30:00Z" },
    { "id": "F1", "status": "ready", "deps": [], "kind": "fill-work", "justification": "produces-reusable-artifact", "title": "Pre-draft the PR description skeleton", "created_at": "2026-06-05T11:30:00Z" }
  ],
  "log": [
    { "ts": "2026-06-05T11:05:00Z", "kind": "dispatch", "task": "T0", "summary": "Dispatched i18n framework scaffold" },
    { "ts": "2026-06-05T11:48:00Z", "kind": "verify", "task": "T0", "summary": "Endpoint-verified scaffold (tests green)", "refs": ["commit a1b2c3"] }
  ]
}
```
