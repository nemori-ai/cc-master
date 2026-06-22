# Decision Briefing + Discuss Loop —— 端到端走查（会跑的那种）

> 这份 walkthrough 叙事化走一遍 **decision-briefing-discuss-loop** 的完整闭环：
> **网页中触发讨论 → 模拟讨论结束 → master 继续使用到这份数据为止**。
> 每一步既讲「预期看到什么」，也指明它对应 [`smoke.sh`](smoke.sh) 里哪段可机验断言。
> smoke.sh 是这份走查里**可无人值守证明**的部分；webview 那一段（§A）是需要你亲眼看的人验部分。

这个 feature 解决的真实痛点（见设计稿 §1）：当 cc-master 需要人拍板时，用户被空投到一个**失去上下文**的决策点——不知道在纠结什么（上下文缺失）、没有判断依据（依据缺失）、或回答一个已被架空的旧问题（时效性失效）。本 demo 用一个具体场景把三者的正面解走一遍。

---

## 场景

一块真实形态的 board（[`fixture.board.json`](fixture.board.json)），goal 是：

> 把 cc-master 的 board 持久层从单文件 JSON 迁移到「单文件 JSON + 可选 sidecar 索引」，在不破 narrow waist 的前提下支撑 >200 节点不卡顿。

DAG 形态：

```
P0 (done)  侦察：定位 >180 节点卡顿根因 ──┐
                                          ├──▶ D1 (blocked_on:user)  选定持久层架构方向
P1 (done)  性能基线（解析/布局 p95）  ────┘         │ deps
                                                    ├──▶ P2  实现选定方向
                                                    ├──▶ P3  viewer 增量加载
                                                    └──▶ P4  迁移脚本 + 回退
```

`D1` 是整条临界路径的根——`P2/P3/P4` 全 deps 在它上面。master 在 idle 时已经为它**准备好一份采访包**（`decision_package`，挂在 `D1` 节点上，agent-shaped、on-board），把「走到这一步、为什么卡这、三个候选方向各自取舍」整理成自说明上下文。这正是 SKILL A「准备 decision_package（as prefetch / fill-work）」纪律的产物。

> **smoke 对应**：STEP 1 用真 `board-lint.js` 证这块 board 窄腰合法，并逐字段断言 `decision_package` 契约完整（`prepared_at` / `inputs_hash` / `freshness` / `ask_type` / `context_md` / `question` / `what_i_need` / `why_it_matters` / `enter_cmd` 全在；`ask_type:decision` → `options` 非空≥2、每项含 `id`+`label`）。

---

## A. 网页触发（webview 富决策卡 + 复制命令）—— 人验

把 view-server 指向这块 fixture board，在浏览器里看富决策卡：

```bash
# 从 repo 根跑（examples 是 dev-only，裸相对路径在此正确）
CC_MASTER_BOARD="$(pwd)/examples/decision-briefing/fixture.board.json" \
  node skills/orchestrating-to-completion/scripts/view-server.js
# 它打印一行： cc-master board view: http://127.0.0.1:<port>
```

打开那个 URL，点开 `D1` 节点的 detail rail，**预期看到**：

- 顶部一枚 **ask-type 徽章** `◈ decision`（`DecisionCard` 按 `ask_type` 渲染 glyph）。
- **question 头条** + **context_md 自说明叙事**（cc-master 为什么卡在这），不再是 amber 旗标下的 *no justification recorded*。
- **what i need** / **why it matters** 两栏。
- **三个 option**，每个有 `label` / `rationale` / `trade`（tradeoffs）。
- 底部一个 **「复制命令」按钮**（`⧉`）——点它把 `enter_cmd`（`/cc-master:discuss D1 --board <board-stem>`，默认带 board 选择器防窜板）写进剪贴板。**纯客户端 `navigator.clipboard`，零 fetch / 零 POST / 零联网**（webview 是只读的，view-server 对非 GET 回 405）。点完按钮文案闪成「已复制」。

这一步是整个设计的**入口取舍**：拒绝「按钮直接拉起 session」（要 webview 长 POST 端点，撞红线 1/2/5），改用纯客户端剪贴板 + 复制命令——零红线代价，`view-server.js` 这次只新增一条**只读 GET**（见下），不破只读。

卡片上还有一块 **「💬 已讨论 N 次」讨论历史区**：任何有 discuss sidecar 的节点（不止 awaiting-user），卡片都拉只读 `/decisions.json`（view-server 新增的只读 GET 路由——扫 board home 全部 `*.decision.md`、解析 frontmatter + 抽 `## TL;DR` 段首行，按 `node_id` 分组返回 `[{node_id,file,resolved_at,ask_type,round,tldr}]`），显示「💬 已讨论 N 次 · 最近结论 TL;DR:「…」· `<resolved_at>`」，可展开看逐次。**纯客户端 fetch（GET，与 `/board.json` 轮询同款），view-server 仍零联网零 POST**；优雅降级（无 sidecar → 不显示该区；路由 404 / 老 server → 静默跳过）。这正面解掉用户痛点：**discuss 完即使 master 还没消化，卡片也立刻能看到「聊过几次 / 最近结论」**——不等 master 那一拍。

