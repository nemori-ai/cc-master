# dev-as-ml-loop — 设计宪法（DESIGN.md）

> 本仓 DESIGN.md 统一 6 段（`curating-skill-portfolios` 约定）。SKILL.md 实质改动先在此更新。

## 1. One-liner

给**执行 agent** 的心智模型：把 agentic-loop 开发当成一个 **ML 优化过程**——验收 = 目标函数，每一轮"提议 → 测量 → 调整"迭代逼近收敛。

## 2. Craft 自分类

**Craft B 心智模型**（cognitive-override 强 / process-control 弱）：body 以**命名锚为主**（8 个 ML ↔ dev 映射），不是编号步骤。

- **诊断说明（为何不走 pressure baseline）**：本 skill 装的是一套**生产性框架**（Probe A 增量），不是堵一条 agent 会在压力下合理化掉的纪律规则（Probe B 覆写）。**skillsmith 铁律的 pressure-baseline gate 只 gate 纪律型 prose，不 gate 心智模型内容**——后者靠框架的连贯 + 有用来验证，不靠"agent 没它会违规"的 RED。**两个早期 baseline 反而是正向证据**：当目标清晰时，agent 单步上默认就不镀金、不瞎猜、会侦查（GREEN）——这恰说明价值**不在**纪律覆写、**在**给这些分散的好习惯一个统一的"优化"框架根（尤其把"钻牛角尖"从道德缺陷重 frame 为"识别局部最小值 → restart"的可操作信号）。验证 = 框架连贯性（用户判）+ Track A 触发 +（可选）Track B 行为 benchmark。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角

补**执行侧 plane** 的空白：A 协调但**不演奏**、`slicing-goals-into-dags` 只**切**——谁教那个被派去干活的 agent 怎么把一个任务**优化到验收**?ML 隐喻是 cc-master 的签名（board `acceptance` = 两态 objective function），本 skill 是它在**执行侧的延伸**。

### 3.2 Agent 视角

给执行 agent 一套它不会自发推导的**优化框架**：把"线性把活干完、一次写对"换成"带测量的迭代优化"。最承重的一锚是 #5——把模糊的"别钻牛角尖"换成"plateau = 局部最小值 → restart 换方向"这个**可识别、可操作**的信号（沉没成本是局部最小值的引力，不是继续的理由）。

### 3.3 Human 视角

更少 gold-plating / 过拟合、更快收敛到**真验收**（而非"我觉得完美"）、卡住时会换方向而非死磕——开发节奏与质量同时受益。

## 4. 责任边界

### 4.1 IN scope

执行**单个带验收任务**的优化心法（8 命名锚）：锚定目标函数（验收）→ 架测量 → 迭代逼近 → explore/exploit 调步长 → plateau 时 restart → 收敛即停 → 拟合意图非用例 → 简单性正则。

### 4.2 OUT of scope（明确移交给谁）

| 不归本 skill | 归谁 |
|---|---|
| 该编排什么 / 怎么派发 / 端点验收（指挥不演奏） | `master-orchestrator-guide`（A） |
| 怎么把目标**切**成带验收的任务 DAG | `slicing-goals-into-dags`（#8，在执行**之前**） |
| 怎么用 ccm 把任务 / 结果写进 board | `using-ccm` |
| workflow 脚本怎么写 | `authoring-workflows`（B） |

### 4.3 Boundary heuristic（一句话判定法）

"一个**已切好、带验收**的任务，怎么把它**优化到验收**" → 本 skill；"该不该做 / 怎么切 / 怎么派 / 怎么落库" → A / #8 / using-ccm。

## 5. 触发与反例

### 5.1 Recognition cues

接手一个 dev 任务要实现到验收；怎么迭代逼近验收；卡在一个方案上越改越深（钻牛角尖）；怎么判断"做完了"；要不要先写测试 / 测量；要不要换方案。

### 5.2 Counter-examples

编排 / 派发（A）；切目标成 DAG（#8）；ccm 写 board（using-ccm）；workflow 脚本（B）；**纯 ML 理论问题**（"讲讲梯度下降 / 过拟合是什么 / 怎么训模型"——本 skill 借 ML 隐喻，但不是 ML 教程，别被 ML 关键词误触发）。

### 5.3 Pre-flight gate（Craft B 专属，与纪律 skill 不同）

- 本 skill 是心智模型，**不走 pressure baseline**（铁律不 gate 框架）；改框架前确认它**仍连贯**、且不与 board `acceptance` 语义漂移。
- `description` 改动前后跑 Track A（尤其确认 ML-理论 near-miss 不误触发）。
- 新增锚前问：它是真给框架补一块（增量），还是把已有锚换皮?守 body ≤ 一屏可握。

## 6. 演化锚

- **ML ↔ dev 映射有新洞察**（如 batch / ensemble / early-stopping 类比）→ 加锚，但守"命名锚为主、≤ 一屏"。
- **board `acceptance` 模型变** → 同步锚 1（目标函数的接地）。
- **dogfood 发现框架某锚反被误用**（如 restart 被滥用成逃避）→ 补该锚的边界，必要时才升为带 baseline 的纪律段（那时它才变 Craft C）。
