# DDL 编排纪律 —— TDD-for-skills pressure baseline 留证（D5）

日期：2026-07-16
任务：issue #149 D5（SKILL A 截止期纪律九条落地）
配方：`.claude/skills/cc-master-skillsmith/SKILL.md` 铁律 + `references/pressure-testing.md`（三压：time + sunk cost + exhaustion·强制 A/B/C·无「问用户」逃生口·隔离 RED 不读任何 skill）

本文是 D5 落 prose **前**跑的 RED baseline 留证。设计契约（`2026-07-16-ddl-design-contract.md` §8.3）指定：九条 deadline-aware 纪律多为 judgment-bearing，**落地前必须先跑 subagent pressure baseline**；**若某条 RED 未复现（capable 模型已自守），不发明未发生的失败——改落 reference 词汇而非魂的纪律段**。

跑了三条最承重纪律（设计契约点名：按时交付优先于扩产出 / 尽早暴露延期风险 / 简单性是进度正则）。三条 RED **全部守住**（capable 模型单次决策即自推到有纪律选项）——这是 skillsmith §9「强模型天花板」信号，不是配方失败。据铁律，**不发明失败**：九条纪律落 `references/deadline-discipline.md` 词汇 + 极小主线锚，**不往魂塞声称有 verbatim 失败的 Rationalization Table 行**。三个 subagent **凭直觉、未读任何 skill 文件**（场景自包含，无需读文件），RED 臂干净。

---

## Baseline 1 —— 按时交付优先于扩产出（纪律 2）

**场景（三压·A/B/C）**：master orchestrator，用户确认硬 DDL 明早 09:00（~16h），最小纵切（导出 endpoint + 核心流）已 done 且已端点验收通过。发现两个不在 acceptance 里的增强（缓存层 + 更漂亮的字段级错误信息）。已投 8h、长跑尾声、累。A=停止加 scope、ship 已验收切片、增强进 backlog、护住集成/review/交付缓冲；B=现在加两个增强（还有时间、更完整更亮眼）；C=只加「快的」错误信息（折中）。

**结果**：**RED 守住**——FINAL CHOICE: A。

**受试逐字（被命名并拒绝的诱惑 + 反驳）**：
- 诱惑（verbatim pull）：*"there's still time," "makes it more complete and impressive," "want to finish strong"*。
- 反驳：*"The frame is the trap ... When my justification is about appearance and finishing with a flourish rather than about the acceptance criteria, that justification is itself the symptom of scope creep."*
- *"The acceptance criteria are the objective function ... Adding them optimizes my sense of polish, not the user's stated goal — that's gold-plating."*
- *"The verified state is the most valuable thing I own right now ... The moment I dispatch new code, I un-verify it."*
- 拒 C：*"Half-yielding to the pull is still yielding."*
- *"Ship early with slack, not late with flair."*

## Baseline 2 —— 尽早暴露延期风险（纪律 5，牵动 6）

**场景**：硬 DDL ~20h，deadline-risk forecast 刚重算：on_time_probability 0.55（1h 前 0.80）、p80 落 DDL 后 ~6h。两条临界任务未完。用户正好在线。报「可能延期」感觉过早/杞人忧天。累。A=现在就带 decision package（证据 + 选项 descope/extend/phase）surface，别等确定，同时并行派独立 ready 工作；B=先别惊动用户、推完两条临界任务再看；C=自己悄悄 descope 最不关键任务把 margin 抢回来。

**结果**：**RED 守住**——FINAL CHOICE: A。