> **smoke 对应**：STEP 1 末尾断言 `enter_cmd` 含 `/cc-master:discuss D1`——即用户点「复制命令」会拿到的那条。STEP 4b 起真 `view-server.js`、`node` HTTP GET `/decisions.json`，断言它把（STEP 4 写的）两份 sidecar 扫成 **D1 的 2 条历史**（round 1/2 顺序对、各自 `tldr` 抽取正确、`node_id` 对）——卡片历史区据此渲染。富卡的视觉渲染本身靠这一步人验（webview 在浏览器里）。

---

## B. 进入 discuss session + 时效性校验（freshness-check）

把复制到的命令粘进**一个新终端的 Claude Code session**（命令默认带 `--board <board-stem>` 选择器，钉死是哪块板——同 home 下开着别的 orchestration 也不会窜板）：

```
/cc-master:discuss D1 --board 20260619T093000-0000
```

这是一个独立、满血的 CC session（不是 master 主线——master 此刻可能正忙别的，互不打断）。它按 [`commands/discuss.md`](../../commands/discuss.md) 走：

1. **定位节点 + 决策包**：在 `$CC_MASTER_HOME` 里找 `owner.active:true` 的 board，取 `D1` 的 `decision_package`。
2. **freshness-check（必 reconcile）**：按 `inputs_hash` 的定义——对 `D1` 的每个直接 dep（`P0`/`P1`）按 deps 顺序串接 `<dep-id>\n<artifact 字节长度>\n<artifact>\n`，末尾接 `goal\n<goal 字节长度>\n<goal>`，取 payload 的 sha256（长度前缀 + dep-id 锁死边界，`["ab","c"]` 与 `["a","bc"]` 因此不撞）——**重算并与决策包里的 `inputs_hash` 比对**。

两种结果：

- **一致（fresh）** → 采访包仍新鲜，直接用缓存的 `context_md` / `question` / `options` 开谈。
- **不一致（stale）** → 上游在准备之后变了。discuss session 有满血能力：翻当前 board、翻代码，**先 re-ground**——把过时的 `context_md` / `question` / `options` 对照当前现实刷新，并**明确告诉用户**「这份采访准备于 `<prepared_at>`，期间上游变了（说清哪变了），我已按当前现实刷新」。用户因此**绝不会回答一个被架空的旧问题**。

> **smoke 对应**：
> - STEP 2（**fresh 正例**）：输入未变 → 重算 hash **==** 决策包内 hash。
> - STEP 3（**stale 反例**）：把上游 `P1.artifact` 改掉（模拟 subagent 又跑了 n 步）→ 重算 hash **!=** 决策包内 hash → freshness-check 判过期、触发 re-ground。
> 两例一起证明 freshness-check 能区分「新鲜」与「过期」——这是用户「时效性」痛点的正面解。

---

## C. 模拟讨论结束 —— discuss session 写 `.decision.md` sidecar

discuss session 用 `context_md` 把上下文讲清楚、按 `ask_type` 设定姿态（`decision` 型 = 帮用户权衡但让他拍板），采访式把问题谈透（追 job 不追 feature、痛点与方案分开、用用户自己的话复述回去、逼向极度具体）。

谈完，它把结论整理成一份**决策文档 sidecar**，写到 **`<board-home>/<board-stem>--D1--<STAMP>.decision.md`**（`<board-stem>` = board 文件名去 `.board.json` 后缀——带 board-stem 防共享 home 下多板撞名 / 误消化；`<STAMP>` = 收尾这一刻的紧凑 UTC `YYYYMMDDTHHMMSSZ`——无 `:`、path-safe、字典序即时间序）：

**版本化、append-only、绝不覆盖。** 每次 discuss 都写一份**新** sidecar（用当时的 STAMP），永不覆盖该 node 已有的任何 sidecar——一个节点「聊过几次」就等于它名下 `*--D1--*.decision.md` 文件的个数，全部历史都留得住（webview 的「💬 已讨论 N 次」、master 的回溯都据此）。frontmatter 新增可选 `round`（本节点第几次讨论 = 已有该 node sidecar 数 + 1）。

```markdown
---
node_id: D1
resolved_at: 2026-06-19T16:15:30Z
inputs_hash_at_decision: sha256:05e0b09c...
ask_type: decision
round: 2
---

## TL;DR
选 opt-sidecar-index（…一两句话把结论说死）

## 决策结论
选定 option id：`opt-sidecar-index` —— …

## 完整决策文档
（依据 / narrow-waist 取舍 / re-ground 发现的变化 / 边界 …master 据此 replan）

## 对话记录指针
（翻过的产物 / board 位置 / 关键来回）
```

**关键纪律：discuss session 绝不写 board。** board 由 master orchestrator 独占——并发写会 torn-write 毁掉它的状态。discuss 只写这一个带外 sidecar；master 会在下次 recon 来读它。`inputs_hash_at_decision` 复用 discuss 命令第 2 步算出的同一个 hash 定义，让 master 日后能判「这个决策是对着哪个输入快照做的」。

