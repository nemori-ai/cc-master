---
path: AGENTS.md
version: v1.0
last-edited: 2026-06-09
agent-edit-policy: |
  仓库根 AGENTS.md——agent / 贡献者进入 cc-master 的着陆页与导航地图。三类编辑分级：
  - 自主刷新（无需 PR 人审）：§12 目录/文件约定在子目录增减时刷新行级；§N 触发式深入阅读表新增行；§9 findings 台账新增条目的指针；frontmatter 的 last-edited / version 字段；命令或脚本落地后在对应表追加行。
  - 走 PR 人审：§3 五条红线的任意改动（红线 SSOT 在此，改动须人审）；章节重排 / 目录拓扑级变化；§2 不变式语义改动；§N 表的语义重排（不只新增）。
  - 禁止：把 SKILL.md 的运行时灵魂（七镜头 / 决策程序 / Rationalization Table 正文）塞回本文——那类内容已在 skills/orchestrating-to-completion/SKILL.md，是每次 compaction 由 SessionStart hook 重注的常驻手册；本文只给触发条件 → SSOT 的导航指针，不复述。复述即制造双 SSOT（Finding #7 已证重复是负担）。
content-summary: |
  cc-master 仓库根 AGENTS.md——agent 着陆即读的最小心智地图与渐进式披露导航表。承载：(1) 这个插件是什么 + 不是什么（多指针）；(2) 仓库形态 + 不变式速览；(3) 五条 non-negotiable 红线（每条一句话 + 链回 SSOT + grep/CI 硬卡点）——红线 SSOT 在此；(4) gstack × superpowers 路由（指针）；(5) 编排纪律（SKILL A 是灵魂，不复述，只导航）；(6) skill 创作/维护纪律（含 TDD-for-skills 指针 + YAML 引号反模式）；(7) codex 作为端点验收 reviewer；(8) eval 机制 Track A+B；(9) dogfood 循环 + findings 台账；(10) 测试纪律 + 验收门；(11) 分支/PR/commit 约定；(12) 目录与文件约定；(13) ADR 约定（指针）；(§N) 触发式深入阅读大表。直接进入 agent 上下文的是最小必需内容，深度信息（编排方法论 / workflow 写法 / eval / ADR 正文）通过"当你做 X 时去读 Y"按需引出，不预加载。
---

# cc-master

> 本文是 agent / 贡献者进入 `cc-master` 仓库的**第一站**——通读本文即获得做事所需的最小心智地图：这个插件是什么、目录长什么样、哪些红线不能碰、什么时候该读什么。
> §N "触发式深入阅读" 里的链接**不需要预加载**——只在命中对应触发条件时跳转。这是渐进式披露（progressive disclosure），不是 reading list。
> **运行时的灵魂在 [`skills/orchestrating-to-completion/SKILL.md`](skills/orchestrating-to-completion/SKILL.md)（SKILL A）——它是 `SessionStart` hook 每次 compaction 全文重注的常驻手册。本文绝不复述它的七镜头 / 红线 / 决策程序，只给定位与指针。**
> CLAUDE.md = `@AGENTS.md` 一行 include——Claude Code 与 codex 等读同一份真相源。

---

## 1. 这个插件是什么

`cc-master` 是一个 **ship-anywhere 的 Claude Code 插件**：把任意主会话 agent 变成一个 long-horizon **master orchestrator（总指挥）**。给它一个跨度 >24h 的目标，它把目标拆成依赖图、并行派发后台工作、在每个等待窗口里让主线**主动**推进，并且——最难的一环——在反复 context compaction 与跨 session 之间存活续跑而不忘记自己是谁、还剩什么。

它**不是**：agent framework / library，不是某个 LLM API 的包装，不依赖 agent-teams 或 scheduled routines（见 §3 红线 5）。它是 **commands + 2 skills + hooks + 一个 board 文件**的薄编排层。

**深入指引**：
- 用户视角（怎么装、怎么用、三范式对比）→ [`README.md`](README.md)
- 编排方法论（魂）→ [`skills/orchestrating-to-completion/SKILL.md`](skills/orchestrating-to-completion/SKILL.md)
- workflow 脚本写法（机制）→ [`skills/authoring-workflows/SKILL.md`](skills/authoring-workflows/SKILL.md)
- 完整设计 spec → [`design_docs/spec.md`](design_docs/spec.md)

