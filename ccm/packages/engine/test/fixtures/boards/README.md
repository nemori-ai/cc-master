# 估算 / 配速引擎验证集 board fixtures

> 这是 ccm OR/ML 估算 + 配速引擎（`usage` / `estimate` / `baseline` namespace，ADR-015）的**版本控制持久化验证集**。三用途合一：① 算法端到端测试 ② 未来迭代回归 ③ backtest（`--as-of` 回放）验证。
> **与运行时 board（gitignored `.claude/cc-master/`）严格分开**——这里的 board 是 repo 资产，手工构造、可读、可复现、可解释（非随机生成）。
> 规格权威来源：`design_docs/plans/2026-06-25-estimate-usage-namespaces.md` §12（fixture 规格）+ §3/§4（算法层 / 历史语料）。数据模型 SSOT：`packages/engine/src/board-model.ts`；校验规则 SSOT：`packages/engine/src/board-lint-core.ts`。

所有 fixture：`schema: "cc-master/v2"`，时间锚全部严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）。基准「现在」≈ `2026-06-25T13:00:00Z`，归档板往前铺开约 10 周。

---

## 目录树

```
boards/
├── home-corpus/                          ← 多板 home 模拟：7 块归档板（owner.active:false），喂跨板历史语料 loader
│   ├── archived-01-auth-service.board.json     (auth-service · OAuth PKCE · ~10 周前)
│   ├── archived-02-auth-mfa.board.json         (auth-service · TOTP MFA · ~8 周前 · 含最重的估偏长尾之二)
│   ├── archived-03-pipeline-etl.board.json     (data-pipeline · CDC 迁移 · ~7 周前 · 含 workflow / shell-like 无 token 任务)
│   ├── archived-04-dashboard-charts.board.json (web-dashboard · 实时图表 · ~5.5 周前 · 估值整体贴合)
│   ├── archived-05-pipeline-dedup.board.json   (data-pipeline · 去重重排 · ~4 周前 · 含语料最大长尾 R3)
│   ├── archived-06-dashboard-export.board.json (web-dashboard · 报表导出 · ~2.5 周前 · 欠估侧聚集)
│   └── archived-07-ccm-lockcli.board.json      (cc-master/ccm 自身 repo · board-lock CLI · ~1 周前 · 最近 recency)
├── current/                              ← 当前在跑的板
│   ├── baseline-example.board.json             (P1 既有 · baseline 段 + EVM 最小语料)
│   └── active-estimate-engine.board.json       (复杂主板 · 见下「current 场景覆盖」)
└── edge/                                 ← 边界 / 错误路径
    ├── cold-start-empty.board.json             (冷启动 · 全新板无任何 done 任务 · 无历史)
    ├── single-board-thin-corpus.board.json     (单板语料极少 · 仅 2 个 done · 低置信路径)
    ├── all-missing-estimate.board.json         (5 个 done 任务全无 estimate 字段 · throughput-only 模式)
    └── intentional-error-cycle.board.json      (★故意带 GRAPH-CYCLE · 错误路径 fixture · 见下)
```

---

## home-corpus —— 跨板历史语料底座

模拟一个真实 home 下沉淀的 7 块**归档板**（`owner.active:false`，像 `/stop` 归档但保留全部 `tasks`/`log`，符合 ADR-009）。时间戳横跨约 10 周（`2026-04-13` → `2026-06-19`），体现 recency 衰减（远的 auth-service、近的 ccm-lockcli）。

**喂哪些算法**：跨板历史语料 loader（多层收缩 hierarchical partial pooling）/ EWMA 分层校准 / k-NN 案例推理 / conformal（Mondrian 分组）/ velocity 吞吐 / SLE cycle-time 分位 / task-cost 聚合。

### 关键统计（基准 now=2026-06-25T13:00:00Z 算 actualHours = finished − started）

