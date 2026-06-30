# cc-master 产品功能手册（Feature Manual）

> **这是 cc-master 全部机制 / 功能点的单一真相源（SSOT），当产品手册持续维护。** 任何新增 / 改动功能，**同步更新本手册**（含状态标记）。README 是本手册面向用户的营销提炼，不是它的替代；二者分工——手册求**穷尽 + 诚实**，README 求**放大 + 上头**。
>
> 维护纪律：① 每加一个 ccm verb / hook / skill / command，在对应章节补一行 + 标状态；② 状态变迁（📐→🔨→✅）就地更新；③ 诚实优先——拿不准就标低一档，绝不把设计中的冒充已落地。
>
> 末次全量同步：2026-06-30（基于 `board-v2-redesign` worktree，版本 0.10.0；对齐 skill 版图 7 个〔退役 C·新增 H〕/ 7 hook / `ccm` 12 namespace·52 handler / 48 条 lint 规则 / 成本轴偿付力仪表 ✅ / ADR-017 协调感知层 ✅ / ADR-018 标签首批迁入）。

---

## 0. 一句话：cc-master 是什么

cc-master 把任意一个 Claude Code 会话，变成一个能把跨度 >24 小时的大目标**自驱推到「真正完成」**的长程总指挥（master orchestrator）——它拆解目标、并行派发、控制烧钱速度、跨 context compaction 与 session 存活，只在真该人拍板时才回头问你。

它已从「一个薄编排插件」长成**三体**：

1. **插件（薄编排层）**——commands + 7 个 skill + hooks + 一份 board 文件，让*主会话 agent 本身*化身指挥。
2. **`ccm` 独立引擎**——把编排状态变成可计算对象的运筹学 / ML 估算 / 配速大脑（独立安装的 CLI，经进程边界消费）。
3. **号池 / 多线程资源经济学**——把多个账号的配额当一个可调度的能量储备池来用。

贯穿的升级方向：把 master orchestrator 从「会拆活、会派发」推向「**像 CFO + 项目经理 + 投资组合经理，在时间和成本双重约束下做受限优化**」。引擎是仪表盘（测时间×成本两轴），orchestrator 是做决策的那个 CFO。

---

## 1. 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | **已落地**——已提交进 0.10.0（或更早），有实现代码 + 测试 |
| 🔨 | **开发中**——已有实现代码但未提交 / 未完整收口（本分支增量或 Accepted-实现中） |
| 📐 | **仅设计**——设计文档 / ADR 草案在册，尚无实现代码 |

> 诚实纪律：手册全程区分这三态。一个能力的「满血形态」若依赖主机预装 `ccm`，单独注明（ADR-014 的代价）。

---

## 2. 总指挥的大脑——7 个分发 Skill（A、B、D–H）+ 决策程序

skill 是按需调阅的深度手册，各自自洽、互不重叠。A 给指挥本身、B/D/E/H 给指挥的不同决策面、F/G 给**被派去干活的执行 agent**。**全部 ✅已落地**（0.10.0；A/B 老牌、D/E/F/G/H 为 0.10.0 新增；**原 SKILL C `account-management` 已退役**——换号机制迁入 ccm `account` 引擎、操作面归 D、配速归 H·ADR-019）。

