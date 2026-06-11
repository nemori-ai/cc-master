# cc-master 愿景落地追踪（vision-landing-tracker）

> 本文持续追踪 cc-master **六条产品愿景**在当前实现里的**落地 gap**。愿景 charter 的 SSOT 在 [`spec.md` §1.0](spec.md)——charter 说**目标**，本文量**差距**。
> **这是 living 文档**：某条 gap 关闭就更新对应卡的 ③⑤ + 翻矩阵「追踪状态」+ 更 last-audited；charter 增删能力就同步增删卡。
> **last-audited：2026-06-11** · 审计法：每条能力穿全产品面（command / hook / skill / board / script）追 trace（指到 file:line）、判落地真实性、找 adversarial 断点、诚实分「真 gap vs 设计意图」。

## 落地真实性图例

- 🟢 **真落地**——有可执行机制（hook / script / board 字段 / command），真 session 走得通。
- 🟡 **半落地**——只有 prose 教 agent、靠自觉、无机制兜底。
- 🔴 **design-only**——只在文档/spec 说，运行时无承载。
- ⚫ **缺失**——愿景里有，产品里找不到对应物。

> **关键判读**：🟡 在本仓**大多是设计意图、不是缺陷**——cc-master 故意让很多东西是 prose 而非 hook（红线 4 指挥不演奏 / 红线 1+5 hooks 纯 bash · ship-anywhere / §6 Iron Law 禁造 agent 不违反的红线）。所以每张卡第 ⑥ 栏专门区分「该是机制却只 prose = **真 gap**」与「按设计就该 prose = **非 gap**」。

---

## 兑现度矩阵（at-a-glance）

| # | 能力 | 落地真实性 | 真 gap（一句话）| 严重度 | 追踪状态 |
|---|---|---|---|---|---|
| C1 | 异步并行多线程推进 + 完整落地 | 并行 🟢（借 harness 原生）· 完整闸 🟢（verify-board）| 闸只信 board status、读不到对话——**board 完整性零机制保障** | 中-高 | 🔴 open |
| C2 | 控制 token 消耗速度 | sensing 🟢（cc-usage.sh）· pacing 决策 🟡 | 传感器是真的、**但 loop 从不调它**；budget 不跨 compaction 持久化 | 中-高 | 🔴 open |
| C3 | 自主决策 vs 人类接入边界（HITL）| 🟡（行为红线靠端点守）| Stop 闸不分「未答用户终审」与「等上游」→ 挂着未答 merge 决策能**静默 Stop** | 中 | 🔴 open |
| C4 | 目标分解 / 管理 / 更新 / 规划 | board 🟢 · 分解方法 🟡 | 计划更新 / supersession **无事务一致性**；`status.md`「critical path」轻度 overclaim | 中-高 | 🔴 open |
| C5 | 资源合理下最大化效率调度 | scheduler 🟡（手跑 prose）| **单侧兜底**：兜了「欠调度 idle」却不兜「过调度顶满 utilization cliff」 | 中 | 🔴 open |
| C6 | 按复杂度/难度/时长选模型 | 设模型 lever 🟢 · 选档判断 🟡 · **duration 维 🔴** | 愿景三因子只兑现 complexity/difficulty，**duration 维蒸发**且 README/spec overclaim | 低-中 | 🔴 open |

---

## 元模式（审计的核心结论）

**真 gap 几乎都不是「prose vs 机制」。** cc-master 的 prose-heavy 设计绝大多数有红线背书（红线 4 指挥不演奏 / 红线 1+5 ship-anywhere / §6 Iron Law），是**有意设计**——把它们机械化反而违背产品定义或读不到语义。真 gap 反而聚成三类：

