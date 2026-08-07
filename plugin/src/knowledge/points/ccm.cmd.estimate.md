---
point: ccm.cmd.estimate
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.estimate -->
## namespace estimate（只读 advisory）

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

工作侧只读 advisory（分解/规划 + 按时长选档）：消费 ccm 引擎的 OR/ML 算法层（双通道 Monte Carlo / EWMA 校准 / conformal 区间 / EVM+Earned Schedule / SLE / CCPM）。**纯只读**——全 verb compute、零写、不抢 board-lock。**5% 硬墙**：所有预测 `p95` = 95% 分位，**绝不算到 100%**（引擎分位口径保证·真上限是 session hard-stop）。历史语料范围由 `--scope home|this-repo|this-board`（默认 `home`·跨板多层收缩）控制。诚实降级：冷启动 / 数据不足 → 退原估值 + `low`-confidence / `no-history`。seeded 确定性：`--seed` 固定 → MC 复现（默认 42）。ccm 出区间/数据，**不替 orchestrator 决策**。

### estimate show

**读**

- 行为：每任务 raw estimate + EWMA 分层校准乘子覆写（`calibrated_h = raw × multiplier`·同 repo+type+executor+tier 多层收缩）+ conformal 区间（Mondrian 分组·快速瞥）。缺估值/无语料 → `no-history`（退原值）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--json` | | bool | | 结构化输出 |

### estimate forecast

**读**

- 行为：双通道 Monte Carlo——① 估算-DAG-MC（依赖结构感知·log-normal·校准估值）+ ② 吞吐-MC（#NoEstimates·不依赖估值·`coverage<50%` 时主导）→ P50/P80/P95 ETA + makespan + 敏感度三件套 **CI/CRI/SSI**；①②偏差 >20% 出 consistency warning。板有 asserted/confirmed 交付 DDL 时**附 `deadline_risk` 摘要块**（相对 DDL 的 margin/风险 band·复用 `estimate deadline-risk` verdict·不重算）；无 DDL → `null`（不假绿）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--effective-n <n>` | | string | 正整数（默认 1） | 号池有效配额份数：N 路并行配额 → **吞吐通道② 天数 ÷N**（资源型加速）。估算-DAG 通道① 是临界路径 makespan、**不受 N 缩短**（已假设无界并行·见输出 `notes`）。回显 `effective_n` |
| `--json` | | bool | | 结构化输出 |

### estimate evm

**读**

- 行为：EVM（PV/EV/AC → CPI/EAC/ETC/VAC）+ **Earned Schedule**（SPI(t)=ES/AT·SV(t)·IEAC(t)·全程保判别力·修 SPI($) 末期失灵）。消费 `board.baseline`——**无 baseline 降级 warn**（`has_baseline:false`·exit 0·先 `ccm baseline snapshot`）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--json` | | bool | | 结构化输出 |

### estimate velocity

**读**

- 行为：历史吞吐（tasks/day）+ backlog 清空 ETA（P50/P80/P95）+ **SLE**（cycle-time 服务水平期望 P50/P85/P95·Kanban Guide 2020）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--window <n>` | | string | | 滑窗天数：只取 `finished_at` 落在最近 n 天的 done 语料喂 SLE/吞吐/velocity。**缺省（不传）→ 不过滤全语料**（`window_days` 回显 `null`）；传 n → 过滤 |
| `--json` | | bool | | 结构化输出 |

### estimate risk

**读**

- 行为：综合风险——敏感度 **CI/CRI/SSI**（MC 高临界节点）+ **WIP-aging SLE**（在飞任务 age > SLE_P85 → `at_risk`·> P95 → `critical`）+ **CCPM buffer_health**（项目缓冲绿/黄/红区）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--json` | | bool | | 结构化输出 |

### estimate cost-to-complete

**读**

- 行为：清空剩余 backlog 的总**配额%** P50/P80/P95（剩余工作 × 每单位配额%增量·throughput 式 MC·偿付力账本）——每单位 %-增量 = 账户权威 burn-rate（%/h）× 历史任务实测工期（duration-grounded·串行归因假设）；外加 **token 辅助 sizing**（`knnPredict` 预测各 backlog 任务 token·**辅助相对量计·非预算账本**，只把总% 按相对重量切到各任务）。账户 burn 不可得 → `available:false` + `cost_to_complete_pct:null`（exit 0·降级·非 exit 1）；`backlog:0` → cost `0%`。p95 = 5% 硬墙（引擎分位口径·绝不 100%）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--json` | | bool | | 结构化输出 |

### estimate deadline-risk

**读**

- 行为：交付 DDL（`goal_contract.deadline`）风险 verdict——三通道 Monte Carlo 出**准时概率** `on_time_probability` + 分位 margin + 六态 `risk_band` + top drivers。三通道各司其职：**RCPSP-in-trial**（真调度当前 DAG + 吃 `scheduling.wip_limit` 资源竞争）是**唯一 verdict 源**，`on_time_probability` 只从它来；**precedence-only**（无资源闸）只作显式标注的乐观下界（喂 `forecast`/`margin` + 双通道分歧信号）；**throughput** 降为 heuristic 参考（`channels.throughput_reference`·`kind:"heuristic-reference"`）**绝不映射 verdict**。诚实降级（**绝不假绿**）：无 DDL（state ∈ `pending`/`none`/键缺失）/ 图含环 / 无有效预测 / coverage·history 太弱 / 双通道严重分歧（`> 0.25`）/ RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now ≥ DDL` 且未完成 → `overdue`（strong）。band 阈值为 **explicitly uncalibrated 保守起点**（`calibration_status:"uncalibrated-conservative"`·on_track ≥ 0.90 / at_risk < 0.65 / likely_late < 0.40·待 labeled 语料校准）。纯只读零写，hook 只搬运结果、绝不重算
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--runs <n>` | | string | | MC trials（默认 2000·latency 降档阶梯埋好防极端大图） |
| `--json` | | bool | | 结构化输出 |

---

<!-- ccm:k:end point:ccm.cmd.estimate -->

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm 二进制对 estimate namespace（show、forecast、evm 等六个子命令）的具体实现事实

estimate 各 verb 的通道口径、降级取值与 flag 默认值是本引擎的接口事实，不是通用预测方法论。