| Skill | 给谁 | 一句能力 | 对用户的价值 |
|---|---|---|---|
| **A. orchestrating-to-completion** | 指挥（魂） | 七镜头 + 红线 + 合理化对照表 + 决策程序，`SessionStart` 每次 compaction 后整篇重注 | 让 AI 真像个靠谱项目总监跨天扛目标：自己拆活、并行派、卡住主动问、不越权替你做不可逆的事、失忆后还记得自己是谁 |
| **B. authoring-workflows** | 指挥 | 写 / 调试 dynamic-workflow 脚本（fan-out / pipeline / loop + 反过度工程护栏） | 任务真大时（批处理几百文件 / 多 agent 评审），用可恢复的确定性并行流水线跑，而非把中间垃圾塞爆对话 |
| **D. using-ccm** | 指挥 | `ccm` CLI 操作手册 + board 模型/字段/48 条校验规则速查（含号池 `account` 操作面） | 底层保证 AI 写"项目看板"时走一道带校验的关卡，不写脏、不自相矛盾；备号录入/换号也走这道操作面 |
| **E. slicing-goals-into-dags** | 指挥 | 把目标**切**成 DAG 的道与品味（纵切薄端到端增量 / walking skeleton / 按价值×风险排序） | AI 不会闷头打半月地基才给你看东西，而是尽早交付能用的薄切片、最大化并行 |
| **F. dev-as-ml-loop** | 执行 agent | 把开发当 ML 优化过程（验收=目标函数 / 测试=梯度 / 钻牛角尖→restart / 收敛即停） | 干活的 AI 稳步逼近验收、不在死胡同无限打转烧钱、做完就停 |
| **G. engineering-with-craft** | 执行 agent | DDD/SDD/TDD/OOP 五条共享根 + 工程红线（no-silent-failure / spec 不漂移 / test-first） | 产出的代码经得起看——清晰领域模型、不偷吞错误、测试真测约束 |
| **H. pacing-and-estimation** | 指挥 | 消费 ccm 只读 advisory（usage/estimate/baseline）配速 + 估算（双侧走廊 verdict / 四档模型档 / 配额信号源链 / 估算诚实字段·**ccm 出 verdict、A 决策**） | AI 既不烧穿配额也不浪费额度、开工前就知道"几号能完"、风险早警——全靠算法盯着而非拍脑袋 |

**决策程序**（A 的牙齿）：一个七镜头的确定性 loop，既挡住*空转*（有活不派、干等）、又挡住*装忙*（造 busywork 镀金）——这是主线始终有用的根本机制。✅

---

## 3. 运行时脊柱——7 个 Hook + 武装闸

hook 是 cc-master 的牙齿。**全部 ✅已落地**（board-v2 已从 v1 的脆弱 awk 副本收敛为 6 个 node hook 共用 `hook-common.js` 武装地基 + 1 个 bash bootstrap；`hook-common.js` 本身是武装 SSOT 共享库、非 hook 入口）。

**横切：武装闸（dormant-until-armed）✅** ——每个 hook 在本 session 被 `/cc-master:as-master-orchestrator` 显式武装前完全休眠（空 stdout、RC 0、绝不 block）。武装是 board 派生的（home 里有 `owner.active:true` 且 `session_id` 匹配的板）。**用户价值：你平时正常写代码、跑别的任务时，这套 hook 全程隐身、零打扰，也绝不串台**（A 项目的指挥逻辑不会跑进 B 会话）。

| Hook | 触发 | 做什么（人话） | 用户价值（信息差） | 状态 |
|---|---|---|---|---|
| **bootstrap-board.sh** | UserPromptSubmit | 点火 / 武装动作本身：建板 + 盖 session_id + 注入"你是指挥"；第二形态 `--resume` 接管旧板（含复活归档板、live-safety 闸、legacy 自动迁移） | 一句话把普通会话变跨天指挥；换电脑 / 隔几天 / 会话崩过，`--resume` 一下从原地接着干 | ✅ |
| **reinject.js** | SessionStart（含 compact 后） | 魂重注：compaction 抹掉"我是谁"后，从外部重注角色 + board 路径 + 接着跑 | **这 AI 永远不会聊着聊着断片**——记忆不靠脑子、靠外部 board 续命 | ✅ |
| **verify-board.js**（goal-hook） | Stop | 不准假装做完：想停时对照原始 goal 强制自检（该问的问了吗 / 该做的做了吗 / 后台挂没挂），指纹去重 + 5 次保险丝 | **它不会假装做完了糊弄你**——没做完 / 没问你的，交代清楚才放停 | ✅ |
| **usage-pacing.js** | Stop | 双侧配速：调 `ccm usage advise` 拿走廊判决，注入**非阻断**提示（撞墙减速 / 欠用加速 / 7d≥85% 停派交用户） | **它替你盯账单**、双侧调速、有备号时知道"烧满了切下一份"而非傻等 | ✅ |
| **posttool-batch.js** | PostToolBatch | WIP 过载软警告：在飞数超健康水位 → 提示"这轮别再加并行"；sub-agent 内静默（红线4 不泄漏给 leaf） | **不会一口气铺太多并行活把自己和配额撑爆**，但从不强拦 | ✅ |
| **board-lint.js** | PostToolUse | 写板即校验：改了 board 就调 `ccm board lint` 注入"违了哪条 + 怎么修" | **写任务清单一犯结构错就当场被点出**，不带着烂"大脑"跑很远才发现 | ✅ |
| **identity-nudge.js** | Stop | 周期提示表 `[identity, critpath]`：① 默认 6h 重申"你是 master orchestrator"+ 漂离时重温 SKILL A；② 默认 2h 报临界路径进度 X/Y + ccm estimate on-track/behind（两条经 `ccm board set-param` 写回 `runtime.*`·写回成功才注入·advisory weak·ADR-020） | **长会话里 AI 不会忘了自己是跨天指挥、也被定期提醒"关键链走到哪了"**，温和不打断 | ✅ |

