---
point: ccm.board.agents-registry
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.agents-registry -->
## C.6 agents[]：运行时 agent 登记簿

`agents[]` 是 board 级 ✎ 段（hook 不读·窄腰零碰撞）：**跨所有派发类型的统一运行时花名册**。纪律一句话：**凡派发皆登记**——手工派出的 sub-agent / 后台 shell / workflow 用 `ccm agent create` 起账；跨 harness CLI worker 也可由 `ccm worker dispatch` 在同一个 aggregate 内自动 prepare/bind/link/terminal。两者都让花名册、viewer 和 resume 后的自己能看见「现在总共多少 agent 在跑、各自在干什么、还活着没」。

`worker dispatch` 额外在 agent 条目下写 additive `dispatch` 元数据：显式 idempotency key + 只覆盖非敏感结构的 request digest、`prepared|launch-claimed|bound|closing|closed|reconciliation-required` phase、真实 PID/session evidence、typed capability 与 sanitized terminal facts。它的 repository 每次在既有 board lock 内重读并只替换目标 agent；除 `agents[]` 外的 board 投影若变化就拒绝写盘。prompt/stdin/secrets/environment/完整 provider argv/provider output 永不进入 board，prompt / argv 内容也不哈希进 digest。

**agent 和 executor 的分层（别合并、别互推）：**

| | task 的 `executor` | `agents[]` 里的一条记录 |
|---|---|---|
| **层** | planning 层：**计划**由哪类执行者做 | runtime 层：**实际跑起来**的运行时实例 |
| **基数** | 每 task 一个值 | 与 task 多对多（一个 agent 可服务多个 task，一个 task 可换多个 agent） |
| **何时写** | 派发前规划时 | 真实派发那一刻（create）+ 拿到句柄时（bind） |

一个 `executor: subagent` 的 task 被真实派发时，对应动作是两笔：task 侧照旧（`task start` / `--handle`），agent 侧 `agent create` + `agent bind` + `agent link <id> --task <task-id>`。join 存 agent 侧 `links[]`，不动 task 的 routing / attempt 结构。

**生命周期状态机：何时转哪态（只走专属 verb，别用 `--set` / `--set-json` 手改）：**

| 情况 | 转到 | 命令 |
|---|---|---|
| 刚发起派发、还没拿到句柄 | `starting` | `agent create --type ... --harness ... --intent "..."` |
| 拿到真实句柄（session id / pid） | `running` | `agent bind <id> --handle <kind:value>`——**无真实证据会被拒（exit 3）**，别用占位值硬凑 |
| probe 发现会话文件陈旧（在但不动了） | `uncertain` | `agent probe` 自动降级，不用手转 |
| probe 确定性判死 | `orphaned` | `agent probe` 自动降级，不用手转。判死只认两种确定性证据：① `pid` kill-0 进程不存在；② mtime 类方法的「曾在而消失」——上一次同方法观测到过 `alive`/`silent`、本次**完整**扫描确认文件缺失。**从未见过文件只出 `unknown`、state 不动**（启动竞态下文件可能尚未落盘）；扫描不完整（目录预算耗尽 / 读取失败）也不判死 |
| worker 收工或起跑失败（成功 / 失败 / 根本没起来都要收口） | `terminal` | 手工登记用 `agent terminal <id> --outcome "..."`；`worker dispatch` 由同步 supervisor 自动落 sanitized terminal fact。`starting` 也能直接收口（启动失败别留永久僵尸）。**terminal ≠ task done / acceptance**，task 仍走父层独立验收；terminal 是唯一终态，probe 永不复活 |
| `uncertain` / `orphaned` 后观测到还活着 | `running` | `agent probe` 双向 reconcile 自动归回，但复活按证据强度分级：`uncertain` 任何方法的 `alive` 都归回；**`orphaned` 只被 session / transcript 文件类的 `alive` 复活**（按 sid / 路径寻址、身份强），`pid` 的 `alive` 不够格（kill-0 不验进程身份·pid 复用会产生假 alive）。也可重新 `bind` 交新 handle |

**收口闭环纪律：凡派发皆登记，凡进程结束皆收口。** 手工把 agent 登进花名册（`create`→`bind`→`link`）是前半段；观测到它结束后显式 `ccm agent terminal <id> --outcome "..."` 是后半段。`worker dispatch` 已在同步 supervision 内自动完成这两段，不要再手工重复登记/terminal。漏掉手工收口，花名册会堆满「其实早结束」的僵尸；**别指望 `ccm agent probe` 替你收口**——probe 只 reconcile 死活（`gone→orphaned` / `silent→uncertain` / `alive→running`），永不产生 `terminal`。无论自动还是手工，agent terminal 都只编码运行时实例已结束；产出是否被收割、parent result/artifact 是否通过验收仍由 task 层独立判断。

**批量收口顺序 bash 安全无 race。** 一次收割多个 agent 时，`ccm agent terminal agt-019`、`ccm agent terminal agt-026`…作为**顺序 bash 命令**背靠背跑就行——每条 ccm 写各自抢一次 O_EXCL board 锁、天然串行化，同一命令重复零竞态；不必也别把它们 `&` 后台并行（并行 ccm 写会争锁、超时 `exit 4`）。真正需要 one-at-a-time 的是**单个 agent 的 `create`→`bind`→`link` 复合三连**：`bind`/`link` 要吃 `create` 返回的 `agent_id`，靠数据依赖定序（先建、拿到 id、再 bind、再 link），跨多个 agent 也是一个 agent 的三连做完再下一个。这是**定序**，不是「所有 agent 操作都必须逐个小心防锁竞态」——已知 id 的批量 `terminal` / `probe` 顺序跑永远安全。

