# 报告 4：高效、异步、并行推进目标达成的原理、算法与方法论

**日期**：2026-06-05
**定位**：四份报告中的"工程与管理底层原理"层。报告 1 诊断出 Dynamic Workflow 机制在"主线程不空等"上的两块空白；本报告从软件工程、并行/并发计算、分布式系统、运筹学、项目管理五个学科，把"该怎么做"的成熟原理、算法、方法论系统蒸馏出来，**把"即兴"变成"有章法"**。
**与其余报告的关系**：报告 3（LLM-Compiler）是本报告"调度理论"在 LLM agent 上的具体学术实例；报告 2（社区实践）证实了本报告的核心命题——"主线程不空等"在生态里是空白，需自建。

**一句话主轴**：**你的 orchestrator 本质是一台 dataflow 机器 + critical-chain 调度器 + 内容寻址的增量构建系统**。把目标当成一张 DAG，沿 critical path 压缩 makespan，用 greedy/work-stealing 的「ready 就发」原则消除空转，用 WIP 上限避开 utilization cliff，用 content-addressable journaling 实现廉价 resume。

> **阅读提示**：每节末尾的 **【回扣 orchestrator】** 段把抽象理论映射到 Claude Code 主线程 + dynamic workflow 这个具体系统。最后一节「关键综合」是 payload——可直接编码进 orchestrator 行为的清单。

---

## 簇 1：调度理论与算法

### 1.1 DAG scheduling、topological sort、greedy scheduling

任何可分解的目标都是一张 **DAG**（节点 = 工作单元，边 = 依赖）。执行顺序的合法性由 **topological sort** 保证：只有所有前驱完成后，一个节点才 ready。这是 dataflow「dispatch when ready」思想的图论基础（见 §1.5）。

### 1.2 Critical Path Method (CPM) / PERT / slack(float)

- **CPM**（Kelley & Walker, 1959）用确定性工期，找出"决定项目最短完成时间的任务链"——即 **critical path**（关键路径上任务的 **float / slack = 0**，任何延迟直接延后整个项目）。
- 算法两遍扫：**forward pass** 求每个任务的 ES/EF（最早开始/结束），**backward pass** 求 LS/LF 与 **float = LS − ES**。
- **Total float**（不延后整个项目可拖延的量）vs **Free float**（不影响后继任务可拖延的量）是两个不同的松弛度，调度优先级不同。
- **PERT**（用三点估计 optimistic / most-likely / pessimistic 做概率工期）适用于工期不确定的场合；**CPM 用于工期已知**。对 AI orchestrator：agent 任务工期天然不确定 → 偏 PERT 心智（带 buffer，见 §5）。

**核心可操作 claim**：**只压缩 critical path 上的任务能缩短总工期；压缩非关键路径任务是浪费**。非关键任务的 float 是你"免费"的并行/重叠预算。

### 1.3 List scheduling 与 Graham's bound

Graham (1966) 给出最早的有界近似调度：贪心地把就绪任务派给空闲处理器，**makespan ≤ (2 − 1/m) × OPT**（m = 处理器数）。即使最朴素的贪心也只差最优一个小常数因子——**"ready 就立即派给空闲 worker"这个策略本身就近最优**。**Graham anomaly**（增加处理器/缩短任务反而延长 makespan）是警示：调度对参数非单调，不能想当然"加 worker 一定更快"。

### 1.4 work-span 模型：Amdahl、Gustafson、Brent

这是量化"值不值得并行、并行上限是多少"的核心框架。

- **Work T₁** = 单处理器总操作数；**Span / depth T∞** = 数据依赖造成的最长串行链（= critical path 长度）；**Parallelism = T₁/T∞**（任意处理器数下的最大可能 speedup）。
- **Brent's theorem / greedy scheduling bound**（Brent 1974）：**T_p ≤ T∞ + (T₁ − T∞)/p**，等价 **T₁/p ≤ T_p ≤ T₁/p + T∞**。直觉：**实际时间 ≈ 可并行部分摊到 p 个 worker 上 + 不可压缩的 critical path**。
- **Amdahl's Law**（固定问题规模，strong scaling）：speedup 上限由串行比例 s 钳死，**Speedup ≤ 1/s**——再多处理器也救不了串行瓶颈。
- **Gustafson's Law**（问题规模随资源增长，weak scaling）：串行部分不随规模增长 → speedup 可近线性。**乐观面**：当你能扩大"要做的工作量"而非固定它时，并行收益持续。

**两条 Law 的张力（标注争议点）**：Amdahl 说"悲观，串行卡死你"，Gustafson 说"乐观，放大问题就行"。二者不矛盾——**Amdahl 适用于"这个固定目标多快做完"，Gustafson 适用于"同样时间能做多大的目标"**。orchestrator 两种情形都会遇到。

### 1.5 dataflow「dispatch when ready」与 speculative execution

