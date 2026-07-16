# Outside-in 纪律 PR（#161，Closes #142）—— codex 第二验收者 review

- **PR**: https://github.com/nemori-ai/cc-master/pull/161
- **跑法**：`codex exec -s read-only`（非 `codex exec review`——后者禁止自定义 prompt 与 `--base` scope 同用），model = repo 默认 `gpt-5.6-sol` @ `model_reasoning_effort=xhigh`，cwd = 本 worktree，diff scope = `git diff origin/main...HEAD`（PR 的全部 13 个改动文件）。
- **Prompt 覆盖四问**：①与现有 SKILL A 纪律冲突/重复 ②红线3（八 skill 不重叠）③自包含合规 ④delta-only 是否真极小没动骨架。
- **Date**：2026-07-16

---

## codex verdict

**`VERDICT: needs-attention`**

> "The outside-in concept is sound and belongs in SKILL A, but I would not approve this version because its board guidance conflicts with the established `judgment_call` model, contains invalid CLI examples, and the claimed RED baseline did not actually fail."

## codex 逐问结论

| # | 问题 | codex 判定 |
|---|---|---|
| 1 | 与现有 SKILL A 纪律冲突/重复 | **concern**——outside-in 三轴划分本身正交、非复述；但组件 A 把 `jc pending_review` 状态机改用成「未验证假设队列」，与 SKILL A §4.6「jc 不是待办队列」冲突；组件 E 有限度地复述了 `goal-contract.md` 的 amendment 机制细节，紧接着又说「本文不复述」 |
| 2 | 红线3（八 skill 不重叠） | **concern**——决策纪律本身归属 A 没问题，不实质侵占 slicing-goals-into-dags / dev-as-ml-loop / engineering-with-craft / pacing-and-estimation；但组件 A 直接写出具体 `ccm` 命令 / 字段 / 枚举值，越界进了 `using-ccm` 的地盘，且举的两个命令例子本身就是错的（见下） |
| 3 | 自包含合规 | **fine**——outside-in.md 与四处 SKILL.md 锚点均未命中 `ADR-NNN` / `Finding #NN` / charter `Cx` / hook `Hx` / `镜头 N` / `design_docs`/`adrs`/`hooks`/`README`/`AGENTS.md`/`CHANGELOG` 引用；跨 skill 提及（`using-ccm`、`slicing-goals-into-dags`）都是裸 skill 名、非文件路径引用，合规；三 host 投影与 canonical 字节一致 |
| 4 | delta-only / 骨架未动 | **fine**——canonical `SKILL.md` 净变更 4 insertions + 1 deletion，四处局部改动（Rationalization Table 一行、Red Flag 一条、reference-index 一行、决策程序「七件→八件」段落追加 item (h)）；决策程序 dot-graph 本身、既有表行/红旗一字未改，纯追加 |

## 其他发现（codex 原始标注 severity）

- **[blocking]** 组件 A 把「一条你据以行动的未验证假设」等同于「一条 `pending_review` 的 jc」，与 SKILL A + `using-ccm` 对 `judgment_call` 的定义冲突——jc 记录的是**已经做过、在授权范围内**的判断，供用户事后知情/复盘，不是一个待验证的开放假设队列。
- **[blocking]** 两处 `ccm` 命令示例有误：
  - `references/outside-in.md:30`（组件 A「用户决策」行）：`` ccm task block --on user --decision @file `` 缺任务 id；command-catalog 与 registry 都要求 `ccm task block <id> --on <str> …`。
  - `references/outside-in.md:28`（组件 A「agent 推断」行）：`` --category architecture/drift `` 不是合法枚举值——`board-model.ts` 的 `jcCategory` 是单选枚举 `['architecture', 'drift', 'spec-impl-misalignment', 'other']`，不支持斜杠组合。