| 维度 | 值 |
|---|---|
| 归档板数 | 7 |
| **done 任务总数** | **40**（全部带 estimate + 三时间锚，皆可算「估 vs 实测」） |
| repo 跨度（喂 repo-match k-NN） | auth-service 13 · data-pipeline 12 · web-dashboard 11 · cc-master/ccm 4 |
| type 跨度（喂 Mondrian conformal / k-NN） | development 23 · design 7 · pr 4 · e2e-integration 3 · doc-alignment 2 · development-demo 1 |
| executor 跨度 | subagent 27 · master-orchestrator 11 · workflow 2 |
| model 档位（喂 tier 校准 / #34 档位成本） | sonnet-4-5 23 · haiku-4-5 12 · opus-4-5 4 · 无 1 |
| tier 跨度 | mid 16 · cheap 12 · 无 12（design/pr/doc 类不标 tier） |
| token 覆盖（喂 task-cost / coverage_pct） | 有 token 34 · **无 token 6**（4 个 pr + 1 个 lint/CI + 1 个 shell-like infra 任务，自然不产 token） |
| token 合计 in / out | ≈ 2.89M / 0.77M |

### 估偏分布（喂 EWMA 校准 + k-NN + conformal 的核心信号）

刻意做成**真实软件开发的右偏（log-normal 形）分布**——估值系统性偏乐观（planning fallacy），主体贴合、有欠估、有重超估长尾：

| 指标 | 值 |
|---|---|
| 全局 act/est | **1.38**（总估 105h vs 总实测 ≈144h——估值整体偏乐观） |
| ratio 分位 min/p25/p50/p75/p90/max | 0.67 / 0.92 / **1.17** / 1.38 / 2.15 / 3.06 |
| 欠估（ratio<0.9） | 9 个（最快 E1 估2h实1.33h，x0.67） |
| 大致估准（0.9–1.25） | 15 个 |
| 中度超估（1.25–1.8） | 11 个 |
| **长尾重超估（>1.8）** | 5 个：M3 x3.06 · R3 x2.63 · P6 x2.5 · M5 x2.38 · A3 x2.15 |

> 欠估侧主要聚在 `archived-06-dashboard-export`（小任务、熟路）；最大长尾在 `archived-05-pipeline-dedup` R3（乱序重排迟到语义反复，估4h实10.5h）。每块板的 `log[]` 里有 `kind:"finding"` 条目叙事性记录了为什么超/欠估，便于人读。

---

## current —— 当前在跑的板

### `baseline-example.board.json`（P1 既有）
含 `baseline` 段（captured_at/t0/task_estimates/dag_snapshot/bac_h/history）+ 5 节点小 DAG + done/in_flight/ready 混合。EVM + `baseline` noun 的最小 e2e fixture。

### `active-estimate-engine.board.json`（复杂主板 · 单板覆盖多场景）

模拟正在用 ccm 实现估算引擎本身的编排板（cc-master/ccm repo，与 archived-07 同 repo → 喂 repo-match 历史）。一块板覆盖 §12.1 `current` 要求的全部场景：

| 场景 | 落点 | 喂哪个算法 |
|---|---|---|
| `baseline` 段 | board.baseline（9 任务 task_estimates + dag_snapshot + bac_h=29） | EVM / Earned Schedule |
| **DAG + 临界路径** | 9 节点（C1..C9），加权最长路 **C1→C2→C4→C6→C8→C9 = 20h** | 估算-DAG-MC / RCPSP / CI/CRI/SSI |
| **混合 status** | done 3（C1/C2/C3）· in_flight 2（C4/C5）· ready 2（C6/C7）· blocked 2（C8/C9） | readySet / 调度 |
| **aging WIP** | C5 started=2026-06-23T14:00 → age ≈ **47h**（远超 C4 的 4h） | SLE / WIP-aging（age>SLE_P85→at_risk） |
| **缺 estimate 任务** | C7（无 estimate 字段） | throughput 模式 fallback / coverage_pct |
| **shell-like 无 token 任务** | C7（无 model / 无 observability——纯 shell 基准床） | coverage_pct 降级 |
| **异质 type/executor/tier** | exec：subagent 7 / master-orchestrator 1 / user 1；model：opus/sonnet/haiku；tier：mid/cheap/无 | Mondrian conformal 分组 |
| **awaiting-user 决策点** | C9（blocked_on:"user" + 完整 decision_package） | HITL 延迟 / 风险清单 |

