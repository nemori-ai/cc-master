# OBJECTIVE — dev-as-ml-loop

J_top: master orchestrator 或执行 agent 处理 dev 任务时，用"开发 = ML 优化过程"框架推进——orchestrator 把 work order 交付成**目标函数 / 测量仪器 / artifact / 约束 / restart-stop / 持续 board ledger**并按 subagent 组件分工调度;执行 agent 先把**目标函数（验收）锚清**（模糊则先锐化）、架好测量、带测量**迭代**逼近（非一次成型）、plateau 时**识别局部最小值并 restart 换方向**（而非死磕沉没成本）、**验收达标即停**（不过拟合 / 不 gold-plate）、拟合**意图**而非用例、同等达标取**最简**;在工作过程中持续把 objective / instrument / hypothesis / last_gradient / next_probe / stop_or_restart 写回 board,让 after compact 可以从 board 续接。

baseline_reference:
  user_task: 给 master orchestrator 一个需要派发的 dev 任务,或给执行 agent 一个带验收标准的 dev 任务（如"搜索接口按相关性排序;验收:top-10 相关、p95<200ms、测试过"），看它是否把任务组织成可测优化问题并推进到验收。
  without_skill_floor: **诚实标注——这里的 floor 不是一个 pressure-RED（已两轮 baseline 证实:目标清晰时 agent 单步上默认不镀金、不瞎猜、会侦查）。** floor 是"默认 agent 缺一套**统一的优化框架**":逐个决策大致对，但没把开发当优化过程的连贯心智——容易线性"写完"而非迭代测量、卡住时凭意志硬撑而非靠"识别 plateau → restart"的可操作信号、对"何时停"缺一个目标函数锚定的统一判据（散落的好习惯，没有共同的根）。
  expected_uplift: 一套连贯框架让这些分散的好习惯有共同的"优化"根——尤其把"钻牛角尖"从模糊的道德告诫转成"plateau = 局部最小值 → restart"的可识别可操作信号;把"先写测试"从规条转成"先架测量仪器才能下降"的必然;把"何时停"统一锚到"目标函数达标"。

strict_dims: [优化框架的连贯应用（验收=objective 锚定 + 带测量迭代 + plateau→restart 不死磕 + 收敛即停不过拟合 + 关键优化状态持续写回 board 以便 after compact 续接）]

rationale: 本 skill 是 **Probe-A 增量**（装一套生产性框架）而非 **Probe-B 覆写**（堵一条会被合理化的纪律）——这是它与本仓纪律型 skill 的根本不同，也是它**不走 pressure baseline** 的原因（skillsmith 铁律只 gate 纪律 prose）。两个早期 baseline GREEN 不是"skill 没用"的证据，恰是"价值在框架、不在纪律覆写"的证据:单步纪律不缺，缺的是把它们统一起来的优化心智。strict 核心是"框架被连贯地应用"，不是某个违规率。单条 strict_dim，符合本仓"1-2 个 strict_dims"约束。

## 非目标（notes）

不要求 agent 背下每个 ML 术语（术语是脚手架，框架才是货）。不评判 agent 在**没有验收**的任务上直接实现的能力——那种任务的正确第一步是锐化目标（锚 1），不是硬优化。也不与纯 ML 工程（训模型 / 调超参）相干——本 skill 只借 ML 的**优化视角**照 agentic-loop 开发，不是 ML 教程。ccm 命令语法 / board 字段规则不是本 OBJECTIVE 的成功条件,那些归 `using-ccm`;本 skill 只要求知道哪些优化信息必须落 board。
