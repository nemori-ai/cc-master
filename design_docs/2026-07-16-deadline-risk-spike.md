# deadline-risk 算法 spike 报告（任务 D3A）

日期：2026-07-16
任务书：[`2026-07-16-ddl-design-contract.md` §6](2026-07-16-ddl-design-contract.md)（算法 spike 任务书）· 输出 schema：§4.3（`ccm estimate deadline-risk --json`）
可移植核心函数：[`spike-deadline-risk/`](spike-deadline-risk/)（standalone `.mjs` + [README](spike-deadline-risk/README.md)·node 直接跑·全 seeded 可复现）
异构审查约束：[`2026-07-16-ddl-review-triage.md`](2026-07-16-ddl-review-triage.md)（codex 两条修正·本报告 §0 确认已内化）

---

## 0. 异构审查两条修正的确认（本报告已按此定性）

> orchestrator 中继的 codex 异构审查两条修正，直接约束本 spike 的结论。**本报告全程按此写，并在此显式确认收到。**

1. **【通道诚实性】** 现有 throughput Monte Carlo 是「历史日完成率采样 × effective-n」，**不调度当前 DAG、不吃 wip_limit/资源竞争**，故**不是** resource-aware。本报告据此定性：`on_time_probability` **只来自 RCPSP-in-trial 通道**；throughput 定位为 **heuristic 参考通道**，其输出**绝不映射 green/on_track**；precedence-only 只作**显式标注的 optimistic bound**。RCPSP-in-trial 超 latency 预算时，结论是「**降 trials / 降档 或 probability=unknown**」，**绝不退回 throughput 冒充 resource-aware**。（spike 实测：RCPSP-in-trial 堆化后**不超预算**，见 §2——故 v1 可直接上 RCPSP verdict。）
2. **【校准诚实性】** 真实历史 board 普遍缺「历史 DDL + 实际交付结果 + 事件溯源快照」（§3.1 实测：DDL=0、交付 label=0）→ 经验 Brier/reliability 校准 12h 内**不可行**、不硬凑。本报告校准章节改为 (a) 数据可得性盘点、(b) 合成图集验**调度器正确性**（明确 ≠ 经验校准）、(c) v1 出货标 **explicitly uncalibrated + 保守 band + 诚实 confidence**、(d) follow-up 的 labeled snapshot 采集方案（§3）。

**一句话结论**：RCPSP-in-trial 的 latency 实测（§2）证明资源约束通道 v1 可出货；校准诚实性（§3）证明阈值只能保守起步、等 labeled 语料。这两条让 spike 更小、更诚实——latency 降档曲线与调度器正确性证据是本 spike 最有价值的产出。

---

## 1. 三通道对比

### 1.1 三通道定性（契约 §6.1 矩阵 + 异构审查修正）

| 通道 | 机制 | 答的问题 | 现状 | v1 定位 |
|---|---|---|---|---|
| **A. precedence-only MC** | forward pass·log-normal 采样每节点·**无资源闸**（假设无界并行） | 「纯依赖约束下最快多久」 | 引擎已有 `estimateDagMonteCarlo`（只回分位·缺经验 CDF） | **optimistic bound·显式标注·非承诺** |
| **B. RCPSP-in-trial MC** | 每 trial 内跑 serial SGS·注 `wip_limit` 资源约束·min-slack/LFT 优先规则 | 「真实 WIP 并发下多久」 | **spike 新建**（`rcpspSchedule` 原是确定性单趟·未入 MC 循环） | **唯一 verdict 源·on_time_probability 只来自它** |
| **C. throughput MC** | 历史日完成率 bootstrap·÷effective-n·**不调度 DAG/不吃 wip** | 「照历史清 backlog 节奏要几天」 | 引擎已有 `throughputMonteCarlo`（只回天数分位） | **heuristic 参考·绝不映射 on_track** |

### 1.2 通道差异实测（真实 283 任务板·as-of 完成一半处·`demo.mjs`）

同一真实板（`20260710T063512Z-232847`·283 任务·backlog 171·wip=16·home 语料 474 条），中等 DDL（time_remaining=67.8h）下三通道：

