# 排期 —— 当前增量的依赖 DAG 怎么排

> **何时读：** 拿到一张**已切好**的 DAG 要给它排期时——临界路径 / float / 并行度是什么、为何把资源压临界链、粒度与每节点契约。**「怎么把目标切成这张 DAG」不在这里**（纵切薄增量 / walking skeleton / 粒度品味）——那是 `slicing-goals-into-dags`：**切先于排**。
>
> **口径：滚动式（rolling-wave）/ 敏捷——只排当前增量。** 本文的临界路径 / float / makespan 一律**只作用于当前这一薄增量的 DAG**，**绝不对整个长程目标做 upfront 的全量甘特 / makespan**。原因是三层脊椎的必然：顶层是敏捷的流（薄增量一片片上岸、下一片才切细）、片内工序有序、任务内再迭代——远处的增量此刻既没切细、估时也不可信，对它跑 CPM 只会产出伪精确的假 makespan。你排的永远是**手上这一片**：它内部的哪条链最长、哪些节点有 float、该开几条道。整场目标的进度靠 cadence 一片片推、靠 `ccm estimate` 的 forecast 滚动更新，不靠一张一次算死的总图。

把当前增量变成一张排好程的依赖图：它已被切成任务节点、连好依赖边，你要做的是——算出这一片的临界路径、判断值得开几条道、在派发每个节点前给它一份契约。

---

## 1. 当前增量 = 一张 DAG —— 拓扑序是排期地基

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

**资源决策 —— 把最强资源压临界链**：临界路径上的**难实现**用强模型 + 双 reviewer + 你紧盯；高 float 任务配便宜资源、塞进空隙里跑。这里的「资源」含每节点的**模型档位（model tier）**——档位事实、四档相对成本、按难度选档、以及为何*主线*绝不切模型，全在 `pacing-and-estimation` 的 model-tiers；本文只给「把稀缺档位压临界链」这条排期判断，**不复述档位语义**。

---

## 3. 用 `ccm board graph` 机器算（主力路径）

排期所需的结构量——拓扑序 / 临界路径 / makespan / 并行度 / ready-set——**一律问 ccm 的 OR 引擎，别手算**。ccm 引擎是图核心的唯一 SSOT，与 board-lint 同一份图、口径字节对齐；你经 `ccm board graph`（命令怎么敲见 `using-ccm`·`command-catalog.md` 的 `board graph`）读它，**纯只读、绝不回写 board**。

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

**它不是 gate**——「图坏」（缺窄腰 / dep 悬挂 / 成环）时图分析仍只分析 + 报告；合法性闸是 `ccm board lint`（见 `board.md` 的 board lint 段）。owner rollup **一致性这道 gate 仍由 hook 强制**（verify-board Stop 软提醒 + board-lint R7d），graph 的 `rollup` 只把同一份事实摆给你看当 advisory。

---

## 4. 并行度 = T₁/T∞ —— 值得开几条道

work-span 模型量化并行到底值不值、天花板在哪（这些量由 `ccm board graph` 的 `parallelism` 直接给出，概念如下）：

- **Work T₁** = 单处理器上的总操作量（≈ 节点总数）。
- **Span / depth T∞** = 数据依赖逼出的最长串行链（即临界路径长度）。
- **并行度 = T₁/T∞** = 不限处理器数时可能达到的最大加速比——告诉你「这片增量的并行最多值得开几条道」：
  - 并行度 ≈ 1（一条长串行链）→ fan-out 毫无意义，**别浪费 agent 预算**，串行跑。
  - 并行度高 → 大胆 fan out。

**Brent 定理**（贪心调度界，Brent 1974）给期望锚点：`T_p ≤ T∞ + (T₁ − T∞)/p`。直觉：实际时间 ≈ 可并行部分摊到 p 个 worker 上 + 压不掉的临界路径。有 N 个任务、临界链长 t、开 p 条道时，期望 ≈ `t + (N−t)/p`——拿它掂量**再加一条道的边际价值**。

**Amdahl 的提醒**：你自己那部分串行综合工作（写 plan、验收、整合）就是串行分数 `s`——不 overlap 起来，再多并行 agent 也修不了总时间，这正是「别空等」为何要把你的综合与后台执行 overlap。**Graham 反常**是警告：调度对参数非单调——加处理器或缩短任务反而可能*拉长* makespan——永远别想当然「worker 越多 = 越快」。

---

## 5. 粒度权衡

把当前增量里每个节点的大小定对：

- **太细** → 协调爆炸（派发、追踪、对账的开销超过节点本身的工作量）。
- **太粗** → 既没法并行、也没法在端点验收（一个节点大到把本该分成独立道的子工作捆在一起，或不透明到你无法独立检查它）。

挑一个粒度，让每个节点都是一个**可独立派发、可独立验证**的工作单元。（切分时的粒度品味——纵切薄增量为并行与验收而定——是 E 的活；这里只讲排期视角的「太细 / 太粗」两侧代价。）

一个大粒度节点*内部*本身就是个复杂规划问题时，让它用**被编排项目自己约定的** planning 层（执行者去发现并遵循那个项目的规范）+ 维护该项目约定位置的计划文档——见 `multi-layer-planning.md`。

---

## 6. 每节点契约 —— 派发前定义

派发一个节点之前，先定义它的契约：

- **Input deps** —— pin 住每条依赖喂进来的上游产物（version / hash）。依赖 pinning 与 stale 检测见 `resume-verify.md`。
- **Output schema** —— 按下游的需要来塑形：`verdict` · `evidence` · `confidence` · `blockers` · `open-q`（open questions）· `artifacts`。
- **Success predicate** —— 该节点算 done 的显式条件。
- **Timeout + budget** —— 该节点的时间 / token 上限。
- **Escalation condition** —— 该节点何时应当 STOP 并返回一个 escalation 结果，而不是硬撑下去（见 `dispatch.md` 的 re-altitude）。

没有契约的节点无法被安全派发、无法在端点验证、也无法从一个 content hash 续跑。

> **字段怎么落进 board**（`acceptance` / `estimate` / `deps` / `executor` 怎么写、撞哪条校验规则）见 `using-ccm` 的 `board-model-guide.md`——本文只给排期判断，不教 ccm 命令与字段取值。