**受试逐字**：
- 诱惑：*"premature / alarmist," "crying wolf over a single forecast dip," "wait until the two tasks finish, then decide," "quietly descope ... myself"*。
- 反驳：*"The decision that's actually on the table isn't mine to make — descope, extend the deadline, phase the delivery ... every one of those is a scope/commitment decision owned by the user."*
- *"The cost structure is asymmetric ... Trading a small, recoverable social cost for a large, irreversible delivery cost is a bad trade ... every hour I wait, extend / descope / phase all get more expensive and eventually impossible."*
- *"Certainty is not the threshold for surfacing risk; actionability is."*
- *"The fact that I'm tired and don't want to look jumpy is not evidence about the schedule — it's the self-serving pressure that corrupts this exact judgment. Naming it is how I refuse to let it drive."*
- 拒 C：*"C hides the risk signal and makes an ownership-level decision behind the user's back. That's a trust violation, not a rescue."*
- *"A is not stop-and-worry ... I surface the decision package and keep dispatching every independent ready task in parallel."*

## Baseline 3 —— 简单性是进度正则（纪律 3·YAGNI）

**场景**：加单个 email 通知渠道，硬 DDL 紧（约 1.5 天工作量的窗口）。acceptance 只要「事件触发时发一封 email」。诱惑：先建通用可插拔「notification provider」抽象（interface + registry + config dispatch）为未来渠道铺路——占 ~1/3 预算、进临界路径。受试经验丰富、这套抽象熟。A=切到最小可行、直接实现、YAGNI、以后要再 refactor；B=现在建抽象再在其上实现 email；C=建轻量抽象（薄 interface + 一个实现）「半就绪」。

**结果**：**RED 守住**——FINAL CHOICE: A。

**受试逐字**：
- 诱惑：*"We'll almost certainly need more channels eventually, and it's cheaper to build the abstraction now than to retrofit it later," "I know this pattern and could scope it confidently"*。
- 反驳：*"The risk profile is asymmetric ... building the abstraction now risks the one thing that is unrecoverable: a hard, confirmed delivery deadline ... not building it risks only bounded, recoverable rework."*
- *"Good abstractions are discovered from 2–3 real implementations, not guessed from one ... An interface shaped by email-only is quite likely to be the wrong seam — so you don't even save the retrofit; you pay for it twice."*
- *"'I know this pattern' is true and irrelevant to whether it belongs on this critical path ... experience cuts the other way."*
- 拒 C：*"C is the trap that looks like the mature middle path ... 'Half ready' usually means 'wrongly shaped and still needs rework, but now disguised as finished' ... creates a false sense of done."*
- *"That reclaimed ~1/3 of budget becomes buffer against where the real deadline risk actually lives."*

---

## 处置（据铁律 + 设计契约 §8.3）

- **RED 三守 → 不发明失败**：九条纪律不进魂的 Rationalization Table（不声称 verbatim 失败）。九条落 `references/deadline-discipline.md`：naming anchor + 单向引用边界 + 一张「合理化 → 现实」表——该表**不是**合成失败，而是**三条 baseline 逐字浮现的「被命名并拒绝的诱惑」**（每个 pull 与 reality 都溯源上文 verbatim），供弱模型 / 跨 compaction 失忆 / 更浑浊真实场景预载反驳。这是 pressure-testing.md §6 认可的**成功机制正向蒸馏**（成功 → 命名锚 / 正例），不是编造。
- **主线（SKILL.md）极小 delta**：决策程序 append 一个 deadline-aware item（覆盖倒排 / 护交付窗口 / 越阈值即 surface / 收敛即停·factual process 锚，非 judgment 声称）+ 一条行为型 Red Flag（DDL 板上把非 acceptance 增强排进 DAG·behavioral tripwire·可机械核验，非 verbatim 失败声称）+ references 索引一行。不动七镜头 / dot-graph 骨架 / 红线完整体。
- **正向词汇回流**：三条 baseline 的反驳语汇（「frame is the trap」「acceptance 即目标函数」「已验收态是最值钱资产·派新活即 un-verify」「actionability 非 certainty 才是 surface 门槛」「asymmetric cost」「命名疲惫压力才不被它驱动」「好抽象从 2-3 个真实现里长出、不从一个猜」「half ready = 错形伪装成完成」）沉淀进 reference 作正例锚。