> 两点机制底色（README 该懂）：① **唯一能硬 block 的只有 verify-board（Stop 闸）**，其余 6 处都只软推、绝不阻断——"指挥不演奏 / 引擎不替它思考"红线在 hook 层的落点。② **ADR-018 标签化注入协议（`<ambient>`/`<advisory>`/`<directive>`）已首批迁入 hook 代码**——`hook-common.js` 出 `ambient()/advisory()/directive()` 包装器（closed set·`source` 必填·`strength` 只给 advisory），bootstrap-board.sh（`<directive>`）/ verify-board.js（`<directive>`+`<advisory>`）/ usage-pacing.js（`<ambient>`+`<advisory>`）/ identity-nudge.js（`<advisory>`）/ posttool-batch.js 已照办，剩余 hook 渐进迁移。✅首批 / 🔨剩余

---

## 4. board 引擎——`ccm`（12 namespace · 52 handler）

`ccm` 是把编排状态变成可计算对象的引擎：board 是一个 JSON 文件（DAG + 审计流），`ccm` 是它唯一的读写关卡 + 一套运筹学/统计算法层。**「神奇」在于：本来要项目经理 + Excel + 几小时手算的东西，变成一条命令、几十毫秒、可复现的输出。**

### 4.1 board / task / log —— 状态机与图分析

| verb | 做什么 | 用户价值 | 状态 |
|---|---|---|---|
| `board show` | 整板摘要（目标 / owner / 状态计数 / lint） | 一眼看清全局 | ✅ |
| `board lint` | **48 条规则**（32 FMT + 7 GRAPH + 9 BIZ）体检整板，硬错退 3 | 写错当场拦、不埋雷 | ✅ |
| `board graph` | 拓扑排序 + 环检测 + readySet + 临界路径 + makespan | "谁挡谁、关键链哪条"从脑算变机算 | ✅ |
| `board critical-path` | 单列临界路径 + 总工期 + 时长来源档 | 抓主要矛盾，盯它就够 | ✅ |
| `board next` | 算此刻可立即派发的 readySet | 每个等待窗口"现在能干啥"机器给答案 | ✅ |
| `board init` / `board update` | 建空板 / 改板级配置（目标、WIP 上限、git） | 起新棋 / 调全局旋钮 | ✅ |
| `task add/show/list/update` | 任务节点增删改查（写入即校验、可过滤） | 每件活有归属、依赖、验收口径 | ✅ |
| `task start/done/block/set-status/rm` | 状态机转移（start 盖 started_at / done 盖 finished_at + 可 `--verified` / block 阻塞在 user 时**强制带 decision_package**） | "完成"是有证据的完成；被问时拿到"有备而来的采访" | ✅ |
| `log add/list` | 只增审计流（8 类、不改不删） | 跨 compaction 后仍能复盘"当初为啥这么决" | ✅ |

> 8 状态枚举：`ready / in_flight / blocked / done / escalated / failed / stale / uncertain`（`verified` 与 status 正交）。背后 `board-graph-core.ts` 是 CPM/float/拓扑/环检测的单一真相源（hook/CLI/webview 共用一份，杜绝三处漂移）。

### 4.2 jc / cadence / watchdog / baseline / policy / peers —— 治理 / 节奏 / 协调感知