| 通道 | on_time_probability | makespan / days | 解读 |
|---|---|---|---|
| A precedence-only（乐观下界） | **0.839** | p50/p80/p95 = 33.2/60.0/114.9 h | 无资源闸·系统性乐观 |
| B RCPSP-in-trial（verdict·wip=16） | **0.840** | p50/p80/p95 = 34.1/60.9/112.1 h | 真调度·此板 wip=16 宽松→与 A 接近 |
| C throughput（heuristic 参考） | **0.0**（heuristic·**非** verdict） | days p50/p80/p95 = 5/7/9 | 清 171 backlog 按历史日完成率需 5-9 天 > 2.8 天预算 |

**关键发现（验证异构审查修正①）**：C 报 `P_heur=0`（清不完 backlog），B 报 `P=0.84`（wip=16 并发下 work-hours makespan 仅 34h）——**两通道差 0.84**。原因：C 数 backlog÷历史日完成率（无视 DAG 并行度/wip），B 真跑资源可行调度。**二者答的是不同问题**，若把 C 当 verdict 会把这块本可按期的板误判成必然延期。→ **throughput 绝不能作 verdict**，只作旁证。

### 1.3 通道序不变式（`selfcheck.mjs` 验）

- **makespan**：precedence ≤ rcpsp（资源约束只会延后·紧 wip 时 rcpsp 显著大于 precedence）。紧资源合成图（50 任务·wip=2）实测 precedence-p50 < rcpsp-p50。
- **on-time 概率**：同 DDL 下 precedence-on-time ≥ rcpsp-on-time（乐观下界永不低于资源约束）。
- `channel_disagreement = |P_precedence − P_rcpsp|` 作**资源竞争敏感度信号**：宽 wip → 近 0（如上板 0.001）；紧 wip → 显著 → 超 `disagreement_gap`(0.25) 时禁无条件 on_track（降 watch）。

---

## 2. 性能预算实测（契约风险 top1·`latency-bench.mjs`）

> 环境：node v24.18.0·8 cores·best-of-3·runs=2000（除标注）。契约风险 top1 =「2000 trials × RCPSP 在真实规模图上是否爆 latency budget」。**实测结论：堆化 serial SGS 后完全不爆——最大真实板全 endpoint 518ms，10s hook budget 下 19× headroom。**

### 2.1 真实 board 图（全任务当 backlog·最坏情况·wip=board 值）

| board | tasks | edges | wip | precedence | **rcpsp(heap)** | rcpsp(naive) | throughput |
|---|---|---|---|---|---|---|---|
| #82 squash（最大真实板） | 283 | 314 | 16 | 105ms | **449ms** | **30626ms** ⚠ | 1.8ms |
| omne_eng 双目标 | 216 | 322 | 8 | 81ms | **319ms** | 12755ms | 1.5ms |
| E1-hitl | 168 | 171 | 8 | 61ms | **227ms** | 7864ms | 1.5ms |
| omne_harness | 118 | 261 | 4 | 47ms | **142ms** | 2373ms | 1.5ms |
| cross-harness | 72 | 45 | 3 | 26ms | **80ms** | 1430ms | 1.4ms |

### 2.2 合成放大图（压力·边密度 ~1.5/node·wip=8）

| N tasks | edges | precedence | **rcpsp(heap)** | rcpsp(naive) | throughput |
|---|---|---|---|---|---|
| 200 | 305 | 78ms | **265ms** | 5607ms | 1.3ms |
| 300 | 452 | 119ms | **414ms** | 13282ms | 1.4ms |
| 500 | 749 | 195ms | **766ms** | 55100ms ⚠ | 1.5ms |
| 1000 | 1470 | 396ms | **1580ms** | (skip) | 2.0ms |
| 2000 | 2973 | 833ms | **3437ms** | (skip) | 2.6ms |

### 2.3 全 endpoint 三通道合计（最大真实板规模 N≈283·runs=2000）

- A(precedence) + C(throughput)：**109ms**（92× headroom）
- A + **B(rcpsp)** + C 三通道：**518ms**（**19× headroom** under 10s hook timeout）

### 2.4 trials 降档曲线（N=300·rcpsp heap·**latency 线性于 trials**）

| runs | rcpsp(heap) | precedence |
|---|---|---|
| 250 | 53ms | 15ms |
| 500 | 104ms | 29ms |
| 1000 | 206ms | 58ms |
| 2000 | 413ms | 113ms |
| 4000 | 825ms | 230ms |

