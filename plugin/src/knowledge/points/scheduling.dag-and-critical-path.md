---
point: scheduling.dag-and-critical-path
---

## 权威陈述

<!-- ccm:k:start point:scheduling.dag-and-critical-path -->
当前增量是一张 **DAG**（节点 = 工作单元，边 = 依赖）。执行序合法与否由**拓扑排序（topological sort）**保证：一个节点只有在所有前驱都做完之后才 `ready`。这正是 dataflow「就绪即派」思想的图论根基——出度 > 1 的节点是 fork 点，入度 > 1 的节点是 join 点。

- **每条依赖边都是债务**（「目标即依赖图」镜头的硬规则）：默认全并行，逐边举证——除非能指名一个被下游直接消费的具体上游产物（artifact / hash），否则删掉那条边。「先做 X 当安全网」「按这个顺序更稳妥」是顺序习惯，不是数据依赖。
- **拓扑序 + 临界路径不用你手算**——交给 ccm 的 OR 引擎（§3）。你只消费它的输出、做排期判断。

---

## 2. 临界路径与 float —— 概念（为什么这么排）

CPM（Kelley & Walker, 1959）用确定性时长找出「决定这一片最短完成时间的那条任务链」——**临界路径（critical path）**。临界路径上的任务 **float / slack = 0**：这里的任何延迟都会直接顺延整片增量。

- **临界路径** —— 最长的那条依赖链；它的长度 = 这片增量压不掉的最短工期。
- **Total float** —— 一个任务能滑多久而不顺延整片增量。
- **Free float** —— 它能滑多久而不顺延它的直接后继。
- **ES/EF/LS/LF** —— 最早 / 最晚开始 / 完成；`float = LS − ES`。这些量由前向 / 后向两趟遍历得出——**遍历本身交给引擎跑，你只读结果**。

**核心可操作主张**：只有压缩**临界路径上**的任务才能缩短这片的总时长；压缩非临界任务纯属白费力气。一个非临界任务的 **float 就是你「白赚」的并行 / overlap 预算**——拿它来填满等待窗口。

**agent 任务时长天生不确定**——倾向 **PERT 心态**（留 buffer），别把单点估时当承诺。这也是为什么排期只排当前增量：越远的节点估时越不可信。

**资源决策 —— 把最强资源压临界链**：临界路径上的**难实现**用强模型 + 双 reviewer + 你紧盯；高 float 任务配便宜资源、塞进空隙里跑。这里的「资源」含每节点的**模型档位（model tier）**——各 host 的 family×effort / 相对成本、配额充足与紧张时的选档、以及为何*主线*绝不切模型，全在 `pacing-and-estimation` 的 model-tiers；本文只给「把稀缺档位压临界链」这条排期判断，**不复述档位语义**。

---

## 3. 用 `ccm board graph` 机器算（主力路径）

排期所需的结构量——拓扑序 / 临界路径 / makespan / 并行度 / ready-set——**一律问 ccm 的 OR 引擎，别手算**。ccm 引擎是图核心的唯一 SSOT，与 board-lint 同一份图、口径字节对齐；你经 `ccm board graph`（命令怎么敲见 {{CCM_COMMAND_CATALOG_POINTER}} 中 `board graph` 条目）读它，**纯只读、绝不回写 board**。

`ccm board graph --json` 一次给全（字段形状见 D，勿在此复抄以免 stale）：

| 字段 | 排期时拿它做什么 |
|---|---|
| `topoOrder` / `cycle` | 合法执行序；`cycle` 非空 = deps 成环、先解环再排（CPM 在环上未定义） |
| `readySet` | deps 全 `done` 的可派集——与决策程序 q_ready 同口径 |
| `criticalPath` `{chain, makespan, weight_source}` | 这片的临界链 + 工期。`weight_source` 是**诚实闸**（见下） |
| `parallelism` `{T1, Tinf, parallelism}` | 值得开几条道（§4） |
| `impact` `{<id>:{count,descendants}}` | 哪个节点卡住连累最多下游——决「先派哪个最解锁」 |
| `rollup` `{owners, inconsistencies}` | owner 容器进度 + 「owner 标 done 但有子未 done」不一致清单 |

**`weight_source` 诚实性（最要紧的一条）**——CPM 要节点时长，而 board 三个时间锚（`created_at` / `started_at` / `finished_at`）是柔性可缺的，故每个 CPM 结果带一个 `weight_source`：

- **`measured`**（全节点有实测时长）→ 报临界链 **+ 小时级 makespan / float**。这才是机器算真比心算强的态：给得出心算给不出的小时数。
- **`mixed` / `unit`**（部分 / 全部节点缺时长）→ **只报临界链结构 + 节点数，不报小时级 float / makespan**。补全时间锚后才升级。**别把 unit 态吐的节点数当小时数汇报**——那比心算更误导（伪精确）。
- **`cycle`**（deps 有环）→ CPM 未定义，先解环。

**时间输入从哪来**——`criticalPath.makespan` 要 measured 才有小时数；要**预测**这片的 ETA / 查进度偏差，用 `ccm estimate`（ETA / 临界路径 / EVM / 风险）+ `ccm baseline`（EVM 计划基线）。**这两者的输出怎么读、forecast / EVM / confidence / 风险该不该信、coverage 低时怎么降低信任——全归 `pacing-and-estimation`，本文不复述**；本文只说：把 estimate 的 ETA / risk 当排期的时间输入，靠数据排程、不靠手感。

**★何时机器算 vs 何时心算够用（判据锚在拓扑复杂度）**：

- **该机器算**——拓扑非平凡、心算开始出错时：非平凡交错 fork/join（钻石依赖、多源多汇）心算追不准哪条链最长；要定位 bottleneck（读 `impact`）；节点带 measured 时间锚要真 makespan；resume 接手一块陌生复杂板 / compaction 后重认领——`ccm board graph` 一把扫出临界链 + ready + WIP，比逐 task 心算重建快且不漏。
- **心算够用**——拓扑平凡时：小图 / 单链 / 浅依赖临界链一眼可见；只需粗判 fan-out 值不值（`parallelism` 明显 ≈1 或 ≫1）。**在平凡图上仪式性跑一遍 CLI 是 busywork**（不解锁依赖、不降风险、不产 artifact、不验假设——过不了 fill-work 准入测试·违「主观能动」镜头），别为「显得严谨」而跑。

判据本质：`ccm board graph` 是心算的**廉价升级**（零 token、只读、秒级），触发条件是拓扑复杂度——图复杂到心算会估错时升级机器算，图平凡到一眼看穿时心算够用、跑 CLI 反成镀金。两侧都是错。

**它不是 gate**——「图坏」（缺窄腰 / dep 悬挂 / 成环）时图分析仍只分析 + 报告；合法性闸是 `ccm board lint`（见 `board.md` 的 board lint 段）。owner rollup **一致性这道 gate 仍由 hook 强制**（verify-board Stop 软提醒 + board-lint 的 `GRAPH-ROLLUP` warn），graph 的 `rollup` 只把同一份事实摆给你看当 advisory。

---

<!-- ccm:k:end point:scheduling.dag-and-critical-path -->