| verb | 做什么 | 用户价值 | 状态 |
|---|---|---|---|
| `jc add/list/show/resolve` | 自主决策诚实台账（做了啥 / 为什么 / 反转代价 + 复盘维持或推翻） | **事后能审计"哪些是 AI 自己决的、对不对"** | ✅ |
| `cadence update/open/ship/status` | 出货节奏（每隔多久出货 + 迭代成员**全 done+verified 才放行**） | **不会闷头干 3 天才出东西**，稳定小步交付 | ✅ |
| `watchdog arm/disarm/status` | 自我唤醒看门狗（到点叫醒查岗 + 降级链 cron/loop/monitor/shell·ADR-011） | 后台任务挂了**不会无人发现地烂在那** | ✅ |
| `baseline snapshot/show/reset` | EVM 计划基线（冻结快照立"军令状"，re-baseline 旧承诺留痕·ADR-015） | 进度偏差对着原始承诺算，不许偷改基准糊弄 | ✅ |
| `policy show/set` | 板级自主权限闸（`autonomous_account_switch` allow/deny，非交互须 `--user-authorized`·ADR-016） | **AI 的自主权是用户授予、可收回的**，授权动作留审计 | ✅ |
| `peers list` | 跨板只读花名册——枚举 home 里其它 active board 的 goal/owner/优先级（多-orchestrator 协调**感知层**·ADR-017·配 board `coordination` ✎ 块 + BIZ 校验） | **多个指挥共享号池时互相看得见**，为协调让路打底（智能协调层仍设计中·见 §8） | ✅ |

### 4.3 usage —— 配额感知 / 配速（只读 advisory，红线3：出数据不替决策）

| verb | 做什么 | 用户价值 | 状态 |
|---|---|---|---|
| `usage show` | 当前号 + 全部备号的 5h/7d 已用% + reset 时刻 | 一眼看清号池里每个号还剩多少、几点回血 | ✅ |
| `usage advise` | 双侧走廊判决（throttle / accelerate / hold / hard_stop）+ 推荐 lever + 候选换号 | **既不烧穿配额、也不白白浪费**——速度被算法盯着 | ✅ |
| `usage task-cost` | 单/聚合任务烧了多少 token（按任务/执行者/类型/档位聚合） | 成本归因到具体任务类型 | ✅ |
| `usage burn-rate` | 配额%燃烧速率（Δ已用%/Δ时间，5h+7d 双窗口） | **像看油表指针的转速**，不只看剩多少 | ✅ |
| `usage runway` | 配额续航（剩余走廊 ÷ burn → 距触顶 vs 距 reset） | **"还能撑多久"实时算给你**，触顶前预警 | ✅ |

> 背后：`usage/pacing.ts`（双侧走廊数学 + effective-N 号池倍速换算）、`usage/solvency.ts`（✅ `pctBurnRate`/`pctRunway`/`tokenWeightedShares`）、`usage/history-loader.ts`（跨板历史语料）。核心纪律：**配额% 是唯一权威账本**（捕获全体消费含主线前台 + cache），token 只当辅助权重。

### 4.4 estimate —— 工期/进度/成本预测（只读 advisory，ADR-015 OR/ML 引擎）

**p95 是 5% 硬墙，永不算到 100%**（真上限是 session hard-stop）。每个预测 = 点估 + 诚实区间 + `confidence`/`as_of`/`coverage_pct` 字段。

| verb | 做什么 | 用户价值 | 状态 |
|---|---|---|---|
| `estimate show` | 估时 + 历史校准（学你一贯乐观偏差 ×1.38 之类）+ 置信区间 | **估值不再一厢情愿**，被历史校正过 | ✅ |
| `estimate forecast` | 双通道 Monte Carlo（各跑 2000 次）→ P50/P80/P95 完成时间 + 敏感度 | **开工前就知道"50% 周三完、95% 周五完"**，哪个环节最危险一目了然 | ✅ |
| `estimate evm` | 挣值管理 + Earned Schedule（CPI / SPI(t) / EAC） | **进度健康度有体检报告**，不靠感觉 | ✅ |
| `estimate velocity` | 历史吞吐 + 燃尽/燃起图 + 服务水平期望 SLE | 团队/AI 的真实速度有数据画像 | ✅ |
| `estimate risk` | 风险盘（CI/CRI/SSI + WIP 老化 + CCPM 缓冲健康度） | **风险早警**——卡太久的活自动标红 | ✅ |
| `estimate cost-to-complete` | 配额%口径"还要花多少"（剩余工作 × 每单位%增量·吞吐-MC） | 结合 runway 知道**"剩余预算够不够干完"** | ✅ |