**结论**：
1. **RCPSP-in-trial 堆化后 v1 可出货**——最大真实板 449ms（含三通道 518ms），远低于 10s hook budget（19× headroom）。契约风险 top1 **被 defuse**（对**堆化实现**而言）。
2. **naive 实现会爆预算**——283 任务真实板 naive=30.6s（>10s）、500 任务合成图 naive=55s。契约担心的正是这个。**D3B 必须用堆化 serial SGS**（`rcpspInTrialMc`·`indeg`-ready-heap + slot-heap·O(V log V)/trial），**不要**用 `rcpsp.ts` 式逐 trial filter-ready（O(V²)/trial·60-70× 慢）。
3. **降档规则**（若未来极端大图或收紧 budget）：latency 线性于 trials·线性于 N。降档阶梯建议：`runs 2000→1000→500`（283 任务从 449→~225→~110ms）；仍不够（N>2000 罕见）→ `on_time_probability=unknown` + `band=unknown`（**绝不退 throughput**）。endpoint 可回 `rcpsp_runs`（实际用的 trials）诚实标注降档。

---

## 3. 校准（诚实性驱动·异构审查修正②）

### 3.1 (a) 数据可得性盘点（`data-inventory.mjs`·本机 22 boards）

| 字段 | 覆盖 | 校准可行性影响 |
|---|---|---|
| `goal_contract` | 3/22 boards | 目标语义载体·部分板有 |
| `goal_contract.deadline`（历史 DDL） | **0/22** | DDL 是本 feature 新引入·历史板无任何真实 DDL 值 |
| 交付结果 label（相对 DDL 准时/延期） | **0/22** | 无 ground-truth outcome·经验 Brier 无正/负样本对 |
| `task.created_at`（as-of 已知任务集近似） | 1154/1154 tasks | 可近似 as-of「已知任务集」·但不含「当时计划的 DAG 全貌」 |
| `task.started/finished`（as-of 完成态） | 901/1154 tasks | 可 as-of 重建「已完成」·喂 `--as-of` 回放 |
| `board.log` 带时戳（事件溯源快照） | 18/22 boards | 无逐时刻 DAG 快照·无法精确重建「as-of 当时完整计划态」 |

**结论**：真实 DDL=0 + 交付结果 label=0 → **经验 reliability/Brier 校准 12h 内不可行**（无正/负样本对比）。`--as-of` 回放只能重建「已完成任务集」，不能重建「当时的 DDL 承诺 / 当时计划的 DAG 全貌」——故只能做**调度器正确性**验证（合成图集·已知 ground truth），**不能**做经验校准。契约 §6.2「用已有 board `--as-of` 回放评估 calibration」的前提（历史板带 DDL + 交付结果）在本机语料**不成立**——诚实标注为外推局限。

### 3.2 wall-clock ↔ work-hours 失真实测（契约风险 top2·同脚本）

MC 出的是 **work-hours** makespan，映射挂钟 ETA 假设**连续执行**（`addHoursISO`）。真实编排有夜间空转 / 等待用户 / 跨天。对 13 块完成度高的真实板实测 `真实挂钟跨度 ÷ 资源可行 work-hours`：

| 指标 | median | mean | range |
|---|---|---|---|
| inflation vs RCPSP(wip) work-hours | **4.0×** | 8.2× | [1.2×, 49.2×] |

**结论**：真实挂钟跨度普遍是 work-hours 的**数倍且高度可变**（4× 中位·个别板 40×+）。continuous-execution 映射**系统性乐观**。demo 里同一板 work-hours makespan 34h、真实挂钟 203h（~6×）正是此。→ v1 **必须**诚实标注 `forecast`/`margin` 为 work-hours 口径乐观估计（schema 加 `basis:'precedence-only-optimistic'`）；`band` 用**保守阈值**兜这层失真；**绝不声称挂钟校准**。`precision=day` 语义（当日末刻·契约 §3.4）也是为避免把「当日交付」误当精确秒而虚增紧迫——与此同源。

### 3.3 (b) 合成图集验调度器正确性（`scheduler-calibration.mjs`·K=500 项目·MC=800）

> ⚠ **受控合成世界**（生成模型与 MC 假设同族：log-normal 时长 + RCPSP 资源模型）·验「机器在其假设下自洽」·**非**经验校准。coverage/PIT：DDL 设成 model 的 p_q 分位（nominal on-time=q）→ 经验 coverage 应 ≈ q。