---

## 2. 仓库形态 + 关键不变式

```
cc-master/
├── AGENTS.md / CLAUDE.md     ← 你正在读 / CLAUDE.md = @AGENTS.md 一行 include
├── README.md / README_zh.md  ← 面向使用者的产品介绍（怎么装 / 怎么用）
├── CONTRIBUTING.md           ← dev loop + before-PR 两道门（红线 SSOT 已外链本文 §3）
├── CHANGELOG.md
├── .claude-plugin/           ← plugin.json 清单 + marketplace.json
├── commands/                 ← as-master-orchestrator / status / stop（一次性点火）
├── skills/                    ← **分发**给插件用户的 skill 源码（仅这两个随插件 ship）
│   ├── orchestrating-to-completion/  ← SKILL A：编排方法论（魂）+ references/
│   └── authoring-workflows/          ← SKILL B：workflow 写法 + references/ + assets/examples/
├── .claude/skills/            ← **项目自用** dev skill（cc-master-skillsmith：怎么造本仓 skill，**不分发**）
├── hooks/scripts/            ← bootstrap-board / reinject / verify-board（纯 bash 门控）
├── scripts/                  ← 带外手动调用脚本：codex-review / eval-trigger / eval-benchmark
├── adrs/                     ← 结构性决策快照（ADR-001..005 + AGENTS.md 规约）
├── tests/                    ← hook 测试（bash）；run-tests.sh 编排 hook + content contract
├── design_docs/             ← 设计文档 + eval/ + dogfood-findings.md（plans/ gitignored）
└── examples/                 ← 可跑样例目标（占位待补）
```

**关键不变式**（每条一句话 + SSOT；硬约束的完整体在 §3 红线）：

- **五条 design 红线**——hooks 纯 bash / board narrow waist / 两 skill 不重叠 / 指挥不演奏 / ship-anywhere。SSOT 在本文 **§3**（每条带 grep/CI 卡点）。
- **临时计划 / 草稿放 `design_docs/plans/`**——已 gitignored，不进版本控制，与正式 `design_docs/` 严格分开。
- **运行时 board 不入版本控制**——`.claude/cc-master/`（或 `$CC_MASTER_HOME`）gitignored；每个 orchestration 一份 time-sortable 文件，并发不撞。

---

## 3. Non-negotiable 红线（SSOT 在此）

这五条是 **cc-master 内任何代码 / 文档变更都不能违反的硬约束**。**本节是这五条红线的单一真相源**（用户拍板）——每条只一句话 + 一个 PR/CI 可执行的 grep/CI 硬卡点；理由 / 决策心智 / 例外在指向的 SSOT 里，本文不复述。违反任一的 PR 会被打回。

1. **Hooks 纯 bash，无 `jq` / `node` / 其它 runtime。** Hook 跑在对 agent context 失明的 shell 里，必须在 cc-master ship 的每个地方都能跑（含 Bedrock / Vertex / Foundry）；用 shell 工具解析 JSON，不用解释器。
   → 决策快照：[`adrs/ADR-001-hooks-pure-bash.md`](adrs/ADR-001-hooks-pure-bash.md) · 硬卡点：`grep -rE 'jq|node' hooks/scripts/` 须只命中注释（无真调用）。

2. **保持 board 的 narrow waist 稳定。** Board 是单一真相源、也是 hook 唯一能读的状态；只有一小撮固定字段是 hook-dependent（`schema` / `goal` / `owner.session_id` / `git` / `tasks[{id,status,deps}]` + status enum），其余 agent-shaped。动 waist 必须同 PR 改全部 hook + 测试并在 PR 描述显式说明。
   → 决策快照：[`adrs/ADR-003-board-narrow-waist.md`](adrs/ADR-003-board-narrow-waist.md) · 协议 SSOT：[`skills/orchestrating-to-completion/references/board.md`](skills/orchestrating-to-completion/references/board.md) · 硬卡点：动 waist 的 PR 必带 `bash run-tests.sh` 全绿 + hook 测试同步更新。