> 背后算法（全部 **0 新依赖、纯手写 ~315 行 TS**，方法选型过"轻量/确定性 seeded/无训练设施/小数据/ship-anywhere"滤）：`calibration.ts`（EWMA+贝叶斯收缩≅RCF）/ `conformal.ts`（split+Mondrian conformal）/ `mc-scheduler.ts`（双通道 MC + ✅ `pctCostToCompleteMonteCarlo`）/ `evm.ts` / `ccpm.ts`（fever chart）/ `knn.ts`（案例推理）/ `rcpsp.ts`（资源受限调度）/ `sle.ts` / `prng.ts`（seeded sfc32·绝不用 Math.random）。重型 ML（GBM/transformer/LLM/MCMC/GNN）逐条排除。

### 4.5 CLI 引擎机制（为什么能信它）✅

- **registry 是命令面单一真相源**：每个 `(noun,verb)` 一条 spec，同喂 router + help + 反漂移门。
- **退出码契约**：`0` OK / `1` ERROR / `2` 用法错 / `3` 校验失败 / `4` 锁占用 / `5` 板未找到。
- **并发写保护**：board 唯一写入关卡是 CLI，多写者经轻量 advisory 文件锁（O_EXCL + 30s stale 偷锁）串行化，防 torn-write，不引守护进程。
- **数据模型三档**（ADR-013）：🔒 load-bearing（红线2 保护、hook 依赖）/ 👁 observed（有则用缺则降级）/ ✎ flexible（agent 自由 + 未知字段静默）+ `--set` 逃生口。
- **每个读命令有 `--json`**：人类摘要 vs 机器结构化双形态。
- **分发形态：per-OS Node SEA 单二进制**（ADR-014）——独立安装、自包含、零运行时依赖；plugin 经进程边界 shell 调，绝不 import 引擎。`@ccm/engine` 同时供 webview（同一份图算法，杜绝漂移）。

---

## 5. 命令——6 个分发 Command（+ `ccm account` CLI·非 slash command）（全部 ✅已落地）

| 命令 | 做什么 | 用户价值（信息差） |
|---|---|---|
| `/cc-master:as-master-orchestrator <goal> \| --resume [选择器]` | 唯一的"开始"按钮：把当前 session 点火成指挥（fresh 拆新目标 / resume 接管旧板） | 敲一句目标，普通会话变跨天指挥；`--resume` 跨 session/重启接着干 |
| `/cc-master:status` | 只读文字简报（目标/进度/分组任务/临界路径/健康检查/预算快照） | 终端里一眼看清"干到哪、卡哪、等不等我、配额剩多少"，像看晨会简报 |
| `/cc-master:view` | 本地 webview 渲 board DAG（xyflow 图，2s 活轮询、只读、零联网） | **浏览器里实时看 AI 在干嘛，像盯一块活的项目看板** |
| `/cc-master:discuss <node-id>` | 独立满血新 session 对一个待决策节点开"采访式讨论"（载 decision_package + 时效校验 + 写回 sidecar） | 另开窗口跟"有备而来、读过全部上下文"的助手把决策谈透，**主线同时继续干不被打断** |
| `ccm account add/delete/refresh/list/switch`（CLI·用户直接敲） | 管换号号池备号 token（token-blind·全程活在 ccm 引擎子进程、不进 agent context）+ 无重启切号（switch·policy 硬闸 `deny`→exit 7） | 攒备用账号池的安全录入口；`list` 随时对账。概念叙事见 `using-ccm` 的 `references/account-pool.md`（旧 `/cc-master:accounts` 命令已退役·ADR-019） |
| `/cc-master:handoff-to-new-session` | 旧 session 优雅交接（quiesce→drain 验收→写叙事 handoff→归档板→给 `--resume` 命令） | 换新窗口接力**不丢进度、不留烂摊子** |
| `/cc-master:stop` | 归档板停用指挥（认板防停错 + 用户确认 + `owner.active:false`，**显式可逆非删除**） | 干净收工，所有后台 hook 安静，板留作审计、日后可复活 |

