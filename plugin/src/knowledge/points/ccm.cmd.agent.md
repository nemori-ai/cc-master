---
point: ccm.cmd.agent
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.agent -->
## namespace agent（Agent Registry·登记/探测/读取）

运行时 agent 登记簿：凡派发皆登记——sub-agent / 后台 shell / workflow / 跨 harness CLI worker 全进本板 ✎ `agents[]` 花名册。**它是登记 / 探测 / 读取 noun**：九个 verb（create / bind / amend / link / terminal / probe / list / show / rm）不含任何 spawn / route / dispatch 语义（不起进程、不选路、不派活；dispatch 命令面归 `worker`）。其中 create / bind / terminal / probe 走生命周期状态机，`amend`（补正 handle 域）与 `rm`（删登记）是**登记簿事后修正**——不经状态机、不做状态转移。agent = 实际跑起来的运行时实例（runtime 层），与 task 的 `executor`（planning 层的计划执行者类型）分层不合并——概念与字段取值见 [board-model-guide.md §C.6](board-model-guide.md#c6-agents运行时-agent-登记簿)。

agent 生命周期状态机（写 verb 强制·同态重入幂等）：

```
starting  → running, uncertain, orphaned, terminal
running   → terminal, uncertain, orphaned
uncertain → running, terminal, orphaned
orphaned  → running, terminal
terminal  → （唯一终态·probe 永不复活）
```

本 namespace 专属 exit code 语义：`3` = 无 handle 证据 / 非法状态转移 / `link` 目标 task 不存在；`5` = agent id 不存在（**注意**：与 `task show` 的 `data:null` + exit 0 不同，`agent show` 查不到 id 直接 exit 5）。

### agent create

**写**

```
ccm agent create --type <t> --harness <h> --intent <str> [flags]
```

- positional：无
- 行为：往本板 `agents[]` append 一条登记（`lifecycle.state=starting`·`handle.kind=none`），agent id 自动生成（`agt-NNN` 递增零填充）；`account_ref` / `quota_pool_ref` 预留 `null`（只存 ref 不存数值）。返回 `agent_id`
- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--type <enum>` | | enum | `cli-worker, subagent, background-shell, workflow` | 是 | agent 类型 |
| `--harness <enum>` | | enum | `codex, claude-code, cursor-agent, kimi-code, origin` | 是 | agent 所在的 runtime / transcript 语义分区。`origin` 只用于不需要具体 host transcript parser 的本 orchestrator 本地机制；要流式观察 native subagent 时按下方 host-specific 配方登记具体 harness。 |
| `--intent <str>` | | string | | 是 | 一句话：派它去干什么 |
| `--model <str>` | | string | | | 已知才填的模型（unknown 保真·缺则不填） |
| `--cwd <str>` | | string | | | agent 工作目录 |
| `--json` | | bool | | | 结构化输出（`{agent_id, agent}`） |

- 例：`ccm agent create --type cli-worker --harness codex --intent "review repo diff"` · `ccm agent create --board /abs/x.board.json --type background-shell --harness origin --intent "跑回归测试" --json`

### agent bind

**写**

```
ccm agent bind <id> --handle <kind:value> [flags]
```

- positional：`<id>`（必填）
- 行为：交真实 handle 证据，`starting→running`（`uncertain→running` / `orphaned→running` 复活、`running→running` 幂等重绑也合法——新 handle 即证据）。**无证据拒绝（exit 3）**：`kind` 必须 ∈ `session-id|pid|task-id` 且 value 非空——无真实 handle 不算 running。`terminal` 态 bind → 非法转移（exit 3·终态不复活）
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--handle <kind:value>` | | string | 是 | handle 证据，`kind ∈ session-id\|pid\|task-id`，value 非空 |
| `--attach-cmd <str>` | | string | | 一键接入命令。**必须自包含**：登记的是「复制到任意 shell 都能跑」的完整命令——凡执行位置敏感的，把 `cd <工作目录> && ` 一并写进去（claude-code 是典型：`claude --resume <sid>` 必须在原 cwd 执行，session 按项目目录归档，写成 `cd /abs/worktree && claude --resume <sid>`） |
| `--transcript <str>` | | string | | transcript 路径引用（绝不内嵌内容） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm agent bind agt-001 --handle session-id:0197-abc --attach-cmd "cd /abs/worktree && codex resume 0197-abc"` · `ccm agent bind agt-002 --handle pid:48213`

**codex worker 登记配方（sid 运行时才生成·两步 bind 升级到位）**：codex 没有 claude-code 那样的 `--session-id` 预设——sid 在 worker 启动后才存在。别用凑合 handle 顶替，照这个顺序登记：

1. **派发**：`codex exec --json "<prompt>" > /abs/worker.log 2>&1 &`——`--json` 让 codex 把事件以 JSONL 打到 stdout，重定向落成日志文件。
2. **立即 bind 兜底证据**：`ccm agent bind <id> --handle pid:<pid> --transcript /abs/worker.log`——pid 立刻可探测、日志立刻可看（纯文本 fallback）。
3. **起跑后升级 bind**：日志**首行 `thread.started` 事件的 `thread_id` 就是 sid**（`head -1 /abs/worker.log` 即可提取；它与 rollout 文件名里的 sid 一致。旧版 codex 若输出的是 `session_meta` 形状，则取其 `payload.session_id`）。拿到就升级：`ccm agent bind <id> --handle session-id:<sid> --attach-cmd "cd /abs/cwd && codex resume <sid>"`——探测随之升级为会话文件 mtime（rollout 落盘于 `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sid>.jsonl`），attach / 流定位升级为精确 rollout 源。
4. **反模式**：`codex exec resume --last` 不可作 attach 命令——它接「最近一个 session」，并行多 worker 时会接错人；shell 后台任务 id 也不是可探测的 handle（登记成 `task-id:<shell任务id>` 会让 probe 无从探测、流定位不到 rollout 文件）。精确 resume 永远是 `codex resume <sid>`。

{{USING_CCM_NATIVE_SUBAGENT_TRANSCRIPT_RECIPE}}

### agent amend

**写**（只改 handle 域·非状态转移）

```
ccm agent amend <id> [--handle <kind:value>] [--attach-cmd "..."] [--transcript <path>] [flags]
```

- positional：`<id>`（必填）
- 行为：事后补正已登记 agent 的 **handle 域三件套**——`handle`（kind:value）/ `attach_cmd` / `transcript_ref`，至少给一项，否则 usage 报错。**任何生命周期状态都能 amend，含 `terminal`**——因为它不是状态转移、不交证据、不复活：**绝不**触碰 `lifecycle.state` / `probe` / `links` / `intent`（要改状态仍走 `bind` / `terminal` 等既有 verb）。`--handle` 复用 `bind` 的同一套校验（`kind ∈ session-id\|pid\|task-id` 且 value 非空，坏 handle 不入登记簿）。agent id 不存在 → exit 5
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--handle <kind:value>` | | string | | 补正 handle 证据（校验同 `bind`） |
| `--attach-cmd <str>` | | string | | 补正一键接入命令（同 `bind`：执行位置敏感的连 `cd` 一起写自包含） |
| `--transcript <str>` | | string | | 补正 transcript 路径引用 |
| `--json` | | bool | | 结构化输出（`{agent}`） |

- 为什么存在：坏 handle 常在 agent 已 `terminal` 后才被发现，此时 `bind` 被状态机拒（终态冻结），唯一出路曾是重复 `create` 一条新登记——**同一个真实 worker 在 roster 撕成两行**。`amend` 就是补正而不撕裂的出口。
- **心智锚**：登记后发现 handle 不完美（sid 拼错、attach 命令漏了 `cd`、transcript 路径写错），**用 `amend` 补正，绝不重复 `create` 登记**——一个真实 worker 两行 roster 是撕裂，会让花名册、viewer 与 resume 后的自己都数错在跑的 agent。
- 例：`ccm agent amend agt-001 --attach-cmd "cd /abs/worktree && codex resume 0197-abc"` · `ccm agent amend agt-002 --handle session-id:0197-fixed --transcript /abs/worker.log`

### agent link

**写**

```
ccm agent link <id> --task <task-id> [flags]
```

- positional：`<id>`（必填）
- 行为：建 agent↔task 关联，**join 存 agent 侧 `links[]`**（`{task_id, linked_at}`·非 `task.routing.attempts[]`——冻结 routing envelope 与 native-attempt dedicated writer 都不允许通用写，agent 侧 links 保持冻结合同零触碰）。**幂等**：已有指向同一 task 的 link 不重复追加（`--json` 回 `idempotent:true`）。目标 task 必须存在于本板，否则 exit 3
- flags：`--task <task-id>`（必填）· `--json`
- 例：`ccm agent link agt-001 --task T7`

### agent terminal

**写**

```
ccm agent terminal <id> --outcome <str> [flags]
```

- positional：`<id>`（必填）
- 行为：`starting/running/uncertain/orphaned → terminal`，盖 `ended_at` + 登记 `outcome`（`starting→terminal` = **启动失败收口**——spawn 失败、无 handle 可 bind 的 agent 也要能收口，别留永久僵尸；`terminal→terminal` 幂等）。**terminal ≠ task done**——本命令绝不碰 task status，父层仍须独立验收后走 `task done --verified --artifact`
- flags：`--outcome <str>`（必填·收口结论一句话）· `--json`
- 例：`ccm agent terminal agt-001 --outcome "review approved, 3 findings filed"`
- **收口是「凡派发皆登记」的对称后半段**：一个 agent 的产出被收割 / 端点验收掉（成功收工，非只 spawn 失败）后就 `terminal` 它——漏了它 agent 永停 `running`、堆成僵尸污染 recon 的 in_flight/phantom 判定。`ccm agent probe` **只判死活、永不 →terminal**，替不了这一步。批量收口：`ccm agent terminal <id>` 每次一个 id，多个 agent 就顺序 bash 背靠背跑（各自抢一次 board 锁·天然串行·零 race），别 `&` 后台并行 ccm 写。

### agent probe

**写**（仅写 `agents[]` 段）

```
ccm agent probe [<id>] [flags]
```

- positional：`<id>`（可选；缺省探测本板全体 agent）
- 行为：活性探测 + reconcile。**只写 agent 自己的 `probe` / `lifecycle` 字段，绝不碰 `task.handle` / attempt 投影**。探测手段按 handle 分级：
  - `pid` → 进程存活判定（进程在 / 存在但无权限 → `alive`；kill-0 确定进程不存在 → `gone`）；
  - `session-id` → 按 harness 的会话落盘根扫描会话文件 mtime（codex 默认 `~/.codex/sessions/**`·递归扫描 + 文件名精确匹配；claude-code 默认 `~/.claude/projects/*/<sid>.jsonl`·定向寻址；`origin` 等无会话落盘的 harness → `method=none`、`observed=unknown`）；
  - `task-id` 或 `type=subagent` → `handle.transcript_ref` 路径 mtime；无 ref → `unknown`；
  - 其余 / 无句柄 → `method=none`、`observed=unknown`（**保真**：拿不到就 unknown，绝不用相邻字段推导补齐）。
  - mtime 类观测（session-file / transcript）：mtime 在 freshness 窗内 → `alive`，在但陈旧 → `silent`；**文件不存在分两种**——上一次**同方法**观测到过 `alive`/`silent` 且本次**完整**扫描确认缺失 → `gone`（「曾在而消失」= 真死亡证据·seen-before 判死），**从未见过 → `unknown`** 不判死（启动竞态下 session 文件可能尚未落盘）；扫描不完整（目录预算耗尽 / 读取失败）不作判死证据、一律 `unknown`。
  - reconcile 双向、以观测为准、按证据强度分级：active 态（`starting/running/uncertain`）按 `gone→orphaned`、`silent→uncertain`、`alive→running`、`unknown→不变`；**`orphaned` 只被 mtime 类方法的 `alive` 复活为 `running`**（session/transcript 按 sid / 路径寻址、身份强）——`pid` 的 `alive` **不**复活 orphaned（kill-0 不验进程身份：pid 复用、存在但无权限都会产生假 alive；`uncertain` + pid `alive` 仍可回 `running`）；`terminal` 是唯一终态，probe 记录观测但永不复活。
  - reconcile 提议的转移在写盘前再过一道引擎状态机闸：不合法则该 agent 保持原态，并记入 `--json` 输出的 `reconcile_rejected`（人类输出以 `!` 行标注）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--freshness-sec <n>` | | string | mtime 判活窗口秒（默认 300·须正数——非法值 exit 2 拒绝进入写路径，不带病判活） |
| `--json` | | bool | 结构化输出（`{probed, reconcile_rejected}`） |

- 例：`ccm agent probe agt-001` · `ccm agent probe --board /abs/x.board.json --json`

### agent list

**读**

```
ccm agent list [flags]
```

- positional：无
- 行为：只读花名册：全体 agent + 按 `lifecycle.state` 分桶计数；每行含 state / harness / type / intent / 已关联 task。**附带 stale-running advisory**：凡 active-state（非 `terminal`）agent 的 linked task **全部已 `done`**，就列为「疑似产出已收割却漏收口」候选（json 落 `stale_candidates:[{id,links}]`·human 输出末尾一条 advisory 行指名候选）。**纯只读提示、绝不自动 terminal**——收口终态判断归 orchestrator，复核后自己 `ccm agent terminal <id>`。保守判据：链非空 + 每条 link 都指向存在且 `done` 的 task 才入选（任一 link 指向不存在 / 未 done 的 task → 不提示）
- flags：`--json`（`{count, buckets, agents, stale_candidates}`）
- 例：`ccm agent list` · `ccm agent list --board /abs/x.board.json --json`

### agent show

**读**

```
ccm agent show <id> [flags]
```

- positional：`<id>`（必填；不存在 → exit 5，**不是** `data:null`）
- 行为：单 agent 钻取：record + attach 命令 + transcript 路径 + probe 观测与新鲜度 + links
- flags：`--json`（`{agent}`）
- 例：`ccm agent show agt-001 --json`

### agent rm

**写**（破坏性·删登记·非状态转移）

```
ccm agent rm <id> [--yes] [flags]
```

- positional：`<id>`（必填）
- 行为：从本板 `agents[]` 删除整条 agent 记录（该 agent 侧的 `links[]` 随记录一并消失）——重复登记 / 误登记的撕裂行的**清除**出口（与 `amend` 互补：`amend` 补正保留的那条，`rm` 删多出来的那条）。**不经状态机**（删除 ≠ 状态转移），仍走带锁 + lint 写入关卡。破坏性，语义对齐 `task rm`：**非 TTY 须 `--yes`**，否则 refuse（exit 2）；agent id 不存在 → exit 5
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--yes` | `-y` | bool | 非交互环境确认（破坏性操作·不加则 exit 2 拒绝） |
| `--json` | | bool | 结构化输出（`{removed}`；支持 `--dry-run` 预演） |

- 例：`ccm agent rm agt-003 --yes` · `ccm agent rm agt-003 --dry-run`

---

<!-- ccm:k:end point:ccm.cmd.agent -->