3. **两个 skill 各自自洽、互不重叠。** SKILL A（`orchestrating-to-completion`）= 主线编排方法论；SKILL B（`authoring-workflows`）= 脚本内写法。不让职责跨界、不在两者间复述同一份指导。
   → 决策快照：[`adrs/ADR-005-two-skills-separation.md`](adrs/ADR-005-two-skills-separation.md) · 硬卡点：跨界/复述在 PR review 拦——"orchestrator 做什么" 归 A，"workflow 脚本怎么写" 归 B。

4. **指挥永不演奏（the conductor never plays an instrument）。** Orchestrator 协调，不亲手做单元工作；任何把主线推向亲自实现 / 亲自 review 的改动都是反方向。
   → 纪律 SSOT（含唯一例外、Rationalization Table、Red Flags）：[`skills/orchestrating-to-completion/SKILL.md`](skills/orchestrating-to-completion/SKILL.md) §Red lines · 硬卡点：行为型红线，由 §8 Track B benchmark + 端点验收守护（非 grep 能拦）。

5. **保持 ship-anywhere。** 支持的后台机制只有 background shell / sub-agent（`run_in_background`）/ workflow；agent-teams 与 scheduled routines 因不可靠 ship-anywhere 而**有意排除**。别加在 Bedrock / Vertex / Foundry 上会断的依赖。
   → 决策快照：[`adrs/ADR-002-ship-anywhere-scope.md`](adrs/ADR-002-ship-anywhere-scope.md) · 排除留痕：[`design_docs/spec.md` §12](design_docs/spec.md) · 硬卡点：带外脚本（codex / eval）依赖 `uv` + Python 3.12 + `claude`/`codex` CLI——**只许进 `scripts/`（手动调用），绝不进 `hooks/`**。

> **违背字面就是违背精神。** "我遵循的是精神，不是字面" 是攻破每一条红线的那句合理化。没有哪个 orchestration 特殊到红线失效——当你开始论证 *这次* 是例外，那套论证本身就是症状。

---

## 4. 迭代范式总图（gstack × superpowers 路由）

本仓的开发遵循用户全局的 **gstack × superpowers 组合范式**——gstack 管"前"（方向判断）和"后"（review / QA / 安全 / ship），superpowers 管"中间"（brainstorming → plans → TDD → debugging → verification）。冲突仲裁：**用户显式指令 > skill > 默认行为**。
→ 完整路由表 + 分工原则 + 避坑：用户全局 `~/.claude/CLAUDE.md` §「gstack × superpowers 组合使用范式」。**本仓收口用项目自带 `github-pr` / `github-tag-release`，不用 gstack 的 `/ship` `/canary` `/land-and-deploy`**（它们假设别的部署形态）。

---

## 5. 编排纪律（SKILL A 是灵魂）

编排方法论的**唯一真相源是 [`skills/orchestrating-to-completion/SKILL.md`](skills/orchestrating-to-completion/SKILL.md)（SKILL A）**——七镜头、红线、Rationalization Table、Red Flags、决策程序（dot-graph）都在那里，是 `SessionStart` hook 每次 compaction 全文重注的常驻手册。**本文不复述任何一条**；要援引方法论就读 SKILL A，要改方法论就改 SKILL A，不在这里另起一份。

**改 SKILL A 的纪律**（这是本文该说的，SKILL A 正文不必自陈）：
- **reinject 重注友好**——它每回合 compaction 后被整篇重注，**越短越好**；新增内容前先问"这能不能进 `references/` 让主文件保持瘦"。
- **决策程序骨架不动**——7 步 + step-6 ledger gate 的 dot-graph 是"牙齿"，结构性改动走 PR 人审（红线级）。
- **Finding #7 收敛结论**——主文件曾与 `references/async-hitl.md` 整段重复 step-6 ledger，已收敛为一句指针；新增时不要重新制造跨文件重复（SSOT 原则）。
- 改 SKILL A 的**纪律段 / description** 前，先走 §6 的 TDD-for-skills pressure baseline。

---

## 6. Skill 创作 / 维护纪律（含 TDD-for-skills）

