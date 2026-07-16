# pacing-and-estimation — 设计宪法（DESIGN.md）

> 本仓 DESIGN.md 统一 6 段（`curating-skill-portfolios` 约定）。本文回答「这 skill 是什么 / 为什么」；「怎么用」在 SKILL.md。任何对 SKILL.md 的实质改动先在此更新对应段。
> 立项依据：2026-06-29 skill-portfolio-rework 设计计划（SKILL3，用户拍板「抽 1 个顶层 skill 求可发现性」覆写 2026-06-26 报告「做成 A 的 reference」判定）+ ADR-019。

## 1. One-liner

在跑 long-horizon 目标、要把一场长跑对照配额窗口配速、估算工期/风险、或在模型分配前读取全机 target 事实时调用——给任意 origin 的 agent **消费 ccm 已产生的 usage/estimate advisory 与 baseline-derived 事实的机制知识**：先读同一份 machine-wide Claude Code / Codex / Cursor target 集合，再按精确 target 下钻 provider 合同与 verdict（Claude 5h/7d、Codex 7d hard ceiling + rolling-24h advisory、Cursor billing period），并读取统一模型 registry、配额信号源链与估算诚实字段；baseline 与 coordination 的写入机制仍归 `using-ccm`，模型与调度选择归 A。它覆写「estimate 整轴 out-of-mind 从不被召回」的默认失败。**ccm 出事实与 advisory、A 决策**——本 skill 只教消费层，决策回 master-orchestrator-guide。

## 2. Craft 自分类

- **Craft**：**B 心智模型为主 + A 机械配方**（命令 schema / 字段速查 / 档位表下沉 reference）。
- **process-control 轴**：**弱**——它不是序敏感的纪律 loop，而是按需 consult（在 dispatch / recon / replan 拍查 advisory），不强制每回合跑。
- **cognitive-override 轴**：**强（stale-prior 覆写，不是 B.1 行为纪律）**——价值在 **B.2 触发召回**（estimate 整轴 out-of-mind，顶层 description 才召回）+ provider 事实覆盖（agent 无法从 prior 推出当前 family×effort 的 benchmark / score/$）；「强」指必须用当前事实替换旧模型先验，不意味着 pacing 是 agent 会合理化掉的重型纪律。
- **形状蕴含**：顶层正文是由唯一 `read-only-capability.json` 结构声明机械生成的**封闭 capability block**，语法只容纳三类动作：读/解释 ccm advisory、引用统一模型 registry、把决策输入交给 A；machine-wide quota 解释与 target/window 合同全部留在 canonical references，所有 origin 看到同一份内容，不再用 origin quota overlay。每个 host 仍可保留真正属于宿主投影的 description、capability profile 与跨 skill path pointer slot，并在 registry 独立声明预期 body SHA-256 与最终 runtime tree 的路径→SHA-256 manifest。projection 先把 canonical、slot/overlay、include 投影到 staging tree，再由不调用 renderer 的 attestor 验证完整 manifest，成功后才发布该 skill，避免生产 generator 或未受约束 reference 自证。命令/状态 mutation 仍路由 D。哪个 verb 读哪些字段与模型档位事实下沉 reference，不在顶层自由追加 procedure prose；**不配重型 Rationalization Table**——pacing / tiering 的 subagent pressure baseline（历史 model-tiering ×6、usage-pacing ×2；2026-07-10 Codex/Cursor 两模式 ×2）实证**零失败**，skillsmith 铁律禁止为一条 agent 根本不会违背的规则编造重型纪律 prose。多数内容靠「使用验证」（trigger eval + dogfood），不跑重型 behavior benchmark。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角 —— 对 cc-master 这个产品 / portfolio 而言

补 charter ②（控 token 消耗速度）④（分解/规划）⑤（资源下最大化效率）⑥（按难度选档）的**消费层**——ccm 的 `usage` / `estimate` 只读 advisory 与 baseline-derived 事实已就绪，消费指导此前埋在 SKILL A 的 `cost-and-pacing.md` reference 里**跳层、不被召回**（前序报告 §3 根因 2「estimate 整轴缺席」）。baseline 和 coordination 的写入 namespace 与命令机制归 `using-ccm`。本 skill 是把消费知识升成**顶层可发现 skill** 的正解。**不能被 A 覆盖**：A own「该不该减速/加速/换号/replan」这个**决策**，H own「决策前怎么读这些 advisory」的**消费机制**——红线 3 正交（这正是 ADR-015「ccm advises 不 decides、orchestrator 决策」在 skill 层的镜像）。

### 3.2 Agent 视角 —— 对调用这个 skill 的 AI 而言

在 pacing / 估算决策瞬间提供两样东西：① **A.1 新领域知识**——`ccm quota status --machine-wide` / `ccm usage advise` / `ccm estimate forecast` 等全自研命令的输出 schema，以及从任意 origin 读取同一 target 集合、再按 target 解读 provider-scoped verdict 的语义（Claude 保留 5h/7d；Codex 只认 7d hard ceiling、rolling-24h 只 advisory、任何 5h 只作 ignored provenance；Cursor 只认 billing period；另含 p50/p80/p95、CPI/SPI、风险指数）、统一 family×effort / score/$ / 配额模式、配额信号源链、估算诚实字段——这些 agent 先验不携带、推不出来、必须教；② **B.2 触发召回**——顶层 description 让 agent 在「该 forecast 工期 / 查 EVM 偏差 / 读 risk flag / 模型分配前查 registry」时被 router 主动召回，克服「estimate 整轴 out-of-mind」。不用它会怎样退化：estimate 整轴零消费（forecast/EVM/risk 工具空转）、pacing 凭感觉不读 verdict、模型分配拿不到当前事实。

### 3.3 Human 视角 —— 对最终落地的用户 / 维护者而言

