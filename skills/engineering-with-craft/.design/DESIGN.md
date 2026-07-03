# engineering-with-craft — 设计宪法（DESIGN.md）

> 本仓 DESIGN.md 统一 6 段（`curating-skill-portfolios` 约定）。SKILL.md 实质改动先在此更新。

## 1. One-liner

给在 **design → build → test** 动手的**执行 agent** 的工程手艺：把 **DDD / SDD / TDD / OOP** 的最佳实践、哲学与品味带进活里——整合成**五条共享根**（不变式即锚 / 契约即 SSOT / 组合优于包装 / 分层思维 / 证据优于声称）+ 几条工程红线。

## 2. Craft 自分类

**Craft B 心智模型 / 框架为主**（cognitive-override 强），叠一层**工程红线**（principle-level，**非** baseline-fortified）。body 以**五条命名根 + 四理论接力**为骨，深度进 4 个 reference（ddd / oop / sdd / tdd）。

- **诊断说明（为何红线段不走 pressure baseline 堵漏）**：建本 skill 时跑了**两个纪律向 pressure baseline**——TDD 铁律（沉没成本+配额+疲劳三压下先写实现还是先写测试）与 no-silent-failure（时间压力下吞不吞异常）。**两个都 GREEN**：强 agent（sonnet）在单步决策上**默认守住** test-first 与 no-silent-failure（「思路新鲜是幻觉压力」「吞异常 = bug 搬家」是它自己说的）。按 **skillsmith 铁律——pressure-baseline gate 只 gate「会被压力合理化掉的纪律 prose」**；baseline 不 RED 就**不许**编造「baseline 逐字捕获」的 Rationalization Table。故本 skill 的红线段按**业界既有工程硬规则 + 对齐 cc-master gate-green≠passed** 陈述，不伪造压力测试背书。这与 dev-as-ml-loop 同款诚实处置（Probe-A 增量，非 Probe-B 覆写）。
- **价值在哪**：不在「堵一条 agent 会合理化的纪律」（baseline 证实它单步不缺），而在**给一个缺乏统一工程框架的执行 agent 一套连贯的根**——让它在设计时会想到「先找不变式 / 先定合约」、写类时有「四柱 + SOLID-as-judgment」的透镜、不写贫血模型 / god class / idle wrapper。这是**框架 / 知识缺口**，靠连贯性 + 有用验证，不靠 RED。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角

补**执行侧 plane 的手艺内容空白**：E 只**切**、F 只给循环**形状**（理论无关的元过程）、A **不演奏**——谁告诉那个动手的 agent「领域怎么建模 / 类怎么写好 / 要不要 spec-first / test-first 怎么执行」？本 skill 是这层手艺，与 F 不同 plane（F 是循环的形状，本 skill 是带进循环的内容）。

### 3.2 Agent 视角

给执行 agent 一套它不会自发凝出的**工程脊椎**：把 DDD/OOP/SDD/TDD 从四张互不相干的清单，收成**同一组根的不同切面**。最承重的是「四理论一条脊椎」这个 reframe——根对了，agent 在 design/build/test 各处的判断彼此印证而非割裂。

### 3.3 Human 视角

更少贫血模型 / god class / idle wrapper / spec 漂移 / 测了 mock 没测世界；领域边界划得更准、合约定得更早、实现更对得上 spec——交付质量与可维护性同时受益。

## 4. 责任边界

### 4.1 IN scope

执行 agent 在 design/build/test **写真实代码**时的工程手艺与红线：领域建模（DDD）、写类品味（OOP）、spec-first（SDD）、test-first 纪律（TDD），统一在五条根下。

### 4.2 OUT of scope（明确移交给谁）

| 不归本 skill | 归谁 |
|---|---|
| 该编排什么 / 怎么派发 / 排期 / 端点验收 | `master-orchestrator-guide`（A） |
| 怎么把目标**切**成带验收的任务 DAG（交付计划轴） | `slicing-goals-into-dags`（E） |
| 把一个任务**迭代优化到验收**的**循环形状本身** | `dev-as-ml-loop`（F·不同 plane） |
| 怎么用 ccm 把任务 / 结果写进 board | `using-ccm`（D） |
| workflow 脚本怎么写 | `authoring-workflows`（B） |

### 4.3 Boundary heuristic（一句话判定法）

「我在**动手写代码**——这个领域 / 类 / 合约 / 测试**该怎么建得好**」→ 本 skill；「该做什么 / 怎么切 / 怎么派 / 循环怎么转 / 怎么落库」→ A / E / F / using-ccm。**与 F 的细分**：F 是「怎么迭代逼近验收」的元循环；本 skill 是「这一轮里手上的领域 / 类 / 合约 / 测试**本身**该长什么样」的内容。

## 5. 触发与反例

### 5.1 Recognition cues

要设计一个模块 / 给领域建模 / 划 bounded context；写类纠结继承还是组合；要不要先写 spec / 先写测试；这个抽象值不值；怎么躲开贫血模型或 god class；实现和 spec 对不上；mock 和真后端行为不一致。

### 5.2 Counter-examples

编排 / 派发 / 排期（A）；切目标成 DAG（E）；执行循环形状 / plateau→restart（F）；ccm 写 board（using-ccm）；workflow 脚本（B）；**纯理论课本查询**（「SOLID 的 L 课本定义是什么 / 拓扑排序算法原理」——本 skill 教**应用**这些理论的品味，不是术语词典）。

### 5.3 Pre-flight gate

- 本 skill 主体是 Craft B 框架，**不走 pressure baseline**（铁律不 gate 框架）；改根 / 接力结构前确认它**仍连贯**、四理论仍彼此印证、与五根不漂移。
- **红线段例外纪律**：若未来要把某条红线**升级**为带 Rationalization Table 的 Craft C 纪律段，**必须先跑出该红线的 pressure baseline RED**（现两条已测 GREEN——TDD 铁律 / no-silent-failure，不得无 RED 强写）。
- `description` 改动前后跑 Track A（尤其确认纯理论 near-miss、E/F/A/using-ccm near-miss 不误触发）。

## 6. 演化锚

- **四理论之外要纳入新理论 / 范式**（如 FP / 契约式设计 DbC）→ 先过 `curating-skill-portfolios`：它是新增一条根 / 一个 reference，还是已有根的皮？守「五根 + body ≤ 一屏可握」。
- **某条红线在 dogfood 里被证实 agent 真会在压力下合理化** → 跑 baseline，RED 才升级为 Craft C 纪律段（届时它才从 principle 变 fortified rule）。
- **omne-next 对应理论 skill 演进出新通用洞察** → 蒸馏回流到对应 reference（守「只留通用、剥项目专属」铁律）。
- **board `acceptance` / cc-master 红线模型变** → 同步根 5（证据优于声称）的接地表述。