本仓**分发**两个 skill：A（编排）、B（workflow 写法）——**互不重叠**（红线 3）：A = orchestrator 做什么，B = workflow 脚本怎么写。另有一个**项目自用、不随插件分发**的 dev skill `cc-master-skillsmith`（在 `.claude/skills/`，不在 `skills/`）= 怎么按本仓纪律创作 / 施压测试 skill 本身。它是「造 skill 的工具」，不是 cc-master 这个产品的一部分——终端用户装插件时不会看到它。

**TDD-for-skills（纪律型 skill 改前必跑 baseline）**：任何"纪律型 / judgment-bearing"的 skill prose（agent 在压力下能把它合理化掉的规则）——新建或编辑——都**必须先跑一遍 subagent pressure baseline 看它在没有该段时选错**，再写堵漏。完整 Iron Law + 三压（time + sunk cost + exhaustion）配方在 → [`.claude/skills/cc-master-skillsmith/SKILL.md`](.claude/skills/cc-master-skillsmith/SKILL.md)（指针 `superpowers:test-driven-development` + `superpowers:writing-skills` + 官方 `skill-creator`）。pressure baseline 是**定性**（哪条 rationalization 要堵）；§8 eval 是**定量**（堵了有没有用）——互补，不替代。

**Frontmatter YAML 引号反模式（Finding #1，血泪）**：`description` 里只要含 `:` 或 `"`，**整个值必须用单引号包起来**——否则 YAML parser 误读、`plugin validate` / content 测试以非显然的方式失败。本仓所有 skill 的 frontmatter 都是单引号整包，照抄即可。**拿不准就加引号**——这是本仓最常见的 skill-authoring footgun。

**content contract = 权威结构 validator**：结构（frontmatter 有 name + description、目录布局）由 `bash run-tests.sh`（node content 段,自动 iterate `skills/*` 与 `.claude/skills/*` 的 SKILL.md）+ `claude plugin validate .`（仅校验分发的 `skills/`）把关，**别手检它们查的东西**。行为靠 pressure baseline，结构靠 contract。

---

## 7. codex 作为 reviewer 范式

cc-master 把 **codex 当独立的第二端点验收者**（呼应红线 4 "指挥不演奏" + SKILL A 的"只信端点验收 / gate-green ≠ passed"）。它**不进任何 hook**（要联网 / OAuth / 多分钟超时 / JSON 解析，违背纯 bash ship-anywhere），只以**带外手动 / 编排调用的 sub-agent 端点验收节点**形态接入。

落地物：[`scripts/codex-review.sh`](scripts/codex-review.sh)——纯 shell 封装 `codex exec review ... --json`，只读 sandbox，对一段 diff 出 `verdict: approve | needs-attention` + 每条 finding 的 severity/file/line。**空 review / OAuth 过期 → 按"未通过"处理**（silent-pass-through guard，不静默放行）。`verdict` 映射现有 Joiner 闸：`needs-attention` → Replan；`approve` + 非空 + 已读 diff → done。
→ 文档化：[`skills/orchestrating-to-completion/references/resume-verify.md`](skills/orchestrating-to-completion/references/resume-verify.md)（codex 第二验收者小节）· 指针：`/codex` skill。

---

## 8. Eval 机制（Track A + Track B）

eval 让 skill 迭代**有数可依**。运行钥匙：`uv run --python 3.12`（系统 Python 跑不了 PEP-604）+ `claude` CLI（复用 session 认证，无需 API key）。两条 Track，**不入 hook、非每-commit CI 门，作改前后对比 / pre-release 检查**。

- **Track A —— 触发准确率门**（全自动可复现）：量每个 skill 的 `description` 在一组 query 上的 precision/recall/accuracy。落地：`skills/<s>/evals/trigger.json`（should-trigger + near-miss）+ [`scripts/eval-trigger.sh`](scripts/eval-trigger.sh)。**何时跑：任何 `description` 改动前后各跑一遍比 accuracy。** 诚实标注：平凡 query 本就不触发 skill，与 description 质量无关——eval query 须 substantive。
- **Track B —— 编排纪律 benchmark**（行为型）：`orchestrating-to-completion` 让编排者行为更好的端到端断言，with-skill vs without-skill 各 3 run 看 mean±stddev。落地：[`scripts/eval-benchmark.sh`](scripts/eval-benchmark.sh) + [`design_docs/eval/track-b-benchmark.md`](design_docs/eval/track-b-benchmark.md)。**codex 当第二评委**：grader 后跑 codex 对同一 transcript 出非-Claude 裁决，分歧 = 高信号。
→ 用法 / 依赖 / 天花板：[`design_docs/eval/README.md`](design_docs/eval/README.md) · 创作/优化 description / 跑 eval 的工具：官方 `skill-creator`。