**Dataflow 架构**：指令不由 program counter 驱动，而由**数据 token 到齐即 fire**——监测操作数可用性、前提一满足就立即把操作分派到可用的计算资源。消除假依赖，允许激进/推测执行而不损害正确性。**Speculative execution**：在依赖未定时用推测值先算，基于推测输入的输出必须 hold 住、直到推测被证明正确才释放、错了就 withdraw。

**【回扣 orchestrator】**
- 把目标建成 dependency DAG，跑一次 topological sort + CPM，**算出 critical path**——这条链决定理论最短交付时间，是你最该盯死、最该投精力（用 opus、加 reviewer）的链。
- **T₁/T∞ = parallelism** 告诉你"这个目标最多值得开几路并行"。若 parallelism ≈ 1（一条长串行链），fan-out 没意义，别浪费 agent 配额；若 parallelism 高，大胆 fan-out。
- **Amdahl 提醒**：orchestrator 自己的串行综合工作（写 plan、verify、整合）是你的"串行比例 s"。这部分不优化，开再多并行 agent 也救不了总时间——所以 §6"不空转"要把这部分**和后台执行重叠**起来。
- **Brent bound** 给期望值锚点：N 个任务、critical path 长 t、p 路并行，期望 ≈ t + (N−t)/p。据此判断"再加一路 agent 的边际收益"。
- **Speculative prefetch**：当某下游任务的输入"八成会是 X"，可让 orchestrator 提前准备该分支（拉资料、起草 spec），错了就丢弃——这是 §6 不空转的一种形态。

---

## 簇 2：并行与并发编程模型

### 2.1 fork-join

父任务 fork 出多个子任务并行执行，在 join 点 **barrier** 等全部完成再继续。是结构化并行的基石（Cilk / Java ForkJoinPool 的核心）。与 CPM 的关系：fork 点 = DAG 出度 > 1，join 点 = 入度 > 1 的汇合。

### 2.2 MapReduce

Dean & Ghemawat (OSDI 2004)：用户只写 **map**（处理 k/v → 中间 k/v）和 **reduce**（合并同 key 的中间值），runtime 自动并行化、容错、调度机间通信。**精髓**：把"同构、无依赖的大批工作"交给框架自动 fan-out + 容错 + 汇总。Map 阶段是 embarrassingly parallel（barrier 后才 reduce）。

### 2.3 dataflow programming

程序 = 数据在算子间流动的图；算子在输入就绪时触发。见 §1.5。

### 2.4 futures/promises & async/await

一个 future 是"尚未完成计算的句柄"。`await` 在需要结果时才阻塞，**让你先发起多个异步操作、稍后再收集**。这是 orchestrator"先派活、不立即等"的语言级原语。

### 2.5 structured concurrency / nurseries（对 orchestrator 最直接）

Nathaniel J. Smith, *"Notes on structured concurrency, or: Go statement considered harmful"* (2018)：
- **黑盒规则**：除 goto 外，控制流"从顶部进 → 干事 → 从底部出"。应用到并发：**一个函数返回时，它 spawn 的所有后台任务都已结束，没有残留**。
- **裸 spawn（go statement）有害**：类比 goto——任何函数调用都可能 spawn 后台任务，不读全部源码（递归地）就不知道，破坏局部推理。
- **nursery 强制 join**：nursery 块不退出，直到块内所有任务退出；父任务先到块尾就在那等。
- **错误传播 + 取消 + 清理**：子任务抛异常 → 立即取消同 nursery 其它任务、等它们结束再重抛；nursery 让 `with` 块（资源清理）重新可靠工作。

### 2.6 actor model vs CSP

- **Actor model**（Hewitt 1973）：异步单向消息，actor 有身份、有 mailbox、拓扑动态变化，为分布式设计、可跨机扩展。
- **CSP**（Hoare 1978）：通过 **channel** 同步通信，进程匿名、拓扑固定、层级化并行组合。
- 选型：actor 更解耦、适合分布式；CSP 更适合固定拓扑的流水线。orchestrator 派 agent ≈ actor（异步消息、各有身份）；阶段间数据流 ≈ CSP channel。

### 2.7 pipeline parallelism、barrier、producer-consumer

- **Pipeline**：把工作切成 stage，不同 stage 对不同数据项并发执行（流水线满载后吞吐 ≈ 最慢 stage 的速率）。**与 fan-out 的关键区别**：pipeline 重叠不同阶段，fan-out 重复同一阶段。
- **Barrier synchronization**：所有参与者到齐才放行（fork-join 的 join、MapReduce 的 map→reduce 交界）。
- **Producer-consumer**：用有界缓冲解耦生产/消费速率（→ §2.9 backpressure）。

### 2.8 work-stealing schedulers（Cilk / Blumofe-Leiserson）

