# deadline-risk 算法 spike — 可移植核心函数

> 任务 D3A 产出。standalone `.mjs`（零依赖·node 直接跑·不 import 未编译 TS）。D3B 据此把核心移植进
> `@ccm/engine` 的 estimate 引擎 + `ccm estimate deadline-risk` endpoint。配套报告：
> [`../2026-07-16-deadline-risk-spike.md`](../2026-07-16-deadline-risk-spike.md)。

## 怎么跑（全部 node ≥18·本机实测 node v24）

```bash
cd design_docs/spike-deadline-risk
node selfcheck.mjs              # 19 条单测式断言（PRNG 确定性 / CDF / 通道序 / 降级 / band 单调）
node latency-bench.mjs          # 性能预算实测（真实 board + 合成放大图 + trials 降档曲线）·~3min
node data-inventory.mjs         # 数据可得性盘点 + wall-clock↔work-hours 失真实测
node scheduler-calibration.mjs  # 合成图集调度器正确性（coverage/PIT）+ band 阈值 FN↔alert-fatigue
node demo.mjs                   # 真实板端到端 §4.3 输出举例（on_track/watch/likely_late/overdue/unknown）
```

全部 seeded·确定性·可复现（同 seed 同结果）。

## 文件清单

| 文件 | 内容 | D3B 移植去向 |
|---|---|---|
| `prng.mjs` | sfc32 seeded PRNG | **引擎已有** `estimate/prng.ts`——移植时复用现成，勿新建 |
| `sampling.mjs` | log-normal Box-Muller 采样 | **引擎已有** `estimate/sampling.ts`——复用现成 |
| `graph.mjs` | topo/CPM/前驱（spike 自包含子集） | **引擎已有** `board-graph-core.ts`——复用现成 |
| `channels.mjs` | **三通道 + `empiricalCdfAtOrBefore`（载重）** | → `estimate/mc-scheduler.ts`（见下移植清单） |
| `deadline-risk.mjs` | 顶层 verdict 计算（§4.3 schema） | → `apps/cli/src/handlers/estimate.ts` 的 `deadlineRisk` handler |
| `board-io.mjs` | 只读 board + **spike 简化校准** | ⚠ 校准部分**丢弃**·换引擎 `calibrate`/`dispersionCv`/`buildMcParams` |
| `selfcheck.mjs` / `latency-bench.mjs` / `data-inventory.mjs` / `scheduler-calibration.mjs` / `demo.mjs` | 自验 + 度量脚本 | 不移植（spike 证据） |

## D3B 移植清单（函数签名 + 文件对应）

### 1. 引擎缺口补齐（`estimate/mc-scheduler.ts`）——最小、seeded、零算法重写

```ts
// 新增导出 helper（channels.mjs 已验·契约 §4.3 载重）：
export function empiricalCdfAtOrBefore(sortedSamples: Float64Array, target: number): number
//   二分 upper_bound·返回 ≤target 占比 ∈[0,1]·空/NaN→NaN。O(log n)。

// 给 estimateDagMonteCarlo 的返回值加暴露已排序样本（当前算完 makespanSamples 就丢）：
//   EstimateMcResult 增字段 makespanSamplesSorted: Float64Array（或加可选 target 参数直接回 on_time_probability）。
// 给 throughputMonteCarlo 同型加 daysSamplesSorted。
// 推荐「暴露 sorted 样本 + 复用 empiricalCdfAtOrBefore」而非在 MC 里塞 target（两通道复用一个 helper·最小）。
```

### 2. 新算法：RCPSP-in-trial MC（`channels.mjs` 的 `rcpspInTrialMc`）——新增进 `estimate/mc-scheduler.ts` 或 `estimate/rcpsp.ts`

```ts
export function rcpspInTrialMc(
  board: BoardLike, params: Map<string, NodeMcParam>,
  opts: { seed?; runs?; wip?; nowMs?; defaultCv?; defaultMeanHours? },
): { makespanSamplesSorted: Float64Array; makespan: {p50,p80,p95}; mean; node_count; cycle; onTime(target): number }
```
- 结构：静态优先级（min-slack + LFT + id·来自确定性 CPM·**循环外算一次**）→ 每 trial 采样时长跑 serial SGS
  （k 机器槽 min-heap·`indeg`-ready min-heap·**O(V log V)/trial**·杜绝 rcpsp.ts 的 O(V²) filter-ready）。
- ⚠ **必须用堆化版**（`rcpspInTrialMc`），不要用 naive 版（`rcpspInTrialMcNaive` 仅 latency 对比·60-70× 慢·30s 爆预算）。
- 资源槽语义 faithful to `rcpsp.ts`：`slots.size < wip` 开新槽·满则复用最早释放（`busy[]` 逐字对应）。
- 复用 `estimate/rcpsp.ts` 已有的 min-slack/LFT 优先规则口径（本 spike 逐字保持）。

### 3. endpoint（`apps/cli/src/handlers/estimate.ts` 加 `deadlineRisk(ctx)` handler·runRead·read:true）

```ts
// 对应 deadline-risk.mjs computeDeadlineRisk：
//   读 goal_contract.deadline（D2 落·state/at）→ 无/pending/none/含环 → unknown（不 false-green）。
//   通道 A precedenceOnlyMc（乐观下界·optimistic-bound）+ 通道 B rcpspInTrialMc（**唯一** verdict 源）
//     + 通道 T throughputMonteCarlo（**heuristic-reference·绝不映射 on_track**）。
//   on_time_probability 只来自 rcpsp；throughput 降为 channels.throughput_reference（见报告 §通道诚实性）。
//   band 判据用 DEFAULT_BANDS（**explicitly uncalibrated 保守起点**·待 labeled 语料校准）。
//   params 用引擎 buildMcParams（**非** spike 的 board-io 简化校准）。
```

### 4. §4.3 schema 收紧建议（spike 发现·喂 D3B 定形）

- `channels.resource_aware.source` 枚举收紧为**只允许 `rcpsp-in-trial`**；throughput 移到独立
  `channels.throughput_reference`（`kind:'heuristic-reference'`·`on_time_probability_heuristic`·带 `note`）。
- 顶层加 `on_time_probability_source`（`rcpsp-in-trial|unknown`）+ `calibration_status`（`uncalibrated-conservative`）。
- `forecast`/`margin` 加 `basis:'precedence-only-optimistic'` + 诚实标注 wall-clock 映射假设（见报告 §wall-clock 失真）。
- RCPSP 超预算降档：`rcpsp_runs` 可 < `runs`；完全禁用 → `on_time_probability=null` + `band=unknown`（**绝不退 throughput**）。