---

## 6. 资源经济学——把多个账号的配额当能量储备池

这是 cc-master 最差异化的一层（"会算账的 CFO"），由 pacing + 号池 + 成本轴 + 权限闸叠成。

- **双侧目标走廊（ADR-010）✅**：pacing 从"单边 ~75% 上限刹车"改成"**两侧都有边的目标走廊**"——5h reset 时落 ~70–90%，低于下沿=欠用（额度将永久蒸发，该加速）/ 高于上沿=逼近撞墙（该减速）。**7d 窗口当加速硬总闸**：7d≥85% 从"挡加速"收紧到"停派新节点"，把"是否续耗 7d 配额"作 `blocked_on:"user"` 交用户拍板。
- **无重启换号 + 号池序列储备（机制归 ccm `account` 引擎·操作面 SKILL D·配速 SKILL H·原 SKILL C 已退役·ADR-019·0.8.0 起）✅**：任一时刻全机器仅 1 个活跃账户，号池 N 个账户是序列储备；换号=覆写官方三存储 + 运行中 claude 惰性 re-read 接管（不重启进程、board 不归档）。effective-N 缩放：握 N 份配额时单 5h 窗要快 N 倍消耗才不浪费。**凭证写已加跨进程锁**（anchor 到机器全局，防并发换号交错损坏三存储）。
- **成本轴偿付力仪表（✅ 0.10.0）**：%-burn-rate（流速）/ %-runway（续航）/ %-cost-to-complete（还要花多少，回答"这目标装得下吗"）——见 §4.3/§4.4。
- **board.policy 自主权限闸（ADR-016）✅**：纵深防御（SKILL A 自律 + `switch-account.sh` 读 policy 硬闸 deny→拒+exit7+log），新板默认 allow，写命令"用户所有"+ "绝不自授权"红线。
- **诚实天花板**：账户信号给 `used_percentage` 但不给绝对 token 分母 / 不给权威 burn rate，故走廊只做**方向性区间调节，绝不承诺精确归零**。

---

## 7. 北极星——六能力 charter（C1–C6）

cc-master **致力于让** 任意会话 agent 化身指挥并具备六项能力。这是 **aspirational 北极星、非验收单**；诚实兑现状态本身是工程成熟度的体现。SSOT 在 `spec.md §1.0`，gap 审计在 `vision-landing-tracker.md`（last-audited 2026-06-30 对 C2/C4/C5/C6 做定点翻新，被 ADR-013/014/015/017 推进）。