- **bound**：随机化 work-stealing 在 P 个处理器上 fully strict 计算的**期望运行时间 = T₁/P + O(T∞)**——至多是理论最小值的常数倍。**这是"调度近最优"的硬保证**。
- **为何优于 work-sharing**：所有处理器都有活时**零调度开销**——空闲者主动去偷，负载均衡时零迁移。
- **机制**：每个 worker 一个 **deque**；本地任务 push/pop **bottom**（LIFO，cache 友好），空闲 worker 随机挑受害者从其 deque **top** 偷（FIFO，偷大块）。

### 2.9 backpressure / reactive streams

- **Reactive Streams** 核心：管理跨异步边界的数据交换，**确保接收端不被迫缓冲任意大量数据**。
- **机制**：消费者 `request(n)` 告诉生产者最多发 n 个；**有界缓冲是强制的——无界队列会掩盖问题直到内存耗尽**。

**【回扣 orchestrator】**
- **每个 dynamic workflow 阶段当成一个 nursery**：派出的 agent 是 nursery 内的子任务，**阶段不结束直到所有子 agent join**；任一 agent 失败可触发同批取消 + 向上抛——这正是 orchestrator 想要的"批次语义"，避免"孤儿后台 agent"。项目记忆里的"null-review 静默放行已修""后台 agent 硬截止 60min"正是 structured concurrency 黑盒规则的具体落地：不让没 join 的子任务静默逃逸。
- **fan-out N-way ≈ MapReduce map 阶段**（同构无依赖任务，barrier 后 orchestrator 做 reduce = 整合）；**多阶段串行 ≈ pipeline**（设计→实现→review→verify，可对不同 task 流水线重叠）。
- **work-stealing 心智**：与其 orchestrator 事前把任务静态切给固定 agent，不如**保持一个就绪任务池，谁空了谁领下一个**——天然负载均衡、近最优。
- **backpressure**：orchestrator 是消费者（要 review/整合 agent 产出）。如果 fan-out 速度 > 你消化产出的速度，产出会堆积。**必须给并发设上界（见 §6 WIP）**，否则就是无界队列掩盖问题直到资源（context window / 配额）耗尽。

---

## 簇 3：分布式系统与可靠性

### 3.1 orchestration vs choreography

- **Orchestration**：中央协调者驱动流程顺序、触发补偿——可见性更清晰，代价是中心化。
- **Choreography**：各服务监听事件自主反应——适合事件驱动，但参与者增多后依赖难追踪。
- **你的系统明确是 orchestration**（master orchestrator = 中央协调者）——好处是可见性/可控性，代价是 orchestrator 自己可能成瓶颈（→ §6 不空转 + §5 别让约束闲置）。

### 3.2 saga pattern + 补偿

长事务拆成一串本地操作，每步配一个**补偿动作**，失败时反向补偿——以 ACID 严格性换可用性。orchestrator 跑多阶段时若中途失败，需要"补偿/回滚"语义（如撤回半成品 commit、清理 worktree）。

### 3.3 idempotency

每个消费消息的服务端点必须幂等——用唯一事务 ID（Saga ID）+ 处理前查本地 log。**resume/重试的前提**：重复执行同一步不能产生副作用翻倍。

### 3.4 speculative / hedged requests（"The Tail at Scale"）

Dean & Barroso (CACM 2013)：尾延迟在大规模系统里被放大——即便罕见的性能打嗝也会影响相当比例的请求。**Hedged requests**：先发一个请求，**超过该类请求 95th-percentile 延迟还没回**，就向第二个副本发同样请求，取先到的。实测：BigTable 读 1000 key、延迟 10ms 后发 hedge，**99.9th-percentile 从 1800ms 降到 74ms，仅多发 2% 请求**。代价：存在多个 server 不必要地执行同一请求的"脆弱窗口"。

### 3.5 checkpointing / memoization / content-addressable caching for resume

失败后从最近 checkpoint 恢复，而非从头重来。**Memoization**：缓存（输入→输出）映射，相同输入直接复用。**Content-addressable**：用内容 hash 当 key（见 §4 Bazel）——天然去重 + 完整性校验。

### 3.6 eventual consistency

副本最终一致但允许短暂不一致——换取可用性。orchestrator 视角：各 agent 的产出/journal 不必瞬时全局一致，**只要最终收敛**即可。

### 3.7 end-to-end argument（Saltzer-Reed-Clark 1984）

放在系统低层的功能，相对其在端点实现的代价，往往冗余或价值有限；许多功能只有靠端点应用的帮助才能完整且正确地实现。底层可做**性能优化版**，但**正确性的最终保证必须在端点**。