| 场景 | p10 | p20 | p50 | p80 | p90 | p95 | Brier |
|---|---|---|---|---|---|---|---|
| **oracle**（估值=真实均值·隔离 MC 机器） | 0.10 | 0.22 | 0.52 | 0.81 | 0.90 | 0.94 | 0.173 |
| realistic-noise（估值带噪 cv=0.5） | 0.18 | 0.29 | 0.61 | 0.82 | 0.89 | 0.94 | 0.184 |
| **biased-optimistic**（估值系统性低估 ×0.7） | 0.00 | 0.00 | 0.03 | 0.12 | 0.23 | 0.33 | 0.316 |

**读法**：
- **oracle 行贴对角线**（p50→0.52·p80→0.81·p90→0.90·p95→0.94）→ **RCPSP-in-trial MC 机器本身 well-calibrated**（在其假设下）。这是本 spike 对「调度器正确性」的正面证据。
- **biased 行崩塌**（低估估值 ×0.7 → p90 经验 coverage 仅 0.23）→ **估值系统性偏差会把准时概率吹爆**，且**无 labeled outcome 就无从检测/校正**。这是 real-world 最大隐患，也是「v1 必须 explicitly uncalibrated + 保守」的根因。
- Brier 是相对量（预测=nominal q·outcome 二元）：oracle/realistic ~0.17-0.18（含固有不确定性下的合理值）· biased 0.32（明显劣化）——**机器正确 ≠ 端到端校准**，端到端取决于估值质量 + wall-clock 映射，二者本机语料都测不了。

### 3.4 (b3) band 阈值 FN ↔ alert-fatigue 权衡（同脚本·realistic-noise·DDL 宽紧混合）

| 升级阈值 τ（pOnTime<τ → at_risk+） | P(漏报延期) FN | P(健康被警报) alert-fatigue |
|---|---|---|
| 0.95 | 1% | 43% |
| 0.90 | 4% | 34% |
| 0.80 | 7% | 25% |
| **0.70** | **12%** | **19%** |
| **0.60** | **15%** | **14%**（交叉点附近） |
| 0.50 | 18% | 11% |
| 0.40 | 23% | 8% |

**读法**：经典 FN↓↔alert-fatigue↑ 权衡。延期代价（临近截止才暴露不可交付）>> 一次多余 advisory 代价，且 v1 是 **advisory 不 block Stop** → **保守起点偏敏感**：升级 at_risk 的门放在 **pOnTime ≈ 0.6-0.7 一带**（漏报 12-15% 可控·误警 14-19% 可接受）。真实定标待 labeled 语料。

### 3.5 (c)(d) 见 §5 v1 出货建议 + §7 follow-up labeled snapshot 采集方案

---

## 4. 诚实降级矩阵（契约 §6.5·`deadline-risk.mjs` 实现 + `demo.mjs` 验）

| 输入情形 | `risk_band` | `on_time_probability` | 关键字段 | 原则 |
|---|---|---|---|---|
| 无 DDL（state ∈ pending/none/键缺失） | `unknown` | `null` | notes「无已确认 DDL·不假绿」 | 不 false-green |
| 图含环 | `unknown` | `null` | notes「含环·无法 forward pass」 | 不 false-green |
| 空图 / backlog=0 已完成 | `unknown` / — | `null` | — | 不 false-green |
| RCPSP 超预算被降档禁用 | `unknown` | `null` | `rcpsp_runs:0`·notes「绝不退 throughput 冒充」 | **绝不退 throughput** |
| coverage/history 太弱 + 本会算出 on_track | `unknown` | 有值但降级 | `confidence:'low'`·on_track→unknown | 低置信不绿 |
| 双通道分歧 > gap(0.25) + 本会 on_track | `watch`（降级） | 有值 | notes「precedence↔rcpsp 分歧·降 on_track→watch」 | 分歧不无条件绿 |
| now ≥ DDL 且未完成 | `overdue`（strong） | `0` | notes「须报告 + 用户决策」 | 主动唤起 |
| 正常有 DDL·置信足 | `on_track`/`watch`/`at_risk`/`likely_late` | rcpsp on-time | 全字段 | 概率优先 + 分位镜像 |

**strength 映射**（ADR-018·引擎 emit·hook 直接填）：`watch`→weak；`at_risk`/`likely_late`/`overdue`→strong；`on_track`/`unknown`→weak。`calibration_status:'uncalibrated-conservative'` 随每次输出（诚实标注阈值未经经验校准）。