> 注：v2 board-model 的 `executor` 枚举无 `shell` 值——「shell 任务」用 `executor:"subagent"` + 无 `model` + 无 `observability`（即无 token 遥测）表达，这是引擎能识别的「无 token」信号。

---

## edge —— 边界 / 错误路径

| fixture | 场景 | 预期行为 / 喂什么 |
|---|---|---|
| `cold-start-empty.board.json` | **冷启动**：全新板，2 个任务全是 ready/blocked，**零 done**，home 无历史 | 算法须退原估值 + 标 `no-history`/`low-confidence`，不得崩 |
| `single-board-thin-corpus.board.json` | **单板语料极少**：仅 2 个 done 任务 | 多层收缩各层 N<3 → 一路向上退化 + 标低置信；conformal 样本不足降级 |
| `all-missing-estimate.board.json` | **全缺 estimate**：5 个 done 任务**无一带 estimate 字段** | 估算-DAG-MC 无估值可喂 → **throughput-MC（#NoEstimates）主导**；测吞吐通道 |
| `intentional-error-cycle.board.json` | **★含有向环（故意错误）**：X1→X3→X2→X1 | **错误路径 fixture**——故意触发 `GRAPH-CYCLE`，测算法/lint 的错误处理；**唯一一块预期带 error 的 fixture** |

> 命名约定：`intentional-error-*` 前缀 + 文件内 `goal` 字段显式标注「INTENTIONAL ERROR FIXTURE」——清楚它不是坏数据漏网，是有意构造的错误路径语料。lint 对它**恰报一条 `GRAPH-CYCLE`**，无其它噪声。

---

## lint 自检约定

每块「正常」fixture **必须 lint 干净**（`errors:[]` 且 `warnings:[]`）；唯一例外是 `edge/intentional-error-cycle.board.json`——它**恰有一条 `GRAPH-CYCLE` error**、无其它。

自检方式（引擎 dist 须最新）：

```bash
cd ccm && pnpm -w build   # 确保 @ccm/engine dist 最新
node -e '
const { lintBoard } = require("./packages/engine/dist/index.cjs");
const fs=require("fs"), path=require("path");
const root="packages/engine/test/fixtures/boards";
for (const dir of ["home-corpus","current","edge"]) {
  for (const f of fs.readdirSync(path.join(root,dir)).sort().filter(f=>f.endsWith(".json"))) {
    const r=lintBoard(fs.readFileSync(path.join(root,dir,f),"utf8"));
    console.log(dir+"/"+f, "errors=", r.errors.map(e=>e.rule), "warnings=", r.warnings.map(e=>e.rule));
  }
}'
```

> `index.mjs`（ESM）与 `index.cjs`（CJS）导出同一个 `lintBoard`；上面用 `require` 走 CJS。

---

## 维护纪律（fixtures 随算法长期演进）

- 新增算法 → 加一块覆盖该场景的 fixture +（property / golden / 必要时 backtest）断言（TDD 风格：先有 fixture + 断言，再实现）。
- golden 值由 **seeded 确定性**保证可复现（`--seed` + fresh PRNG，见 plan §7 确定性）；算法改动导致 golden diff = 有意的、需 review 更新（property 测试兜「意外退化」）。
- backtest（验证集本义·ML holdout）：用命令面 `--as-of <past>` 把板的「未来」遮住、forecast as-of 过去某刻、对照实际 realized 打分（呼应 grounding-skill-evals 的 predict-then-validate 反过拟合纪律）。
- 改动任一 fixture 后必跑上面的 lint 自检；改 estimate/时间锚后注意 actualHours = `finished − started`（**同日内**才是真实工时——跨日 wall-clock 会虚高，本验证集已刻意把所有耗时收敛在同日内）。