**【回扣 orchestrator】**
- **end-to-end argument 是你最重要的可靠性原则**：底层 agent 自报"quality gates 全绿"是不可信的性能优化（项目记忆"Agent 自报 gates 全绿不可信，5 次失实"）——**正确性的最终校验必须由 orchestrator 这个端点独立执行**（独立跑 gates、read diff）。这不是冗余，是 end-to-end 正确性的唯一可靠点。
- **idempotency + content-hash journaling = 廉价 resume**：每个 task 的 journal entry 用"（任务 spec + 输入）的 content hash"当 key，记录已完成步骤；compaction/中断后 orchestrator 比对 hash，已完成的跳过、未完成的续。**这正是项目记忆里 memoize/checkpoint 的诉求。**
- **hedged execution 用于 agent 的长尾**：某个 agent 卡住超过该类任务的 p95 时长（项目已有"codex hung 降级 defer""60min 硬截止"），就 hedge——派第二个 agent 做同一任务取先完成的，或降级放行。**这是"不空转"在可靠性维度的体现：不被单个慢 agent 拖死整批。**
- **saga 补偿**：多阶段 PR 流程中途失败，要有定义好的回滚（删 worktree、撤回 commit）——项目记忆里大量"post-merge cleanup 硬墙""worktree 路径自检"就是补偿动作的纪律化。

---

## 簇 4：构建系统 = 经典 DAG 执行引擎（journaling/resume 的最强类比）

这是你的 workflow journaling/resume 机制最直接、最成熟的参照系。

### 4.1 DAG-based incremental build

Make/Bazel/Ninja/Buck 都把构建建成 DAG（target = 节点，依赖 = 边）。Bazel 构造一张映射 build target 与其 inputs/outputs/tools/env/dependencies 关系的 DAG，把每个 build step 拆成细粒度 task。

### 4.2 content-addressable / hermetic caching（↔ content-hash journal）

- **CAS（Content-Addressable Store）**：每个文件的 key 是其内容的 hash（digest），保证数据完整性、防覆盖。
- **action key**：Bazel 检查某步的 action key 是否匹配此前执行过的；匹配则跳过重跑、复用缓存输出——**incremental build 的本质：只重算 action key 变了的节点**。
- **hermetic / deterministic build**：执行环境完全隔离；本机能过的 build，Bazel 保证在任何其它机器上都过，并产出 bit-for-bit 完全相同的产物。**determinism 是 cache 正确性的前提**：只有确定性的 action 才能安全复用缓存。

### 4.3 并行 job 调度（`-j`）+ remote execution

- `make -j N` / Bazel 自动并行无依赖的 action，并发度 = min(N, 可用并行度)。
- **remote execution**：action 在远端集群跑，并行度只受可用资源限制、不受本机约束——本地 orchestrator 只编排，重活外包。

**核心同构（payload 级类比）**：

| 构建系统概念 | orchestrator 对应物 |
|---|---|
| target DAG | 目标分解出的 task dependency DAG |
| action key = hash(inputs + command + env) | journal key = hash(task spec + 输入上下文) |
| CAS 复用缓存输出 | journal 命中即跳过已完成 task（resume） |
| hermetic / deterministic build | **determinism guard**：同一 spec 应产生等价产出，否则缓存不可信 |
| `make -j N` 并行 + remote execution | fan-out N 个 agent，重活外包给 sub-agent |
| 只重算 action key 变了的节点 | compaction/中断后只重跑"输入变了或没完成"的 task |

**【回扣 orchestrator】**
- **把 dynamic workflow 实现成"增量构建引擎"**：每个 task 算一个 content-hash（spec + 上游产出 + 关键上下文）。开跑前查 journal：hash 命中 → 跳过（复用已落盘的 PR/commit/产出）；未命中 → 执行并写 journal。**这让 compaction、会话中断、`/reload-plugins` 之后的 resume 变成 O(变更集) 而非 O(全部)**。
- **determinism guard 对应 hermetic build**：AI agent 非确定性是这套类比的最大裂缝（标注争议点）——同一 spec 跑两次可能不同。对策：**缓存的不是"重跑会一样"，而是"已落盘的产出 artifact（commit hash / PR）"**——一旦产出物存在且通过 end-to-end 校验（§3.7），就视为该节点已完成、不重跑。把"正确性校验"当作 cache 的 validation 步骤。
- **remote execution = 把实现/review 全部外包给 sub-agent**（项目红线：master orchestrator 不亲自上手 impl/review）。orchestrator 只做 DAG 编排 + 调度 + 端点校验，这正是 Bazel"本地编排、远端执行"的形态。

---

## 簇 5：运筹学与项目管理

### 5.1 Theory of Constraints (TOC) / 瓶颈思维

Goldratt：系统吞吐由**唯一瓶颈（约束）**决定——一条链的强度取决于最弱一环，流程吞吐取决于最慢一步。**五步聚焦法**：识别约束 → exploit（榨干约束）→ subordinate（其余服从约束节奏）→ elevate（扩容约束）→ 防惯性、回到第一步。

### 5.2 Critical Chain Project Management (CCPM)

Goldratt (*Critical Chain*, 1997)：CPM 的资源约束版。
- **critical chain** = 同时考虑任务依赖 **和资源争用** 的最长链。
- **去掉单任务安全余量、汇聚成共享 buffer**：三种 buffer——**Project Buffer**（保护交付日期）、**Feeding Buffer**（保护非关键链汇入关键链处）、**Resource Buffer**（确保关键链资源就位）。
- 任务估时砍到"完全专注、不被打断、无重大问题"的工期（约一半）。