---

## 9. Dogfood 循环 + findings 台账

cc-master 用**本插件改本插件**——任何 behavioral 改动**必须 dogfood**（用 `/cc-master:as-master-orchestrator <goal>` 起真 orchestration，对 live runtime 验证）。多个历史 bug 对测试套件不可见，只在真 session 下浮现。

**findings 台账 [`design_docs/dogfood-findings.md`](design_docs/dogfood-findings.md) = 已踩反模式的永久纪律记录**（omne 式：踩过一次就写进纪律永久避免）。纪律：**用着不爽 / 给 agent 的指导不对 / 效率没真正拉满，必落台账**（现象 → 根因 → 影响 → 处置 → 严重度/来源）。台账是 §6 Rationalization Table 与 §3 红线的素材源——很多红线就是 finding 沉淀出来的。

---

## 10. 测试纪律 + 验收门

两道门（与 [`CONTRIBUTING.md`](CONTRIBUTING.md) 同步，本文不复述命令细节，只立纪律）：`bash run-tests.sh` 必须以 `ALL TESTS PASSED` 收尾 + `claude plugin validate .` 无错。

- **测试只保 correctness，不保 quality**——`run-tests.sh`（hook 行为 + content 结构）回答"语义合不合 spec/contract"；quality（指导对不对、效率拉没拉满）靠 §9 dogfood + §7 端点验收独立守护。
- **并行后端点必跑全套**（Finding #12）——sub-agent / workflow fan-out 之后，orchestrator 在端点亲跑一次完整 `run-tests.sh` + `plugin validate`，不信各 leaf 的自报。
- **红线零违反 grep 门**——见 §3 各条卡点；最关键一条：`grep -rE 'jq|node' hooks/scripts/` 须只命中注释。

---

## 11. 分支 / PR / commit 约定

- **feature branch**——不在 default 分支直接动手（先 branch）。
- **PR 走 `gh` + 本仓 `github-pr` skill 收口**（不用 gstack `/ship`）；PR body 末尾带 Claude 署名（`🤖 Generated with [Claude Code]`）。
- **commit 末尾带** `Co-Authored-By: Claude <noreply@anthropic.com>`；type 前缀 `feat/fix/docs/chore/adr`。
- **single-committer**——sub-agent 只写 + 自证测试绿，**绝不 commit**；orchestrator 端点验收（含 §7 codex 自审）后统一分组 commit。
- **README.md / README_zh.md 同步**——动 user-facing 文档时两份一起改；user-visible 改动加 `CHANGELOG.md ## [Unreleased]` 条目。
- **outward-facing / irreversible（含 merge）先问用户**（红线 4 的延伸）。

---

## 12. 目录与文件约定

- **command**（`commands/*.md`）——一次性点火，frontmatter + body；body 首个非空行的 sentinel 注释（如 `<!-- cc-master:bootstrap:v1 -->`）是 hook 触发标记，**只在首行独立成行时触发**（内联提及不触发，Finding #16）。
- **skill**（`skills/<name>/SKILL.md` + `references/` + `assets/`）——frontmatter `name` + `description`（单引号整包，§6）；大 reference 顶部加锚点 TOC；深度细节进 `references/` 保持主文件瘦。
- **hook**（`hooks/scripts/*.sh`）——纯 bash（红线 1）；状态写 sidecar，**永不碰 board**。
- **design_docs**——正式文档进 `design_docs/`；临时 plan 进 `design_docs/plans/`（gitignored）；日期前缀命名（`YYYY-MM-DD-<slug>.md`）。
- **board 不入版本控制**——`.claude/cc-master/`（或 `$CC_MASTER_HOME`）gitignored。

---

## 13. ADR 约定

