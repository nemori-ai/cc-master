# ADR-015 — ccm 扩成 OR/ML 估算 + 配速引擎（只读 analysis namespace + home 跨板语料）

> Status: **Accepted**（用户主导设计、逐项拍板·2026-06-25 blessing）
> Date: 2026-06-25
> Scope: `ccm`（新增 `usage`/`estimate` 只读 namespace + `baseline` 写 noun + `@ccm/engine` 的 `estimate/`·`usage/` 算法层 + 两个 ✎ board 字段 `board.baseline`/task `model`）· `usage-pacing.js` hook（收口 shell-out）· `cc-usage.sh`（收口退役）· `using-ccm` skill（锁步 ripple）· `account-management`（备号用量快照配套）
> Source: 2026-06-25 estimate/usage namespace 设计讨论（用户主导·多轮收敛）+ 3 路现代 SOTA 调研（web-verified）。详细命令面 / 算法层 / `--json` 形状见 `design_docs/plans/2026-06-25-estimate-usage-namespaces.md`（evergreen 设计·本 ADR 不复述，只记结构性决策与取舍）。

---

## 1. Context

ADR-013 把 board 演进为「完整数据模型 SSOT + 统一 CLI」，ADR-014 把引擎解耦为独立 `ccm`（`@ccm/engine`）。但 catalog 一直**预留**两个未实现 namespace——`estimate`（运筹学/ML 估算引擎）+ `usage`（用量配速）。它们对应 charter 的硬痛点：②控制 token 消耗速度、④目标分解/规划、⑤资源下最大化效率、⑥按难度/时长选模型档。

现状之痛（决定「现在做、且做进 ccm」的理由）：
- **配速数学散在三处**——`usage-pacing.js`（hook 内双侧走廊 + 7d 硬闸 + effective-N）、`cc-usage.sh`（带外 python3 反推 + 读 sidecar）、`cost-and-pacing.md`（orchestrator 心智）。三份各算各的 = 漂移风险 + python3 依赖。
- **estimate 只有字段没有引擎**——`estimate` 是 board 字段、喂 `board critical-path`，但 #29（估值随实测动态校准）、#34（按时长选档）无落地计算，无「估 vs 实测」回路、无概率化预测。
- 要让校准/预测有统计意义，必须读**跨 board 的历史**（单板 done tasks 太少 → 冷启动），这是一个**超出「单板」的新数据访问尺度**。

## 2. Decision

**ccm 从「board 状态 CLI」正式扩成「orchestration + 运筹学/ML 估算 + 配速引擎」。** 六条结构性子决策：

### 2.1 新增两个**只读 advisory** analysis namespace + 一个写 noun
- `usage`（配额侧·**纯只读**）、`estimate`（工作侧·**纯只读**·消费 usage 融合）——只 query/compute、不抢 `board-lock`、不落状态，与 `board graph`/`critical-path`「只读永不回写」同族。
- `baseline`（**写**·走写关卡·顶层 noun：snapshot/show/reset）——EVM 的 plan 基线，是唯一写命令、**刻意置于只读 namespace 之外**。

### 2.2 ccm 出 verdict、orchestrator 决策（守红线 3）
usage/estimate 给**确定性的预测 / 走廊 verdict / 风险数据**；真动作（降档 / 换号 / surface 给用户 / 回写估值）全归 orchestrator（skill A 的 cost-and-pacing 方法论不动）。ccm **advises，不 decides / 不 acts**。

### 2.3 home 级跨板历史语料读（**本 ADR 最新的架构动作**）
ML 层读 home 最近 N 块板（current + `/stop` 归档·保留 tasks·ADR-009）的全部 done tasks——一个**超出单板的新读取尺度**。范围跟 home 解析走（复用 `discover`）、多层收缩（hierarchical partial pooling）+ recency 衰减 + conformal 兜诚实。**只读、本地 only、不外传**；若日后要缓存历史索引加速，那是**写**、归 board 写路径或独立维护命令、**不进这俩只读 namespace**。

### 2.4 轻量 hand-roll 的 OR/ML 引擎，0 新依赖，约束过滤现代 SOTA
算法层全 hand-roll（除可选 PRNG）、**新增 0 个 npm runtime dep**（~315 行 TS·复用 `board-graph-core` 拓扑/CPM/最长路）。方法选型经「轻量 / 确定性(seeded) / **无训练设施** / 小数据 / ship-anywhere」过滤——纳入的（双通道 Monte Carlo / EWMA+Bayesian shrinkage〔≅ Reference-Class Forecasting〕/ split+Mondrian conformal / k-NN / RCPSP min-slack+LFT / EVM+Earned Schedule / SLE / CI-CRI-SSI / CCPM fever）经 3 路 web-research 确认为 2020–2025 SOTA；**重型 ML SOTA（GBM/RF/transformer/GPT2SP/LLM-estimation/MCMC/GNN）经约束逐条排除**（不是无知、是适配·留痕在 scratchpad 调研报告）。

### 2.5 `baseline` + task `model` 作 ✎ board 字段（写在 board 写路径，不破红线 2）
EVM 需要 plan baseline、tier 分层校准/#34 需要 model-tier——二者作 **✎ agent-shaped / hook-blind / 非 narrow-waist** 字段（`board.baseline` 段 + task `model`），由写命令落盘（baseline noun / dispatch-done 路径），不动 hook 依赖的 🔒 窄腰（红线 2 不破）。