### 5.3 student syndrome & Parkinson's law

- **Student syndrome**：拖到最后一刻才开始（吃掉 buffer 的前半）。
- **Parkinson's law**：工作会膨胀填满给定的时间——给多少时间就用多少。
- CCPM 用"紧工期 + 共享 buffer"对治：不给单任务藏余量的空间。

### 5.4 Lean / WIP limits / Kanban

- **WIP limits**：限制每个阶段同时进行的工作项数，逼团队聚焦"完成"而非"开新活"，从 resource-efficiency 文化转向 flow-efficiency 文化。
- **pull system**：下游有空才拉上游的活，避免堆积队列。
- WIP 上限让瓶颈可见，团队"围着阻塞项 swarm"。

### 5.5 Little's Law + 排队论 + utilization cliff（核心定量工具）

- **Little's Law**：**L = λW**（系统内平均工作量 = 到达率 × 平均停留时间）——把延迟与吞吐换算成并发。WIP 上限 → 直接钳制平均完成时间。
- **utilization cliff（utilization knee）**：利用率趋近 100% 时，队列超线性增长、尾延迟飙升；利用率 > 75% 就有 latency spike 风险。M/M/1 的响应时间随利用率 ρ 按 **1/(1−ρ)** 爆炸。
- **致命反直觉**：把资源利用率推到 100% 不是高效，而是**摧毁延迟与可预测性**。运行在 ~70-80% 利用率反而总吞吐/延迟更优。

**【回扣 orchestrator】**
- **TOC 瓶颈思维定位你的约束**：在 orchestrator 系统里，瓶颈往往**就是 orchestrator 自己的串行综合工作**（写 plan、verify、整合、review 决策）——这是 Amdahl 的串行比例 s。**Exploit 这个约束 = 让它永不空转（§6）；Subordinate = 后台 agent 的节奏服从 orchestrator 的消化能力（backpressure）；Elevate = 把可外包的综合工作再下放给 sub-agent。**
- **CCPM buffer 对治 agent 工期不确定**：别给每个 task 估时藏余量，**在 milestone/PR 级别设共享 project buffer**。agent 工期高度不确定（PERT 心智），buffer 聚合比分散更省（统计上 √n 效应）。
- **WIP limit 是你最该立刻装的护栏**：限制同时在飞的 agent 数（项目已有"60min 硬截止""per-task 闭环"雏形）。理由是 §5.5 的硬数学——**并发度无上限会把你推上 utilization cliff**：context window 爆、配额耗尽、来不及消化产出导致 backpressure 崩溃。**用 Little's Law 反推：想让平均 task 完成时间 W 可控，就得限制在飞 WIP = L（given 你的消化吞吐 λ）。**
- **Parkinson/student syndrome 对 AI 也成立的变体**：给 agent 模糊大 scope，它会 over-engineer/gold-plate（项目红线"不 gold-plate""sonnet 偷工"）。对治：**紧 spec + 明确验收标准 + buffer 在 orchestrator 端**，正是 CCPM 思路。

---

## 簇 6：「让 orchestrator 不空转」这个问题本身（用户最核心关切）

这一节的统一主题：**latency hiding（延迟隐藏）——用"有用的别的工作"填满等待后台完成的窗口**。

### 6.1 latency-hiding vs throughput 的根本区别

- **throughput**（吞吐）：单位时间完成的工作量。
- **latency hiding**（延迟隐藏）：**不减少单个操作的延迟，而是在等它时做别的有用工作，让延迟"不可见"**。**这正是 orchestrator 等后台 agent 时该做的事**——不是加快单个 agent，而是用等待窗口做下一阶段的规划。

### 6.2 经典 latency-hiding 技术（全部可映射）

- **Prefetching**：在数据被需要前就发起传输，让计算用此前预取的数据继续推进，同时新数据在传输；编译器按预期 latency 提前 software-pipeline 预取若干轮。
- **Double buffering（ping-pong）**：一种 software-pipelining 策略，用两块 scratchpad buffer（ping 和 pong）交替——一块在算时，另一块在传。
- **Pipelining**：把任务分成阶段并发执行，让计算与数据传输同时进行。
- **Asynchronous I/O**：发起 I/O 后立即返回做别的，完成时回调/await。
- **Compute-communication overlap**：并发执行处理与数据传输以隐藏通信延迟。

### 6.3 协调者（人/AI）该如何不空转

