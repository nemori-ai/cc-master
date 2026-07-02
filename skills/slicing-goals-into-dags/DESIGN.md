# slicing-goals-into-dags — 设计宪法（DESIGN.md）

> 本仓 DESIGN.md 统一 6 段（`curating-skill-portfolios` 约定）。SKILL.md 实质改动先在此更新。

## 1. One-liner

教 orchestrator 把一个目标 / epic **切**成一张 board DAG——纵切成薄的、端到端可 ship 的增量，粒度为并行与节奏而定；**不**按技术层横切、**不**大爆炸一坨。

## 2. Craft 自分类

**Craft B/C 混合**（cognitive-override 强、process-control 中）：主体是**心智 + 品味**（纵切 vs 横切、walking skeleton、粒度手感、价值/风险排序），配少量纪律 backstop（纵切优先、粒度为并行）。

- **诊断证据**：pressure baseline **RED 已捕获**（sonnet，三压下拆"个人记账 app"）——受试 agent 按技术层**横切**（脚手架 → schema → 全部 API → 全部前端 → 测试），逐字第一反应"schema 要一次定干净，不然 API 要返工"，并自承造成 `T1→T2` serial 瓶颈（并行度=1 直到 schema 完）+ 用户要到最末才摸到可用功能。这条 RED 已回填 SKILL.md 心智锚 1 的 Rationalization Table（三行逐字合理化）。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角

补 A 的缺口：A 的 `decomposition.md` 给的是**定量排期**（CPM / float / 临界路径——一张**已切好**的 DAG 怎么排），**没给定性切分的方法论**（怎么切出一张好 DAG）。本 skill 是"**切**"的那一半，A decomposition 是"**排**"的那一半。两者互补、不复述（红线 3）。

### 3.2 Agent 视角

override 三个默认错误：① **横切分层**（serialize + 把价值推到最后）② **大爆炸节点**（粒度过粗、并行度=1）③ **瀑布顺序**（先设计全部再实现）。给 agent 纵切 / walking-skeleton / 价值·风险优先的 carve 品味——这是 B 强覆写。A 增量中等（纵切是已知敏捷概念，但默认不会应用到 board-DAG 切分 + cc-master 的 cadence/iteration 模型上）。

### 3.3 Human 视角

更快摸到第一个可用增量（**开发节奏**痛点）+ 更高安全并行度（**派发效率**痛点）——用户点名的两个痛点正是本 skill 的 J。

## 4. 责任边界

### 4.1 IN scope

怎么把目标切成 DAG：纵切薄增量 / walking skeleton / 粒度手感（为并行 + 为可验收）/ 按价值·风险排序 / 切片映射到 board 的 `task` · 嵌套 sub-DAG · `cadence`/`iteration` timebox。

### 4.2 OUT of scope（明确移交给谁）

| 不归本 skill | 归谁 |
|---|---|
| 一张**已切好**的 DAG 怎么排期（CPM / float / 临界路径 / 并行度计算） | `master-orchestrator-guide` 的 `decomposition.md` |
| 切好后怎么**派发**（选 shell / subagent / workflow + parallel/pipeline 形状） | A（dispatch）+ `authoring-workflows`（workflow 写法） |
| 单个 task 怎么**执行**到验收（dev loop） | `dev-as-ml-loop`（#7·ML 过程 dev loop） |
| 怎么用 ccm 把这些 task **写进** board | `using-ccm` |

### 4.3 Boundary heuristic（一句话判定法）

"怎么**切**出 DAG" → 本 skill；"切好的 DAG 怎么**排 / 派 / 执行 / 落库**" → A decomposition / A dispatch / #7 / using-ccm。

## 5. 触发与反例

### 5.1 Recognition cues（应当被触发的信号）

要把一个目标 / epic 拆成 board 任务图；"这个目标怎么拆才好 / 先做什么后做什么"；定任务粒度；纠结纵切还是横切；想尽早 ship 一个可用增量 / 想最大化并行。

### 5.2 Counter-examples（明确不该被触发的反例）

一张已成形 DAG 算临界路径 / 排期（A decomposition）；workflow 脚本 fan-out 怎么写（authoring-workflows）；单任务怎么实现到验收（#7）；多 active 板消歧 / ccm 命令（using-ccm）。

### 5.3 Pre-flight gate（硬门，任一不满足就 STOP）

- 改纪律段（纵切优先 / 粒度为并行 的硬规则）前先跑 pressure baseline（skillsmith 铁律）。
- `description` 改动前后各跑一遍 Track A trigger eval 比 accuracy。
- 与 A 的 `decomposition.md` 边界若出现复述 → 收敛回"切（本 skill） vs 排（decomposition）"，不双 SSOT。

## 6. 演化锚

- **board 的 `cadence`/`iteration` 模型变** → 同步"切片 → timebox"的映射。
- **dogfood 出现新的切分反模式** → footgun 加行；若是判断型（agent 会合理化）先补 baseline。
- **与 A `decomposition.md` 边界漂移**（出现复述同一份指导）→ 收敛回"切 vs 排"分工。
