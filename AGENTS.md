---
path: AGENTS.md
version: v1.0
last-edited: 2026-07-23
agent-edit-policy: |
  仓库根 AGENTS.md——agent / 贡献者进入 cc-master 的着陆页与导航地图。三类编辑分级：
  - 自主刷新（无需 PR 人审）：§12 目录/文件约定在子目录增减时刷新行级；§N 触发式深入阅读表新增行；§9 findings 台账新增条目的指针；frontmatter 的 last-edited / version 字段；命令或脚本落地后在对应表追加行。
  - 走 PR 人审：§3 六条红线的任意改动（红线 SSOT 在此，改动须人审）；章节重排 / 目录拓扑级变化；§2 不变式语义改动；§N 表的语义重排（不只新增）。
  - 禁止：把 SKILL.md 的运行时灵魂（七镜头 / 决策程序 / Rationalization Table 正文）塞回本文——那类内容已在 plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md，是每次 compaction 由 SessionStart hook 重注的常驻手册；本文只给触发条件 → SSOT 的导航指针，不复述。复述即制造双 SSOT（Finding #7 已证重复是负担）。
content-summary: |
  cc-master 仓库根 AGENTS.md——agent 着陆即读的最小心智地图与渐进式披露导航表。承载：(1) 这个插件是什么 + 不是什么（多指针）；(2) 仓库形态 + 不变式速览；(3) 六条 non-negotiable 红线（每条一句话 + 链回 SSOT + grep/CI 硬卡点）——红线 SSOT 在此；(4) gstack × superpowers 路由（指针）；(5) 编排纪律（SKILL A 是灵魂，不复述，只导航）；(6) skill 创作/维护纪律（含 TDD-for-skills 指针 + YAML 引号反模式）；(7) codex 作为端点验收 reviewer；(8) eval 机制 Track A+B；(9) dogfood 循环 + findings 台账；(10) 测试纪律 + 验收门；(11) 分支/PR/commit 约定；(12) 目录与文件约定；(13) ADR 约定（指针）；(§N) 触发式深入阅读大表。直接进入 agent 上下文的是最小必需内容，深度信息（编排方法论 / workflow 写法 / eval / ADR 正文）通过"当你做 X 时去读 Y"按需引出，不预加载。
---

# cc-master

> 本文是 agent / 贡献者进入 `cc-master` 仓库的**第一站**——通读本文即获得做事所需的最小心智地图：这个插件是什么、目录长什么样、哪些红线不能碰、什么时候该读什么。
> §N "触发式深入阅读" 里的链接**不需要预加载**——只在命中对应触发条件时跳转。这是渐进式披露（progressive disclosure），不是 reading list。
> **运行时的灵魂在 [`plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md`](plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md)（SKILL A）——它是 `SessionStart` hook 每次 compaction 全文重注的常驻手册。本文绝不复述它的七镜头 / 红线 / 决策程序，只给定位与指针。**
> CLAUDE.md = `@AGENTS.md` 一行 include——Claude Code 与 codex 等读同一份真相源。

---

## 1. 这个插件是什么

`cc-master` 是一个 **ship-anywhere 的 agent harness 插件项目**：产品目标是让 Claude Code 或 Codex 等 agent harness 的主会话 agent 都能被初始化成 long-horizon **master orchestrator（总指挥）**。源码结构已按 paragoge 范式重构为 **CLI + source-to-adapter plugin projection**：共享产品语义在 `plugin/src`，Claude Code / Codex 等 host 只通过 adapter 投影成各自可安装产物。

它**不是**：agent framework / library，不是某个 LLM API 的包装，不依赖 agent-teams 或 scheduled routines（见 §3 红线 5）。它的 runtime 是 **commands + 7 skills + hooks + 一个 board 文件**的薄编排层；它的 repo 形态是 **paragoge-style 多 harness adapter 工程**。

**产品愿景 / 北极星（charter）**——cc-master **致力于让** agent 化身 master orchestrator 并具备六项能力：① 异步并行多线程推进、把目标完整落地；② 控制 token 消耗速度；③ 把握自主决策 vs 寻求人类接入的边界；④ 目标的分解 / 管理 / 更新 / 规划；⑤ 资源消耗速度合理前提下最大化实施效率的调度编排；⑥ 按复杂性 / 难度 / 时长选合适的模型。这是**方向目标（aspirational）而非「已全部兑现」**——哪些已落地、哪些 design-only 由 gap 审计度量。**完整六条 charter 的 SSOT 在 [`design_docs/spec.md` §1.0](design_docs/spec.md)**，本段只是摘要回指，不复述。

**深入指引**：
- 用户视角（怎么装、怎么用、三范式对比）→ [`README.md`](README.md)
- 编排方法论（魂）→ [`plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md`](plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md)
- workflow 脚本写法（机制）→ [`plugin/src/skills/authoring-workflows/canonical/SKILL.md`](plugin/src/skills/authoring-workflows/canonical/SKILL.md)
- 完整设计 spec → [`design_docs/spec.md`](design_docs/spec.md)

---

## 2. 仓库形态 + 关键不变式

```
cc-master/
├── AGENTS.md / CLAUDE.md     ← 你正在读 / CLAUDE.md = @AGENTS.md 一行 include
├── README.md / README_zh.md  ← 面向使用者的产品介绍（怎么装 / 怎么用）
├── CONTRIBUTING.md           ← dev loop + before-PR 三道门（红线 SSOT 已外链本文 §3）
├── CHANGELOG.md
├── plugin/                   ← paragoge-style plugin source/projection
│   ├── src/                  ← **单一语义源**：SAP skills + PHIP hooks + host manifest/commands source
│   │   ├── .claude-plugin/   ← Claude Code adapter manifest source（第二 host 出现后可下沉到 host adapter）
│   │   ├── commands/         ← command body source（第一阶段按 Claude Code 投影）
│   │   ├── adapters/         ← cross-surface origin host-native invocation 映射；per-host strategy 投影，状态机/writer 仍归 ccm
│   │   ├── knowledge/        ← skill knowledge graph authored source root；K1 pilot = 3 modules / 9 points，`compile` 投影到 `plugin/dist/<host>/knowledge/`，能力以 `skill-knowledge contract` 为准
│   │   ├── skills/           ← **SAP**：`<skill>/canonical/` runtime 源 + `<skill>/adapters/<host>/strategy.yaml`
│   │   │   └── _hosts/       ← host-wide skill adapter base（当前 `claude-code`）
│   │   └── hooks/            ← **PHIP**：`_manifest/` contract + `_hosts/<host>/` + `<hook>/implementations/<host>/`
│   └── dist/
│       ├── claude-code/      ← Claude Code adapter 可安装产物；由 `scripts/sync-plugin-dist.sh` 从 `plugin/src` 投影
│       └── codex/            ← Codex adapter 可安装产物；同一 plugin 版本线，release asset 按 harness 拆分
├── .claude/skills/            ← **项目自用** dev/meta skill 源（含需求发现、skill 造/评/治、多 harness plugin 架构/投影/发布工程，**不分发**）
├── .agents/skills/            ← Codex 项目级 skills 投影（由 `scripts/sync-codex-skills.sh` 从 `.claude/skills` 生成；默认 symlink）
├── ccm/                      ← **独立产品/引擎**（ADR-014）：`packages/engine`（`@ccm/engine`·board 引擎 SSOT·TS）+ `apps/cli`（`ccm`·per-OS Node SEA 二进制）+ 未来 desktop。pnpm/Turborepo monorepo（tsdown/biome/changesets）。**独立安装、不随 plugin 分发**——plugin / webview / 未来客户端都是消费方：hooks/skill 脚本经进程边界 shell 调 `ccm`，webview 吃 vendored `@ccm/engine` IIFE。`node_modules`/`dist` gitignored
├── .githooks/                ← 版本化 git hook（`scripts/install-git-hooks.sh` 设置 core.hooksPath）；pre-push 自动检查 `plugin/dist` 与 `plugin/src` 同步
├── scripts/                  ← 带外 **dev-only** 脚本：sync-plugin-dist / check-plugin-dist-sync / sync-codex-skills / skill-knowledge / eval-trigger / eval-benchmark / skill-lint（仅开发本仓用、repo 根调用，**不随 plugin 分发**；裸路径在此正确）。运行时带外脚本（codex-review / view webview）住 `plugin/src/skills/master-orchestrator-guide/canonical/scripts/`（随 skill 分发，见上；旧 cc-usage.sh 已退役 → `ccm usage`）
├── adrs/                     ← 结构性决策快照（ADR-001..022 + AGENTS.md 规约）
├── tests/                    ← hook 测试（bash）；run-tests.sh 编排 hook + content contract
├── design_docs/             ← 设计文档 + eval/ + dogfood-findings.md（plans/ gitignored；`harnesses/` 是 paragoge 迁移后校对版 host 机制资料库）
└── examples/                 ← 可跑样例（sample-orchestration：i18n 场景 walkthrough.md + smoke.sh 冒烟证明）
```

**关键不变式**（每条一句话 + SSOT；硬约束的完整体在 §3 红线）：

- **paragoge-style source-to-adapter**——`plugin/src` 是语义源，`plugin/dist/<host>` 是提交进仓的生成产物；skills 走 SAP，hooks 走 PHIP；不手改 dist。改 `plugin/src` 后必须跑 `bash scripts/check-plugin-dist-sync.sh`，若 `plugin/dist` 有 diff，生成物与源码同 commit 提交。每个 clone 跑一次 `bash scripts/install-git-hooks.sh`，pre-push 会机械执行这道门。
- **harness 事实本地化**——从 paragoge 借来的 host 机制资料已经迁入并校对到 [`design_docs/harnesses/`](design_docs/harnesses/)；后续做 adapter 时先读本目录，不默认依赖上级目录的 `../paragoge`。Codex / Claude Code 事实以本仓校对资料、官方文档和实测为准。
- **六条 design 红线**——hooks 只用 bash+node/JS（红线1，ADR-006）/ board narrow waist / 八 skill 不重叠 / 指挥不演奏 / ship-anywhere / 所有 hook 武装后才激活（dormant-until-armed，红线6，ADR-007）。SSOT 在本文 **§3**（每条带 grep/CI 卡点）。
- **临时计划 / 草稿放 `design_docs/plans/`**——已 gitignored，不进版本控制，与正式 `design_docs/` 严格分开。
- **运行时 home 全局、board 不入版本控制**——home = `$CC_MASTER_HOME`（默认 `$HOME/.cc_master/`，harness-neutral；`CLAUDE_CONFIG_DIR` 只影响 Claude Code host 自己的 settings / credentials / projects）；board 集中落 `<home>/boards/`（每场编排一份 time-sortable 文件 `<UTC-timestamp>-<pid>.board.json`，并发不撞），旧 per-repo board（`$CLAUDE_PROJECT_DIR/.claude/cc-master/`）和旧 Claude-config home 的 board 在 bootstrap 时 best-effort 迁入。全局 home 在 repo 外天然不入版本控制（若仍用 in-repo `.claude/cc-master/` 也 gitignored）。

---

## 3. Non-negotiable 红线（SSOT 在此）

这六条是 **cc-master 内任何代码 / 文档变更都不能违反的硬约束**。**本节是这六条红线的单一真相源**（用户拍板）——每条只一句话 + 一个 PR/CI 可执行的 grep/CI 硬卡点；理由 / 决策心智 / 例外在指向的 SSOT 里，本文不复述。违反任一的 PR 会被打回。

1. **Hooks 只用 Claude Code 保证存在的 runtime：bash + node/JS（JS only）。** 不用 `jq` / `python` / 直接跑 TS（这些不随 Claude Code 保证存在）。Hook 跑在对 agent context 失明的 shell 里，但 **Claude Code 本身是 Node 应用——`node` 在任何能触发 hook 的环境天然在**，故 node/JS 不破 ship-anywhere（Bedrock/Vertex/Foundry 是模型后端，非 CLI 宿主）。需结构化 JSON 解析/计算（如从 JSONL 算 usage、deps 图校验）用 node，简单/高频 hook（如 per-tool PostToolUse）用 bash。
   → 决策快照：[`adrs/ADR-006-hooks-may-use-node-js.md`](adrs/ADR-006-hooks-may-use-node-js.md)（取代 [ADR-001](adrs/ADR-001-hooks-pure-bash.md)，纠正「no node」事实错、保留 ship-anywhere 精神）· 硬卡点：`grep -rnE '\bjq\b|\bpython3?\b|tsx|ts-node' plugin/src/hooks/*/implementations/claude-code/` 须只命中注释（node/JS 现已允许）。