### 2.6 配速数学收口进引擎，hook shell-out + 优雅降级
双侧走廊数学搬进 `@ccm/engine` 的 `usage/pacing.ts`（单一 SSOT）；`usage-pacing.js` hook 从「自己算」改为 **shell 调 `ccm usage advise`**、**ccm 缺则静默降级**（pacing 是增强项·同 ADR-014 模式）。`cc-usage.sh` 的账户权威 + 本地反推一并收口进 `usage show`（**TS 重写反推 → 干掉 python3 依赖**）。

## 3. Consequences

### 3.1 Positive
- 配速 / 估算成为**确定性 SSOT**——消灭三处散落数学的漂移、去 python3 依赖。
- **诚实的概率化预测**：处处带 conformal/经验区间 + 5% 硬墙（95%）；把「假精确点估」换成「方向性区间」（合 F#37 信号天花板 + gate-green≠passed 气质）。
- charter ②④⑤⑥ 实质推进；**0 新依赖**保 SEA 二进制精简。
- 现代 SOTA（throughput-MC/#NoEstimates、SLE、Mondrian conformal、Earned Schedule、CI/CRI/SSI、CCPM fever）以轻量形态落地。
- **算法有持久化验证集兜底**：版本控制的 board fixtures（端到端 + property/invariant + seeded golden + `--as-of` backtest 三类断言）作为算法迭代的**回归安全网 + 预测质量验证**——seeded 确定性使 golden 可复现、`--as-of` 回放使「预测 vs realized」可打分（呼应 grounding-skill-evals 的 predict-then-validate）。详见 plan §12。

### 3.2 Negative / 代价
- **ccm 职责面变宽**（不再只是 board）——这是有意的范围扩张，由本 ADR 显式记账。
- **home 跨板读引入跨 board 耦合**——缓解：只读、本地 only、多层收缩处理异质（异质 → conformal 区间变宽而非错点估）、recency 截断防远古污染。
- **新增两个 board-model 字段**（baseline/model）→ 同 PR ripple `using-ccm`（红线 §6 锁步）。
- **无 ccm 则 pacing 提示静默消失**（usage-pacing 收口的代价）——可接受（ADR-014 「ccm 缺优雅降级」一致；pacing 是增强非安全闸）。

### 3.3 Neutral
- 红线全保：红线 3（advises 不 decides）、红线 2（新字段 ✎ 非窄腰）、红线 1 + ship-anywhere（进程边界 + 0 dep + 全 hand-roll + 无 python）。
- ADR-010（双侧走廊）的数学被 §2.6 实现收口（非推翻，是它的引擎落点）。

## 4. Alternatives Considered

### 4.1 维持现状（配速/估算留 hook+脚本）
散落数学持续漂移、python3 依赖、且**无估算引擎**（#29/#34 无解）。**拒**——这正是要解的痛点。

### 4.2 ccm 直接决策 / 执行（auto-throttle / auto-switch / auto-回写估值）
违红线 3（指挥决策、ccm 不演奏调度决策）。**拒** → 只读 advisory，出 verdict 不动作。

### 4.3 只读单板语料（不跨 board）
单板 done tasks 太少、ML 层永远冷启动、校准/预测无统计意义。**拒** → home 跨板语料（§2.3）。

### 4.4 引 npm stats/ML 依赖（simple-statistics / pure-rand / 重型 ML 库）
任何 dep 直接进 SEA 二进制；`simple-statistics` 甚至不含 EWMA；重型 ML 违反「无训练设施/小数据/确定性」。**拒** → 全 hand-roll（pure-rand 仅列为 PRNG 可接受备选）。

### 4.5 重型现代 ML SOTA（GBM/transformer/GPT2SP/LLM/MCMC/GNN）
研究界 SOTA，但需训练阶段 / 重依赖 / 非确定性 / 小数据过拟合——违反全部硬约束。**拒**（约束过滤、逐条留痕，非无知）。

### 4.6 baseline / model-tier 写进只读 namespace
违只读纯度。**拒** → 写命令置于 board 写路径（baseline noun / dispatch-done），只读 namespace 只**读**它们。

## 5. Related
- 演进自 [ADR-013](ADR-013-board-v2-data-model-and-cli.md)（board v2 模型）+ [ADR-014](ADR-014-cli-decoupling-as-independent-product.md)（CLI 解耦·进程边界 = 红线1 落点）。
- 实现 [ADR-010](ADR-010-two-sided-pacing-corridor.md) 的双侧走廊数学（§2.6 收口进引擎）；信号口径承 [ADR-008](ADR-008-account-authoritative-usage-and-script-placement.md)（账户权威 sidecar）。
- 新字段守 [ADR-003](ADR-003-board-narrow-waist.md)（✎ 非窄腰）；语料含归档板承 [ADR-009](ADR-009-resume-cross-session-re-arm.md)（保留 tasks）。
- 红线 3（指挥不演奏）+ 红线 §6（`ccm`⟷`using-ccm` 锁步）：`../AGENTS.md`。
- evergreen 设计（命令面 / 算法层 / `--json` 形状 / 实现排序 P1–P4）：`../design_docs/plans/2026-06-25-estimate-usage-namespaces.md`。

## 6. References
- 现代 SOTA 调研（web-verified·3 路·会话内 scratchpad 留痕）：软件估算 / 概率流预测 / PM-风险。关键来源：Reference-Class Forecasting（Flyvbjerg/Kahneman）、conformal prediction（Vovk 2003 Mondrian；Angelopoulos & Bates 2022）、throughput 预测 / #NoEstimates（Vacanti《When Will It Be Done》、Magennis）、SLE（Kanban Guide 2020）、Earned Schedule（Lipke 2003·PMI appendix）、Schedule Sensitivity（Vanhoucke 2010·Ballesteros-Perez 2019）、PRNG（sfc32·bryc/Vigna/Lemire）。