结构性架构决策（"为什么 X 不 Y / 何时可推翻"）记成 ADR——与 design_docs（描述当前状态）严格分开。命名 `ADR-NNN-<slug>.md`，带 Status/Date/Scope frontmatter + Context/Decision/Consequences/Alternatives/Related 模板。**何时写 ADR、ADR-vs-design_docs 试金石、workflow 全在** → [`adrs/AGENTS.md`](adrs/AGENTS.md)。现有 ADR-001..005（hooks-pure-bash / ship-anywhere-scope / board-narrow-waist / loop-dissolution-and-goal-hook / two-skills-separation）。

---

## N. 触发式深入阅读

下表按"**当你要做 X 时去读 Y**"组织——命中触发条件时跳转，未命中不需预加载。

| 当你要 | 读什么 |
|---|---|
| 改编排方法论 / 援引七镜头 · 红线 · 决策程序 | [`skills/orchestrating-to-completion/SKILL.md`](skills/orchestrating-to-completion/SKILL.md)（魂 · 不在本文复述）|
| 把目标拆成依赖 DAG（CPM / float / 临界路径 / 粒度）| [`skills/orchestrating-to-completion/references/decomposition.md`](skills/orchestrating-to-completion/references/decomposition.md) |
| 选后台机制 / 编排并行（shell · sub-agent · workflow · 两尺度 dataflow）| [`skills/orchestrating-to-completion/references/dispatch.md`](skills/orchestrating-to-completion/references/dispatch.md) |
| 动 board 协议 / narrow-waist schema / status enum / 续跑续接 | [`skills/orchestrating-to-completion/references/board.md`](skills/orchestrating-to-completion/references/board.md) |
| 异步完成 + HITL / p95 hedging / 用户当 async worker | [`skills/orchestrating-to-completion/references/async-hitl.md`](skills/orchestrating-to-completion/references/async-hitl.md) |
| 廉价续跑 + 端点验收 / content-hash / codex 第二验收者 | [`skills/orchestrating-to-completion/references/resume-verify.md`](skills/orchestrating-to-completion/references/resume-verify.md) |
| 写 / 调试 / 启动 workflow 脚本（API + 机制 + pattern + 11 个 example）| [`skills/authoring-workflows/SKILL.md`](skills/authoring-workflows/SKILL.md) + [`references/`](skills/authoring-workflows/references/) + [`assets/examples/`](skills/authoring-workflows/assets/examples/) |
| 写 / 改任何本仓 skill（尤其纪律型）/ 跑 pressure baseline | [`.claude/skills/cc-master-skillsmith/SKILL.md`](.claude/skills/cc-master-skillsmith/SKILL.md)（TDD-for-skills，项目自用 dev skill）|
| 改 hook | [`hooks/scripts/`](hooks/scripts/) + [`tests/`](tests/) + [`CONTRIBUTING.md`](CONTRIBUTING.md)（先确认红线 1 纯 bash）|
| 让 codex 当端点验收 reviewer | [`scripts/codex-review.sh`](scripts/codex-review.sh) + `/codex` skill |
| 跑触发准确率 eval（description 改动前后）| [`scripts/eval-trigger.sh`](scripts/eval-trigger.sh) + [`design_docs/eval/README.md`](design_docs/eval/README.md) |
| 跑编排纪律 benchmark（行为型 + codex 第二评委）| [`scripts/eval-benchmark.sh`](scripts/eval-benchmark.sh) + [`design_docs/eval/track-b-benchmark.md`](design_docs/eval/track-b-benchmark.md) |
| 写新 ADR / 援引现有 ADR / 判断 ADR-vs-design_docs | [`adrs/AGENTS.md`](adrs/AGENTS.md) + [`adrs/`](adrs/) |
| 落 dogfood 发现 / 援引已踩反模式 | [`design_docs/dogfood-findings.md`](design_docs/dogfood-findings.md) |
| 援引设计留痕 / 有意排除的决策 | [`design_docs/spec.md` §12](design_docs/spec.md) |
| 临时计划 / 草稿（不进版本控制）| 写在 `design_docs/plans/`（gitignored），不进正式 design_docs |
| 装 / 用插件（用户视角）| [`README.md`](README.md) / [`README_zh.md`](README_zh.md) |
| 跑 dev loop / before-PR 两道门 | [`CONTRIBUTING.md`](CONTRIBUTING.md)（红线 SSOT 见本文 §3）|