**登记后要修正 handle：用 `amend`，别重复 `create`。** 发现 handle 拼错、attach 命令漏了 `cd`、transcript 路径写错——`ccm agent amend <id> --handle/--attach-cmd/--transcript` 就地补正 handle 域三件套（任何状态可用，含 `terminal`；不做状态转移、不碰 `lifecycle.state` / `probe` / `links` / `intent`）。**绝不重复 `create` 一条新登记**——同一个真实 worker 两行 roster 是撕裂，花名册 / viewer / resume 后的自己会数错在跑的 agent。真多登记 / 误登记出来的多余行用 `ccm agent rm <id>`（破坏性·非 TTY 须 `--yes`）清除；`amend` 补正保留的那条、`rm` 删多出来的那条。两者都不经状态机。

**handle.kind 怎么选：**

| kind | 什么派发用 | attach 方式 |
|---|---|---|
| `session-id` | 跨 harness CLI worker（codex / claude-code headless） | `--attach-cmd` 记一键接入命令，**必须自包含**——执行位置敏感的连 `cd` 一起登记（如 `cd /abs/worktree && claude --resume <sid>`：claude-code 的 resume 必须在原 cwd 执行，session 按项目目录归档）。codex 的 sid 运行时才生成：先 `pid` + `--transcript` 兜底 bind，再从 `codex exec --json` 日志首行 `thread.started` 事件取 `thread_id`（即 sid）升级 bind（完整配方见 command-catalog 的 agent bind 节；`codex exec resume --last` 接错 session 风险，不可作 attach 命令） |
| `pid` | 后台 shell 进程 | 无 attach；probe 用进程存活判定 |
{{USING_CCM_TASK_ID_HANDLE_ROW}}
| `none` | 尚无证据（create 后的缺省态） | 不可手选——bind 不接受 `none` |

对 `worker dispatch`，上述 handle 选择不是调用方猜出来的：四 harness 都先以 spawn 返回的真实 PID 原子 bind；Codex 只从声明了 `--json` transport 的 `thread.started.thread_id`、Kimi 只从声明了 `--output-format stream-json` transport 的 `session.resume_hint.session_id` 单调升级到 session-id。Claude Code 可从显式 `--session-id` 立即取得身份，或只在 `--output-format json|stream-json` 已声明结构化 transport 时接受严格的 `type=result / session_id` 信封；取得 sid 后定位会话 transcript，并生成 `claude --resume <sid>` 的 resume attach。它不从任意模型文本猜身份；若未观察到 session 证据就仍保持 PID-only，identity/attach 为 typed `unavailable`。显式 `--transcript` 指向已存在、可读的路径时，transcript 可独立为 typed `supported`，即使仍没有 session identity；在这条 PID-only 路径里，只有没有可读的显式 `--transcript` 时，transcript 才为 typed `unavailable`。支持 attach 时 board 只存 `{kind:"session-resume"}` 能力类，exact cwd/argv 只在 CLI receipt 与聚合校验期间短暂存在。Cursor 当前仍保持 PID identity；其 native session identity、SQLite transcript 与 exact attach 缺口写 typed `unsupported`，但显式 `--transcript` / `CURSOR_TRANSCRIPT_PATH` 可提供独立的 raw transcript stream；路径未提供或不可读时 transcript 为 `unavailable`，不是空字符串。

typed capability 合并是偏序：只有 `unavailable ≤ supported(同一 canonical value)`；后来一次 `unavailable` 不会擦掉已支持值，同值重复幂等。`unsupported` 是相反的负声明，和另两态不可比，所以 `unsupported ↔ unavailable`、`unsupported ↔ supported` 都必须 `evidence_conflict → reconciliation-required`，绝不靠强弱排序吞掉。相同 session 若出现不同 transcript 绝对路径或不同 canonical attach cwd/argv 也同样对账；旧 handle / `handle.transcript_ref` / capability value 原样保留。degraded reason 只是诊断文本，同 status 重复时保留首个 durable reason。冲突 session id 仍走同一 reconciliation 原则，不覆盖旧身份。

**probe 字段是 ccm 写的，别手填。** `probe.{last_probe_at, method, observed, as_of}` 与 probe 引发的 lifecycle 升降级全部由 `ccm agent probe` 落盘；`observed` 的语义是保真观测（`alive` / `silent` / `gone` / `unknown`）——`gone` 只出自确定性证据（pid kill-0 判死，或「上次同方法观测到过、本次完整扫描确认消失」的 seen-before 判死），从未见过的文件 / 扫描不完整只出 `unknown`；拿不到就 `unknown`，ccm 不会用相邻字段推导补齐，你也不要手拼一个「看起来合理」的观测值伪造活性。上一次的 `probe.method` / `probe.observed` 还是下一次 seen-before 判死的输入——手改它会让判死链失真。同理 `account_ref` / `quota_pool_ref` 当前是预留位（保持 `null`），别自创取值。

**会撞的规则**（详见 [N 节](#n-校验规则全集速查fmt--graph--biz)）：段形状坏 → `FMT-AGENTS` warn（graceful·不拦写盘，但 `ccm agent list/show` 与 viewer 花名册会读不出坏条目）；task 已 `in_flight` 却无任何 agent 登记指向它 → `BIZ-INFLIGHT-AGENT` warn（软提示补登记）。

---

<!-- ccm:k:end point:ccm.board.agents-registry -->