2. **保持 board 的 narrow waist 稳定。** Board 是单一真相源、也是 hook 唯一能读的状态；只有一小撮固定字段是 hook-dependent（`schema` / `goal` / `owner.session_id` / `git` / `tasks[{id,status,deps}]` + status enum），其余 agent-shaped。动 waist 必须同 PR 改全部 hook + 测试并在 PR 描述显式说明。
   → 决策快照：[`adrs/ADR-003-board-narrow-waist.md`](adrs/ADR-003-board-narrow-waist.md) · **协议 canonical SSOT：`@ccm/engine` 的 `board-model`**（enums / 字段 tier 元数据 / 不变式注册表 / 状态机·ADR-013/014——动 waist = 改它的 tier）；[`plugin/src/skills/master-orchestrator-guide/canonical/references/board.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/board.md) 是 orchestrator 侧**派生叙事**（协议 narrative + 长程操作纪律）、**非 SSOT** · 硬卡点：动 waist 的 PR 必带 `bash run-tests.sh` 全绿 + hook 测试同步更新。

3. **八个分发 skill 各自自洽、互不重叠。** SKILL A（`master-orchestrator-guide`）= 主线编排**决策**（含 pacing 决策 + **换号决策锚**〔lever 阶梯 / policy 授权 / 绝不自授权·消费机制单向引用 H〕+ 一张**已切好**的 DAG 怎么排期）；SKILL B（`authoring-workflows`）= 脚本内写法；SKILL D（`using-ccm`）= **ccm CLI 一体两面手册 + 号池操作面**（面1 命令面 command-catalog〔含 namespace account 录号/换号/选号〕 + 面2 board 模型与字段取值指南 board-model-guide：领域概念 / 字段取值判断 / 引擎 registry 的全量校验规则速查；外加状态机 verb / 三档字段 / footgun 心智 + 换号号池概念叙事 account-pool.md）；SKILL E（`slicing-goals-into-dags`）= **敏捷切 DAG 方法论**（怎么把目标**切**成 board DAG，「切」先于 A 的「排」，A 在分解点引用 E）；SKILL F（`dev-as-ml-loop`）= **执行侧 dev loop 心智**（把 agentic-loop 开发当 ML 优化过程:验收=目标函数 / 迭代-测量-收敛 / plateau→restart——把一个**已切好**的任务**优化到验收**,与 A 的「指挥不演奏」不同 plane:A 派发、F 执行)；SKILL G（`engineering-with-craft`）= **设计/开发/测试的工程手艺**（DDD/SDD/TDD/OOP 整合成五条共享根 + 工程红线——「领域 / 类 / 合约 / 测试**本身**该长什么样」的**内容**，与 F 不同 plane:F 给循环**形状**、G 给循环里的手艺**内容**)；SKILL H（`pacing-and-estimation`）= **消费 ccm 只读 advisory（usage/estimate/baseline）配速 + 估算**（读双侧走廊 verdict / 四档模型档相对成本 / 配额信号源链 / 估算诚实字段·**ccm 出 verdict、A 决策**——只教消费层，决策回 A）；SKILL I（`distilling-lessons-into-assets`）= **经验→资产的路由与落地品味**（`/cc-master:distill` 引导加载：一条候选经验该落成纪律文档 / skill / workflow / subagent 中的哪一种、以及每种资产该怎么落地不走样——归宿判断决策树 + 落地手艺反模式 + 证据忠实性硬约束,不涉及代码工程手艺内容本身、不涉及目标切分、不涉及任务执行循环)。**决策 + 排期归 A;切分方法论归 E;执行循环形状归 F;循环里的工程手艺内容归 G;读 advisory 配速估算的消费归 H;经验蒸馏的资产路由归 I;机制按域分流**——换号机制归 ccm `account` 引擎 + 操作面归 D、board 操作机制归 D，A 在相应决策点单向引用 D/E/F/G/H 而不复述其内容（含**换号 policy（ADR-016）：换号授权决策 + 「绝不自授权」红线归 A、policy 机制硬闸〔切号前读 board.policy·`deny`→exit 7〕归 ccm `account switch` 引擎**）。`using-ccm` 与 `ccm` 命令面的锁步抗漂移约束见 **§6**。
   → 决策快照：[`adrs/ADR-005-two-skills-separation.md`](adrs/ADR-005-two-skills-separation.md)（两 skill 分离原则现扩到八个，using-ccm / slicing-goals-into-dags / dev-as-ml-loop / engineering-with-craft / pacing-and-estimation 经 curating 闸纳入·account-management 退役·portfolio 7→7〔-C+H〕· `distilling-lessons-into-assets` 经 [`adrs/ADR-027-distill-stage2-and-eighth-skill.md`](adrs/ADR-027-distill-stage2-and-eighth-skill.md) 纳入·portfolio 7→8〔+I〕·ADR-019/ADR-027·不变其精神）· 硬卡点：跨界/复述在 PR review 拦——"编排决策 + DAG 排期 + 换号决策锚" 归 A，"workflow 脚本怎么写" 归 B，"怎么用 ccm 操作 board + 号池 account 操作" 归 D，"怎么把目标切成 DAG" 归 E，"怎么把一个任务优化到验收（循环形状）" 归 F，"领域 / 类 / 合约 / 测试本身怎么建得好（DDD/OOP/SDD/TDD 手艺）" 归 G，"读 ccm usage/estimate verdict 怎么配速估算 / 选模型档" 归 H，"一条候选经验该落成哪类资产、落地手艺与反模式" 归 I；号池 / 选号 / vault 的**实现**归 ccm `account` 引擎。

4. **指挥永不演奏（the conductor never plays an instrument）。** Orchestrator 协调，不亲手做单元工作；任何把主线推向亲自实现 / 亲自 review 的改动都是反方向。
   → 纪律 SSOT（含唯一例外、Rationalization Table、Red Flags）：[`plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md`](plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md) §Red lines · 硬卡点：行为型红线，由 §8 Track B benchmark + 端点验收守护（非 grep 能拦）。

5. **保持 ship-anywhere。** 后台**派发**机制只有 background shell / sub-agent（`run_in_background`）/ workflow（不变）。**timer primitives 已部分解禁（ADR-011 收窄 ADR-002）**：`ScheduleWakeup` + **`CronCreate`（`durable:false` 本地 session 内存调度，不需 claude.ai OAuth）** **许可用于自我唤醒 / watchdog**（补静默失败盲区的安全网，层叠于 harness 自动重唤起之上）——但**只以降级链形态教**（CronCreate / ScheduleWakeup / Monitor 按情境降级，**background-shell `until` 轮询永为 universal floor**），不假设新工具到处都在。**仍排除/仍不教**：**agent-teams**（实验开关，不可靠）、**RemoteTrigger / claude.ai 云 `scheduled routines` / `/schedule`**（需 OAuth、Bedrock/Vertex/Foundry 上没有，破 ship-anywhere——注意与 CronCreate 本地内存调度区分）。别加在 Bedrock / Vertex / Foundry 上会断的依赖。**★ADR-014 修订 ship-anywhere 口径**：board 引擎已解耦为独立安装的 `ccm`（per-OS Node SEA 二进制 + `@ccm/engine` 库），cc-master plugin 降为消费方之一；**plugin hooks/skills 经进程边界 shell 调全局 `ccm` + JSON 访问 board，绝不 import `@ccm/engine`**（TS/npm 依赖锁在 ccm 内——这条**进程边界**是红线1 在新架构的落点）。ship-anywhere 从「单件自包含」变为「跨模型后端仍可跑」：`ccm` SEA 在任何能跑 Claude Code 的 OS 主机上运行，与 Bedrock/Vertex/Foundry（模型后端，非 CLI 宿主）无关（同 ADR-006「node 之于 hook」的宿主/后端之分）。代价：`ccm` 成为主机安装前置（诚实记账）；`ccm` 缺失时 hook 优雅降级（静默，不 block）。
   → 决策快照：[`adrs/ADR-002-ship-anywhere-scope.md`](adrs/ADR-002-ship-anywhere-scope.md)（被 [`ADR-011`](adrs/ADR-011-self-wakeup-watchdog.md) 部分收窄、ship-anywhere 口径被 [`ADR-014`](adrs/ADR-014-cli-decoupling-as-independent-product.md) 修订）· 排除留痕：[`design_docs/spec.md` §12](design_docs/spec.md) · 硬卡点：带外脚本（codex / eval）依赖 `uv` + Python 3.12 + `claude`/`codex` CLI 或 node——**绝不进 `plugin/src/hooks/`**（那会破 ship-anywhere）。落点二分：**运行时**带外脚本（终端用户会跑：codex-review / view webview）进 `plugin/src/skills/<skill>/canonical/scripts/`（随 skill 分发，prose 用 `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}` 引用，**裸相对路径会在用户 cwd 下找不到**·Finding #37）；**dev-only** 脚本（eval / skill-lint）留顶层 `scripts/`（仅 repo 根调用，裸路径正确）。

6. **所有 hook 武装后才激活（dormant-until-armed）。** 每个 hook 在本 session 被 `as-master-orchestrator` 武装（board-derived：home 的 `boards/` 里有 `*.board.json` 且 `owner.active:true` 且 `owner.session_id == 本次 hook stdin 的 session_id`；sid 空 → 降级匹配任一 active 板）之前完全休眠（空 stdout、RC 0、不 block）；`bootstrap-board.sh` 唯一豁免（它**是** ARM 动作本身）。**ARM 有 fresh / resume 两形态**：fresh（新建板并盖 `owner.session_id`）与 resume（`as-master-orchestrator --resume` 盖到选定旧板上、`owner.active` 置 true 含复活归档板、保留 `tasks`/`log`/`goal`，经 live 安全闸；ADR-009）——红线实质不变（仍是「bootstrap 是唯一豁免的 ARM 动作」）。
   → 决策快照：[`adrs/ADR-007-hook-arming-gate.md`](adrs/ADR-007-hook-arming-gate.md)（board-derived armed-gate）· 协议 SSOT：本文 §12 hook 武装纪律 · 硬卡点：`grep -rL 'board_matches\|isArmed\|listMatchingBoards\|runHook' plugin/src/hooks/*/implementations/claude-code/*.sh plugin/src/hooks/*/implementations/claude-code/*.js | grep -vE 'bootstrap-board\.sh'` 须零命中（除 `bootstrap-board.sh` 唯一豁免外每个 hook 都须含武装判定，否则违规）。**v2 收编 + phase-1b harness 收口**：pattern 加 `runHook`——phase-1b 把五个 node hook 的武装收口进 `hook-common.js` 的 `runHook(spec)` harness（武装闸是它的固定环节·结构性保证「每 hook 入口先过武装」），各 node hook 经 `runHook({arm:…})` 的 **arm 参数**委托武装（真代码级·非靠注释里的字面残留）：reinject / posttool-batch / usage-pacing 用 `arm:'boards'`（harness 调 `listMatchingBoards` 填 `ctx.boards`），board-lint / verify-board 用 `arm:'custom'`（body 自判武装——board-lint 的四闸复合 / verify-board 的自判 + clearSidecar）。pattern 同时保留 `board_matches\|isArmed\|listMatchingBoards`（`hook-common.js` 与 bash hook 仍含这些字面），加 `runHook` 锚定**真代码级委托**、比靠注释残留稳健（类比 ADR-014 加 `listMatchingBoards`·不弱化红线6：每 hook 入口仍 dormant-until-armed，harness 把它从「各 hook 自觉」升级为「结构性保证」）。**唯一豁免**：`bootstrap-board.sh`（它**是** ARM 动作本身·bash·无 `runHook`，由显式 `grep -vE` 排除）；`hook-common.js` 含 `isArmed`/`boardMatches`/`runHook` 故天然过门、无需列豁免。**★ADR-014 后**：board 引擎（board-model/lint-core/graph-core/lock）**已不在 `plugin/src/hooks/*/implementations/claude-code/`**——迁入独立的 `@ccm/engine`，hooks 改经进程边界 shell 调 `ccm`（不再 in-process require 引擎），故旧的「board-\*.js 纯 helper 库豁免」已随文件删除一并移除（grep 不再排除它们）。**红线本身不弱化**——「每个 hook 入口 dormant-until-armed」不变。

> **违背字面就是违背精神。** "我遵循的是精神，不是字面" 是攻破每一条红线的那句合理化。没有哪个 orchestration 特殊到红线失效——当你开始论证 *这次* 是例外，那套论证本身就是症状。

---

## 4. 迭代范式总图（gstack × superpowers 路由）

本仓的开发遵循用户全局的 **gstack × superpowers 组合范式**——gstack 管"前"（方向判断）和"后"（review / QA / 安全 / ship），superpowers 管"中间"（brainstorming → plans → TDD → debugging → verification）。冲突仲裁：**用户显式指令 > skill > 默认行为**。
→ 完整路由表 + 分工原则 + 避坑：用户全局 `~/.claude/CLAUDE.md` §「gstack × superpowers 组合使用范式」。**本仓收口用 `gh` CLI 手工流程（feature branch → PR → squash merge → `gh release`；本仓**没有** `github-pr` / `github-tag-release` skill——那是历史占位、实物不存在，别去找），不用 gstack 的 `/ship` `/canary` `/land-and-deploy`**（它们假设别的部署形态）。详见 §11。

> **本仓对 superpowers 的一处覆盖（self-contain）**：「中间」段最前那一步**需求发现 / brainstorming** 在本仓用项目自带的 [`requirement-elicitation`](.claude/skills/requirement-elicitation/SKILL.md)（dev skill），**不用 `superpowers:brainstorming`**——把这一步内化进本仓、重接地到 board `goal` 模型与「发现 → 准入 → 造 → 度量」生命周期，让贡献者无须外装 superpowers 也有这一步。其余「中间」段（plans / TDD / debugging / verification）与「前 / 后」仍按全局路由表。

---

## 5. 编排纪律（SKILL A 是灵魂）

编排方法论的**唯一真相源是 [`plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md`](plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md)（SKILL A）**——七镜头、红线、Rationalization Table、Red Flags、决策程序（dot-graph）都在那里，是 `SessionStart` hook 每次 compaction 全文重注的常驻手册。**本文不复述任何一条**；要援引方法论就读 SKILL A，要改方法论就改 SKILL A，不在这里另起一份。

**改 SKILL A 的纪律**（这是本文该说的，SKILL A 正文不必自陈）：
- **reinject 重注友好**——它每回合 compaction 后被整篇重注，**越短越好**；新增内容前先问"这能不能进 `references/` 让主文件保持瘦"；但收敛靠 delta 下沉 `references/`，**非整篇重写 / 有损压缩**——双侧悬崖：过短 → brevity bias 丢洞察，整篇重生成 → context collapse 蚀细节（delta-only 纪律 SSOT：`.claude/skills/cc-master-skillsmith/SKILL.md`）。
- **决策程序骨架不动**——7 步 + step-6 ledger gate 的 dot-graph 是"牙齿"，结构性改动走 PR 人审（红线级）。
- **Finding #7 收敛结论**——主文件曾与 `references/async-hitl.md` 整段重复 step-6 ledger，已收敛为一句指针；新增时不要重新制造跨文件重复（SSOT 原则）。
- 改 SKILL A 的**纪律段 / description** 前，先走 §6 的 TDD-for-skills pressure baseline。

---

## 6. Skill 创作 / 维护纪律（含 TDD-for-skills）

本仓**分发**八个 skill（源码在 `plugin/src/skills/`，各 host 产物在 `plugin/dist/<host>/skills/`）：A（编排决策 + DAG 排期 + 换号决策锚）、B（workflow 写法）、D（`using-ccm`·ccm CLI 操作手册 / board 操作机制层 + 号池 account 操作面）、E（`slicing-goals-into-dags`·敏捷切 DAG 方法论）、F（`dev-as-ml-loop`·执行侧 dev loop 心智）、G（`engineering-with-craft`·设计/开发/测试的工程手艺）、H（`pacing-and-estimation`·消费 ccm 只读 advisory 配速 + 估算）、I（`distilling-lessons-into-assets`·经验→资产的路由与落地品味）——**互不重叠**（红线 3）：A = orchestrator 做什么（含换号**决策** + 已切好的 DAG 怎么排期），B = workflow 脚本怎么写，D = 怎么用 ccm 读写 board + 操作 account 号池（操作**机制**；号池 / 选号 / vault **实现** SSOT 在 ccm `account` 引擎，概念叙事在 D 的 account-pool.md），E = 怎么把目标**切**成 board DAG（「切」先于 A 的「排」），F = 把一个已切好的任务**优化到验收**（agentic-loop 开发=ML 优化的执行侧**循环形状**，与 A「指挥不演奏」不同 plane），G = 设计/开发/测试时**领域 / 类 / 合约 / 测试本身怎么建得好**（DDD/SDD/TDD/OOP 整合成五根 + 红线，与 F 不同 plane:F 给循环形状、G 给循环里的手艺内容），H = 消费 ccm `usage`/`estimate`/`baseline` 只读 advisory 配速 + 估算（读 verdict / 四档模型档 / 配额信号源 / 估算诚实字段·**ccm 出 verdict、A 决策**，只教消费层），I = `/cc-master:distill` 引导加载的**经验→资产路由判断力**（一条候选经验该落成纪律文档 / skill / workflow / subagent 中的哪一种、每类资产怎么落地不走样、证据忠实性硬约束——不涉及代码工程手艺内容本身〔归 G〕、不涉及目标切分〔归 E〕、不涉及任务执行循环〔归 F〕）。另有**七个项目自用、不随插件分发**的 dev/meta skill（住 `.claude/skills/`，不在 `plugin/src/skills/`，并投影到 `.agents/skills/` 给 Codex 项目级发现），终端用户装插件时看不到它们：

- **`requirement-elicitation`** — 在动手任何 feature / skill / 行为改动**之前**，通过协作对话挖出用户真实痛点、过设计闸（批准前不实现）。本仓 dev 流的需求发现闸，**取代 `superpowers:brainstorming`**（self-contain + 重接地到 board `goal` 模型）。**它不是「为对仗凑的第四件造/评/治」**——是不同家族的**发现层**（喂给 curating），靠 self-containment 缺口 + 强 B1 覆写挣得席位，见其 [`DESIGN.md`](.claude/skills/requirement-elicitation/DESIGN.md)。
- **`cc-master-skillsmith`** — 写或改**一个** skill 的 body（craft 两轴诊断 + 4 类 body 内容 + pressure-test 纪律）。
- **`curating-skill-portfolios`** — 判断要不要建一个 skill / 这块该 skill 还是 reference / 一组 skill 的边界与重叠（Counterfactual Probe A/B + 裁剪七维 + DESIGN 宪法）。
- **`grounding-skill-evals`** — 声明 J（成功契约）/ 度量一个 skill / 跑触发或行为 eval（轻量 J 写法 + 接现有 eval 三脚本 + holdout / predict-then-validate 防过拟合）。
- **`harness-plugin-architecture`** — 设计 / 重构本仓的多 agent harness 兼容架构：paragoge 式 `plugin/src` → `plugin/dist/<host>`、SAP skills、PHIP hooks、host adapter 边界、Codex 项目 skills 同步。
- **`adapter-projection-engineering`** — 实现 / 修改 / 调试 source-to-adapter 投影脚本：strategy/meta 检查、slot/placeholder rewrite、dist 生成、sync check、path token 验证。
- **`plugin-release-engineering`** — 打包 / 分发 / 发布 CLI+plugin：source/dist/package 边界、host-native artifact、版本线、release checks、marketplace metadata。

**路由**：**还没搞清用户真需求 / 动手实现之前 → `requirement-elicitation`；要不要建 skill / 边界 / 重叠 → `curating-skill-portfolios`；写或改一个 skill 的 body → `cc-master-skillsmith`；声明 J / 跑触发或行为 eval / 度量一个 skill → `grounding-skill-evals`；改 origin 多 harness plugin adapter / N-host parity → `harness-plugin-architecture`；改 sync/projection → `adapter-projection-engineering`；改打包/发布 → `plugin-release-engineering`**。它们触发时机正交，靠 description 识别，不设路由器 skill。

**Codex 项目级 meta-skill 同步**：Codex 不读取 `.claude/skills`，项目级 skills 的官方目录是 `.agents/skills`。本仓以 `.claude/skills` 为 dev/meta-skill 源，`.agents/skills` 由 [`scripts/sync-codex-skills.sh`](scripts/sync-codex-skills.sh) 生成（默认 symlink，Codex 支持 symlinked skill folders；不能用 symlink 的环境跑 `--copy`）。新增 / 删除 / 重命名 `.claude/skills/*` 后必须运行：

```bash
bash scripts/sync-codex-skills.sh
```

不要手改 `.agents/skills` 里的生成项。

**语言纪律**：本仓所有 skill 正文 + references 一律**中文**；例外仅 `name`（kebab-case 英文）、代码/路径/CLI/API 字段/工具名等技术术语；`description` 中文为主可含英文触发词。

**Frontmatter description 路由纪律（含 adapter stub / partial）**：`description` 是 skill 触发器，不是简介摘要。任何 `SKILL.md`——canonical、adapter `partial/`、adapter `stub/`、项目自用 meta-skill——都必须保留足够路由信息：**何时用 / Triggers / Do NOT use / 职责边界 / unsupported 或 partial 边界**。做 host adapter 时可以替换 host-specific 能力（例如 Claude Code account/statusline/workflow → Codex 当前支持边界），但**不许**把 description 压缩成英文短句或“unsupported stub for X”式维护者注释；stub 也要告诉 agent 什么时候触发、阻止它误用什么、缺哪类 host 能力。硬卡点：`scripts/skill-lint.sh` 会扫描 `plugin/src/skills/**/SKILL.md`（含 `adapters/<host>/{stub,partial}`）并要求 description 中文主体 + 路由语言 + adapter 边界。

**Adapter payload 唯一性纪律**：每个 `plugin/src/skills/<skill>/adapters/<host>/strategy.yaml` 的 `mode` / `projection.source` 是该 host 唯一有效 payload。`mode: partial_overlay` 后就删掉旧 `stub/`，`mode: unsupported_stub` 后就删掉旧 `partial/`；不要为了“以后可能用”保留未引用的 `SKILL.md`。未引用 stub/partial 会成为第二真相源，让 reviewer 和 projection 都看错当前支持边界。硬卡点：`scripts/skill-lint.sh` 会拒绝 strategy 未引用的 adapter `stub/` / `partial/` payload。

**Partial overlay 例外纪律（slot/overlay 优先）**：host 适配的默认解法是**canonical + slot/overlay**，不是复制一份 adapter `partial/SKILL.md`。`partial_overlay` 是最后手段，只能用于 canonical 结构本身在某 host 下暂时不可复用、且已经把可抽 slot 的机制点抽尽之后；它必须在 strategy 里写 `allow_partial_overlay: true` 和 `partial_reason`，说明为什么不能继续 slot 化、计划怎么退回 `copy`。一句话：**partial 是战术勤奋、战略偷懒的默认陷阱**——它会 fork 方法论、丢 description 路由密度、制造两份主文件漂移。硬卡点：`scripts/skill-lint.sh` 会拒绝未显式 allow 的 `mode: partial_overlay`。

**受众纪律（skill .md = 写给 agent 的 prompt·第二人称）**：所有分发 skill 的 `SKILL.md` + `references/` 正文都是**注入 agent context 的 prompt**——用第二人称、imperative、agent-as-actor 写。**绝不夹带写作者留给自己 / 维护者看的「注释」性质文本**：文档自述（「这是 X 的魂」）、投递机制（「`SessionStart` hook 每次 compaction 重注」）、自述结构的 TOC（「本文分四模块…」，与紧邻的章节标题冗余）、设计理由旁白（「（显式化判定：…）」）、给评审的 meta 注。判据一句话：**这行字是在「对 agent 说话让它行动」，还是在「对人描述这份文档」？后者删。**（命令体同型原则见 §12 [[Finding #43]]——命令体正文用 imperative / 第二人称、别写成第三人称 reference；此为其 skill 版。）

**自包含纪律（skills/ 服务 user-agent·repo-无关·无代号）**：分发 skill 源码在 `plugin/src/skills/`，安装后投影为 plugin 根下的 `skills/`；其读者是**被初始化成 master orchestrator 的用户 agent**（在编排它自己的目标），**不是 cc-master 项目的开发者**。因此 skills 正文只写对 user-agent 有用的 **HOW**，**绝不夹带 cc-master 项目自身的开发者视角 meta**：产品愿景 / charter 能力（`C1`–`C6`）、hook 内部编号 / taxonomy（`H3` / `H8`）、`ADR-NNN` 决策记录、`Finding #NN` 台账、`design_docs/` 设计文档——这些对一个只被初始化来编排目标的 user-agent **不明所以**，删。两条硬约束：**① repo-无关 self-contain**——skills 里的文件绝不引用 skills 以外的东西（`design_docs/` / `adrs/` / `hooks/` / `README` / `AGENTS.md` / `CHANGELOG`），装到用户机器后它们都不在。**② 无代号压缩概念**——绝不用代号压缩一个概念（`ADR-024` / `Finding #37` / `C4` / `H8` / 「SKILL H」/「镜头 2」这类），**即使概念定义在 skills 内，也用它的名字或 skills 内文件路径引用、不用代号**（代号要么指向 skills 外破 self-contain、要么逼读者查外部解码表）。判据一句话：**一个只拿到 skills/、对 cc-master 项目一无所知的 user-agent，读这句能直接懂吗？懂→留；要查外部解码表→换成名字 / skills/ 内文件路径。** 硬卡点：`scripts/skill-lint.sh` 新增 check——`plugin/src/skills/` 里命中 `ADR-[0-9]` / `Finding #` / charter `\bC[1-6]\b` / hook `\bH[0-9]\b` / `镜头 ?[0-9]` / `design_docs|adrs|hooks/scripts` 引用即违规。（与 §12 分发 self-contain 同源而更严：§12 曾容「叙事性 `Finding #NN` / `ADR-NNN`（不带路径）可留」，本纪律为分发 skills **收紧为一律不留**。）

