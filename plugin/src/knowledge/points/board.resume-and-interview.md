---
point: board.resume-and-interview
---

## 权威陈述

<!-- ccm:k:start point:board.resume-and-interview -->
`owner.heartbeat` 一直是 pinned 的 waist 字段，但早先它没有读者也没有固定写者。resume 探测给了它首个用途：

- **resume 探测读它**——`as-master-orchestrator --resume` 时 bootstrap 在重盖前读 TARGET 板的 `owner.heartbeat`（连同文件 mtime）判断「这板是否看起来仍有活 session」，新鲜则先警告、要 `--force-takeover` 二次确认（接管安全闸）。
- **活 session 每回合 flush 时写它**——活的 orchestrator 在每次 flush board 时把 `owner.heartbeat` 更新为当前时间戳，给下一次 resume 探测留下可读信号。

这不新增 waist 字段、narrow-waist 契约不动——只是首次赋予一个既有 pinned 字段一个读者（resume 探测）和一个固定写者纪律（活 session flush）。

---

## `owner.session_id` 与武装 / 续跑（此处只给落地心智）

`owner.session_id` 是 hook **武装闸**读的那个字段（每个 hook 在被武装前完全休眠，靠它 + `owner.active` 判定武装）。续跑视角要点：

{{PLATFORM_RESUME_GUIDANCE}}
- **全新独立会话（无平台 `--resume`，必拿新 `session_id`）对别人的 active 板按设计休眠**——这是防跨会话污染的设计，**不是**续跑失效。
- **未盖 `session_id`（空串）的 active 板保持休眠**——合法续跑因 resume / compaction 保留 `session_id` 故照常匹配；异常 blank 板由**显式 re-arm**（重跑 `as-master-orchestrator`）认领。
- **`as-master-orchestrator --resume` = 显式跨 session re-arm**——让一个**全新 session** 显式接管别的 session 的（或已归档的）board：bootstrap 把选定旧板的 `owner.session_id` 盖成新 sid、`owner.active` 置 `true`（**可复活 `/stop` 归档板**），并保留 `tasks` / `log` / `goal` / `git`。这是经用户显式 `--resume` 授权的合法武装形态（区别于被拒的「隐式自动收养空板」）。

---

## `decision_package` 采访协议 —— awaiting-user 节点的采访式决策

为「上下文缺失 / 决策依据缺失 / 时效性失效」三种把用户空投到失上下文决策点的失败形态而设的一对配套结构（此处只钉**协议叙事**——生命周期与两端逐字对齐的约束）。两者都是 agent-shaped / optional / **hook 一概不读**，narrow waist 完全不变。

**`decision_package`**（挂在 `blocked_on:"user"` 节点上的柔性边）：master 在 idle / 创建 awaiting-user 节点时为该节点预备的一份采访包（on-board，webview 可直接渲染富决策卡）。canonical 字段：`prepared_at` / `inputs_hash` / `freshness` / `ask_type` / `context_md` / `question` / `what_i_need` / `why_it_matters` / `options[]` / `enter_cmd`。语义要点：

- 它表示「用户还没拍板」。agent 已经自主做过、等待用户回来知情 / 复盘 / 追认的重要判断，走 `judgment_calls` / `jc`；不可逆、对外、merge、授权、方向性等用户拥有的决定不能先做成 judgment record。
- `ask_type` ∈ `{decision, advice, solution}`——明确告诉用户要「决策 / 建议 / 方案」哪一种；`decision` 型 `options` 必填非空、其余型可空。
- `freshness` ∈ `{fresh, stale}`——复用既有 `stale` 心智：采访包是**缓存**，discuss 入口重算 `inputs_hash` 比对做 freshness-check，过期则 re-ground。
- **生命周期闸**：discuss 用决策包**前**先验节点仍 `blocked_on:"user"`（master 已消化、清掉用户闸但 `decision_package` 残留时，discuss 据此停手、不再对已解决节点重开讨论）。

