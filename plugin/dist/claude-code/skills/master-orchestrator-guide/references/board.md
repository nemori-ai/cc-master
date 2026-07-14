# Board —— 编排存档文件（长程操作纪律）

> **何时读：** 触碰 board 的**长程操作纪律**时——home 解析 / 每编排一份 board 文件 / snapshot·flush / 单一真相源 / supersession / `owner.heartbeat` 与续跑 / `decision_package` 采访协议。
>
> **本文是 orchestrator 侧的派生叙事视图，不是协议 SSOT。** board 协议的 canonical SSOT（narrow-waist schema / status enum / 字段三档 🔒👁✎ / `parent` 不变式 / 全部 FMT·GRAPH·BIZ 校验规则 / 状态机）归 **ccm 引擎的 board-model**；它的**操作视图**（每个字段何时填什么、撞哪条规则、一次写对不撞 exit 3）在 `using-ccm` 的 `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/board-model-guide.md`。**本文不复述 schema / enum / 字段三档 / 校验规则的细节**——要查字段取值或规则去 `using-ccm`，本文只讲 orchestrator 特有的长程操作纪律。

**本质**：你跑长任务时的「存档文件」——一张带状态的**任务依赖图（task dependency graph）**。它身兼两职：① 跨 compaction 存活的记忆，② hook 唯一能读到的那扇编排状态窗口（hook 是个 shell——读不到 agent 的 context，也读不到内建的 `Task` 工具）。

> **board 引擎已解耦为独立的 `ccm` CLI——但 narrow-waist 契约本身没变。** board 状态逻辑（数据模型 / lint / 图分析 / 锁）的单一真相源现归独立安装的 ccm 引擎；plugin 降为消费方：hook（board-lint / verify-board）经**进程边界** `spawn ccm` 取数（`ccm` 缺则优雅降级、静默不 block），运行时图分析经 `ccm board graph`。变的只是「谁怎么访问 board」——契约（🔒/👁/✎ 三档、status enum、单一真相源、deps 图完整性）一字未动。

## 目录