`demo.mjs` 在真实 283 任务板上实测五态齐现：宽 DDL→on_track(P=0.99)、中→watch(P=0.84)、紧→likely_late(P=0.20·strong)、过期→overdue(strong)、无 DDL→unknown(null)。

---

## 5. v1 出货建议

### 5.1 通道组合（异构审查修正① 的落地）

**v1 endpoint 三通道**：
- **verdict = RCPSP-in-trial**（唯一 `on_time_probability` 源·`channels.resource_aware.source` 收紧为**只允许 `rcpsp-in-trial`**）。latency 实测证明可出货（§2）。
- **precedence-only = optimistic bound**（`channels.precedence_only.role:'optimistic-bound'`·显式标注非承诺·同时供 `channel_disagreement` 资源敏感度信号 + `forecast`/`margin` 的 work-hours 乐观口径）。
- **throughput = heuristic 参考**（`channels.throughput_reference`·`kind:'heuristic-reference'`·`on_time_probability_heuristic` 带 note·**绝不映射 on_track**）。保留它只为「历史节奏 sanity check」旁证。

**disagreement 暴露方式**：`channel_disagreement = |P_precedence − P_rcpsp|`（资源竞争敏感度）；超 `disagreement_gap`(0.25·保守起点) → 禁无条件 on_track（降 watch）+ note。

### 5.2 RCPSP 超预算退档策略

latency 实测 v1 **不需要退档**（最大真实板 449ms·19× headroom）。但埋好降档阶梯以防极端大图：`runs 2000→1000→500`（线性省时）→ 仍不够 → **`on_time_probability=null` + `band=unknown` + `rcpsp_runs:0`**（**绝不退 throughput 冒充 resource-aware**）。endpoint 回 `rcpsp_runs` 诚实标注实际 trials。

### 5.3 默认 trials / seed

- **runs=2000**（契约 headline·449ms @ 283 任务·充裕）·**seed=42**（固定·确定性可复现）。
- 三通道共用同一 seed 派生（precedence `seed`·rcpsp `seed^0x51ed270b`·throughput `seed^0x9e3779b9`·避免共相）。

### 5.4 band 阈值（**explicitly uncalibrated·保守起点**）

```
on_track:    P_rcpsp >= 0.90     (且无严重分歧·置信足)
watch:       0.65 <= P < 0.90    (weak)
at_risk:     0.40 <= P < 0.65    (strong)     ← §3.4 FN/alert 权衡支持 0.6-0.7 一带升级
likely_late: P < 0.40            (strong)
overdue:     now >= DDL 且未完成  (strong)
unknown:     无 DDL/含环/低置信/严重分歧/RCPSP 不可用  (绝不映射绿)
```
- 标注 `calibration_status:'uncalibrated-conservative'`——阈值是保守起点、非合同，待 labeled 语料（§7）校准固化。
- 偏敏感（延期代价 >> 多余 advisory·且不 block）。

### 5.5 交付收口建模建议（契约 §6.4）

- **推荐：显式收口任务进 DAG，v1 不叠 project buffer**（避免双算）。集成/review/修复/文档/发布作为**显式 board 任务**进 DAG（切分归 slicing skill·D5/E），RCPSP-in-trial 自然把它们算进 makespan——比 CCPM project buffer 更透明、可被 top_drivers 指认（demo 里 top_drivers 已能指出 critical 收口节点）。
- project buffer（`sizeProjectBuffer`）留作 `estimate risk` 的 CCPM 视图**旁证**，**不**叠加进 deadline-risk 的 on_time_probability（否则 DAG 内显式收口任务 + project buffer = 重复计）。若未来要引入 buffer，须在 schema 显式二选一并标注，spike 建议 v1 走「显式收口任务」一条腿。

### 5.6 给 D3B 的移植清单（函数签名 + 文件对应）