- **[blocking]** 对 `design_docs/2026-07-16-outside-in-baseline-log.md` 的方法学提出质疑：三轮 RED 尝试（含 saturated-context 单情境重试）最终是 **9/9 全 PASS**，没有出现 `cc-master-skillsmith` 铁律要求的「记录在案的（干净）失败」，认为不满足先看到失败、再写 prose 的前置条件。
- **[non-blocking]** 组件 B（触发校准的三条门 AND）与组件 F（豁免的三条门 AND）用的是两组不同的三元条件，codex 认为需要一张统一决策表把两者关系讲清楚，目前容易读出「按哪张表算」的歧义。

## 我方核验（对 codex 每条具体断言逐条查源码/既有纪律，非盲信）

- **jc 语义冲突**：**核实为真**。`plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md:328` 原文「它记录的是『你已经在授权范围内或低于必须升级边界时做过的判断』，**不是待办队列**，也不是让用户现在拍板的采访包」；`plugin/src/skills/using-ccm/canonical/references/board-model-guide.md` H 节同样明写「它不是待办队列，也不是 awaiting-user 的替代品」。outside-in.md 组件 A 把 `pending_review` jc 重新定义为「待验证假设」的做法，与这条既有定义确有语义冲突，是本 PR 最站得住脚的一条 blocking finding。
- **命令示例错误**：**两处均核实为真**。`command-catalog.md:1331` 与 `:1349` 确认 `task block` 语法是 `ccm task block <id> --on <str> [flags]`（例：`ccm task block T9 --on user --decision @/abs/decision.json`），outside-in.md 的例子漏了 `<id>`；`ccm/packages/engine/src/board-model.ts:48` 确认 `jcCategory: ['architecture', 'drift', 'spec-impl-misalignment', 'other']` 是单选枚举，`architecture/drift` 组合值不合法。这是可执行文本里的真实 footgun，分发出去会让 agent 撞 `exit` 错误。
- **baseline 方法学**：**部分核实、判断为可辩护但非无可指摘**。baseline log 本身对这个「single-shot 天花板」高度自觉——三轮都诚实记录 PASS、援引 `cc-master-skillsmith` §9「强模型天花板」条款（RED 守得住是信号而非配方失败），并据此**收窄 prose 主张范围**（只claim「让抵抗在负载下/跨 compaction 可靠」而非「教会有能力模型它推不出的东西」）、把「记录在案的失败」落实为「逐字捕获的拉力合理化 + 情境1的 out-of-mind near-miss」而非一次干净的错选。这是对铁律的一种解释，不是明显违反，但也不是铁律字面最严格的读法——`pressure-testing.md` §3 的字面要求是「你必须看到它失败」「*只有现在*你才被允许写 prose」，该文档确实从未在最终判定里产出一次干净的错误终局。这条我判为**可辩护的方法学分歧**，不是明确违规，留给 orchestrator 定夺是否需要补一轮更尖锐的情境设计或接受当前证据链。
- **B/F 双三元组**：**核实为真的可读性问题**，非逻辑矛盾（B 的「三条不全中→记假设照常推进」与 F 的「三条全中→免仪式」覆盖的是不同粒度：B 决定要不要发起正式校准，F 决定连「记一条待验证假设」的最低仪式都能不能省），但确实没有一张表把「B 未触发」×「F 未豁免」的中间态（组件 A 表格里「承重的记 jc」那格）显式钉出来，容易读歧义。

## 结论 / 建议

codex 的 `needs-attention` 判定**站得住**——三条 blocking finding 里，jc 语义冲突和两处命令示例错误是**明确、可核实、需要修的真实缺陷**（分发文本里的错误命令示例尤其不该带着合入）；baseline 方法学那条是可辩护但值得 orchestrator 知晓的分歧点，不构成同等确定性的阻塞。

**建议不直接合并**：至少应修正两处命令示例 + 重新措辞组件 A 对 jc 的用法（改用 `ccm log add --kind note`/`finding` 记未决假设，而非借用 `pending_review` jc 状态机；或改造成一个新的、不与既有 jc 生命周期冲突的落点），并考虑把 B/F 两组三元条件合成一张表消歧义。是否需要为方案 4（baseline 方法学）单独补一轮验证，留给 orchestrator 判断是否值当。
