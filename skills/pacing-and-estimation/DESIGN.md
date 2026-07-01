# pacing-and-estimation — 设计宪法（DESIGN.md）

> 本仓 DESIGN.md 统一 6 段（`curating-skill-portfolios` 约定）。本文回答「这 skill 是什么 / 为什么」；「怎么用」在 SKILL.md。任何对 SKILL.md 的实质改动先在此更新对应段。
> 立项依据：2026-06-29 skill-portfolio-rework 设计计划（SKILL3，用户拍板「抽 1 个顶层 skill 求可发现性」覆写 2026-06-26 报告「做成 A 的 reference」判定）+ ADR-019。

## 1. One-liner

在跑 long-horizon 目标、要把一场长跑对照 5h/7d 配额窗口配速、或要估算工期/风险/选模型档时调用——给 agent **消费 ccm 只读 advisory（usage/estimate/baseline）的机制知识**：怎么读单侧走廊 verdict（ADR-024·hold/throttle/switch/stop_5h/stop_7d）、四档模型相对成本、配额信号源链、估算诚实字段；覆写「estimate 整轴 out-of-mind 从不被召回」的默认失败。**ccm 出 verdict、A 决策**——本 skill 只教消费层，决策回 orchestrating-to-completion。

## 2. Craft 自分类

- **Craft**：**B 心智模型为主 + A 机械配方**（命令 schema / 字段速查 / 档位表下沉 reference）。
- **process-control 轴**：**弱**——它不是序敏感的纪律 loop，而是按需 consult（在 dispatch / recon / replan 拍查 advisory），不强制每回合跑。
- **cognitive-override 轴**：**中**——价值在 **B.2 触发召回**（estimate 整轴 out-of-mind，顶层 description 才召回），**不在 B.1 倾向覆写**（pacing 不是 agent 会合理化掉的纪律）。
- **形状蕴含**：**命名锚为主**（哪个 verb 何时查 / 读哪个字段 / 触发什么判断），命令面机械细节 + 模型档位表下沉 reference；**不配重型 Rationalization Table**——pacing / tiering 的 subagent pressure baseline（model-tiering ×6、usage-pacing ×2）实证**零失败**，skillsmith 铁律禁止为一条 agent 根本不会违背的规则编造重型纪律 prose。多数内容靠「使用验证」（trigger eval + dogfood），不跑 pressure baseline。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角 —— 对 cc-master 这个产品 / portfolio 而言

补 charter ②（控 token 消耗速度）④（分解/规划）⑤（资源下最大化效率）⑥（按难度选档）的**消费层**——ccm 工具（`usage`/`estimate`/`baseline` 只读 advisory namespace·ADR-015）已就绪、消费指导此前埋在 SKILL A 的 `cost-and-pacing.md` reference 里**跳层、不被召回**（前序报告 §3 根因 2「estimate 整轴缺席」）。本 skill 是把消费知识升成**顶层可发现 skill** 的正解。**不能被 A 覆盖**：A own「该不该减速/加速/换号/replan」这个**决策**，H own「决策前怎么读这些 advisory」的**消费机制**——红线 3 正交（这正是 ADR-015「ccm advises 不 decides、orchestrator 决策」在 skill 层的镜像）。

### 3.2 Agent 视角 —— 对调用这个 skill 的 AI 而言

在 pacing / 估算决策瞬间提供两样东西：① **A.1 新领域知识**——`ccm usage advise` / `ccm estimate forecast` 等全自研命令的输出 schema 与 verdict 语义（ADR-024 单侧 enum：hold/throttle/switch/stop_5h/stop_7d、p50/p80/p95、CPI/SPI、风险指数）、四档模型相对 multiplier、5h/7d 信号源链、估算诚实字段——这些 agent 先验不携带、推不出来、必须教；② **B.2 触发召回**——顶层 description 让 agent 在「该 forecast 工期 / 查 EVM 偏差 / 读 risk flag」时被 router 主动召回，克服「estimate 整轴 out-of-mind」。不用它会怎样退化：estimate 整轴零消费（forecast/EVM/risk 工具空转）、pacing 凭感觉不读 verdict、模型档位乱选。

### 3.3 Human 视角 —— 对最终落地的用户 / 维护者而言

用户的长跑被**配额感知地**驱动（不半截撞墙、不白白蒸发额度）、工期/风险有**诚实区间**预测可看（非假精确点估）、模型档位按难度选省 token。用了/没用可观察区分：用了的会在决策点留下「查了 `advise=throttle` 故降档 / 查了 `forecast` p80 超期故 surface 用户」的痕迹，没用的撞墙才发现、或工期估歪。

## 4. 责任边界

### 4.1 IN scope