| 能力 | 兑现 | 真 gap 一句话 |
|---|---|---|
| **C1** 异步并行多线程、完整落地 | 并行 ✅ + 完整闸 ✅(verify-board) | board 完整性零机制保障、靠 agent 自觉 |
| **C2** 控制消耗速度 | sensing ✅ · pacing 决策 ✅(引擎收口) | 原"传感器真但 loop 从不调它"**已闭**——usage-pacing.js 每轮调 `ccm usage advise`；余 budget 跨 compaction 持久化偏弱 |
| **C3** 自主 vs 人类边界 | 🔨(行为红线靠端点守) | Stop 闸不分"未答终审"与"等上游" |
| **C4** 分解/管理/更新/规划 | board ✅ · 分解方法 🔨 · 临界路径已机器算 | supersession/重规划无事务一致性 |
| **C5** 资源下最大化效率 | scheduler 🔨(手跑决策程序) · 过调度侧软兜底 ✅(posttool-batch/usage-pacing 采样) | 单侧兜底**已补过调度侧**（软警告·非硬拦），仍无引擎强制 WIP |
| **C6** 按复杂度/难度/**时长**选模型 | lever ✅ · 选档 🔨 · **duration 维已承载 ✅(ccm estimate forecast)** | duration 轴**已由 ccm estimate 接回**（P50/P80/P95+makespan），接进选档规则仍 prose |

---

## 8. 设计前沿——正在长成什么（in-flight / design-only）

这些是 0.10.0 **之后**的雄心方向。README 提它们时标"设计中"，不冒充已 ship。

| 方向 | 是什么 / 雄心 | 状态 |
|---|---|---|
| **资源/预算模型** | 把资源问题正式建成双变量受限优化（时间存量 × 成本流）；配额% 当唯一权威账本；引擎=forecaster、orchestrator=optimizer（CFO） | 📐 设计建模（待审 + 2 开放问题） |
| **多-orchestrator 协调·感知层（ADR-017）** | channel 已 ship：`ccm peers list`（`peers.list` handler + `engine/coordination/peers.ts`）跨板只读花名册 + 各板写自己的 `coordination` ✎ 块 + BIZ 校验 + ccm 跨板聚合——多个指挥共享号池时互相看得见 | ✅ 已 ship（0.10.0·CHANGELOG 收录） |
| **多-orchestrator 协调·智能协调层（ADR-017）** | M 个指挥共享号池配额；两层=AIMD 机械底座（收敛公平份额、抗震荡）+ **L-agentic 智能体推理层**（读 peer 的 goal 推理相对价值、主动礼让） | 📐 仅设计（AIMD + L-agentic 待建） |
| **Hook→Agent 标签协议（ADR-018）** | `<ambient>`/`<advisory strength>`/`<directive>` 三类 + P1–P6 作者纪律；"没有中性注入"；按 tag 分配注意力、可追溯 | 🔨 Accepted-rollout（作者侧已落 AGENTS §13；**hook 代码已首批迁入**——`hook-common.js` 包装器 + ≥4 hook 照办；读者侧 SKILL A 须先跑 pressure baseline；剩余 hook 渐进迁移） |
| **全局 home 多用途底物** | home 从 per-repo `.claude/cc-master/` 升级为**全局** `$CC_MASTER_HOME`（默认 `$HOME/.claude/cc-master/`·旧 per-repo board 自动迁入）下的多用途底物：`boards/`（数 active 板得并发数 M·舰队共享内存）+ 根放 `accounts.json` 号池 registry + decision sidecar + 跨板 ML 历史语料（估算冷启动）+ 预留 coordination 黑板 | 🔨/📐 混合（**全局 home 基础布局 + 旧 board 自动迁移 ✅（HOME-A·当前模型）**；跨板语料 ADR-015 实现中；协调 channel ADR-017 草稿） |
| **多账号 7d 负载均衡 + 主动换号** | 5h=流速 / 7d=存量；只撞 5h 墙才换→抽干单号 7d→失衡"无号可换"；按各号 5h/7d reset 异构做 DP、即使不撞墙也主动均衡 7d、数据算法驱动经 hook advisory 提示 | 📐 仅设计（新需求，dep 成本轴引擎；连 ADR-017 做完整账号池调度层） |
| **5 层 skill 栈（7→拟 10）** | 拟从 SKILL A 抽出 usage / estimation / pacing 三个消费层 skill，定位五层栈：L4 编排决策→L3 节奏控制→L2 信号解读→L1 命令机制→L0 计算引擎 | 📐 设计稿待审（抽 pacing 需动魂、走红线级 PR 人审） |
| **ccm 解耦为独立产品（ADR-014）** | board 引擎从"插件内 bash"演进为独立 `ccm` CLI（TS SSOT + per-OS SEA 二进制 + 工业化 monorepo + 自有 CI）；plugin 降为消费方之一；**未来基于同一引擎平行长出桌面 / web 客户端** | 🔨 地基已实现+端点验收，SEA/CI/文档收口为后续阶段 |

---

## 维护此手册

- 每个 PR 引入 / 改动功能 → 同步本手册对应行 + 状态标记（与 CHANGELOG 同拍）。
- 状态升级（📐→🔨→✅）就地改，别新开重复条目。
- 与权威源对齐：ccm 命令面以 `ccm/apps/cli/src/registry.ts` 为准；charter 以 `spec.md §1.0` 为准；各机制以对应 ADR 为准。本手册是**面向人的索引 + 状态总账**，不复述算法细节（那在引擎源码 + ADR）。
- README 是本手册的营销提炼——手册变了、README 该跟着重新提炼。