**TDD-for-skills（纪律型 skill 改前必跑 baseline）**：任何"纪律型 / judgment-bearing"的 skill prose（agent 在压力下能把它合理化掉的规则）——新建或编辑——都**必须先跑一遍 subagent pressure baseline 看它在没有该段时选错**，再写堵漏。完整 Iron Law + 三压（time + sunk cost + exhaustion）配方在 → [`.claude/skills/cc-master-skillsmith/SKILL.md`](.claude/skills/cc-master-skillsmith/SKILL.md)（指针 `superpowers:test-driven-development` + `superpowers:writing-skills` + 官方 `skill-creator`）。pressure baseline 是**定性**（哪条 rationalization 要堵）；§8 eval 是**定量**（堵了有没有用）——互补，不替代。

**Frontmatter YAML 引号反模式（Finding #1，血泪）**：`description` 里只要含 `:` 或 `"`，**整个值必须用单引号包起来**——否则 YAML parser 误读、`plugin validate` / content 测试以非显然的方式失败。本仓所有 skill 的 frontmatter 都是单引号整包，照抄即可。**拿不准就加引号**——这是本仓最常见的 skill-authoring footgun。

**content contract = 权威结构 validator**：结构（frontmatter 有 name + description、description 路由密度、adapter payload 唯一性、目录布局）由 `bash run-tests.sh`（node content 段 + `scripts/skill-lint.sh`，自动覆盖 `plugin/src/skills/**/SKILL.md` 与 `.claude/skills/*/SKILL.md`）+ `claude plugin validate plugin/dist/claude-code`（仅校验当前 Claude Code adapter 产物）把关，**别手检它们查的东西**。行为靠 pressure baseline，结构靠 contract。