1. **非对称兜底**——机制只兜了失效的一侧。C5：`verify-board` 兜「欠调度（不许 idle）」却**零**兜「过调度（顶满 cliff）」；C3：Stop 闸不区分「未答的用户终审」与「等上游任务」，两者都握手一轮即放行。
2. **完整性 / 事务性无保障**——机制信任的前提本身零机制守护。C1：闸信 board 的 status enum，但「board 忠实反映现实」全靠 agent 自觉 + reinject prose；C4：计划更新 / supersession 靠 agent 每回合记得重写整个 board，无事务一致性、无 deps 图完整性校验。
3. **愿景某维度蒸发 + overclaim**——C6：charter 写 complexity/difficulty/**duration** 三因子，落地选档只用前两个，duration 维缺失却仍写进 charter；C4：`status.md`「critical path」让人以为有机器算的临界路径，实为 agent 心算。

**→ 处置取向随之收敛**（多数真 gap 的正确护栏**不是**「加 hook」——那会违背 ship-anywhere 或读不到语义）：

- **① Track B 行为断言**——守 C5（不过调度）/ C3（不 overreach merge）/ C2（长跑要 sense）这类**行为型** gap，正合红线 4「行为红线靠 §8 Track B + 端点验收守，非 grep 能拦」。
- **② 廉价只读护栏**（纯 bash、不动 narrow waist、不破红线 1/2）——C3：握手文案列出 `blocked_on:"user"` 的 title；C4：`status.md` 加 deps 图一致性 + 悬挂 stale 检测；C1：握手文案点名「board 完整性」。
- **③ 个别 waist 字段**（最贵最慎，动 waist = 红线 2，须同 PR 改全部 hook + 测试 + ADR-003）——C1：`done` 必带 `verified:true`+`artifact`，让闸至少能拦裸 done。
- **④ 愿景措辞校准**——C6：要么把 duration 接进选档规则，要么修 README/spec 措辞使其与落地一致。

---

## 六张 gap 卡

### C1 — 异步并行多线程推进 + 实现目标完整落地

- **① 愿景断言**（`spec.md:22`）：拆依赖图、并行派后台工作、全程异步推到目标**完整落地（不半途）**。拆两子断言：(a) 并行后台推进 + (b) 完整落地闸。
- **② 落地 trace**：点火 `commands/as-master-orchestrator.md:5` → `hooks/scripts/bootstrap-board.sh:43-66`（确定性建 board 空骨架 + 注角色）🟢；三种后台机制（shell / sub-agent `run_in_background` / workflow）以 prose 住 `references/dispatch.md:76-105`——**机制是 harness 原生、非 cc-master 代码**；完整闸 `hooks/scripts/verify-board.sh`（Stop-hook，已 wire）：empty→block、**ready/uncertain→block**（:114,167）、全终态→fingerprint self-check 握手（:176-182）、fuse=5 防死锁（:137-144）；测试 `tests/hooks/test_verify-board.sh` 钉死。
- **③ 等级**：bootstrap 🟢 · 三机制 🟢（harness 原生）· 「选机制+就绪即发+WIP」🟡（by-design）· **完整闸 🟢（C1 最实一块）** · 跨 compaction 续 🟢（reinject）。
- **④ adversarial 断点**：闸**只信 board status enum、不读对话也不重建 DAG**（verify-board.sh:6-8 自陈）。compaction 后 agent 漏把工作写进 `tasks[]`、或手标未完成节点为 `done`/`failed` → 闸全看不见、直接放行。`failed`/`escalated`/`stale` 归入「终态」握手一次即可停 → 目标半途而废但闸放行。
- **⑤ 严重度 + 处置**：**中-高**。处置：(waist，慎) `done` 必带 `verified:true`+`artifact`，让闸能拦裸 done——但动 waist 是红线 2；或接受为 ship-anywhere ceiling。
- **⑥ gap vs 设计意图**：三后台机制是 harness 原生 + 薄教学层 = **非 gap**（spec §1.1/§12 + AGENTS.md §1 定义）；「调度=prose」= **非 gap**（dispatch.md:46-48 论证主线 DAG 动态、no compile-time script can express it + 红线 4）；**真 gap 种子** = 闸读不到对话是红线 1 的硬代价（非 gap 那半），**但「board 完整性零机制保障、全靠 prose self-check + reinject 续命」没有任何 pressure baseline 证明 agent 三压下不违反**——这块够格叫真 gap。

### C2 — 控制资源（token 用量）消耗的速度 〔已作样板 pilot〕

- **① 愿景断言**：>24h 跑程里感知配额、临墙前节流不停摆。
- **② 落地 trace**：`scripts/cc-usage.sh` 真 sensing 脚本（解析本地 JSONL → 5h/7d used + burn rate，ship-anywhere，`tests/scripts/test_cc-usage.sh` passed=10）；`references/cost-and-pacing.md` pacing 决策 + 4 档 model + 三杠杆，**全 prose 且顶部自述「informational, not a red line」**；`SKILL.md` lens 5 软指针；决策程序 dot-graph 的 `budget` 仅指 **WIP 预算非 token 配额**；board **无** budget/quota 字段（仅 `blocked_on:"quota-reset"` 约定）；hooks 不碰 usage（对，红线 1）。
- **③ 等级**：sensing 🟢 · pacing 决策 🟡（by-design）。
- **④ adversarial 断点**：**传感器是真的，但决策程序从不调它**——无任何一步跑 `cc-usage.sh`/查 burn-rate 墙，全靠 agent 自觉；compaction 后只剩 lens 5 软指针。长跑半途撞穿 5h 窗口，因没人跑过传感器。budget 不持久化 → pacing 上下文跨 compaction 丢失。按难度选模型无强制（见 C6）。
- **⑤ 严重度 + 处置**：**中-高**（用户 #1 能力 + forcing-function 洞）。处置：(a) 决策程序 reconcile 加**软** sensing checkpoint（长跑则 sense 一次——是 sensing 节律提示、**非** pacing 红线）；(b) board 加 agent-shaped budget 快照字段让 pacing 跨 compaction 续；(c) Track B 加「长跑要 sense」断言。
- **⑥ gap vs 设计意图**：pacing **决策**是 prose = **非 gap**（cost-and-pacing.md:3-13 有 baseline 证据 + Iron Law）；**真 gap** = baseline 证的是「给定事实时 agent 能 derive 对的 pacing」，**没**证「跨 compaction 长 loop 里 agent 还记得 sense」。决策程序对 loop 有 fuse，却**无 usage-sensing 检查点**——「传感器真实但不被 loop 触发」是真 gap。

### C3 — 自主决策 vs 寻求人类接入的边界（HITL）

- **① 愿景断言**：难撤销 / 对外可见 / 方向抉择 / 终审（典型 merge）必须先问；立刻 surface 不擅专；前台问用户 ∥ 后台执行；可预见决策 prefetch。
- **② 落地 trace**：`SKILL.md:57-60`（lens 7）+ `:74-75`（红线 overreach）+ `:94-95`（Rationalization 两行）+ `:124-128,158-160`（dot-graph q_user/surface + dispatch fires even mid-HITL）；`references/async-hitl.md:43-71`（HITL 模型全文，prose）；board `blocked_on:"user"` 样例 `assets/board.example.json:12`，但 `board.md:71` 列 `blocked_on` 为 **flexible edge 非 pinned waist**；`commands/status.md:18`/`stop.md:11`；**verify-board.sh:167-182**：`blocked` 落「完成态」桶、握手一次即 allow，`blocked_on` 只进 fingerprint 哈希、**不**作 block 判据（`2026-06-08-goal-hook-design.md:51` 实证「`blocked_on:"user"` 不触发 block，设计如此」）。
- **③ 等级**：边界判定 🟡 · `blocked_on:"user"` 承载 🟡（不对称：hook 哈希它不路由它）· **Stop 闸守「挂未答用户决策不让停」🔴 缺失** · 前台∥后台 🟡 · prefetch 🟡。
- **④ adversarial 断点**：board 到「实现/验收全 `done`，剩一个 `blocked_on:"user"` 的 merge 终审」。agent 疲劳+sunk-cost 合理化「活都干完、用户没在线我先 merge」→ 亲手 merge 不可逆/对外步骤（破红线 4）。Stop hook 帮不上：无 ready/uncertain，握手一次放行，分不出「未答终审」与「可推进的等待」。更隐蔽：agent 根本没把 merge 立成 `blocked_on:"user"` 节点。
- **⑤ 严重度 + 处置**：**中**。首选（廉价不破红线）：握手文案在 board 存在 `blocked_on:"user"` 时**显式列出该悬决策 title**，把「你正挂着未答用户决策」摆到 agent 脸上（纯 bash 只读 board）；守护层确认 Track B 有「overreach on merge」断言。**勿做**：把 `blocked_on:"user"`-must-block 加进 Stop hook——会架空 lens 7「前台∥后台」（同 native `/goal` 被废之病）。
- **⑥ gap vs 设计意图**：HITL 边界=prose = **设计意图**（红线 4 是行为型、由 Track B + 端点守，AGENTS.md §3；hook 读不了语义，goal-hook-design.md:19；ADR-004 拍板）；**真 gap** = 对称性缺口：`blocked_on:"user"` 是 flexible、Stop 闸不区分「未答终审」与「等上游」→ 挂着未答终审能静默 Stop。补的是**廉价 surface 信号护栏**，非推翻设计。

### C4 — 目标的分解 / 管理 / 更新 / 规划

- **① 愿景断言**：拆成依赖 DAG、把计划做成被持续管理 / 跨 compaction 存活 / 可重规划的真文件。
- **② 落地 trace**：`bootstrap-board.sh:43-66`（从 goal 建空 board 骨架，hook 不写 tasks）；board schema `assets/board.template.json` + narrow waist `tasks[{id,status,deps}]`+status enum（`board.md:43-66`，ADR-003）；`verify-board.sh:67-114`（escape-aware awk 真解析 tasks region、数 id、grep status）🟢；分解方法 CPM/float **只在** `references/decomposition.md` + `commands/status.md:19`（grep 确认 hooks/commands **零**机器计算 float）；supersession = 把 status 写 escalated/stale（`board.md:97-102`），纯靠 agent 每回合 Write 整文件。
- **③ 等级**：**board=被管理的持久计划 🟢** · **narrow-waist 契约 🟢（最硬一块）** · 完成度判定 🟢 · 分解方法（CPM/float）🟡（prose-only）· per-node 契约 🟡 · **更新/supersession 跨 compaction 续 🟡（关键断点）**。
- **④ adversarial 断点**：critical-path 是幻觉（无代码算 float，大 DAG 上 agent 心算会错且无校验）；supersession 漏写即丢（compaction 卡在标完一个、没标完剩下之间，reinject 不提示「上次没标完」）；重规划无事务性（重写 tasks[] 半截 compaction → torn-plan，hook 只数 id/status 不验 deps 图完整/无环）；per-node 契约可空（没 success predicate 也能 dispatch，端点验收无据）。
- **⑤ 严重度 + 处置**：**中-高**（supersession/重规划）。处置：`status.md` health-check 增「deps 图完整性 + 悬挂 stale 检测」（read-only 纯 bash）；reinject 增「上次 board 有未消化的 stale/escalated 吗」；`status.md`「critical path」措辞标注「agent 心算」或提供带外 `scripts/` 真算 float 脚本（ship-anywhere 不进 hook）。
- **⑥ gap vs 设计意图**：分解方法 prose = **非 gap**（红线 1 hook 读不了语义算不了语义化临界路径 + 红线 4 分解是指挥判断活，ADR-004 §2.2）；board/narrow-waist/goal-hook 🟢 = 真机制无虚标；**真张力** = supersession/重规划**无事务一致性**——ADR-003 §3.3 有意把 supersession 设计成显式 status 改（留痕在 board），但「靠 agent 记得 Write」零 hook 兜底是 ADR-004 已自承的 ceiling；该不该加 read-only deps 一致性守护是**未被现有 ADR 正面拍板**的开放张力。

### C5 — 在资源消耗速度合理前提下最大化实施效率的调度编排

- **① 愿景断言**：token 速率可控约束下，把并行+调度编排到实施效率最大化（就绪即发、WIP~75%、admission control、临界路径/float 定 lane 数）。
- **② 落地 trace**：决策程序 dot-graph = 手跑 dataflow scheduler（`SKILL.md:120-156`，:166 自陈「hand-run dataflow scheduler — a TFU」）；lens 3 就绪即发 + lens 5 ~75%（`SKILL.md:42-52`）；fill-work admission test（`SKILL.md:172-176`）；admission control/WIP/并行度（`dispatch.md:151-161`）；CPM/float（`decomposition.md:28-88`）；board `wip_limit:4` 但 `board.md:74` 列其为 **flexible edge（hook-ignored）**——`dogfood-findings.md` Finding #9 自承「实际 hook 都不读 wip_limit」；Track B 四断言（`track-b-benchmark.md:40-71`）**无一条**覆盖 WIP/over-dispatch/~75%。
- **③ 等级**：scheduler 作「手跑 prose 决策程序」🟢（真存在、重注友好）· 作「有机制兜底的调度器」🔴（无引擎执行、WIP/就绪即发/admission 全靠自律、`wip_limit` 无 hook 读）· 综合 🟡（偏 by-design 侧）。
- **④ adversarial 断点**：**唯一机制兜底（verify-board Stop）只防「欠调度 idle」，完全不防「过调度顶满」**。第 18h 疲劳态一次 fan-out 12 个 sub-agent（远超 `wip_limit:4`）→ 无 hook 拦（看到一堆 in_flight 反而放行）→ synchronization cliff + 一次烧穿 5h 配额窗（Graham anomaly）。镜头 4「不空等」有 Stop hook 当牙齿，**镜头 5「不顶满」一颗牙齿都没有**。
- **⑤ 严重度 + 处置**：**中**。**推荐**：Track B benchmark 加第 5 条断言「**不过调度**」——transcript 里同时 in_flight 的 worker 数不超 `wip_limit`、无巨型一次性 fan-out（把「顶满」拉进定量守护，不碰 waist）。次选：verify-board 加 in_flight 计数软提示（但会把 `wip_limit` 升回 hook-dependent = 动 waist 红线 2，须先 pressure baseline 验证 agent 真会顶满）。
- **⑥ gap vs 设计意图**：scheduler=prose 而非引擎 = **设计意图**（红线 4 主线亲手跑 scheduler 正是协调动作 + dispatch.md:44-48「no compile-time script can express it」+ 红线 5 + Iron Law）；**真 gap** = **单侧兜底非对称**：既然已为镜头 4 装机制（verify-board 拦 idle），镜头 5 的对称兜底（哪怕只 Track B 一条断言）为何缺席——Finding #9 把 `wip_limit` 矛盾收敛成「统一 flexible」却没追问「那谁来强制」（答案：没人）。**与 C1/C2 重叠**：并行机制本身归 C1、配额感知归 C2，本卡只取「资源约束下把调度编排到效率最大化」的 scheduler 落地真实性，不双算。

### C6 — 根据复杂度 / 难度 / 所需时长选择合适的模型

- **① 愿景断言**（`README.md:26`「by complexity, difficulty, and expected duration」）：每个节点按复杂度/难度/预计时长选恰当档位模型。
- **② 落地 trace**：`agent(prompt,{model})` 是真 lever（`authoring-workflows/references/api-reference.md:23`，进 cache-key），`assets/examples/staged-escalation.js:7,18` 真跑 cheap→Opus escalate 🟢；选档规则 `cost-and-pacing.md:24-58`（4 档 + 相对成本 + 按 difficulty 选）+ lens 2（`SKILL.md:38-41`）+ `decomposition.md:52-57`（per-node 的 model 维）；board 每 task **无 model 字段**、`model` 不在 pinned waist 也不在 flexible 枚举（grep hooks/=0、tests/=0）。
- **③ 等级**：设模型 lever 🟢（真能 per-leaf 设）· 「按难度选对档」🟡（纯 prose 判断、零核对：无人验机械活真给了 Haiku、board 不存选的 model 故超支无审计痕迹）· **「预计时长」维 🔴（愿景有、选档规则从不以 duration 为输入，grep 0 命中）** · 主线固定模型保 cache 🟡（劝阻型 prose，无门控阻止主线敲 `/model`）。
- **④ adversarial 断点**：无强制下疲劳态「12 个 leaf 全用主线同款 Opus 一把梭」→ 8 个机械活白烧 ~5× 成本，board 不记每节点 model 故超支事后都无迹可查；中途切主线模型省钱反而废掉 prompt cache + reinject 前缀；duration 盲区（难度低但跑很久的批量机械活按 difficulty-only 规则派 Haiku，超长 duration 的配额冲击无人评估）。
- **⑤ 严重度 + 处置**：**低（设计意图主导）+ 一处真 gap（中）**。lever 🟢 无需动；选档=prose 维持现状（至多 cost-and-pacing.md 补一句「board 可选记 leaf model 进 flexible-edges 供事后审计」，不动 waist）；**duration 维缺失（🔴）= 真 gap**：要么把 duration 接进选档规则（长时机械活的配额权衡），要么修 README/spec 措辞使其与落地一致（删/降级「expected duration」）——二选一消除张力。
- **⑥ gap vs 设计意图**：「选型=prose 无强制」= **设计意图**（`cost-and-pacing.md:3-13` 自述「informational, not a red line」+ pressure baseline model-tiering×6 零失败 + §6 Iron Law）；**真 gap** = ③ 的 🔴 duration 维——不是「选型该不该 prose」，而是**愿景断言（README:26「expected duration」）在落地选档规则里完全没有对应物**，且 README:28 的粗粒度免责声明没具体点出 duration 缺失。**与 C2 重叠**：pacing/配额窗口归 C2，C6 只认 model tiers + per-node 选档 + `agent({model})` lever。

---

## 排序的设计讨论清单（按严重度 × 性价比）

> 「廉价护栏」= 纯 bash / 不动 narrow waist / 不破红线，是高杠杆低成本的先做项。

1. **C5 过调度无兜底**〔中，**廉价护栏·首推**〕→ Track B 加第 5 条断言「不过调度」（in_flight ≤ wip_limit、无巨型 fan-out）。不碰 waist，补上唯一机制兜底的非对称。
2. **C3 HITL 对称缺口**〔中，**廉价护栏**〕→ `verify-board.sh` 完成态握手文案在存在 `blocked_on:"user"` 时列出其 title。纯 bash 只读 board。
3. **C4 supersession 无事务性**〔中-高，**廉价护栏 + 措辞**〕→ `status.md` 加 deps 图一致性 + 悬挂 stale 检测（read-only）；`status.md`「critical path」措辞标注「agent 心算」或带外 `scripts/` 真算 float。
4. **C2 传感器不被 loop 触发**〔中-高，**软 prose + 可选字段**〕→ 决策程序 reconcile 加软 sensing 节律提示（非红线）；board 加 agent-shaped budget 快照字段；Track B 加「长跑要 sense」断言。
5. **C6 duration 维缺失 + overclaim**〔低-中，**措辞校准 or 接维**〕→ 二选一：把 duration 接进 `cost-and-pacing.md` 选档规则，或修 `README`/`spec` 措辞去掉 overclaim。
6. **C1 board 完整性零机制保障**〔中-高，**最贵最慎**〕→ 候选 waist 字段 `done` 必带 `verified:true`+`artifact`（动 waist = 红线 2，须同 PR 改全部 hook + 测试 + ADR-003）；或显式接受为 ship-anywhere ceiling 并留痕。

> **若只做三件**：1 + 2 + 3 的廉价护栏——都不破红线、不动 waist、纯 bash/eval，却补上元模式里两类最危险的真 gap（非对称兜底 + 事务性无保障）。

---

## 怎么更新本文（持续追踪）

- **重审某能力**：对它重跑「穿全产品面追 trace（command/hook/skill/board/script）→ 判落地真实性 → 找 adversarial 断点 → 分 gap vs 设计意图」，刷新其卡 + 矩阵行 + `last-audited`。
- **gap 关闭**：更新对应卡的 ③⑤ + 翻矩阵「追踪状态」🔴 open → 🟢 closed（附关闭它的 PR/commit）+ 更 `last-audited`。
- **charter 变动**（`spec.md` §1.0 增删能力）：本文同步增删对应卡 + 矩阵行——charter 是 SSOT，本文是它的 gap 投影。
- **严重度/性价比变**：随实现演进重排「设计讨论清单」。