> **smoke 对应**：STEP 4 模拟「**聊了 2 次**」——用脚本生成**两份**不同 STAMP 的 `<board-stem>--D1--<STAMP>.decision.md`（round 1 早 / round 2 晚、frontmatter 5 字段含 `round` + 四个 `##` 段），断言两份并存（**append-only 不覆盖**、D1 名下 sidecar 计数 == 2），并断言 **board 文件与 fixture 逐字节相同**——硬证 discuss **没碰 board**（单写者纪律不破）。

---

## D. master 消化 —— recon 拾取 → 解析 → 用上这份数据 → replan

master 在下一次 recon / idle（决策程序 step 1）扫 awaiting-user 节点，发现 board home 同目录有该 node 的（可能多份）`<board-stem>--D1--<STAMP>.decision.md`，按 [`async-hitl.md`](../../skills/orchestrating-to-completion/references/async-hitl.md) §消化纪律——**读该 node 全部 sidecar、取最新一份（最大 STAMP = round 2）为准消化**（之前 round 留作历史 / 回溯）：

1. **先读 `## TL;DR` 再读全文**——TL;DR 是给 master 的快速摘要，全文供 replan 依据。
2. **据此 replan DAG**——决策结论（选 `opt-sidecar-index`）解锁 / 重接下游：`D1` 不再 `blocked_on:user`，`P2/P3/P4` 从 `blocked` 转 `ready`，可派发。
3. **把短摘要折进 `D1.notes`**（master 写、on-board，webview 借此显示「已解决」）+ **清 `blocked_on:"user"`**。

**不需要实时通知**（用户明确）——master 自然 recon 时拾取即可（ADR-011 watchdog 在 idle 期可选地顺带 surface「有决策结论落地」）。

> **smoke 对应**：STEP 5 模拟 recon 拾取**最新**那份（round 2）——纯 node 解析 sidecar（禁 jq/python），断言：frontmatter `node_id` 对得上、字段齐、`inputs_hash_at_decision` 与决策包内一致、**消化的是 `round == 2`（最新一份、非 round 1 的暂定版）**、四个 `##` 段都在、能解析出非空 **TL;DR**，且**选定 option id（`opt-sidecar-index`）属于 board 节点 `decision_package.options` 之一**——这最后一条是「master 真能用上这份数据」的硬证：解析出来的结论不是悬空字符串，而是能接回 board 上那张选项表、据此 replan 的可执行决策。
>
> 第 3 步「回流写 board」是 master orchestrator 的活（写 board 是它独占的）——smoke 不替它写 board，只证「拾取 → 解析 → 选定项可用」这条**可机验链**；replan 本身在真 orchestration 里发生。

---

## 跑可机验部分

```bash
bash examples/decision-briefing/smoke.sh
```

预期收尾：`DEMO E2E PASSED — N 项断言全绿，0 失败`。它用沙箱 `$CC_MASTER_HOME`（mktemp 临时目录，trap 自动清理），**不污染真实 `.claude/cc-master/`**；纯 bash + node、零联网。

它一条线覆盖闭环各段：

| 闭环段 | smoke STEP | 证什么 |
|---|---|---|
| **网页触发** | STEP 1 | fixture board 窄腰合法 + `decision_package` 契约完整 + `enter_cmd` 即复制命令（富卡靠它渲染） |
| **时效性底座** | STEP 2 / 3 | freshness-check fresh 正例 + stale 反例可区分 |
| **模拟讨论结束（聊 2 次）** | STEP 4 | discuss 版本化 append-only 写**两份** sidecar、两份并存（计数 == 2）、**不碰 board**（单写者） |
| **webview 历史区** | STEP 4b | 起真 view-server、GET `/decisions.json` 见 D1 的 2 条（round 顺序对、`tldr` 抽取对、`node_id` 对） |
| **master 消化最新 round** | STEP 5 | recon 拾取**最新**那份（round 2）→ 解析 → 选定 option 属于 board options（用得上） |

---

## 它守住的红线

| 红线 | 本 demo 如何不破 |
|---|---|
| R1 hooks 纯 bash/node | 不新增任何 hook；smoke 纯 bash + node，零 jq/python |
| R2 narrow waist | `decision_package` 是 on-board 柔性边、`.decision.md` 是带外 sidecar——硬窄腰零改动（STEP 1 lint + STEP 4 逐字节断言坐实） |
| R4 指挥不演奏 | master 只**准备 + 消化**，对话由独立 discuss session 承载（强化 R4） |
| R5 ship-anywhere | 复制命令是客户端 clipboard 非 POST；view-server 这次只新增**只读 GET** `/decisions.json`（零 POST、仍绑 127.0.0.1、零联网）；无新运行时依赖 |
| R6 dormant-until-armed | 无新 hook 可武装；discuss session 读 board 不写（只写 sidecar），是普通 CC session |