**`enter_cmd` 生成规则（master 端钉死·跨 session 不窜板）**：命令前缀按当前 harness——Claude Code `/cc-master:discuss`、Cursor `/discuss`、Codex `$cc-master-discuss`。discuss 是用户在**新终端**起的独立 session，未必继承本次编排的 `CC_MASTER_HOME`——故复制命令要**自带选择器**：**默认带 `--board <board-stem>`**（`<board-stem>` = 本板文件名去 `.board.json`），这样即便同 home 下还开着别的 board、新 session 跑复制命令也**绝不窜板**。home 非默认时再对路径加 shell 引号追加 `--home '<绝对路径>'`（单引号包整路径，含空格的 home 不被截断）。**home 路径含字面单引号 `'` 不支持**——master 生成端遇到时直接报错拒吐 `enter_cmd`（POSIX `'...'` 内无法转义内层单引号，两端解析都只对「不含字面单引号的路径」对齐）。webview 复制按钮原样复制整串，discuss 第 1 步按同一 `--home` **quote-aware 解析**——生成端加引号 ⟺ 解析端 quote-aware，两端逐字对齐。

**`inputs_hash` 算法（准备端与 discuss 端必须逐字一致，否则永远误判 stale）**：对该节点 `deps[]` 里每个直接 dep，**按 `deps` 顺序**依次串接 `<dep-id>` + `\n` + `<artifact 的 UTF-8 字节长度>` + `\n` + `<artifact 内容>` + `\n`（某 dep 无 `artifact` 则 artifact 计空串、长度 0）；末尾再串接 `goal` + `\n` + `<goal 字节长度>` + `\n` + `<goal 内容>`；对最终 payload 的 UTF-8 字节取 **SHA-256**，记为 `sha256:<hex>`。**长度前缀 + dep-id 一起锁死依赖边界**——纯裸串接会让 `["ab","c"]` 与 `["a","bc"]` 产生同字节流（把过期采访包误判 fresh），加长度前缀后区分开。discuss 入口按同一算法重算比对——不一致即采访已过期、先刷新。纯 node 实现（`crypto.createHash('sha256')`）。

**`<board-stem>--<node-id>--<STAMP>.decision.md` sidecar**（带外文档，写在 board home 同目录，**由独立 discuss session 写、绝不写 board**——保单写者纪律，避免与 orchestrator 的 board 写并发 torn-write）：discuss 谈完的产物。命名三段：`<board-stem>`（board 文件名去 `.board.json`·共享 home 下防不同板 sidecar 互相覆盖）+ `<node-id>`（须 path-safe·discuss 落盘前 guard 校验）+ `<STAMP>`（收尾那刻紧凑 UTC `YYYYMMDDTHHMMSSZ`·无 `:`·字典序即时间序）。**版本化 append-only**：每次 discuss 写一份**新** sidecar、绝不覆盖——「一个节点聊过 N 次」= 它名下 `*--<node-id>--*.decision.md` 文件数，全部历史可回溯；同秒碰撞给 STAMP 追 `-2`/`-3` 后缀去重。结构：frontmatter（`node_id` / `resolved_at` / `inputs_hash_at_decision` / `ask_type` / `round`）+ `## TL;DR` + `## 决策结论` + `## 完整决策文档` + `## 对话记录指针`。

**消化闭环**：master 在 recon / idle 拾取 sidecar 消化（先 TL;DR 再全文 → replan → 把短摘要折进节点 `notes`（master 写、on-board）+ 清 `blocked_on:"user"`）。

---
<!-- ccm:k:end point:board.resume-and-interview -->

## 失效类型

`environment_fact`（主体：事实方法） —— inputs_hash 必须在准备端与一个全新、不共享记忆的 discuss session 里逐字重算出同一结果;删掉这条算法细节,新 session 只能凭印象拼一个看起来差不多的哈希输入,导致 staleness 判断系统性出错。

删掉后不知 heartbeat/session_id 武装语义、decision_package 字段与 inputs_hash/enter_cmd 的本工具约定。

## 边界

这套心智只对必须跨 session、跨 compaction 保持字节级一致的场景成立(如决策包续跑);同一上下文内一次性做的判断不需要这条规则,因为没有『下一个断开的上下文』要对齐。

## 失败形态

discuss 端在全新 session 里凭大概记得重新拼一遍 hash 输入,漏掉某个 dep 的长度前缀或算错顺序,算出的 sha256 与准备端不一致——系统判定 stale 强制重新沟通,看不出是算法级 bug;更隐蔽的是两串恰好因省略前缀而意外重合,把过期采访包误判成新鲜,形式上通过了校验,实质已经失真。