- [关键决策](#关键决策)
- [narrow-waist 原则（narrative）](#narrow-waist-原则narrative)
- [单一真相源](#单一真相源)
- [读 / 写 / flush 纪律](#读--写--flush-纪律)
- [Supersession —— 显式状态](#supersession--显式状态非隐式-gc)
- [`log` 段 —— 轻量审计](#log-段--轻量审计append-only)
- [board lint —— 自检真相源](#board-lint--自检真相源)
- [图分析 advisory —— 机器算的临界路径](#图分析-advisory--机器算的临界路径只读永不回写-board)
- [`owner.heartbeat` —— resume 探测信号](#ownerheartbeat--resume-探测信号)
- [`owner.session_id` 与武装 / 续跑](#ownersession_id-与武装--续跑ssot-在-adr-007此处只给落地心智)
- [`decision_package` 采访协议](#decision_package-采访协议--awaiting-user-节点的采访式决策)
- [示例](#示例与-boardexamplejson-一致)

---

## 关键决策

- **名字**：`board`。**单一真相源。** **可配置的 home + 每编排一份唯一命名的 board 文件。** home 取 `$CC_MASTER_HOME`（默认 `$HOME/.cc_master/`，全局、harness-neutral）；board 集中落 `<home>/boards/`，每场编排拿到自己那份可按时间排序的文件 `<UTC-timestamp>-<pid>.board.json`（如 `20260605T101821Z-54324.board.json`），这样多场并发编排永不相撞；旧 per-repo board 在 bootstrap 时自动迁入（迁移来源由 host adapter 决定）。bootstrap hook 负责创建该文件、并注入它的精确路径；**哪个 board 是你的，由你自己认领**——compaction 之后，靠列出 home 的 `boards/` 并匹配 `goal` 把它重新找出来。全局 home 在 repo 外天然不入版本控制（in-repo 仍 gitignored）。
- **存储 = 单一真相源的 board 文件（每编排一份命名文件）**：**board 变更只走 `ccm` 命令**——`ccm` 是唯一写入关卡（持锁 / 落盘前校验不变式 / 守状态机 / 盖 derived 字段；怎么用见 `using-ccm`）。**直接 file-edit（`Write` / `Edit` / `sed` / `echo` / `cat >`）会被 board-guard PreToolUse hook 拦**（手改绕过写关卡、静默腐蚀 deps 图 / 状态机 / 窄腰）；markdown 视图按需生成。校验这次写盘合不合契约的**机械关卡就是 `ccm`**（写时即校验，有 hard error 直接拒绝落盘）；PostToolUse lint hook 只作事后 backstop——见下方「board lint」段。

---

## narrow-waist 原则（narrative）

别把整张表都钉死——只钉死 hook 所依赖的那份最小契约。这既给了 agent 自由，又让手工维护保持安全。

- **硬 waist = hook 机器读的那一小撮字段**：top-level `schema` / `goal` / `owner{active,session_id,heartbeat}` / `git{worktree,branch}`，以及 `tasks[{id,status,deps,parent}]` + status enum。动它是结构性改动：必须同步改全部 hook + 测试。**确切字段清单、status 八态语义与路由、`parent` 的 depth=1 / 无环 / rollup 不变式，全在 `using-ccm` 的 `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/board-model-guide.md`**——本文不复抄。
- **其余全 agent-shaped 柔性边**——你尽可按任务需要随意塑形（`title` / `artifact` / 三时间锚 / `observability` / `accounts[]` / `notes` / `log`…），hook 一概不读、lint 对未知字段 silent-on-unknown。
- **少数柔性边是 soft-observed**：`wip_limit`（超 cap 注过调度软警告）/ `owner_wip_limit`（owner 级两级 WIP）/ canonical `watchdog`（legacy 名 `wakeup`；有 `in_flight` 却无 nonblank `job_id` + 未过期 `fire_at` 的健康记录时提醒 arm）。**不影响硬 waist**。这些字段的确切 schema 与降级口径见 D；watchdog 心智见 `async-hitl.md` §等待前 arm watchdog + `dispatch.md` §watchdog/liveness。
- **`verified` 是与 `status` 正交的柔性边布尔，不是 status 值**——「已验」写 `"verified": true`，**别写成 `"status":"verified"`**（那会被 lint 当非法 status 拒）。`status` 答「在 DAG 里哪一态、怎么路由」，`verified` 答「验没验过」，二者各表各的。

---

## 单一真相源

内建的 `Task*` 工具至多是一面 in-session 的草稿镜像——**不权威**。唯有 home 里你那份 board 文件，才是一次断电、一次关机、一个 hook 都还认得的存档文件。两者打架时，board 文件赢。

---

## 读 / 写 / flush 纪律

- **每回合写整个文件** —— 快照很小。
- **在决策程序 step 7 flush**（每回合收尾），也可选在 PreCompact 时再 flush 一次。
- hook **基本只读** board（不改编排状态），编排状态的写由 agent 独占。
- **✎ `runtime.*` 是 hook-owned 例外** —— 身份提示 / critpath 等周期 hook 经 `ccm board set-param` 带锁写 `board.runtime.*`（如 `last_identity_remind` / `last_critpath_remind`）。你走 `ccm` 命令改 board 天然保留它（`ccm` 做字段级合并、不整盘覆写）；你自己**永不写 `runtime.*`**（那是 hook 的簿记区）。

---

## Supersession —— 显式状态，非隐式 GC

一个节点被重新定位（re-altitude）、或被一个上游变更顶替时，体现为一个**显式 board 状态**（`escalated` / `stale`），而不是隐式的垃圾回收。被顶替的节点带着它被设的状态留在 board 上，好让历史可审计。

---

## `log` 段 —— 轻量审计（append-only）

回溯与审计骑在柔性边那个轻量的 `log` 段上——它**不是**一套完整的 event-sourcing 存储（YAGNI）。有值得记的事发生时追加一条简短条目（`ts` + `summary` 必填，`kind`/`task`/`detail`/`refs` 可选；字段形状见 `using-ccm`）。

- **append-only 纪律**：log 条目**写下即不可变——只增不改不删**。每回合 flush 整个 board 时，已有条目原样保留、只在尾部追加。它是一条不可改写的事件轨迹（与可变的 `tasks[]` 状态相对）——回溯、审计、跨 compaction 重建「发生过什么」都靠它的不可变性。**绝不**回头编辑或删旧条目（要更正就追加一条新的修正条目）。

---

## board lint —— 自检真相源

board 是 hook / viewer / resume 三条链路的共同输入。写坏它（不合法 JSON、缺窄腰字段、`status` 拼错、dep 指向不存在的 id、deps 成环）大多**静默**出问题——尤其 viewer 会永久冻结在上一帧好的渲染却不报错。一套 board lint 在 board 被写坏的那一刻（或你随时手动）校验它的结构 / 语法 / 格式正确性。

> **lint 引擎 SSOT = ccm 引擎，规则全集速查在 `using-ccm`**。下面几道自检的规则逻辑都不在 plugin 里——经**进程边界** `spawn ccm board lint` 取裁决。**全部 FMT / GRAPH / BIZ 规则逐条速查在 `using-ccm` 的 `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/board-model-guide.md`**——本文不复述规则清单。

**一条正路 + 两道兜底（board 变更只走 `ccm`）：**

- **写时即校验（`ccm` 命令·唯一写路径）**：经 `ccm` 改 board 时，写入关卡在**落盘前**就跑全套校验——有 hard error 直接 `exit 3` 拒绝落盘，坏 board 根本写不进去。这是唯一正路。
- **写关卡硬化（board-guard PreToolUse hook）**：直接 file-edit board 在**执行前**就被 deny，并注一条 `<directive source="board-guard">` 提醒改用 `ccm` verb。把「只走 `ccm`」从纪律硬化为机制。
- **事后 backstop（PostToolUse lint hook·经 `spawn ccm`）**：万一有 `Bash` 手改绕过 guard 溜进来，写盘后的 lint hook 兜一道——注一条点名「违了哪条规则 + 哪个字段 / task + 怎么修」的非阻断提示，**看到就当回合改用 `ccm` 修掉，别带病往下跑**。
- **手动**：任何想确认 board 健康的时刻主动跑 `ccm board lint`（无参 lint home 里唯一 active 板，多块则传 `--board <path>`；`--json` 出结构化 `{errors, warnings}`）。**何时务必手动跑**：① 疑似有 Bash 手段绕过 guard 改过 board；② 大改 `tasks[]`（重规划 / supersession 批量改 status / 重接 deps）后；③ compaction 后重建模型、对 board 健康存疑时；④ `--resume` 认领一块旧板后。

**lint 绝不约束你的自由**：你给 task 加任何柔性字段、省略任何柔性边——lint 一律不报错（silent-on-unknown）。它只在窄腰被破、JSON 不合法、或 deps 图坏了时出 hard fail；柔性边至多 warn、从不 fail。

---

## 图分析 advisory —— 机器算的临界路径（只读，永不回写 board）

lint 守「board 写得对不对」；**图分析**则在 board 写对之后回答「这张 DAG 长什么样」——替你心算大图时易错的临界路径 / 并行度 / impact / owner rollup。你经 `ccm board graph`（引擎同一份 SSOT）取数，**纯只读、只出 stdout/`--json`，绝不回写 board**。**排期怎么用这些输出（`criticalPath` / `parallelism` / `impact` / `weight_source` 诚实性、何时机器算 vs 心算够用）见 `decomposition.md` §3**——本文不复述。

> **advisory ≠ gate**：图分析是只读分析，给编排决策当输入（机器算的临界路径胜过心算）；它**不**强制任何东西。owner rollup 一致性这道**关卡**仍由 hook 强制（verify-board Stop 软提醒 + board-lint 的 `GRAPH-ROLLUP` warn），advisory 只把同一份事实摆给你看。

---

## `owner.heartbeat` —— resume 探测信号

`owner.heartbeat` 一直是 pinned 的 waist 字段，但早先它没有读者也没有固定写者。resume 探测给了它首个用途：

- **resume 探测读它**——`as-master-orchestrator --resume` 时 bootstrap 在重盖前读 TARGET 板的 `owner.heartbeat`（连同文件 mtime）判断「这板是否看起来仍有活 session」，新鲜则先警告、要 `--force-takeover` 二次确认（接管安全闸）。
- **活 session 每回合 flush 时写它**——活的 orchestrator 在每次 flush board 时把 `owner.heartbeat` 更新为当前时间戳，给下一次 resume 探测留下可读信号。

这不新增 waist 字段、narrow-waist 契约不动——只是首次赋予一个既有 pinned 字段一个读者（resume 探测）和一个固定写者纪律（活 session flush）。

---

## `owner.session_id` 与武装 / 续跑（此处只给落地心智）

`owner.session_id` 是 hook **武装闸**读的那个字段（每个 hook 在被武装前完全休眠，靠它 + `owner.active` 判定武装）。续跑视角要点：

- **平台 resume（`claude --resume` / `-c`）与 compaction 都保留原 `session_id`**——`SessionStart` 分别以 `source:"resume"` / `"compact"` 触发、`session_id` 不变。故武装与 reinject **跨平台 resume / compaction 照常工作**。
- **全新独立会话（无平台 `--resume`，必拿新 `session_id`）对别人的 active 板按设计休眠**——这是防跨会话污染的设计，**不是**续跑失效。
- **未盖 `session_id`（空串）的 active 板保持休眠**——合法续跑因 resume / compaction 保留 `session_id` 故照常匹配；异常 blank 板由**显式 re-arm**（重跑 `as-master-orchestrator`）认领。
- **`as-master-orchestrator --resume` = 显式跨 session re-arm**——让一个**全新 session** 显式接管别的 session 的（或已归档的）board：bootstrap 把选定旧板的 `owner.session_id` 盖成新 sid、`owner.active` 置 `true`（**可复活 `/stop` 归档板**），并保留 `tasks` / `log` / `goal` / `git`。这是经用户显式 `--resume` 授权的合法武装形态（区别于被拒的「隐式自动收养空板」）。

---

## `decision_package` 采访协议 —— awaiting-user 节点的采访式决策

为「上下文缺失 / 决策依据缺失 / 时效性失效」三种把用户空投到失上下文决策点的失败形态而设的一对配套结构（采访包准备 + 消化两条纪律的**方法论**在 `async-hitl.md`；字段何时填什么、`BIZ-AWAITING` / `BIZ-DECISION-PACKAGE` lint 规则在 `using-ccm` §G/§N；此处只钉**协议叙事**——生命周期与两端逐字对齐的约束）。两者都是 agent-shaped / optional / **hook 一概不读**，narrow waist 完全不变。

**`decision_package`**（挂在 `blocked_on:"user"` 节点上的柔性边）：master 在 idle / 创建 awaiting-user 节点时为该节点预备的一份采访包（on-board，webview 可直接渲染富决策卡）。canonical 字段：`prepared_at` / `inputs_hash` / `freshness` / `ask_type` / `context_md` / `question` / `what_i_need` / `why_it_matters` / `options[]` / `enter_cmd`。语义要点：

- 它表示「用户还没拍板」。agent 已经自主做过、等待用户回来知情 / 复盘 / 追认的重要判断，走 `judgment_calls` / `jc`；不可逆、对外、merge、授权、方向性等用户拥有的决定不能先做成 judgment record。
- `ask_type` ∈ `{decision, advice, solution}`——明确告诉用户要「决策 / 建议 / 方案」哪一种；`decision` 型 `options` 必填非空、其余型可空。
- `freshness` ∈ `{fresh, stale}`——复用既有 `stale` 心智：采访包是**缓存**，discuss 入口重算 `inputs_hash` 比对做 freshness-check，过期则 re-ground。
- **生命周期闸**：discuss 用决策包**前**先验节点仍 `blocked_on:"user"`（master 已消化、清掉用户闸但 `decision_package` 残留时，discuss 据此停手、不再对已解决节点重开讨论）。

**`enter_cmd` 生成规则（master 端钉死·跨 session 不窜板）**：命令前缀按当前 harness——Claude Code `/cc-master:discuss`、Cursor `/discuss`、Codex `$cc-master-discuss`。discuss 是用户在**新终端**起的独立 session，未必继承本次编排的 `CC_MASTER_HOME`——故复制命令要**自带选择器**：**默认带 `--board <board-stem>`**（`<board-stem>` = 本板文件名去 `.board.json`），这样即便同 home 下还开着别的 board、新 session 跑复制命令也**绝不窜板**。home 非默认时再对路径加 shell 引号追加 `--home '<绝对路径>'`（单引号包整路径，含空格的 home 不被截断）。**home 路径含字面单引号 `'` 不支持**——master 生成端遇到时直接报错拒吐 `enter_cmd`（POSIX `'...'` 内无法转义内层单引号，两端解析都只对「不含字面单引号的路径」对齐）。webview 复制按钮原样复制整串，discuss 第 1 步按同一 `--home` **quote-aware 解析**——生成端加引号 ⟺ 解析端 quote-aware，两端逐字对齐。

**`inputs_hash` 算法（准备端与 discuss 端必须逐字一致，否则永远误判 stale）**：对该节点 `deps[]` 里每个直接 dep，**按 `deps` 顺序**依次串接 `<dep-id>` + `\n` + `<artifact 的 UTF-8 字节长度>` + `\n` + `<artifact 内容>` + `\n`（某 dep 无 `artifact` 则 artifact 计空串、长度 0）；末尾再串接 `goal` + `\n` + `<goal 字节长度>` + `\n` + `<goal 内容>`；对最终 payload 的 UTF-8 字节取 **SHA-256**，记为 `sha256:<hex>`。**长度前缀 + dep-id 一起锁死依赖边界**——纯裸串接会让 `["ab","c"]` 与 `["a","bc"]` 产生同字节流（把过期采访包误判 fresh），加长度前缀后区分开。discuss 入口按同一算法重算比对——不一致即采访已过期、先刷新。纯 node 实现（`crypto.createHash('sha256')`）。

**`<board-stem>--<node-id>--<STAMP>.decision.md` sidecar**（带外文档，写在 board home 同目录，**由独立 discuss session 写、绝不写 board**——保单写者纪律，避免与 orchestrator 的 board 写并发 torn-write）：discuss 谈完的产物。命名三段：`<board-stem>`（board 文件名去 `.board.json`·共享 home 下防不同板 sidecar 互相覆盖）+ `<node-id>`（须 path-safe·discuss 落盘前 guard 校验）+ `<STAMP>`（收尾那刻紧凑 UTC `YYYYMMDDTHHMMSSZ`·无 `:`·字典序即时间序）。**版本化 append-only**：每次 discuss 写一份**新** sidecar、绝不覆盖——「一个节点聊过 N 次」= 它名下 `*--<node-id>--*.decision.md` 文件数，全部历史可回溯；同秒碰撞给 STAMP 追 `-2`/`-3` 后缀去重。结构：frontmatter（`node_id` / `resolved_at` / `inputs_hash_at_decision` / `ask_type` / `round`）+ `## TL;DR` + `## 决策结论` + `## 完整决策文档` + `## 对话记录指针`。

**消化闭环**：master 在 recon / idle 拾取 sidecar 消化（先 TL;DR 再全文 → replan → 把短摘要折进节点 `notes`（master 写、on-board）+ 清 `blocked_on:"user"`）——消化纪律见 `async-hitl.md`。

---

## 示例（worked board 全字段样例）

```json
{
  "schema": "cc-master/v2",
  "meta": { "template_version": 1 },
  "goal": "Internationalize the app to 6 locales (i18n framework + per-locale translation + locale routing)",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30:00Z" },
  "git": { "worktree": "/repo/.worktrees/i18n", "branch": "feat/i18n-rollout" },
  "wip_limit": 4,
  "num_account": 1,
  "watchdog": {
    "armed_at": "2026-06-05T12:30:00Z", "fire_at": "2026-06-05T13:15:00Z", "mechanism": "cron", "job_id": "cron-9f",
    "checklist": ["recon T1 handle vs git/工具结果（phantom?）", "T1 过 p95 无 liveness 则 hedge/降级"]
  },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "mechanism": "sub-agent", "handle": "bg-3c", "artifact": "commit a1b2c3", "verified": true, "created_at": "2026-06-05T11:00:00Z", "started_at": "2026-06-05T11:05:00Z", "finished_at": "2026-06-05T11:48:00Z", "observability": { "total_tokens": 93159, "duration_ms": 119255, "tokens_per_min": 46896, "tool_uses": 21, "source": "completion-event" } },
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