把上面技术翻译成协调者层面的动作：**在当前批次执行时就规划下一批次 / 重叠自己的综合工作**。等价于：
- **look-ahead / prefetch**：在批次 N 跑时，提前把批次 N+1 的 spec 草拟好、把它需要的资料/符号 grep 好（项目记忆"dispatch 前 grep 真实符号"可前置到等待窗口做）。
- **double-buffering 思维**：当前批次 = ping buffer 在"算"，下一批次 = pong buffer 在"准备"。批次 N 一完成，N+1 立即可发，无空窗。
- **pipeline 重叠**：design(N+1) ∥ implement(N) ∥ review(N−1) ∥ verify(N−2) 流水线满载，orchestrator 始终在某个 stage 上有产出。

**【回扣 orchestrator】——这是用户最核心的诉求，给足可操作清单**

后台 agent 在跑时，orchestrator **必须**从以下"有用工作池"里取活填满等待窗口（**绝不 idle-poll 空等**，项目记忆明确"后台工作时主线程不空转，持续推进文档/下一批 anchor/经验沉淀"）：

1. **Look-ahead 规划下一阶段（最高价值）**：为还没发的下游 task 草拟 spec、画 dependency、grep 真实符号、预读相关文件、起草 reviewer prompt。批次完成时下一批"即插即用"。
2. **Speculative prefetch（推测准备）**：对"八成会走的分支"提前准备（如八成会要写 ADR → 先起草；八成会要补测试 → 先列 test case）。猜错就丢，成本 = 一次 look-ahead，收益 = 命中时零延迟。映射 §1.5 speculative execution。
3. **重叠自己的综合工作（pipeline 串行段）**：把 orchestrator 的串行职责（整合上一批产出、更新 progress.md/journal、沉淀经验记忆、做 milestone review 决策）**安排在后台执行窗口内**——这部分本来就是 Amdahl 的串行 s，必须和并行段重叠才不拖总时间。
4. **Verify 上一批（pipeline 错位）**：批次 N 在跑实现时，orchestrator 独立 verify 批次 N−1 的 gates（end-to-end 校验，§3.7）。
5. **维护 journal/checkpoint**：把已完成 task 的 content-hash + 产出写进 journal，为 resume 铺路。

**反模式（禁止）**：阻塞式 `sleep` 轮询等单个 agent；手搓文件 size 轮询判断完成（项目记忆"已误报翻车"）；什么都不做干等通知。**正确**：用 structured-concurrency 的 nursery join（§2.5）等批次，等待期间主线程在"有用工作池"里持续产出。

---

## 关键综合：给 AI dynamic-workflow orchestrator 的可操作原则（PAYLOAD）

把全部蒸馏成可直接编码进 orchestrator 行为的原则。

### A. 目标分解成 dependency DAG + 找 critical path

1. 把目标拆成 task 节点，画依赖边，得到 DAG，做 **topological sort** 定合法执行序（§1.1）。
2. 跑一遍 **CPM**（forward/backward pass）：算每个 task 的 ES/EF/LS/LF 和 **float**；**float = 0 的链就是 critical path**（§1.2）。
3. 算 **parallelism = T₁/T∞**（总工作量/critical path 长度）。这是"这个目标最多值得几路并行"的硬上限（§1.4）。
4. **资源决策**：critical path 上的 task 投最强资源（opus impl + 双 reviewer + orchestrator 盯死）；高 float 的 task 用便宜资源、可延后填空隙。**压缩非关键路径不缩短总工期**——别浪费。

### B. 何时 fan-out (barrier) vs pipeline (streaming) vs sequential

| 工作形态 | 选择 | 理论依据 |
|---|---|---|
| 多个**同构、互相独立**的 task | **fan-out / barrier**（MapReduce map 阶段，全跑完再 reduce 整合） | §2.2 / §2.1 fork-join |
| 多个 task 走**相同的多阶段流程**（design→impl→review→verify） | **pipeline**（错位重叠不同阶段，orchestrator 始终满载） | §2.7 / §6.3 |
| 一条**长串行依赖链**（parallelism ≈ 1） | **sequential**（fan-out 无收益，省配额） | §1.4 Amdahl |
| 任务工期高度不确定、池子动态 | **work-stealing 池**（保持就绪池，谁空谁领下一个，近最优负载均衡） | §2.8 T₁/P + O(T∞) |

### C. orchestrator 如何避免空转（核心）

- **永远在某个 pipeline stage 上有产出**：批次 N 跑实现时，orchestrator 同时做 {规划批次 N+1 spec + grep 符号、verify 批次 N−1、整合批次 N−2 产出、写 journal、沉淀记忆}（§6.3）。
- **look-ahead = prefetch**：等待窗口内预拉下游 task 所需的一切，使其"即插即用"（§6.2）。
- **double-buffer**：当前批次（ping）执行 ∥ 下一批次（pong）准备（§6.2）。
- **speculative prefetch**：对高概率分支提前准备，错了即弃（§1.5 / §6.3 step 2）。
- **禁止**阻塞 sleep 轮询、手搓 size 轮询；**用** nursery join 等批次（§2.5）。

### D. 给并行设界（避免资源耗尽与 utilization cliff）