用户的长跑被**配额感知地**驱动（不半截撞墙、不白白蒸发额度）、工期/风险有**诚实区间**预测可看（非假精确点估）、模型分配拿到当前可用性 / provenance / 能力 / 成本事实。用了/没用可观察区分：用了的会留下「读到 `advise=throttle` + 当前模型 registry 事实后把输入交给 A」「读到 `forecast` p80 超期后把张力交给 A」的痕迹；没用的撞墙才发现、工期估歪、或拿陈旧模型先验决策。

## 4. 责任边界

### 4.1 IN scope

- **消费 ccm 已产生的 advisory / 事实** 的读法 + 字段解读 + 喂回 orchestrator 判断：`usage`（show/advise/task-cost/burn-rate/runway）· `estimate`（show/forecast/evm/velocity/risk/cost-to-complete）· baseline 派生的 `has_baseline` / EVM 字段；不教 baseline 与 coordination 写入机制。
- 顶层 capability 只声明 `read_and_interpret_ccm_advisory` / `reference_model_registry` / `handoff_decision_input` 三种操作；host strategy 只选择同一 registry 的 profile，canonical `SKILL.md` 只保留生成 slot；三宿主最终发布的 `SKILL.md`、canonical references 与 host overlay/include 结果必须逐文件等于 registry 的 host-local manifest。
- **统一模型档位事实 registry**（Claude 四档；Codex GPT-5.6 Sol/Terra/Luna×effort；Cursor 已准入 first-party selectors），以及 provider-neutral 的 selected-target inventory/model/quota envelope 解释：任意 origin 都可读所有 target 的可用性 / provenance / freshness / 相对成本 / 能力边界，具体模型分配、路由与主线固定归 A；精确命令形状归 D。
- **canonical machine-wide 配额信号源链**（Claude 5h/7d；Codex 7d-only hard ceiling + rolling-24h advisory，`five_hour` / 5h 只作 ignored provenance；Cursor billing_period；`ccm usage advise` 的 provider-authoritative 部分优先 / 信号不可得时诚实降级）+ effective-N 可用时的缩放节奏消费；origin 不筛掉异族 target，也不拥有独立 quota 解释 overlay。
- 宿主适配只保留真正 host-specific 的 description、capability/profile 声明与安装后 path pointer；这些 slot 不得改变 machine-wide target 集合、窗口语义或 unknown fail-closed 规则。
- **估算诚实字段怎么用**（coverage_pct / source / confidence / conformal 区间 → 何时降低对预测的信任权重）。

### 4.2 OUT of scope（明确移交给谁）

| 关切 | 移交给 |
|------|--------|
| 该不该减速/加速/换号/replan（**编排决策**）+ 7d 总闸 surface 动作 + 换号 lever 阶梯 / policy 授权 / 绝不自授权 | `master-orchestrator-guide`（A·镜头 5/2/7 + 决策程序 §(f) + `references/cost-decisions.md`） |
| ccm 命令**怎么敲**（flag/positional/exit code）+ account 录号/换号/选号操作 + board 字段填什么 | `using-ccm`（D·command-catalog + account-pool.md） |
| 号池机制实现 / vault 安全 / 选号算法（**实现**） | ccm 引擎 `@ccm/engine/account`（+ D 的 account-pool.md 概念叙事） |
| pacing 走廊数学 / 估算 OR-ML 算法（**实现 SSOT**） | ccm 引擎 `@ccm/engine/usage`·`estimate`（H 只消费 verdict，不复述数学） |

### 4.3 Boundary heuristic（一句话判定法）

「**读完这个 advisory 该怎么解读** → H；**读完之后该不该据此行动** → A；**这条 advisory 命令怎么敲出来** → D。」

## 5. 触发与反例

### 5.1 Recognition cues（应当被触发的信号）

- 要把长跑对照配额窗口配速；纠结升档还是降档。
- 要在模型分配前从当前 origin 读取全机各 target 的 benchmark、可用性、provenance、相对成本与 family×effort 事实，再把输入交给 A。
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
- **Sunset trigger**：若未来模型能从 `ccm <ns> --help` 自发学会消费 advisory 且主动召回估算轴（B.2 不再需要顶层 description 撑），H 可折回 A 的 reference。模型档位表 / 信号源是会 stale 的事实快照（SSOT 在各 provider / host 官方文档与 ccm 引擎），H 只是消费视图——这强化 scaffolding 定位。
- **Fitness 不变量 → 可跑 probe**：
  - ① H 不复述 pacing 数学 / 估算算法（SSOT 在引擎）→ grep H 正文无走廊公式 / MC 算法实现，只有「调 `ccm usage advise` 读 verdict」→ 人审 + dogfood。
  - ② H 与 A 不重叠 → 两者 description 的 Use-when / 反例互指闭合 → Track A trigger eval（`evals/trigger.json`）。
  - ③ ccm 命令 schema 变 → H 随 ccm 锁步（同 §6 using-ccm 锁步精神：H 的命令面引用须与 ccm 真实 verb 对得上）→ 改 ccm `usage`/`estimate` 命令面的 PR 须同步 H。
  - ④ H runtime 不靠 writer target / verb 词表猜责任语义 → `read-only-capability.json` 的 exact schema + canonical closed-template grammar + 三宿主完整 runtime-tree manifest attestation；任何未同步 manifest 的 canonical / renderer / overlay / include 变化都会在该 skill 发布前因 provenance 违规失败。
  - ⑤ 三宿主只允许 description / capability profile / path pointer 的投影差异，quota target/window 解释必须 canonical 且全量一致 → projection 后比较三宿主 canonical references；strategy 不得重新引入 quota interpretation slot。
- **Cross-major review owner**：`curating-skill-portfolios`。