见 [`spike-deadline-risk/README.md` §D3B 移植清单](spike-deadline-risk/README.md)。摘要：
1. `estimate/mc-scheduler.ts` 加 `empiricalCdfAtOrBefore(sorted, target)` + 给 `estimateDagMonteCarlo`/`throughputMonteCarlo` 暴露 `*SamplesSorted`（两通道复用一个 helper·最小·零算法重写）。
2. 新增 `rcpspInTrialMc(board, params, opts)` 进 `estimate/mc-scheduler.ts` 或 `estimate/rcpsp.ts`——**堆化 serial SGS**（`indeg`-ready-heap + slot-heap·O(V log V)/trial·**不要 naive filter-ready**）。复用现成 `prng.ts`/`sampling.ts`/`board-graph-core.ts`/`rcpsp.ts` 的 min-slack/LFT 口径。
3. `apps/cli/src/handlers/estimate.ts` 加 `deadlineRisk(ctx)` handler（runRead·read:true）——对应 `computeDeadlineRisk`·**params 用引擎 `buildMcParams`（非 spike 简化校准）**·读 D2 落的 `goal_contract.deadline`。
4. §4.3 schema 收紧：`resource_aware.source` 只允许 `rcpsp-in-trial`·throughput 移 `throughput_reference`·加 `on_time_probability_source`/`calibration_status`/`forecast.basis`。

---

## 6. spike 局限与诚实标注（不硬凑）

1. **spike 校准是全局单层简化**（`board-io.mjs`：全局 κ + 全局 log-残差 cv）——**非**引擎的多层收缩 `calibrate`/`dispersionCv`。demo 实测本机语料 κ=0.09（actual/estimate 中位 0.09·估值系统性远高于实测工期）、cv 撞 2.0 上限——正说明本机 estimate↔actual 关系噪声大/有偏，**更需引擎的分层校准**。D3B **必须**换回引擎 `buildMcParams`，spike 的通道对比结论对相对量成立、绝对 on-time 值不可当合同。
2. **经验校准缺 ground truth**（§3.1）——无真实 DDL + 交付 label·合成图集只证调度器正确性、不证端到端预测真实交付。v1 出货标 `uncalibrated-conservative`。
3. **wall-clock 映射失真已量化未消除**（§3.2·median 4×）——v1 诚实标注 work-hours 口径 + 保守 band 兜，未做日历/空闲建模（follow-up）。
4. **合成图生成模型与 MC 同族**——coverage 好是「自洽」不是「贴真实」；真实图的依赖结构/时长分布可能偏离 log-normal，只有 labeled 语料能验。

---

## 7. follow-up：labeled snapshot 采集方案（§3 (d)·让经验校准将来可行）

要让经验 Brier/reliability 校准将来可行，需从「本 feature 上线后」起累积三样 label（本机现全缺）。建议随 D2/D4B 落地时**顺带埋点**：

1. **历史 DDL 值**——`goal_contract.deadline`（D2 落）一旦被 set/confirm，即成时间戳化的 DDL 承诺记录（`board.log` decision 条目已含 `{from,to,ts}`·§4.1）。这天然累积「DDL 承诺快照」。
2. **交付结果 label**——board 归档（`/stop`）时记一条终态：`{deadline_at, actual_final_finish, on_time: bool, delivered_scope}`。建议 D4B/D7 在归档路径加一个轻量 outcome 落点（`board.log` 或归档 sidecar·不进窄腰）。这是经验校准唯一缺的正/负样本源。
3. **as-of 风险快照**——deadline-risk hook 每次评估时，把 `{as_of, on_time_probability, risk_band, deadline_at}` 追加到 hook-owned sidecar（复用 `runtime.*` 簿记同型·不进窄腰）。累积后即得「预测 vs 实际」配对，可直接跑 reliability diagram。

累积 ~数十场带 DDL 的真实编排后（估计数周 dogfood），即可用真实 `--as-of` 回放做经验校准，把 §5.4 的保守起点阈值换成 holdout 证据固化的合同值（对照 `grounding-skill-evals` 的 predict-then-validate·防过拟合）。**在此之前，v1 阈值保持 `uncalibrated-conservative`。**

---

## 附录：可复现产物

全部脚本 seeded·确定性·node 直接跑（见 [`spike-deadline-risk/README.md`](spike-deadline-risk/README.md)）：
- `selfcheck.mjs`（19 断言全绿）· `latency-bench.mjs`（§2 数据）· `data-inventory.mjs`（§3.1/3.2）· `scheduler-calibration.mjs`（§3.3/3.4）· `demo.mjs`（§1.2/§4 五态）。
- 核心可移植：`channels.mjs`（三通道 + `empiricalCdfAtOrBefore`）· `deadline-risk.mjs`（§4.3 verdict）· `graph.mjs`/`prng.mjs`/`sampling.mjs`（引擎已有·spike 自包含镜像）· `board-io.mjs`（⚠ 校准简化·D3B 丢弃换引擎）。
