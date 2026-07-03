# OBJECTIVE — slicing-goals-into-dags

J_top: orchestrator 把一个目标 / epic 切成 board DAG 时，切出的是**纵向、薄、端到端可 ship 的增量**（而非横切技术层）、地基只前置**最小共享脊椎**（walking skeleton，而非一次定全 / 镀金）、**粒度**让无真实依赖的兄弟节点真能并行且每节点有清爽验收、并按**价值 × 风险**排序——使第一个可用增量**尽早**落地（开发节奏）且安全并行度逼近真实依赖结构允许的上限（派发效率）。

baseline_reference:
  user_task: 给 agent 一个多功能目标（如"个人记账 app:加支出 / 看列表 / 月度图 / 导 CSV"），让它切成一张要派给并行 sub-agent 的 board DAG。
  without_skill_floor: 默认 agent 按**技术层横切**——pressure baseline 实证（sonnet，三压）：切成 脚手架 → schema → 全部 API → 全部前端 → 测试，逐字第一反应"schema 要一次定干净，不然 API 要返工"。后果（agent 自承）：`T1→T2` serial 瓶颈（并行度=1 直到 schema 完）、用户要到最末（全部前端完）才摸到可用功能、那个"定全的 schema"是投机的。
  expected_uplift: 把 strict_dim 从 floor 推过去——纵切薄的端到端增量、地基切到 walking-skeleton 最小脊椎（schema 随纵切增量生长）、粒度为并行 + 可验收而定、按价值/风险排序使最早一片既去风险又交付可用价值。

strict_dims: [切分质量（纵切而非横切技术层 / 地基只前置最小共享脊椎而非镀金一次定全 / 粒度让兄弟真能并行且每节点可独立验收 → 直接产出"早可用 + 高安全并行"）]

rationale: 本 skill 的承重价值在切分那一刀——**怎么切定死了并行度、可 ship 速度、反馈速度的天花板，排期再优、派发再快都救不回一张切坏的图**。默认 agent 在压力下恰恰退化为横切技术层（baseline 逐字捕获"schema 一次定干净"的工程师本能），它同时砸了用户点名的两个痛点（开发节奏：价值堆到最后；派发效率:serial 瓶颈把并行掐成 1）。故"切分质量"是不可回退的 strict 核心；具体切法用语、worked example、cadence 映射是 Pareto-可换的。单条 strict_dim，符合本仓"1-2 个 strict_dims"约束。

## 非目标（notes）

J 不评判**已切好的 DAG 怎么排期 / 算临界路径**（那是 master-orchestrator-guide 的 decomposition）、不评判怎么派发、不评判单 task 怎么执行到验收（dev-as-ml-loop）。只评判"切"那一刀的质量：纵切、最小脊椎、可并行可验收的粒度、价值风险排序。也不要求机械"必须纵切到底"——真共享的最小核心该前置成脊椎（这正是纵切的一部分，不是横切例外）。