- **设 WIP 上限**：同时在飞的 agent 数有硬上界（semaphore）。理由是 Little's Law **L = λW** + utilization cliff——**别把利用率推到 100%，目标 ~70-80%**，否则尾延迟与队列超线性爆炸、context/配额耗尽（§5.4-5.5）。
- **用 Little's Law 反推上限**：given 你消化 agent 产出的吞吐 λ 和可接受的平均 task 周转 W，则在飞 WIP **L = λ × W**。超过就 backpressure（§2.9）。
- **CCPM buffer**：别给单 task 藏余量，在 milestone/PR 级设共享 project buffer（§5.2）。

### E. memoization / journaling 实现廉价 resume

- **每个 task 算 content-hash**：`key = hash(task spec + 上游产出 refs + 关键上下文)`，对应 Bazel **action key**（§4.2）。
- **执行前查 journal**：hash 命中 → 该 task 已完成，**复用已落盘 artifact（commit/PR），跳过**；未命中 → 执行 + 写 journal entry（含产出 ref）。
- **compaction/中断后 resume = O(变更集)**：只重跑"输入变了或没完成"的节点（Bazel incremental build）。**这是项目记忆 memoize/checkpoint 诉求的直接实现。**
- **determinism guard（处理 AI 非确定性，标注争议点）**：缓存的不是"重跑会一样"，而是"已落盘且通过 **end-to-end 校验** 的 artifact"。校验 = orchestrator 独立跑 gates + read diff（§3.7：正确性的最终保证必须在端点，agent 自报不可信）。artifact 存在且校验通过 → 视为完成，不重跑。
- **idempotency**：每个 task 步骤可安全重放（带 task-id 查 journal 再执行），重试不产生重复副作用（§3.3）。

### F. 处理异步完成 + backpressure

- **futures/await 模型**：先派出整批 agent（拿 future 句柄），不立即逐个阻塞等；在 nursery 里统一 join（§2.4-2.5）。
- **structured concurrency 批次语义**：阶段 = nursery，所有子 agent join 才进下阶段；任一失败可触发同批取消 + 向上抛（修"null-review 静默放行""孤儿后台 agent"，§2.5）。
- **hedged execution 处理长尾**：单个 agent 超过该类任务 p95 时长 → hedge（派备份 agent 取先完成）或降级放行（项目已有"codex hung defer""60min 硬截止"）。**不被单个慢 agent 拖死整批**（§3.4）。
- **backpressure**：产出消化不过来时，**降 fan-out 速率**（bounded queue 必须有界，unbounded 会掩盖问题直到 context/配额爆，§2.9）。
- **saga 补偿**：多阶段中途失败有定义好的回滚（删 worktree、撤 commit），对应"post-merge cleanup 硬墙"纪律（§3.2）。

### G. 一句话操作守则（可贴进 orchestrator 系统提示）

> **把目标当 DAG，沿 critical path 投资源；fan-out 同构任务、pipeline 多阶段流程、串行长依赖链；后台跑着时用 look-ahead / speculative-prefetch / 重叠综合工作填满每一个等待窗口（绝不空转）；用 WIP 上限把利用率压在 ~75% 避开 latency cliff；用 content-hash journal 实现 O(变更集) 的 resume；正确性校验永远在 orchestrator 这个端点独立做，不信 agent 自报。**

---

## 标注的争议点 / 裂缝

1. **Amdahl vs Gustafson**：不矛盾但适用场景不同（固定目标 vs 可放大目标）。orchestrator 两种都会遇到——固定交付用 Amdahl 心智（串行段是天花板），扩大产出用 Gustafson 心智。
2. **build-system 类比的最大裂缝 = AI 非确定性**：Bazel 缓存依赖 hermetic/deterministic build；AI agent 同 spec 跑两次可能不同。**对策**：缓存"已落盘且通过 end-to-end 校验的 artifact"而非"重跑会一样"，把正确性校验当 cache validation。
3. **Graham anomaly**：加 worker/缩任务可能反而变慢，调度对参数非单调——别想当然"加 agent 一定更快"。
4. **hedged requests 的代价**：多个 agent 做同一任务有"脆弱窗口"（重复工作/配额）。仅对长尾（超 p95）触发，控制额外负载在个位数百分比。

---

## 信源清单（canonical，named-result 优先一手）