**`ccm` ⟷ `using-ccm` 锁步（抗漂移硬约束）**：`ccm` CLI（引擎 `@ccm/engine`）是命令面 / 状态机转移 / lint 规则 / 字段三档的**单一真相源**；分发 skill `using-ccm` 是它的**派生操作视图**（手册）。**`ccm/` 下任何命令 / flag / 状态机 / lint 规则 / 字段档位的增删改，必须在同一 PR 同步更新 `using-ccm`**——首当其冲两份 reference：① `references/command-catalog.md`（全量命令面，逐命令对得上——**含 namespace account 的 5 verb〔add/refresh/delete/list/switch〕逐条对 ccm `account` registry**·ADR-019 portfolio 重排后 account 操作面归 D）② **`references/board-model-guide.md`（board 模型 / 字段取值 / 引擎 registry 的全量 FMT/GRAPH/BIZ 校验规则速查——引擎 `board-lint-core.ts` / `INVARIANTS` 改一条规则或字段 tier，它必同步一条，否则 agent 照旧表写仍撞 `exit 3`，「一次写对」承诺即破）**；外加受影响的 `SKILL.md` 心智锚 / footgun 速查 / `evals/trigger.json`。漂移即手册骗人：agent 照过时手册敲命令会踩 `exit 2/3`。判据：改 ccm 命令面 / lint 规则的 PR，审查者必查 `using-ccm` 两份 reference 是否同步（命令面 + 校验规则是机械事实，须逐条对得上；心智锚 / footgun 是语义，按改动性质判）。这是 ADR-014 解耦的代价之一——SSOT 在 `ccm`、操作视图在 skill，二者人工锁步（§11 的 ccm CI/release 段回指本条）。

**术语表 ⟷ 措辞锁步（抗漂移硬约束）**：[`design_docs/glossary.md`](design_docs/glossary.md) 是承重术语 canonical 措辞的 dev-side 单一真相源（由 `scripts/glossary-lint.sh` 机械把关、接进 `skill-lint.sh` check(5)）。**新增 / 改一个 canonical 术语的措辞，必须在同一 PR 更新 `design_docs/glossary.md` 的「禁用变体」列**（同上「`ccm`⟷`using-ccm` 锁步」同型：改了措辞不同步禁用变体列，lint 就漏卡新漂移形、或对旧措辞假阳）——禁用变体列只收「零合法用法」的错形/漏字（closed-set 克制见 glossary 卷首）。

**hook N-host 锁步（抗漂移硬约束，HOOKPAR-DEC / ADR-028 · 升格 ADR-031）**：已知宿主 `claude-code | codex | cursor | kimi-code`。`plugin/src/hooks/<hook>/CONTRACT.md`（每个多端 `implemented*` 的业务 hook 一份）是该 hook **host-neutral 业务规则 SSOT**——业务规则枚举 + 注入 taxonomy + 武装语义 + 降级行为（三分类学 `event-unavailable` / `protocol-capability-gap` / `host-convention-divergence`，后者必带 `tracked_by`）。`implementations/<host>/` 是这份 CONTRACT 在各自协议下的**投影**，不是独立 spec。**`plugin/src/hooks/<hook>/` 下任何业务逻辑改动（判定分支 / 阈值 / 状态转移 / 注入文案的语义而非措辞），若该 hook 在 `hooks.yaml` 声明任一宿主 `implemented*`，必须在同一 PR 要么同步改所有 `implemented*` 宿主的等价实现，要么在该 hook 的 CONTRACT.md「降级行为」一节显式声明本次改动为何只影响部分宿主**（协议不支持 / host 无等价事件 / 有意暂缓 + tracking 链接）——同「`ccm`⟷`using-ccm` 锁步」同型，改了一端不声明就是让其他端悄悄过期。跨 hook/command/skill 的硬缺口（reinject / PostToolBatch / Workflow / path token / ccm quota·account 等）另有 **Capability INTENT** 层：[`design_docs/harnesses/capabilities/`](design_docs/harnesses/capabilities/)（host-neutral 意图 + 验收 + 各宿主机制 / 替代）+ `scripts/gen-capability-parity-matrix.sh` → [`design_docs/capability-parity-matrix.md`](design_docs/capability-parity-matrix.md)；Cursor / Kimi 走双轨——Track A SAP/PHIP 1:1、Track B 须在 Capability Card 声明替代（禁止沉默省略）·见 [`adrs/ADR-031-n-host-capability-parity.md`](adrs/ADR-031-n-host-capability-parity.md)。落地物：① 每条业务规则一个 `rule-<id>`，在其「PARITY anchors」一节登记 `required_hosts`，`// PARITY: rule-<id>` 结构锚点须在每个 required host 的实现文件里能 grep 到（`tests/content/hook-injection-contracts.test.mjs` 机械核验，只证明「各 required host 都声明了这条规则」，不证明判定逻辑本身等价）；② hook parity 矩阵是生成物——`scripts/gen-hook-parity-matrix.sh` 从全部 CONTRACT.md 的「降级行为」节汇总渲染 `design_docs/hook-parity-matrix.md`（四列宿主·只读、类比 `plugin/dist` 的 source-to-artifact 纪律，`--check` 模式接进 `run-tests.sh`）；③ 行为级 parity test（`tests/hooks/test_parity-fixtures.sh`）用同一份 host-neutral fixture stdin 跑各 `implemented*` 真实现，断言判定落在同一等价类（`hook-common.js` 的 `ctx.normalized` 是归一化桥接收敛单点）；④ commands/skills：每个 required command / 分发 runtime skill 对每个已知宿主须有 `adapters/<host>/strategy.yaml`（`tests/content/capability-host-coverage.test.mjs`）。硬卡点：`scripts/check-hook-parity-touch.sh`——PR diff 若 touch 任一 `implemented*` 宿主的 `implementations/<host>/`，同 PR 须 touch 该 hook 的 CONTRACT.md（存在性检查，非语义检查——PR reviewer 手动判断声明是否合理）。

---

## 7. codex 作为 reviewer 范式

cc-master 把 **codex 当独立的第二端点验收者**（呼应红线 4 "指挥不演奏" + SKILL A 的"只信端点验收 / gate-green ≠ passed"）。它**不进任何 hook**（要联网 / OAuth / 多分钟超时 / JSON 解析，违背纯 bash ship-anywhere），只以**带外手动 / 编排调用的 sub-agent 端点验收节点**形态接入。