- **消费 ccm 只读 advisory** 的读法 + 字段解读 + 喂回 orchestrator 判断：`usage`（show/advise/task-cost/burn-rate/runway）· `estimate`（show/forecast/evm/velocity/risk/cost-to-complete）· `baseline` 生命周期。
- **模型四档位事实**（Fable/Opus/Sonnet/Haiku 相对成本心智 + 当前可用性约束）+ 按难度选档的事实映射 + 为何主线固定一个模型（prompt-cache）。
- **5h/7d 配额信号源链**（`ccm usage advise` 走廊 verdict 首选 / sidecar 由 ccm 自带 `ccm statusline` 自动落 / 诚实天花板）+ effective-N 缩放节奏的消费。
- **估算诚实字段怎么用**（coverage_pct / source / confidence / conformal 区间 → 何时降低对预测的信任权重）。

### 4.2 OUT of scope（明确移交给谁）

| 关切 | 移交给 |
|------|--------|
| 该不该减速/加速/换号/replan（**编排决策**）+ 7d 总闸 surface 动作 + 换号 lever 阶梯 / policy 授权 / 绝不自授权 | `orchestrating-to-completion`（A·镜头 5/2/7 + 决策程序 §(f) + `references/cost-decisions.md`） |
| ccm 命令**怎么敲**（flag/positional/exit code）+ account 录号/换号/选号操作 + board 字段填什么 | `using-ccm`（D·command-catalog + account-pool.md） |
| 号池机制实现 / vault 安全 / 选号算法（**实现**） | ccm 引擎 `@ccm/engine/account`（+ D 的 account-pool.md 概念叙事） |
| pacing 走廊数学 / 估算 OR-ML 算法（**实现 SSOT**） | ccm 引擎 `@ccm/engine/usage`·`estimate`（H 只消费 verdict，不复述数学） |

### 4.3 Boundary heuristic（一句话判定法）

「**读完这个 advisory 该怎么解读** → H；**读完之后该不该据此行动** → A；**这条 advisory 命令怎么敲出来** → D。」

## 5. 触发与反例

### 5.1 Recognition cues（应当被触发的信号）

- 要把长跑对照配额窗口配速；纠结升档还是降档。
- 要估目标 ETA / 查进度偏差（EVM）/ 看综合风险 / 算 cost-to-complete。
- 要读 `ccm usage advise` / `ccm estimate forecast` 的输出、不知道哪个字段是什么意思。
- 配额逼顶要判该不该换号的**读 usage 那一半**（决策那一半归 A）。

### 5.2 Counter-examples（明确不该被触发的反例）

- 「该不该并行派这几个任务 / 该不该换号 / 该不该 surface 用户」→ A（决策）。
- 「`ccm task done` / `ccm account switch` 怎么敲」→ D（命令面）。
- 「workflow 里 pipeline 还是 parallel」→ B。
- 「怎么把目标切成 DAG」→ E；「把一个任务优化到验收的循环」→ F。

### 5.3 Pre-flight gate（硬门，任一不满足就 STOP）

- (i) 确在 long-horizon 编排上下文（有 board、`ccm` 可达）；账户信号不可得时 advisory 多半 `available:false`，按降级处置。
- (ii) 改任何 judgment-bearing 段（若日后新增）前先跑 pressure baseline——但 H 主体是 reference 知识（pacing/tiering baseline 零失败），多数内容靠「使用验证」、不跑 baseline。

## 6. 演化锚

- **Lifecycle class**：**scaffolding**（脚手架）——它补的是「当前模型不携带 ccm 自研命令 schema + 不会自发召回 estimate 轴」这个弱点。
- **Sunset trigger**：若未来模型能从 `ccm <ns> --help` 自发学会消费 advisory 且主动召回估算轴（B.2 不再需要顶层 description 撑），H 可折回 A 的 reference。模型档位表 / 信号源是会 stale 的事实快照（SSOT 在 `claude-api` skill / 官方文档 / ccm 引擎），H 只是消费视图——这强化 scaffolding 定位。
- **Fitness 不变量 → 可跑 probe**：
  - ① H 不复述 pacing 数学 / 估算算法（SSOT 在引擎）→ grep H 正文无走廊公式 / MC 算法实现，只有「调 `ccm usage advise` 读 verdict」→ 人审 + dogfood。
  - ② H 与 A 不重叠 → 两者 description 的 Use-when / 反例互指闭合 → Track A trigger eval（`evals/trigger.json`）。
  - ③ ccm 命令 schema 变 → H 随 ccm 锁步（同 §6 using-ccm 锁步精神：H 的命令面引用须与 ccm 真实 verb 对得上）→ 改 ccm `usage`/`estimate` 命令面的 PR 须同步 H。
- **Cross-major review owner**：`curating-skill-portfolios`。