**调度 / work-span**
- Brent (1974) / [Analysis of parallel algorithms — Wikipedia](https://en.wikipedia.org/wiki/Analysis_of_parallel_algorithms)（Brent's law、work/span/parallelism）
- [CMU 15-210 Parallel Computing: Theory and Practice](https://www.cs.cmu.edu/afs/cs/academic/class/15210-f15/www/tapp.html)；[Stanford CME 323 Lecture 1（Brent's theorem）](https://stanford.edu/~rezab/dao/notes/lecture01/cme323_lec1.pdf)
- [Amdahl's Law — Cornell Virtual Workshop](https://cvw.cac.cornell.edu/parallel/efficiency/amdahls-law)；[Strong vs weak scaling / Gustafson — KTH PDC](https://www.kth.se/blogs/pdc/2018/11/scalability-strong-and-weak-scaling/)
- [List scheduling / Graham bound — Wikipedia](https://en.wikipedia.org/wiki/List_scheduling)
- CPM / float：[Asana](https://asana.com/resources/critical-path-method)、[ProjectManager](https://www.projectmanager.com/guides/critical-path-method)、[float guide](https://www.projectmanager.com/blog/float-in-project-management)、[CPM vs PERT — Galorath](https://galorath.com/schedule/critical-path-method/)
- [Dataflow architecture — Wikipedia](https://en.wikipedia.org/wiki/Dataflow_architecture)；[Speculation in OoO dataflow — Springer](https://link.springer.com/article/10.1007/s10766-013-0277-2)

**并行/并发模型**
- [Smith, "Notes on structured concurrency, or: Go statement considered harmful" (2018)](https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/)
- [Work stealing — Wikipedia](https://en.wikipedia.org/wiki/Work_stealing)；[Blumofe & Leiserson, "Scheduling Multithreaded Computations by Work Stealing", JACM 1999](https://dl.acm.org/doi/10.1145/324133.324234)
- [Dean & Ghemawat, "MapReduce", OSDI 2004](https://research.google.com/archive/mapreduce-osdi04.pdf)
- [Actor model — Wikipedia](https://en.wikipedia.org/wiki/Actor_model)；[CSP — Wikipedia](https://en.wikipedia.org/wiki/Communicating_sequential_processes)；[Actor vs CSP — Karan Pratap Singh](https://www.karanpratapsingh.com/blog/csp-actor-model-concurrency)
- [Reactive Streams — Akka](https://doc.akka.io/libraries/guide/concepts/reactive-streams.html)；[Backpressure — Jay Phelps](https://medium.com/@jayphelps/backpressure-explained-the-flow-of-data-through-software-2350b3e77ce7)

**分布式 / 可靠性**
- [Dean & Barroso, "The Tail at Scale", CACM 2013 (PDF)](https://www.barroso.org/publications/TheTailAtScale.pdf)
- [Saga orchestration vs choreography — ByteByteGo](https://blog.bytebytego.com/p/saga-pattern-demystified-orchestration)；[Temporal saga guide](https://temporal.io/blog/mastering-saga-patterns-for-distributed-transactions-in-microservices)；[AWS saga choreography](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html)
- [Saltzer, Reed, Clark, "End-to-End Arguments in System Design", ACM TOCS 1984 (MIT PDF)](https://web.mit.edu/saltzer/www/publications/endtoend/endtoend.pdf)

**构建系统**
- [How Bazel Works — gocodeo](https://www.gocodeo.com/post/how-bazel-works-dependency-graphs-caching-and-remote-execution)；[Why Bazel is the Endgame — The Coding Gopher](https://thecodinggopher.substack.com/p/why-bazel-is-the-endgame-for-build)；[Remote Caching — Bazel docs](https://bazel.build/remote/caching)

**运筹学 / 项目管理**
- [Critical Chain / buffers — HotPMO](https://www.hotpmo.com/management-models/the-critical-chain-method/)；[Student syndrome — Epicflow](https://www.epicflow.com/blog/student-syndrome-in-project-management-real-constraint-or-just-human-factor/)
- [Theory of Constraints — Kanban Tool](https://kanbantool.com/kanban-guide/theory-of-constraints)；[WIP limits — Atlassian](https://www.atlassian.com/agile/kanban/wip-limits)；[WIP limits — agility-at-scale](https://agility-at-scale.com/principles/wip-limits/)
- [Little's Law — Wikipedia](https://en.wikipedia.org/wiki/Little's_law)；[Little's Law for scaling — Dan Slimmon](https://blog.danslimmon.com/2022/06/07/using-littles-law-to-scale-applications/)；[Queueing theory / utilization knee — BigBinary](https://www.bigbinary.com/blog/understanding-queueing-theory)

**延迟隐藏 / 不空转**
- [Communication patterns & overlapping (prefetch/double-buffer/pipeline) — Fiveable](https://library.fiveable.me/parallel-and-distributed-computing/unit-9/communication-patterns-overlapping/study-guide/hHtAIflquxEJzH9d)；[Mowry et al., compiler-inserted prefetching](https://dl.acm.org/doi/pdf/10.1145/273011.273021)

---

*本报告是四份报告中的第 4 份。它把报告 1 §8.3 诊断出的"主线程不空等"空白，用 latency-hiding / work-span / Little's Law / build-system journaling 等成熟原理填成了可操作清单。配合报告 3（LLM-Compiler 的 Task Fetching Unit 是 §1.5 dataflow dispatch-when-ready 的 LLM 实例）一起读效果最佳。*