落地物：[`skills/master-orchestrator-guide/scripts/codex-review.sh`](plugin/src/skills/master-orchestrator-guide/canonical/scripts/codex-review.sh)——纯 shell 封装 `codex exec review ... --json`，只读 sandbox，对一段 diff 出 `verdict: approve | needs-attention` + 每条 finding 的 severity/file/line。**空 review / OAuth 过期 → 按"未通过"处理**（silent-pass-through guard，不静默放行）。`verdict` 映射现有 Joiner 闸：`needs-attention` → Replan；`approve` + 非空 + 已读 diff → done。
→ 文档化：[`skills/master-orchestrator-guide/references/resume-verify.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/resume-verify.md)（codex 第二验收者小节）· 指针：`/codex` skill。

---

## 8. Eval 机制（Track A + Track B）

eval 让 skill 迭代**有数可依**。运行钥匙：`uv run --python 3.12`（系统 Python 跑不了 PEP-604）+ `claude` CLI（复用 session 认证，无需 API key）。两条 Track，**不入 hook、非每-commit CI 门，作改前后对比 / pre-release 检查**。

- **Track A —— 触发准确率门**（全自动可复现）：量每个 skill 的 `description` 在一组 query 上的 precision/recall/accuracy。落地：`skills/<s>/evals/trigger.json`（should-trigger + near-miss）+ [`scripts/eval-trigger.sh`](scripts/eval-trigger.sh)。**何时跑：任何 `description` 改动前后各跑一遍比 accuracy。** 诚实标注：平凡 query 本就不触发 skill，与 description 质量无关——eval query 须 substantive。
- **Track B —— 编排纪律 benchmark**（行为型）：`master-orchestrator-guide` 让编排者行为更好的端到端断言，with-skill vs without-skill 各 3 run 看 mean±stddev。落地：[`scripts/eval-benchmark.sh`](scripts/eval-benchmark.sh) + [`design_docs/eval/track-b-benchmark.md`](design_docs/eval/track-b-benchmark.md)。**codex 当第二评委**：grader 后跑 codex 对同一 transcript 出非-Claude 裁决，分歧 = 高信号。
→ 用法 / 依赖 / 天花板：[`design_docs/eval/README.md`](design_docs/eval/README.md) · 创作/优化 description / 跑 eval 的工具：官方 `skill-creator`。

---

## 9. Dogfood 循环 + findings 台账

cc-master 用**本插件改本插件**——任何 behavioral 改动**必须 dogfood**（用 `/cc-master:as-master-orchestrator <goal>` 起真 orchestration，对 live runtime 验证）。多个历史 bug 对测试套件不可见，只在真 session 下浮现。

**findings 台账 [`design_docs/dogfood-findings.md`](design_docs/dogfood-findings.md) = 已踩反模式的永久纪律记录**（纪律式：踩过一次就写进纪律永久避免）。纪律：**用着不爽 / 给 agent 的指导不对 / 效率没真正拉满，必落台账**（现象 → 根因 → 影响 → 处置 → 严重度/来源）。「处置」字段**必须含蒸馏判定**——回流到哪个 skill 的 body / reference（指明具体落点），或显式判「不回流」+ 理由；**成功机制的验证与失败同权入账蒸馏**（不只记踩坑——台账已有 ✅正向 先例）。台账是 §6 Rationalization Table 与 §3 红线的素材源——很多红线就是 finding 沉淀出来的。

---

## 10. 测试纪律 + 验收门

三道门（与 [`CONTRIBUTING.md`](CONTRIBUTING.md) 同步，本文不复述命令细节，只立纪律）：`bash run-tests.sh` 必须以 `ALL TESTS PASSED` 收尾 + `bash scripts/check-plugin-dist-sync.sh` 不留下 `plugin/dist` diff + `claude plugin validate plugin/dist/claude-code` 无错。

- **测试只保 correctness，不保 quality**——`run-tests.sh`（hook 行为 + content 结构）回答"语义合不合 spec/contract"；quality（指导对不对、效率拉没拉满）靠 §9 dogfood + §7 端点验收独立守护。
- **并行后端点必跑全套**（Finding #12）——sub-agent / workflow fan-out 之后，orchestrator 在端点亲跑一次完整 `run-tests.sh` + `plugin validate`，不信各 leaf 的自报。
- **红线零违反 grep 门**——见 §3 各条卡点；最关键一条：`grep -rnE '\bjq\b|\bpython3?\b|tsx|ts-node' plugin/src/hooks/*/implementations/claude-code/` 须只命中注释（node/JS 现已允许·ADR-006——故 grep 门**不含** `node`，否则会把 `usage-pacing.js` 的 `#!/usr/bin/env node` shebang 误判为违反）。

---

## 11. 分支 / PR / commit 约定

- **feature branch**——不在 default 分支直接动手（先 branch）。
- **PR 走 `gh` CLI 手工收口**——`gh pr create`（PR body 末尾带 Claude 署名 `🤖 Generated with [Claude Code]`）→ `gh pr merge <N> --squash --delete-branch`（本仓惯例 squash，main 上 commit 形如 `… (#N)`）。本仓**没有** `github-pr` / `github-tag-release` skill（历史占位、实物不存在，别去找）；不用 gstack `/ship`。
- **merge 前 CI 必须绿（branch protection · 硬闸）**——main 已设 branch protection（`build-and-check` required + strict + enforce_admins），**CI 红任何人（含 admin）都 merge 不进 main**（曾发生 gate 红被 squash 进 main 的事故，现已机制堵死）；`gh pr merge` 前先 `gh pr checks <N>` 确认 `build-and-check` = pass（或 `--auto` 等 CI）。**ccm 改动的本地验收须对齐这道复合门**——除 §10 三道门另跑 `pnpm -C ccm typecheck` + `pnpm -C ccm lint`（`ccm build` 不做严格 tsc、`run-tests.sh` 不含 ccm typecheck/lint，漏跑必本地绿 CI 红）。细节见 [`CONTRIBUTING.md`](CONTRIBUTING.md)「Before you open a PR」段，本文不复述。
- **发版（release）——两条独立版本线，各自 tag、各自触发**（决策快照 [`adrs/ADR-022-version-line-decoupling.md`](adrs/ADR-022-version-line-decoupling.md)·本段是它的操作纲领·不复述正文）。`ccm`（独立 TS 引擎/CLI·ADR-014）与 cc-master plugin 的**版本号 + 发版触发 + changelog 节奏完全解耦**，互不绑定。**未来发版者先回答「这次该 bump 哪条线」**：
  - **改 plugin 面**（`plugin/src/commands/` / `plugin/src/skills/` / `plugin/src/hooks/` / 命令体 / README·凡随 plugin zip 分发的物）→ **bump plugin 线**（裸 `v*`）。
  - **改 `ccm/` 包**（`@ccm/engine` 引擎 / `ccm` CLI 命令面 / lint 规则 / 估算配速数学·凡进 SEA 二进制的物）→ **走 ccm changeset**（`ccm-v*`），且若动命令面/规则必同 PR 同步 `using-ccm`（§6 锁步）。
  - **两侧都改**（如本轮 0.10.1 + ccm-v0.11.0）→ **两条线各自 bump、各打各的 tag**（互不绑架节奏·glob 互斥保证零交叉触发）。一条线发版**绝不**要求另一条同时发——这正是解耦的目的。
  - 机制细节如下：
  - **plugin 线（裸 `vX.Y.Z` tag·延续历史·手动门）**——版本号同步改**全部 4 个 host** 的 plugin manifest：`plugin/src/.claude-plugin/plugin.json` + `plugin/src/.codex-plugin/plugin.json` + `plugin/src/.cursor-plugin/plugin.json` + `plugin/src/.kimi-plugin/plugin.json`，再同步 `plugin/src/.claude-plugin/marketplace.json`（都要 bump；4-host manifest 版本 lockstep 检查会机械把关）+ `CHANGELOG.md`（`[Unreleased]` 定版为 `[x.y.z] — YYYY-MM-DD`，顶部留空 `[Unreleased]`）；合并进 main 后打**裸** `vx.y.z` tag（`gh release create vx.y.z --target main`）→ 触发 `.github/workflows/plugin-release.yml`（同一 plugin tag 下打四个 per-harness asset：`cc-master-plugin-claude-code-<tag>.zip` / `cc-master-plugin-codex-<tag>.zip` / `cc-master-plugin-cursor-<tag>.zip` / `cc-master-plugin-kimi-code-<tag>.zip`，外加共享 `SHA256SUMS`）。发版前手动跑 `bash run-tests.sh`（须 `ALL TESTS PASSED`）+ `bash scripts/check-plugin-dist-sync.sh`（须无 `plugin/dist` diff）+ `claude plugin validate plugin/dist/claude-code`（须 `Validation passed`）。**版本文件归属 plugin 线**：全部 4 个 host 的 `plugin.json` + `marketplace.json`（+ `CHANGELOG.md`）。
  - **ccm 线（`ccm-vX.Y.Z` tag·CI + changesets）**——解耦出的 `ccm` 子产品（ADR-014·`ccm/`）有自己的 GitHub Actions CI：`.github/workflows/ccm-ci.yml`（PR/push 碰 `ccm/**` 即 build/typecheck/lint/test）+ `ccm-release.yml`（**`ccm-v*` tag 触发**，多平台 Node SEA 二进制 → attach GH release）。版本走 changesets（`ccm/.changeset/`）：PR 附 changeset → `changeset version` 聚合 bump + 生成 changelog → 打 **`ccm-vX.Y.Z`** tag。**版本文件归属 ccm 线**：`ccm/apps/cli/package.json`（`ccm`·= `ccm --version`）+ `ccm/packages/engine/package.json`（`@ccm/engine`·**与 cli `fixed` 锁步成单一 ccm 版本号**·见 `ccm/.changeset/config.json`）+ `ccm/package.json`（`ccm-monorepo`·private·cosmetic）。
  - **tag glob 天然互斥**：裸 `v*` 不匹配 `ccm-v*`（后者以 `c` 开头），两个 workflow 零交叉触发，无需排除规则。**两条线各管各的 changelog**：plugin 根 `CHANGELOG.md`（手动）∥ ccm 各包 changesets 生成的 changelog。**首个真实分叉**：plugin 线 `v0.10.1`、ccm 线 `ccm-v0.11.0`（ccm 线**首个** `ccm-v*` release·**不存在 `ccm-v0.10.0` 锚点**——旧合并式 `v0.10.0` release 早于解耦、属 plugin 历史·ADR-022 §2.5）。
  - **本机更新（终端用户）**：`install.sh` 双 pin flag——`--ccm-version <ccm-vX.Y.Z>` / `--plugin-version <vX.Y.Z>`（各自可选·缺省装本线最新）；ccm 二进制日后还可经 `ccm upgrade` 子命令就地自更新（按 `ccm-v*` 解析），免重跑 install.sh。
  - **改 `ccm/` 命令面**（命令 / flag / 状态机转移 / lint 规则 / 字段档位）的 PR 还须同 PR 同步 `using-ccm` skill（首当其冲 `references/command-catalog.md`）——见 §6「`ccm` ⟷ `using-ccm` 锁步」抗漂移约束。
- **commit 末尾带** `Co-Authored-By: Claude <noreply@anthropic.com>`；type 前缀 `feat/fix/docs/chore/adr`。
- **single-committer**——sub-agent 只写 + 自证测试绿，**绝不 commit**；orchestrator 端点验收（含 §7 codex 自审）后统一分组 commit。
- **commit 卫生：每任务一 commit + 绝不 `git add -A` 盲提**——分组 commit 时**每个任务落一个独立 commit**（任一 commit 都是干净可回滚点，能单独 revert 而不牵连别处）；且**只 stage 该任务真正碰过的文件**（显式列路径），**绝不 `git add -A` / `git add .` 盲提**——自治的 per-task commit 一旦吞并 worktree 里的无关本地改动（残留脏文件、别处溢进来的改动），就把它们焊进了这次 commit，clean-rollback 保证当场破掉。
- **README.md / README_zh.md 同步**——动 user-facing 文档时两份一起改；user-visible 改动加 `CHANGELOG.md ## [Unreleased]` 条目。
- **outward-facing / irreversible（含 merge）先问用户**（红线 4 的延伸）。

---

## 12. 目录与文件约定

- **command / prompt**（`plugin/src/commands/**/body.md`、`plugin/src/prompts/<host>/*.md`）——一次性点火，frontmatter + body；body 首个非空行的 sentinel / prompt prefix 是 hook 触发标记时，**只在首行独立成行时触发**（内联提及不触发，Finding #16）。仅作为 hook 触发点的 command / prompt 需要机读标记；`status` / `stop` / `handoff-to-new-session` 等普通入口不需要。**正文是用户触发入口时注入 agent context 的 prompt——用 imperative / 第二人称 / task-first 写（对齐 `status` / `stop` 的嗓音），只写 agent 此刻该怎么做。绝不夹带维护者提醒 / adapter 说明 / host 对照 / deprecated surface 解释 / “本 prompt 是…”这类开发者旁白；这类事实只能放在 `strategy.yaml`、设计文档或 AGENTS，不进 runtime prompt。**
- **skill**（`skills/<name>/SKILL.md` + `references/` + `assets/` + 可选 `scripts/`）——frontmatter `name` + `description`（单引号整包，§6）；大 reference 顶部加锚点 TOC；深度细节进 `references/` 保持主文件瘦。`skills/<name>/.design/` 只放维护者用的 co-located 设计/J 文档（`DESIGN.md` / `OBJECTIVE.md`），不是 runtime prose，打包时由 `scripts/package-plugin.sh` 剔除。
- **skill knowledge graph**（`plugin/src/knowledge/`）——面向维护者的 authored graph source root，不是 runtime skill；runtime 投影落在 `plugin/dist/<host>/knowledge/`（由 `compile` / `sync-plugin-dist` post-pass 生成）。当前 rollout stage 是 **K1 pilot**（1 skill / 3 modules / 9 points）。先用 `node scripts/skill-knowledge.mjs contract --json` 读取真实能力；已实现 `check` / `compile` / `report` / `path` / `explain`。`change` 与 `check --host|--base` / `report --host` 仍 exit 10。不得把 declared 当 implemented，也不得用 examples 冒充全 portfolio inventory。
- **command / skill 必须分发 self-contain（不断链）**——分发源码 `plugin/src/commands/` 与 `plugin/src/skills/<name>/` 里的 runtime 文件（命令体 / SKILL.md / `references/` / `scripts/`，不含 dev-only `.design/`）引用别的文件时，**只能指向随 plugin 分发的约定目录**（安装后 plugin 根下的 `skills/` `hooks/` `commands/` `agents/` `bin/`），且**必须用 `${CLAUDE_PLUGIN_ROOT}/<dir>/…` 绝对引用**（skill 引用自己目录内的资产用 `${CLAUDE_SKILL_DIR}/…`）。**两类断链禁止**：① **裸相对路径**（如 `scripts/cc-usage.sh`——装到用户机器后相对其 cwd 解析、找不到）；② **引用非约定目录的文件**（`design_docs/` `adrs/` `README` `AGENTS.md` `CHANGELOG`——这些不保证随 plugin 分发，安装后死链）。**概念性提及不算文件引用、可留**：泛指「以本 plugin 的 hook 脚本为准」、叙事性 `Finding #NN` / `ADR-NNN`（不带路径）、描述脚本运行时读「所在 repo 的 AGENTS.md」这类行为。（**⚠️ 此「可留」对 skills 已被 §6「自包含纪律」收紧**：分发 skills 服务 user-agent、须 repo-无关且无代号，`Finding #NN` / `ADR-NNN` / charter `Cx` / hook `Hx` / `镜头 N` 等代号在 skills 内**一律不留**——本行的宽松只余 `plugin/src/commands/` 与本仓 dev 文档适用。）→ 硬卡点：`grep -rnE 'design_docs\|adrs/[A-Z]\|\]\(\.\.\|hooks/scripts\|README\.md' plugin/src/commands plugin/src/skills | grep -v '/\.design/' | grep -v CLAUDE_` 须只剩 `codex-review.sh` 那条「读所在 repo 的 AGENTS.md」行为描述。来源 [[Finding #38]]/[[Finding #39]]（真实安装才现形的形态盲区）。→ **裸跨 skill 引用专项硬卡点**（[[Finding #50]]）：反引号包裹、以兄弟 skill 名（`authoring-workflows` / `master-orchestrator-guide` / `pacing-and-estimation` / `using-ccm` / `slicing-goals-into-dags` / `dev-as-ml-loop` / `engineering-with-craft` / `distilling-lessons-into-assets`）开头带 `/` 的路径引用，是装机后相对用户 cwd 解析的死链，必须升为 `${CLAUDE_PLUGIN_ROOT}/skills/<name>/…`。模式：`` grep -rnE '`(authoring-workflows|master-orchestrator-guide|pacing-and-estimation|using-ccm|slicing-goals-into-dags|dev-as-ml-loop|engineering-with-craft|distilling-lessons-into-assets)/[^`]*`' plugin/src/skills plugin/src/commands plugin/src/hooks | grep -v '/\.design/' `` 须零命中（正则反引号锚定已天然排除 `${CLAUDE_*}/…` 修正形式，故**不接** `| grep -v CLAUDE_` 行级过滤——加了反而对「同行既有修正形式又有残留裸引用」漏报，与 `skill-lint.sh` check(4) 的逐 token 匹配保持一致·[[Finding #50]] codex round-3 catch）。**注意范围**：只查这八个**分发 skill 名**——纯 skill 名提及（不带 `/`）合法、同 skill 内 `references/x.md` 自引用天然不匹配、dev-only repo 根 `scripts/` 与 `.design/` 不算（不分发·红线5，裸路径从 repo 根正确，故**有意不纳入**模式避免误报）。此卡点已接进 [`scripts/skill-lint.sh`](scripts/skill-lint.sh) check (4) 自动执行（命中即 `exit 1`）。
- **hook**（`plugin/src/hooks/*/implementations/claude-code/*.sh` / `*.js`）——bash 或 node/JS（红线 1·ADR-006）；状态默认写 sidecar，**不碰 board 的窄腰**——但**可经 `ccm` 带锁字段级 setter 写特定 ✎（非窄腰）board 字段**（ADR-020 松绑此前「永不碰 board」的 pre-ccm 保守默认·受六硬约束框死：只写 ✎ `runtime.*` / 进程边界 spawn / 带锁 + lint / 武装后 + 确定性目标板 / ccm 缺降级 / token-blind）。当前这么做的运行时 hook 是 `identity-nudge.js`（IDNUDGE·经 `ccm board set-param` 写 `runtime.last_identity_remind`）。**另一处性质不同的写边界（ADR-020 §2.45）**：`bootstrap-board.sh` 作为**板的创建者**，在 fresh **建板初始化**时据用户**亲手敲的**启动 flag（`as-master-orchestrator --priority/--wip/--owner-wip/--policy-switch`）经 `ccm board update`/`ccm policy set` 写 ✎ coordination/scheduling/policy（建板初始化、非运行时 side-channel·写在建板后=已武装·best-effort 不 block 起跑·policy 的 `--user-authorized` 权来自用户输入非自授权）。窄腰仍 hook-read-only-for-arming（红线2 不破）。
  - **hook 武装纪律（硬规则，违背字面就是违背精神）**：**所有 hook 在本 session 被 `as-master-orchestrator` 武装之前完全休眠。** 武装是 board-derived 且跨 compaction 持久——armed ⟺ home 的 `boards/` 里存在一个 `*.board.json`，其 `owner.active:true` 且 `owner.session_id == 本次 hook stdin 的 session_id`（sid 空 → 降级匹配任一 active 板，保 compaction 边界鲁棒）。每个 hook 的武装闸即这道闸——**未武装一律静默**（空 stdout、RC 0、不 block）。**v2 收编 + phase-1b harness 收口后**：武装逻辑集中在 `hook-common.js`（`isArmed` 布尔 + `boardMatches` 谓词 + `listMatchingBoards` 板列表 + `runHook(spec)` harness），五个 node hook 经 `runHook({arm:…})` 的 **arm 参数**委托武装（武装闸是 harness 的固定环节·真代码级保证「每 hook 入口先过武装」，非靠各 hook 自觉）——reinject / posttool-batch / usage-pacing 用 `arm:'boards'`（harness 调 `listMatchingBoards` 填 `ctx.boards`），board-lint / verify-board 用 `arm:'custom'`（body 自判武装：board-lint 的四闸复合 / verify-board 的自判 + clearSidecar）。`bootstrap-board.sh`（仍 bash·无 `runHook`）是**唯一豁免的 hook 入口**：它就是 ARM 动作本身、不经 harness、不需武装闸。**★ADR-014 后**：board 引擎（board-model/lint-core/graph-core/lock）已**不在 `plugin/src/hooks/*/implementations/claude-code/`**——迁入独立的 `@ccm/engine`，hooks（board-lint/verify-board）改经**进程边界 shell 调 `ccm`**，不再 in-process require 引擎；故旧的「`plugin/src/hooks/*/implementations/claude-code/` 下 board-\*.js 纯 helper 库豁免于 grep 门」已随文件删除而移除（grep 不再排除它们）。现 grep 门只豁免 `bootstrap-board.sh`；`hook-common.js`（武装 SSOT 共享库，含 `isArmed`/`boardMatches`/`listMatchingBoards`/`runHook`）天然过门、无需列豁免（详见 §3 红线6）。各 node hook 经 `runHook` 的 **arm 参数**委托武装：reinject / posttool-batch / usage-pacing = `arm:'boards'`，board-lint / verify-board = `arm:'custom'`（body 自判）。**ARM 有两种形态**：fresh（建板即把 `owner.session_id` 盖成创建它的 session）与 resume（`as-master-orchestrator --resume <选择器>` 把选定的**已存在**旧板盖成新 sid、`owner.active` 无条件置 true 含**复活 `/stop` 归档板**、保留 `tasks`/`log`/`goal`/`git`，经 live 安全闸——见 ADR-009）。两形态都经 `bootstrap-board.sh` + 显式用户命令，仍是「唯一豁免的 ARM 动作」，红线 6 实质不变。解除武装 = `/stop` 归档板（`owner.active:false`，此后**显式可逆**——可经 `--resume` 复活）+ goal-hook。新增 / 修改任何 hook **必须**先过这道闸（绝不在未武装路径上注入或 block），且只读 narrow-waist 的 `active` / `session_id` 判 arming——不碰 board 的 agent-shaped 部分（红线 2）。→ 决策快照：[`adrs/ADR-007-hook-arming-gate.md`](adrs/ADR-007-hook-arming-gate.md)（+ resume re-arm：[`adrs/ADR-009-resume-cross-session-re-arm.md`](adrs/ADR-009-resume-cross-session-re-arm.md)）。
- **design_docs**——正式文档进 `design_docs/`；临时 plan 进 `design_docs/plans/`（gitignored）；单篇决策期设计用日期前缀（`YYYY-MM-DD-<slug>.md`）。成组、长期维护的主题资产用 `design_docs/<topic>/README.md` 作入口：正式规范/机器合同进对应主题目录，调研专栏进 `design_docs/research/<topic>/`；当前 `skill-knowledge-graph/` 是 skill knowledge graph 的规范与 schema SSOT，`research/skill_knowledge_graph/` 是其近一年研究证据，`research/graph_engineering/` 研究 task/execution/control graph，后两种 graph 的 schema / 结论不得混用。
- **home 全局、board 不入版本控制**——home = `$CC_MASTER_HOME`（默认 `$HOME/.cc_master/`，harness-neutral）；board 集中落 `<home>/boards/`，旧 per-repo board 与旧 Claude-config home 的 board 在 bootstrap 时 best-effort 迁移；全局 home 在 repo 外天然不入版本控制（若仍用 in-repo `.claude/cc-master/` 也 gitignored）。

---

## 13. Hook→Agent 通信协议（标签化信息类型）

> **新约定**（本次重构引入）——**所有 hook 往 agent context 注入的文本都按本节标签写**；当前重构的三处注入（pacing / 多-orchestrator coordination / verify-board）首批照办，现有 hook（reinject 除外，见下）渐进迁移。本节只立**作者侧**落地纪律；**读者侧**（agent 怎么按 tag 分配注意力）在 SKILL A。→ 深层 SSOT（完整 taxonomy + 真实例子 + 推导）：[`adrs/ADR-018-hook-agent-message-protocol.md`](adrs/ADR-018-hook-agent-message-protocol.md)，本节不复述。

**命门：没有中性注入。** hook 给 agent 的唯一信道是往 context 塞文本，而 in-context 文本全都条件化下一步 token——「纯展示 = 无影响」是假二分。故分类轴不是「影不影响」，而是 **①决策归谁 + ②影响力度**，且用**结构化标签**让它对 agent 机器级可读、直接映射「分配多少注意力」（别只靠 prose 措辞暗示，易误读）。

**三类 taxonomy + 标签词汇**（核心·closed set·别 proliferate）：

| 类型 | 决策归谁 | 标签 | 注意力 |
|---|---|---|---|
| **Ambient 背景** | agent | `<ambient source="…">` | **低**·更新世界模型即可·别当待办（但自觉它在 prime 你）|
| **Advisory 建议** | agent | `<advisory source="…" strength="weak\|strong">` | weak=顺手权衡·可合理忽略 / strong=认真权衡·默认应响应——**但最终仍你拍**（推理其前提是否成立）|
| **Directive 指令/闸** | system | `<directive source="…">` | **满**·遵从且理解 why（理解了才能识别规则误触、带脑子执行）|

- 三个标签固定对应三类；`strength` **只给 advisory**（ambient 恒低 / directive 恒满，保持简单）；**所有标签必带 `source`**（注的是哪个 hook·可追溯可审计）。
- **绝大多数 hook→agent 通信落 advisory**——agent 是有判断力的 orchestrator（agentic delta），不该被 hook 降格成规则机器；**directive 留给硬约束（红线 / 安全 / 阻断闸），越少越好。**
- **`reinject`（魂重注）不进本体系**——它是 agent 的操作 substrate（每回合 compaction 后整篇重注 SKILL A），是赖以思考的地基，非「分配注意力」的 transient 消息。

**作者纪律 P1–P6**（hook 作者 wrap 注入内容时）：
- **P1 没有中性注入**——凡注入即塑造，标签要**匹配**你想要的影响；连 ambient 也诚实承认在 prime。
- **P2 默认 advisory、慎用 directive**——用**最低够用**的类别；过度 directive 浪费判断力 +「狼来了」稀释。
- **P3 标签即承诺**——advisory 别用命令式措辞伪装成 directive；ambient 别偷夹 steering；directive 别滥用。
- **P4 力度配 stakes**——低风险 / 可逆 → `weak`；高风险 → `strong`；硬约束才 `directive`。
- **P5 directive 内含 why**——让有判断力的 agent **带理解地**遵从（还能识别规则误触），而非盲从。
- **P6 source 必填**——每个标签注明来源 hook，影响**可追溯、可审计**（人读 transcript 也能溯源）。

**反模式**：①把想 steer 行为的东西塞进 `<ambient>` 装无辜；②把 `advisory` 写得像命令；③`directive` 不给 why；④标签集膨胀（新增类型前先证明「3 类 + strength」不够用）。

> **读者侧契约**（agent 怎么按 tag 分配注意力）在 SKILL A，属压力下能被两侧合理化的 agent-facing 纪律——须先跑 pressure baseline 再落（§6 TDD-for-skills）。**本节不碰。**

---

## 14. ADR 约定

**最新索引增量**：ADR-034 = additive routed-task contracts；ADR-035 = Goal Contract lifecycle（raw request 与 normalized goal 分离、optional observed contract + ccm-managed Goal Brief + `ccm goal` 专属生命周期；不扩大 narrow waist）。完整状态与链接以 [`adrs/AGENTS.md`](adrs/AGENTS.md) 为准。

结构性架构决策（"为什么 X 不 Y / 何时可推翻"）记成 ADR——与 design_docs（描述当前状态）严格分开。命名 `ADR-NNN-<slug>.md`，带 Status/Date/Scope frontmatter + Context/Decision/Consequences/Alternatives/Related 模板。**何时写 ADR、ADR-vs-design_docs 试金石、workflow 全在** → [`adrs/AGENTS.md`](adrs/AGENTS.md)。现有 ADR-001..028（hooks-pure-bash / ship-anywhere-scope / board-narrow-waist / loop-dissolution-and-goal-hook / two-skills-separation / hooks-may-use-node-js / hook-arming-gate / account-authoritative-usage-and-script-placement / resume-cross-session-re-arm / two-sided-pacing-corridor / self-wakeup-watchdog / parent-waist-and-rollup-aware-stop-gate / board-v2-data-model-and-cli / cli-decoupling-as-independent-product / estimation-and-pacing-engine / board-scoped-orchestrator-authority / multi-orchestrator-coordination / hook-agent-message-protocol / skill-portfolio-rework / hook-writes-flexible-board-via-ccm / ccm-install-presence-hard-precheck / version-line-decoupling / deps-driven-gating-and-blocked-on-discriminator / single-sided-pacing-switch-stop / board-write-guard-single-path / done-true-semantics / distill-stage2-and-eighth-skill / hook-parity-contract-and-normalization —— ADR-010：pacing 从单边上限护栏改为**双侧目标走廊**（5h reset 目标落 70–90% 区间、欠用侧轻推加速 / 临界侧轻推减速），以 **7d 窗口当加速硬总闸**〔**双侧走廊已被 ADR-024 supersede 为单侧 verdict**——见下 ADR-024〕；ADR-011：前台空转期 **watchdog 自我唤醒**——`ScheduleWakeup`/`CronCreate`（本地内存调度）部分解禁、许可用于补静默失败盲区的安全网，**降级链 + background-shell 永为 floor**，云 routines / agent-teams 仍排除·收窄 ADR-002；ADR-012：`tasks[].parent` 升入 narrow-waist + rollup-aware Stop gate（nested max-depth=1 调度图，扩展 ADR-003）；ADR-013：board v2 完整 JS 数据模型 SSOT + 统一 CLI 访问层（演进 ADR-003 的 narrow-waist 为三档建模 🔒/👁/✎）；ADR-014：`ccm` CLI **解耦为独立安装的工业化 TS 产品/引擎**（`@ccm/engine` SSOT），plugin 降为消费方之一、经**进程边界 shell 调全局 `ccm` 二进制 + JSON**访问 board（绝不 import 引擎）、ship-anywhere 改由「主机预置 per-OS Node SEA + 进程边界」守·修订 ADR-013 的 CLI 定位 + ADR-002 的 ship-anywhere 口径；ADR-015：ccm 扩成 **OR/ML 估算 + 配速引擎**——新增 `usage`/`estimate` **只读 advisory** namespace（出 verdict、orchestrator 决策·红线3）+ `baseline` 写 noun、**home 级跨板历史语料读**（超出单板·多层收缩 + conformal）、算法层 **0 新 dep 全 hand-roll**（约束过滤现代 SOTA、重型 ML 排除）、配速数学收口进引擎 + hook 优雅降级；`baseline`/task `model` 作 ✎ 非窄腰字段；演进 ADR-013/014、实现 ADR-010 走廊数学；ADR-016：board 新增可扩展 **`policy` 段**框定本块板 orchestrator 自主权限，首条 `autonomous_account_switch`（allow/deny）门控**自主换号**——强制力 = 纵深防御（建议层 SKILL A 自律 + 机制硬闸 `switch-account.sh` 读 policy·deny→拒+exit7+log）、新板默认 **allow（opt-out）**、写命令视权限**用户所有**（非 TTY 须 `--user-authorized`·SKILL A「绝不自授权」红线·board.log 审计）；`policy` 作 **✎ 非窄腰**（hook 不读·红线2 不破）+ 顶层 **`policy` 写 noun** + `FMT-POLICY` warn（规则全集 45→46）·复用 ADR-015 写 noun vs 只读 namespace 分界；ADR-017：多-orchestrator 协调感知层（跨板只读花名册 + coordination ✎ 块）；ADR-018：hook→agent 标签注入协议（ambient/advisory/directive·closed set + source·没有中性注入）；ADR-019：skill portfolio 重排——退役 `account-management`（SKILL C·两 strong 形态〔A.2 选号配方 + B.1 token 命门〕均被 ccm `account` 引擎迁移塌缩 → 装饰）+ 新增 `pacing-and-estimation`（SKILL H·A.1 advisory 命令 schema + B.2 estimate 整轴 out-of-mind 触发召回，覆写 2026-06-26「做 A 的 reference」判定）+ 切 A/H 边界（决策锚 / 镜头留 A、消费机制抽 H）+ account 操作面归 D（号池/选号/vault **实现**归 ccm `account` 引擎）·portfolio 7→7〔-C+H〕；ADR-020：松绑 §12「hook 永不碰 board」pre-ccm 默认——许可 hook 经 `ccm` 带锁字段级 setter 写特定 ✎（非窄腰）board 字段，受六硬约束框死（只写 ✎ `runtime.*` / 进程边界 spawn / 带锁 + lint / 武装后 + 确定性目标板 / ccm 缺降级 / token-blind）；新增 ✎ `board.runtime` + `FMT-RUNTIME` warn（规则 46→47）、`ccm board set-param` least-privilege scoped 写 verb（候选 B·收窄 `runtime.*`·白名单 + 值校验）、首个写 board 的 hook `identity-nudge.js`（IDNUDGE 周期身份提示）；clobber 走轻解（hook 独占 `runtime.*` + agent 不写它）·**窄腰一字不动**（runtime 是 ✎·hook 不读·红线2 不破）·**`runtime.*` 白名单第二键 `last_critpath_remind`**（critpath-nudge 周期临界路径提示·hooks-enhancements-v2 ②·同形扩展·复用 `set-param` 白名单 + `FMT-RUNTIME`）·**§2.45 board-init 写边界**（方案 A·`as-master-orchestrator` 启动 flag `--priority/--wip/--owner-wip/--policy-switch`：bootstrap 作为板的创建者在 fresh 建板初始化时经 `ccm board update`/`ccm policy set` 写 ✎ coordination/scheduling/policy·与运行时 `runtime.*` nudge 性质不同·best-effort 不 block 起跑·policy 授权来自用户亲手敲 flag 非自授权）；ADR-021：**ccm 硬前置·bootstrap install-presence 硬查 vs 运行时软降级边界**——把 `ccm`（ADR-014 主机前置）从「运行时静默降级才暴露」提升到「ARM 入口 fail-loud 硬前置」：`bootstrap-board.sh` 触发后建板前硬查 `command -v ccm`（`CCM_BIN` 覆写则 `[ -x ]`），缺则**拒 arm**（不建 board）+ 注 `<directive source="bootstrap">` agent-relay 提醒用户装 ccm + exit 0（不 block·否则 agent 收不到 directive）；框定「装没装」（二元·install presence·起点硬拦·用户可修）vs 运行时「装了但这一下没响应」（瞬态·软扛·不让一次抽风崩长程编排）的边界·**绝不动**运行时软降级·纯 bash`command -v`（红线1 floor·不 spawn ccm）·不破 ship-anywhere（只把既定前置提前 fail-loud·不新增依赖）·README×2 安装段改「ccm 必须先装」）；ADR-022：**ccm 与 plugin 版本线解耦**——拆成两条独立版本线，非对称 tag 前缀（方案 A）：plugin 留裸 `vX.Y.Z`（手动门 + `CHANGELOG.md`·`plugin.json`/`marketplace.json` 归 plugin 线），ccm 改用 `ccm-vX.Y.Z`（changesets + CI·`ccm/apps/cli` 与 `ccm/packages/engine` `fixed` 锁步成单一 ccm 版本号）；`ccm-release.yml` 拆为只产 ccm 二进制（触发 `ccm-v*`）+ 新增 `plugin-release.yml` 只打插件 zip（触发 `v*`）·两 glob 天然互斥；是 ADR-014 的版本维度 follow-up·兑现 `.changeset/README.md` 已声明的「不共享版本号」意图；ADR-023：**deps 驱动的 `ready↔blocked` 自动门控 + `blocked_on` 作语义阻塞判别器**（Model 1）——`@ccm/engine` 新增纯函数 `reconcileGating`（写入关卡 `runWrite` 在 mutate 后、lint 前跑一趟：无 `blocked_on` 且 status∈{ready,blocked} 的 task 按 deps 完成度归一·deps 全 done→ready 否则→blocked·一趟 O(V+E)/幂等/不产生新 done/复用 `readySet` 邻接零漂移），`blocked_on` 升为语义阻塞判别器（有则整体豁免自动门控）+ 新 verb `ccm task unblock`（清 blocked_on·交回门控）+ 新 warn `BIZ-STATUS-DEPS`（兜手改 board 不一致态·规则全集 48→49）；**窄腰不动**（只改「ready/blocked 由谁定」·红线2 不破）·修订 ADR-013/003 的门控规则·Model 2/3 作 Alternatives。；ADR-024：**pacing 从双侧走廊翻转为单侧 verdict**——`ccm usage advise` 的 verdict enum 改为 `{hold, throttle, switch, stop_5h, stop_7d}`（去掉旧的 `accelerate` 欠用侧加速 + `hard_stop`），退役「欠用→加速」这一侧（配额没用满就蒸发不再作为催加速理由）+ 新增显式 `switch`（切下一份配额）/ `stop_5h`（本窗烧穿·arm watchdog 守到 `nearest_reset` 回血）/ `stop_7d`（7d 硬总闸·暂停 dispatch + surface 用户）；消费方直接吃 ccm 出的 `strength`（ADR-018 标签强度）；plugin 侧 `usage-pacing.js` hook **退役 ~200 行本地反推 fallback**（ccm 硬前置·ADR-021 后 fallback 前提消失·ccm 缺/sidecar 缺→静默）+ 新增读 `runtime.last_account_switch` 的「检测到换号」ambient；supersede ADR-010 的双侧走廊（走廊数学收敛为单侧上界 + 换号 + 停）；ADR-025：**board writes go through ccm only·PreToolUse board-guard 硬化单一写路径**——新增 `plugin/src/hooks/board-guard/implementations/claude-code/board-guard.js`（PreToolUse·matcher `Write|Edit|MultiEdit|Bash`）在工具**执行前**拦截 agent 直接 file-edit 本 home `boards/` 下 `*.board.json`（`Write`/`Edit`/`MultiEdit` 目标 board 文件 → 路径判定 deny；`Bash` sed/echo/tee/cp… 手改 → 启发式偏假阴 deny·含 `ccm` 调用早放行）+ 注 `<directive source="board-guard">`（含 why + 该改用哪个 ccm verb），把「board 变更只走 ccm」从**纪律**硬化为**机制**（写关卡从 ccm 内部延伸到工具入口）；同 PR 删 skills 里所有「ccm 缺则降级 Write/Edit 手改」fallback 指导（ADR-021 后 ccm 硬前置·fallback 前提已死）。dormant-until-armed（红线6·`arm:'custom'`+isArmed·未武装静默放行）+ **fail-open**（异常静默放行·崩溃 guard 绝不卡死 agent）+ 只读窄腰判武装（红线2·窄腰一字不动）+ node/JS only（红线1·复用 runHook harness·零依赖）；PostToolUse board-lint 降为事后 backstop（兜漏网 Bash 手改·软提示）。（注：ADR-023/024 属并行 ccm-v* 版本线·本 plugin 分支预置其 §14 索引条目使两线合并后一致；ADR-025 = 本 plugin 分支的 board-write-guard。）；ADR-026：`status=done` 的真完成语义升级为 `status=done && verified===true && artifact 非空`——`BIZ-DONE-VERIFIED` 从 reserved 激活为 hard invariant，`ccm` 写入关卡拒绝裸 done（exit 3）；`verified`/`artifact` 仍是 ✎ flexible 字段，不进 narrow waist，hooks 不直接依赖它们；ADR-027：**retro Stage 2 蒸馏 + 第八个分发 skill**——新增 `/cc-master:distill` 命令（消费一份或多份 `retro.md`，单 agent 全局去重/合并/路由规划 → 蒸馏计划一次性用户审阅 → 按目标文件 fan-out → 一律 feature-branch+PR 收口,非 git 项目降级为变更草稿目录;绝不写 board、不调用任何 `ccm` 命令）+ 新分发 skill `distilling-lessons-into-assets`（承载"候选经验该落成纪律文档/skill/workflow/subagent 中的哪一种、每类怎么落地"的归宿判断决策树 + 落地手艺反模式 + 证据忠实性唯一硬约束）;`distill` 与 `retro` 严格两阶段(只读产候选 → 可写落资产),skill portfolio 7→8(+I);skill 边界不与 `engineering-with-craft`(代码工程手艺)/`slicing-goals-into-dags`(目标切分)/`dev-as-ml-loop`(任务执行循环)重叠——本 ADR 是 ADR-019 skill portfolio 重排的延续；ADR-028：**hook 双端锁步机制（HOOKPAR-DEC）**——新增 `plugin/src/hooks/<hook>/CONTRACT.md`（7 个双端 `implemented` 业务 hook 各一份 host-neutral 业务规则 SSOT + 三分类学降级行为声明）+ `scripts/gen-hook-parity-matrix.sh`（生成只读 `design_docs/hook-parity-matrix.md`，接入 `run-tests.sh`）+ `hook-common.js` 最小归一化桥接（`normalizePayload`/`ctx.normalized`，纯附加只读字段，收敛在 `runHook` 单点，零业务行为变化）+ 行为级 fixture parity test（`tests/hooks/test_parity-fixtures.sh`，首批覆盖 FUSE / `segmentTouchesRealBoard` / 握手 dedup）+ CONTRACT.md PARITY anchors 结构级检查 + `scripts/check-hook-parity-touch.sh`（PR-diff 存在性检查）；同 PR 修复四处 codex 侧 `host-convention-divergence`（verify-board FUSE 熔断 + rollup 检查补齐、board-guard bash 手改判定对齐 claude-code〔删兜底分支 + 补 `segmentTouchesRealBoard`〕、四个 hook 补齐 ADR-018 标签协议）+ `hooks.yaml` 的 `verify-board.host_coverage.codex` 陈旧标注纠正；ADR-029：`ccm web-viewer` 正式入口；ADR-030：`ccm status-report` 生成报告；ADR-031：**N-host capability parity**——升 ADR-028 双端锁步为 `claude-code | codex | cursor` + Capability INTENT 层 + Cursor 双轨（Track A SAP/PHIP / Track B 声明替代）·AGENTS.md §6 纪律段改称「hook N-host 锁步」；ADR-032（Accepted·2026-07-09）：确定性池中介 + `coordination.inbox`（演进 ADR-017 §2.2·否决 #66 点对点协商）；ADR-033（Accepted·2026-07-09）：`ccm monitor` 建议型连续监控 daemon（复用 ADR-029 service 模式·补 idle 烧配额盲区）+ **home 常驻服务（monitor+web-viewer）⟷ ccm 二进制同生命周期**（`services reconcile` 挂 upgrade/install）。

---

## N. 触发式深入阅读

下表按"**当你要做 X 时去读 Y**"组织——命中触发条件时跳转，未命中不需预加载。

| 当你要 | 读什么 |
|---|---|
| 改编排方法论 / 援引七镜头 · 红线 · 决策程序 | [`skills/master-orchestrator-guide/SKILL.md`](plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md)（魂 · 不在本文复述）|
| 把目标拆成依赖 DAG（CPM / float / 临界路径 / 粒度）——一张**已切好**的图怎么**排期** | [`skills/master-orchestrator-guide/references/decomposition.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/decomposition.md) |
| 把目标**切**成 board DAG（敏捷:纵切薄增量 / walking skeleton / 粒度品味 / 价值风险排序——「切」先于上一行的「排」）| [`skills/slicing-goals-into-dags/SKILL.md`](plugin/src/skills/slicing-goals-into-dags/canonical/SKILL.md) + [`references/worked-example.md`](plugin/src/skills/slicing-goals-into-dags/canonical/references/worked-example.md) |
| 作为执行 agent 把一个已切好的任务**优化到验收**（开发=ML 过程:验收=objective / 迭代测量 / plateau→restart / 收敛即停——循环**形状**）| [`skills/dev-as-ml-loop/SKILL.md`](plugin/src/skills/dev-as-ml-loop/canonical/SKILL.md) |
| 设计 / 开发 / 测试时把领域 / 类 / 合约 / 测试**本身**建得好（DDD/SDD/TDD/OOP 整合成五根 + 工程红线——循环里的手艺**内容**，与上一行的循环形状不同 plane）| [`skills/engineering-with-craft/SKILL.md`](plugin/src/skills/engineering-with-craft/canonical/SKILL.md) + [`references/`](plugin/src/skills/engineering-with-craft/canonical/references/)（ddd / oop / sdd / tdd）|
| 判断一条候选经验该落成纪律文档 / skill / workflow / subagent 中的哪一种、以及落地时怎么写才不走样（`/cc-master:distill` 引导加载：归宿判断决策树 + 落地手艺反模式 + 证据忠实性唯一硬约束）| [`skills/distilling-lessons-into-assets/SKILL.md`](plugin/src/skills/distilling-lessons-into-assets/canonical/SKILL.md) + [`references/`](plugin/src/skills/distilling-lessons-into-assets/canonical/references/)（asset-taxonomy / routing-decision-tree / landing-craft-by-asset-type / evidence-fidelity）|
| 把一份或多份 `/cc-master:retro` 产出的候选经验蒸馏成目标项目的实际资产（一律 PR 或显式变更草稿目录收口，绝不写 board、不碰 ccm）| [`commands/distill.md`](plugin/src/commands/distill/adapters/claude-code/body.md) |
| 派发的某个大节点*内部*本身是个复杂规划问题（让执行者发现并遵循**被编排项目自己**约定的 planning 规范 + 维护其计划文档 / board ⊥ 项目 planning 层的多层次调度）| [`skills/master-orchestrator-guide/references/multi-layer-planning.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/multi-layer-planning.md)（注意：「项目」指 orchestrator 所服务的目标项目，**非 cc-master 本仓**）|
| 选后台机制 / 编排并行（shell · sub-agent · workflow · 两尺度 dataflow / 反过度工程护栏 · parallel-vs-pipeline smell-test）| [`skills/master-orchestrator-guide/references/dispatch.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/dispatch.md) |
| 动 board 协议 / narrow-waist schema / status enum / 续跑续接（协议 narrative + 长程操作纪律；**canonical schema/enum/不变式 SSOT 在 `@ccm/engine` 的 board-model**，board.md 是派生叙事）| [`skills/master-orchestrator-guide/references/board.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/board.md) |
| 用 ccm 操作时某字段填什么 / 会撞哪条校验规则（全部 FMT/GRAPH/BIZ 规则速查 + 领域概念解释 + 字段取值判断，一次写对不撞 exit 3）| [`skills/using-ccm/references/board-model-guide.md`](plugin/src/skills/using-ccm/canonical/references/board-model-guide.md) |
| 用 `ccm` 操作 board（建板 / 加改任务 / 状态机 verb / 阻塞等用户 / 查 ready·图·临界路径 / jc·cadence·watchdog / footgun / `--json` 形状）| [`skills/using-ccm/SKILL.md`](plugin/src/skills/using-ccm/canonical/SKILL.md) + [`references/command-catalog.md`](plugin/src/skills/using-ccm/canonical/references/command-catalog.md)（操作手册；命令面 SSOT 在 `ccm`/`@ccm/engine`，本 skill 是派生视图·随 ccm 锁步见 §6）|
| 异步完成 + HITL / p95 hedging / 用户当 async worker | [`skills/master-orchestrator-guide/references/async-hitl.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/async-hitl.md) |
| 前台空转等后台时为静默失败盲区 arm watchdog 自我唤醒（降级链 CronCreate/ScheduleWakeup/Monitor + background-shell floor、`wakeup` 柔性边双层记录、CronDelete 清理）| [`adrs/ADR-011-self-wakeup-watchdog.md`](adrs/ADR-011-self-wakeup-watchdog.md) + [`skills/master-orchestrator-guide/references/async-hitl.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/async-hitl.md)（`wait` 边主体）+ [`skills/master-orchestrator-guide/references/dispatch.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/dispatch.md)（工具降级链）|
| 廉价续跑 + 端点验收 / content-hash / codex 第二验收者 | [`skills/master-orchestrator-guide/references/resume-verify.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/resume-verify.md) |
| 消费 ccm 只读 advisory 配速 + 估算：选模型档 / 主线为何固定模型保 cache / 按 5h-7d 配额窗口 pace（**双侧走廊** verdict·ADR-010）/ 读 estimate forecast·EVM·risk·cost-to-complete / 估算诚实字段 | [`skills/pacing-and-estimation/SKILL.md`](plugin/src/skills/pacing-and-estimation/canonical/SKILL.md) + `references/`（model-tiers / usage-signals / pacing-levers / estimation）+ [`adrs/ADR-010-two-sided-pacing-corridor.md`](adrs/ADR-010-two-sided-pacing-corridor.md) · [`adrs/ADR-015-estimation-and-pacing-engine.md`](adrs/ADR-015-estimation-and-pacing-engine.md)（reference 知识,非红线；ccm 出 verdict、A 决策） |
| 换号决策锚（lever 阶梯 / policy 授权 / 绝不自授权）/ 号池录号换号选号机制 | [`skills/master-orchestrator-guide/references/cost-decisions.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/cost-decisions.md)（决策锚·A）+ [`skills/using-ccm/references/account-pool.md`](plugin/src/skills/using-ccm/canonical/references/account-pool.md)（机制概念叙事·D）+ ccm `account` 引擎（实现 SSOT） |
| 沿愿景轴定位（哪条镜头 / reference / 决策程序节点服务哪项 charter 能力）/ 把 hook 注入短语回溯到锚点 | [`skills/master-orchestrator-guide/references/external-coordinates.md`](plugin/src/skills/master-orchestrator-guide/canonical/references/external-coordinates.md)（愿景索引 + hook 共享词汇,魂瘦身下沉的坐标系）|
| 写 / 调试 / 启动 workflow 脚本（API + 机制 + pattern + 11 个 example）| [`skills/authoring-workflows/SKILL.md`](plugin/src/skills/authoring-workflows/canonical/SKILL.md) + [`references/`](plugin/src/skills/authoring-workflows/canonical/references/) + [`assets/examples/`](plugin/src/skills/authoring-workflows/canonical/assets/examples/) |
| 动手任何 feature / skill / 行为改动前先挖真需求 / 过设计闸（取代 `superpowers:brainstorming`）| [`.claude/skills/requirement-elicitation/SKILL.md`](.claude/skills/requirement-elicitation/SKILL.md)（道 + 五个 discovery moves + strawman + 设计闸，项目自用 dev skill）|
| 写 / 改任何本仓 skill（尤其纪律型）/ 跑 pressure baseline | [`.claude/skills/cc-master-skillsmith/SKILL.md`](.claude/skills/cc-master-skillsmith/SKILL.md)（TDD-for-skills，项目自用 dev skill）|
| 判断要不要建 skill / 该 skill 还是 reference / 一组 skill 边界与重叠 | [`.claude/skills/curating-skill-portfolios/SKILL.md`](.claude/skills/curating-skill-portfolios/SKILL.md)（Counterfactual Probe A/B + 裁剪七维 + DESIGN 宪法，项目自用 dev skill）|
| 设计 / 维护 skill knowledge graph：module/point/edge schema、canonical SSOT、access class、三跳、typed change、projection / CI 合同 | [`design_docs/skill-knowledge-graph/README.md`](design_docs/skill-knowledge-graph/README.md)（正式规范 + schema + examples）+ [`adrs/ADR-038-git-native-skill-knowledge-graph.md`](adrs/ADR-038-git-native-skill-knowledge-graph.md)（技术路线决策）|
| 查询 skill knowledge toolkit 当前能力 / 运行 K0 source 合同检查 / 读取稳定 diagnostics 与 exit code | `node scripts/skill-knowledge.mjs contract --json` + `node scripts/skill-knowledge.mjs check --stage K0 --json` + [`design_docs/skill-knowledge-graph/cli-contract.md`](design_docs/skill-knowledge-graph/cli-contract.md) |
| 调研 skill 内 knowledge point 身份、Markdown span source map、跨 skill navigation、lineage / admission / health diagnosis | [`design_docs/research/skill_knowledge_graph/README.md`](design_docs/research/skill_knowledge_graph/README.md)（近一年官方规范 + 学术证据 + 工程分类 + cc-master 映射 + 研究议程）|
| 声明 J（成功契约）/ 度量一个 skill / 跑触发或行为 eval | [`.claude/skills/grounding-skill-evals/SKILL.md`](.claude/skills/grounding-skill-evals/SKILL.md)（轻量 J 写法 + Track A/B + holdout / predict-then-validate，项目自用 dev skill）|
| 梳理 / 规划 / 审查 ccm-owned cross-harness headless worker control plane（planning/routing/attempt/run 合同、machine facts/quota admission、provider driver、supervisor/journal/attach、active-run upgrade lifecycle） | [`design_docs/cross-harness-orchestration-capability-model.md`](design_docs/cross-harness-orchestration-capability-model.md)（current / partial / target、owner、工业化 gate 的持续 SSOT；不是独立 dev skill） |
| 实现 / 审查 cross-harness worker 的 immutable runtime stage→verify→activate→exact invoke→doctor/recover→rollback supply chain | [`design_docs/cross-harness-runtime-supply-chain-spec.md`](design_docs/cross-harness-runtime-supply-chain-spec.md)（C1 implementation contract）+ `ccm/apps/cli/src/runtime-supply-chain.ts` + `ccm/apps/cli/test/handler-runtime.test.ts`；公共合同不得钉死 POSIX symlink，Windows backend gate 未过须 fail closed |
| 设计 / 重构多 agent harness 兼容架构（paragoge-style CLI + plugin source-to-adapter、SAP/PHIP、host adapter 边界） | [`.claude/skills/harness-plugin-architecture/SKILL.md`](.claude/skills/harness-plugin-architecture/SKILL.md) + [`plugin/src/AGENTS.md`](plugin/src/AGENTS.md) + [`design_docs/harnesses/`](design_docs/harnesses/) |
| 查 Claude Code / Codex 的 plugin、skill、hook、command、project memory 机制，或校对 paragoge 旧结论 | [`design_docs/harnesses/README.md`](design_docs/harnesses/README.md) + [`design_docs/harnesses/compatibility-matrix.md`](design_docs/harnesses/compatibility-matrix.md) + [`design_docs/harnesses/paragoge-import-audit.md`](design_docs/harnesses/paragoge-import-audit.md) |
| 盘点 runtime skills 里的 Claude Code 专有指导，决定哪些该模块化 / 变量化 / adapter overlay | [`design_docs/harnesses/skill-host-coupling-audit.md`](design_docs/harnesses/skill-host-coupling-audit.md) + [`.claude/skills/harness-plugin-architecture/references/host-adapter-boundaries.md`](.claude/skills/harness-plugin-architecture/references/host-adapter-boundaries.md) |
| 实现 / 修改 source-to-adapter 投影脚本（strategy/meta 检查、slot/placeholder、dist 生成、sync check） | [`.claude/skills/adapter-projection-engineering/SKILL.md`](.claude/skills/adapter-projection-engineering/SKILL.md) + [`scripts/sync-plugin-dist.sh`](scripts/sync-plugin-dist.sh) |
| 打包 / 分发 / 发布 CLI+plugin（source/dist/package 边界、host artifact、版本线、marketplace metadata） | [`.claude/skills/plugin-release-engineering/SKILL.md`](.claude/skills/plugin-release-engineering/SKILL.md) |
| 新增 / 删除 / 重命名项目 meta-skill 后让 Codex 也能发现 | [`scripts/sync-codex-skills.sh`](scripts/sync-codex-skills.sh)（`.claude/skills` → `.agents/skills`；默认 symlink，`--copy` 可选） |
| 改 hook | [`plugin/src/hooks/*/implementations/claude-code/`](plugin/src/hooks/*/implementations/claude-code/) + [`tests/`](tests/) + [`CONTRIBUTING.md`](CONTRIBUTING.md)（先确认红线 1：bash+node/JS，ADR-006）|
| 改一个多端 `implemented*` hook 的业务逻辑 / 查降级行为 / 跑 parity test / 写跨 surface 硬缺口 | 先改对应 `plugin/src/hooks/<hook>/CONTRACT.md`（HOOKPAR-DEC / ADR-028 SSOT·升格 ADR-031 N-host），再改所有 `implemented*` 宿主实现或在「降级行为」节声明分叉；跨 hook/command/skill 缺口写 [`design_docs/harnesses/capabilities/`](design_docs/harnesses/capabilities/) Capability Card；`scripts/gen-hook-parity-matrix.sh` + `scripts/gen-capability-parity-matrix.sh` 生成两张只读矩阵；[`tests/hooks/test_parity-fixtures.sh`](tests/hooks/test_parity-fixtures.sh)（行为级）+ [`tests/content/hook-injection-contracts.test.mjs`](tests/content/hook-injection-contracts.test.mjs) + [`tests/content/capability-host-coverage.test.mjs`](tests/content/capability-host-coverage.test.mjs) + `scripts/check-hook-parity-touch.sh` + [`adrs/ADR-031-n-host-capability-parity.md`](adrs/ADR-031-n-host-capability-parity.md) |
| 查 Cursor IDE Agent 接入 / Track A·B 分类 / Capability Card | [`design_docs/harnesses/cursor.md`](design_docs/harnesses/cursor.md) + [`design_docs/harnesses/capabilities/`](design_docs/harnesses/capabilities/) + [`adrs/ADR-031-n-host-capability-parity.md`](adrs/ADR-031-n-host-capability-parity.md) |
| 新建 / 改任何 hook 前先懂「武装闸」/ 为什么所有 hook 未武装即休眠 | [`adrs/ADR-007-hook-arming-gate.md`](adrs/ADR-007-hook-arming-gate.md)（board-derived armed-gate）+ 本文 §12 hook 武装纪律 |
| 写 / 改任何 hook 往 agent 注入的文本（按标签包 ambient/advisory/directive、配 strength + source）| 本文 §13（作者侧纪律 P1–P6）+ [`adrs/ADR-018-hook-agent-message-protocol.md`](adrs/ADR-018-hook-agent-message-protocol.md)（深层 SSOT：taxonomy + 注意力映射 + 推导）|
| 让 hook 写一个 ✎ board 字段（经 `ccm` 带锁 setter·六硬约束）/ 加周期提示 hook（复用 `hook-common.periodicNudge`·跑周期提示表）/ 懂 `board.runtime` 参数区 + `ccm board set-param`（白名单 `last_identity_remind` / `last_critpath_remind`）| [`adrs/ADR-020-hook-writes-flexible-board-via-ccm.md`](adrs/ADR-020-hook-writes-flexible-board-via-ccm.md)（§12 松绑 + IDNUDGE + clobber 轻解）+ [`plugin/src/hooks/identity-nudge/implementations/claude-code/identity-nudge.js`](plugin/src/hooks/identity-nudge/implementations/claude-code/identity-nudge.js)（周期提示表 identity + critpath 实现）|
| 懂 bootstrap 为何硬查 ccm install presence + 缺则拒 arm（vs 运行时软降级边界）| [`adrs/ADR-021-ccm-install-presence-hard-precheck.md`](adrs/ADR-021-ccm-install-presence-hard-precheck.md)（ccm 硬前置·fail-loud·directive agent-relay）+ [`plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh`](plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh)（ccm 硬查分支）|
| 让新 session 用 `--resume` 续旧板 / 复活归档板 / 接管安全闸的「显式 vs 隐式」论证 | [`adrs/ADR-009-resume-cross-session-re-arm.md`](adrs/ADR-009-resume-cross-session-re-arm.md)（显式跨 session re-arm）+ [`plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh`](plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh) 的 resume 分支 |
| 由旧 session 优雅交接 board 给新 session（`--resume` 的写/准备侧：停派发 + 兜底在飞任务 + 写叙事交接文档 + 归档板）| [`plugin/src/commands/handoff-to-new-session.md`](plugin/src/commands/handoff-to-new-session.md)（与 `--resume` 配对的写侧）|
| 让 codex 当端点验收 reviewer | [`skills/master-orchestrator-guide/scripts/codex-review.sh`](plugin/src/skills/master-orchestrator-guide/canonical/scripts/codex-review.sh) + `/codex` skill |
| 在 pacing 决策点感知 5h-7d usage（读 ccm 只读 advisory，非 hook）| `ccm usage advise --json` / `ccm usage show --json`（账户权威 `used_percentage`；信号由 ccm 自带的 `ccm statusline` 自动捕获落 sidecar·旧带外 cc-usage.sh / statusline-capture.js 已退役·ADR-024）|
| 跑触发准确率 eval（description 改动前后）| [`scripts/eval-trigger.sh`](scripts/eval-trigger.sh) + [`design_docs/eval/README.md`](design_docs/eval/README.md) |
| 跑编排纪律 benchmark（行为型 + codex 第二评委）| [`scripts/eval-benchmark.sh`](scripts/eval-benchmark.sh) + [`design_docs/eval/track-b-benchmark.md`](design_docs/eval/track-b-benchmark.md) |
| 写新 ADR / 援引现有 ADR / 判断 ADR-vs-design_docs | [`adrs/AGENTS.md`](adrs/AGENTS.md) + [`adrs/`](adrs/) |
| 落 dogfood 发现 / 援引已踩反模式 | [`design_docs/dogfood-findings.md`](design_docs/dogfood-findings.md) |
| 援引设计留痕 / 有意排除的决策 | [`design_docs/spec.md` §12](design_docs/spec.md) |
| 追踪六条愿景的落地 gap / 重审某能力兑现度 | [`design_docs/vision-landing-tracker.md`](design_docs/vision-landing-tracker.md)（兑现度矩阵 + 六张 gap 卡 + 排序讨论清单，living 追踪）|
| 临时计划 / 草稿（不进版本控制）| 写在 `design_docs/plans/`（gitignored），不进正式 design_docs |
| 装 / 用插件（用户视角）| [`README.md`](README.md) / [`README_zh.md`](README_zh.md) |
| 写面向人类的技术问答 / 故障解释 / 操作说明（借鉴 ASD-STE100、区分英文规则与中文信息结构）| [`CONTRIBUTING.md`「技术问答与解释性技术文本」](CONTRIBUTING.md#技术问答与解释性技术文本) + [ASD-STE100 官方 current issue](https://www.asd-ste100.org/) |
| 跑 dev loop / before-PR 三道门 | [`CONTRIBUTING.md`](CONTRIBUTING.md)（红线 SSOT 见本文 §3）|
