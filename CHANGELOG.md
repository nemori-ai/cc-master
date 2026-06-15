# Changelog

All notable changes to **cc-master** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.4] — 2026-06-15

### Added

- **`handoff-to-new-session` —— 由旧 session 优雅交接 board 给新 session（`--resume` 的写/准备侧）** — 新增普通 slash command `/cc-master:handoff-to-new-session`（无 sentinel，由**旧** orchestrator session 运行），把 board 优雅交接给一个**新** session：(1) 停止派发新活；(2) 让在飞任务在当前 session 跑完并验收（straggler 兜底——长跑任务降级成孤儿 + 重验、surface 给用户）；(3) 写一份**叙事层**交接文档（cc-master home 里的 sidecar 文件，指向 board、**不复述** board 的 DAG）；(4) 在 `board.log` 加一条指向该交接文档的指针；(5) 归档 board（`owner.active:false`）让新 session 的 `--resume` 无摩擦复活；(6) 告诉用户文档路径 + 下一步要跑的 `--resume` 命令。与 v0.4.3 的 `--resume` 跨 session re-arm **配对**：handoff 是**写/准备侧**，`--resume` 是**读/接管侧**——同一次干净跨会话接力的两半。

## [0.4.3] — 2026-06-15

### Added

- **`as-master-orchestrator --resume` —— 新 session 接续已存在 board（跨 session re-arm + 复活归档板 + live 接管安全闸）** — `/cc-master:as-master-orchestrator --resume [选择器]` 让一个全新 session **显式接管**一块已存在的 board：bootstrap（唯一武装豁免 hook）的第二种 ARM 形态——按选择器（板文件名 / 时间戳前缀 / `goal` 子串）选板，把 `owner.session_id` 盖成新 sid、`owner.active` 无条件置 true（**可复活 `/stop` 归档板** `false → true`）、`owner.heartbeat` 写接管时间戳，**保留 `tasks`/`log`/`goal`/`git`**；选择器省略 / 歧义 / 缺失时**绝不写盘**，注入分两组（active-but-abandoned / archived）的候选让用户消歧重发。**live 接管安全闸**：板看起来仍活（heartbeat / mtime 新鲜）时先警告、要 `--force-takeover` 二步确认，无信号时保守要 force。命令体加 resume 形态叙述（接手而非重启：reconcile 现有 `tasks[]`、孤儿 `in_flight` 走端点验或重派、每回合 flush 更新 heartbeat）；`resume-verify.md` 加「孤儿 in_flight 续接」小节（复用既有 content-hash + 端点验收，不新建机制）；`board.md` 给 `owner.heartbeat` 首个读者/写者用途。新增 [ADR-009](adrs/ADR-009-resume-cross-session-re-arm.md)：resume = 经 `as-master-orchestrator` + 用户显式授权的合法 ARM 形态，区分「ADR-009 显式命令接管 + selector + live 闸」vs「CODEX14 拒绝的隐式自动收养」（后者仍禁）；ADR-007 武装闸 + 其余 4 hook 一字不变，`/stop` 终态语义弱化为「显式可逆归档」。

## [0.4.2] — 2026-06-15

### Fixed

- **AGENTS.md 修正 `github-pr` / `github-tag-release` skill 误引用** — §4 / §11 此前把这两个**不存在**的 skill 当「本仓项目自带收口工具」引用（实物在本仓与 `~/.claude` 均无），照它找会扑空。改为 `gh` CLI 手工流程描述，并把真实发版步骤（版本号三处同步 bump + squash merge + `gh release` + 两道验收门）固化进 §11。纯贡献者文档（dev-facing）修正，不影响分发物。

## [0.4.1] — 2026-06-15

### Changed

- **模型档位指导加 Fable 5 临时不可用回退（运行时可用性补充）** — 当前账户层 Claude Fable 5 不可用（点名调用被挡回 *"Claude Fable 5 is currently unavailable. Please use Opus 4.8 or another available model."*）。`cost-and-pacing.md` 模型档位表下新增「运行时可用性补充」callout（回退口径 SSOT），并在每处 Fable 指派（`cost-and-pacing.md` §每节点模型选择 的两处 + `decomposition.md` 资源决策）加简短回指：所有指派给 Fable 的高杠杆裁决 / 最难开放推理节点临时回退 **Opus 4.8**。**Fable 相关描述一律保留不删**（记录「档位本应如何」的稳定心智模型，可用性只是一时运行时约束）；Fable 恢复即删回退框、按原指派切回。属 informational reference、非红线（Finding #26）。

## [0.4.0] — 2026-06-12

### Added

- **账户权威 usage pacing（Finding #37 / [ADR-008](adrs/ADR-008-account-authoritative-usage-and-script-placement.md)）** — 订阅账户的 5h/7d `used_percentage` + `resets_at` 是**权威**用量信号，但官方核实它**只**出现在 status-line 脚本的 stdin 里（所有 hook 的 stdin、transcript JSONL、`claude` CLI 子命令全无；API `anthropic-ratelimit-*` 是 tier RPM/ITPM、口径不等价）。新增 `statusline-capture.js`（接进你的 status line，把 `rate_limits` 落到账户级 sidecar，`--passthrough` 不覆盖你既有的 status line）；`cc-usage.sh` / `usage-pacing.js` 优先读它（`source:"account"`），缺/陈旧则降级本地 JSONL 反推（`source:"local-derived-approx"`，**标 approx**）。`usage-pacing.js` 撞墙判据**脱钩会失真到数量级的本地反推 `window_remaining_min`**、改用账户 `used_percentage`，并**首次纳入 7d**（修 Finding #31 的 7d 全盲缺口）。接法见 [`cost-and-pacing.md`](skills/orchestrating-to-completion/references/cost-and-pacing.md)「接法」段。
- **自进化 commands/skills 方法论整合** — 整合研究-grounded 的自进化方法论（Option B 纯整合）；SKILL A reinject 瘦身（愿景索引 + hook 词汇下沉 `references/`）；分发物措辞诚实性修正。

### Fixed

- **既存运行时带外脚本分发 bug（Finding #38 / ADR-008）** — `cc-usage.sh` / `codex-review.sh` 此前在**分发的** skill/command prose 里是**裸相对路径** `scripts/xxx`，终端用户 cwd（用户项目）下解析、**触不到 plugin 安装位置**（裸路径在 dev 的 repo 根碰巧能跑，真实安装才现形）。运行时带外脚本（cc-usage / codex-review / statusline-capture）搬入 `skills/orchestrating-to-completion/scripts/`（随 skill 分发），分发 prose 改用 `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` 引用；dev-only 脚本（eval / skill-lint）留顶层 `scripts/`（仅 repo 根调用，裸路径正确）。
- **skill/command 分发 self-contain（不断链）** — 去除分发 skill/command 里对 `design_docs/` 等**非约定目录**文件的引用（安装到用户机器后死链）；plugin 内约定目录改用 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` 绝对引用。AGENTS §12 加 self-contain 纪律 + 硬卡点 grep。

### Changed

- **`cc-usage.sh` 输出 schema 扩展（向后兼容）** — 加 `source`（`account` / `local-derived-approx`）+ 5h/7d `used_percentage` + `resets_at`；保留 `used_tokens` / `burn_rate_per_min`。
- **[ADR-008](adrs/ADR-008-account-authoritative-usage-and-script-placement.md)** — 账户权威 usage + 运行时脚本落点决策快照：`statusline-capture.js` **不受武装闸**（非 hook、不注入/不 block、只缓存账户全局只读信号，红线 6 精神之外）。

## [0.3.0] — 2026-06-12

### Added

- **两个新 hook（接通过调度 + pacing 通道，均已建 + 测 + 接线 LIVE）** — 把此前「编译进 prose、compaction 一冲就丢」的运行时信号变成确定性 hook：
  - `posttool-batch.sh`（`PostToolBatch`，bash）— 一批并行工具调用后数 in_flight 任务对 board 的 `wip_limit`，超限时注入「下回合别再加并行、延后高 float」软警告；**绝不 block**，保住并行自由。
  - `usage-pacing.js`（`Stop`，**node**，ADR-006 解锁的旗舰 node hook）— 读本地 usage JSONL（同 `scripts/cc-usage.sh` 口径）算 5h burn-rate，临近撞墙时注入**非阻断** pacing 警告（7d 累计总量是经 `cc-usage.sh` 的带外信号，非 live hook 注入）；怎么 pace 是认知（属 SKILL A），hook 只感知不替主线调度。
- **hook 武装纪律 + ADR-007（结构决策）** — 新增 [`adrs/ADR-007-hook-arming-gate.md`](adrs/ADR-007-hook-arming-gate.md)：**所有 hook 在本 session 被 `as-master-orchestrator` 武装之前完全休眠**。armed ⟺ home 里有一个 `*.board.json` 且 `owner.active:true` 且 `owner.session_id == 本次 stdin session_id`（sid 空 → 降级匹配任一 active 板，保 compaction 边界鲁棒）；每个 hook 的 `board_matches`/`isArmed` 即这道闸，未武装一律静默（空 stdout、RC 0、不 block）。`bootstrap-board.sh` 是唯一豁免者（ARM 动作本身，建板即盖 `owner.session_id`），解除武装 = `/stop`。**复用已 pinned 的 `active`/`session_id` 两个 narrow-waist 字段判 arming，不动红线 2（ADR-003）**；Context 记录调研结论：CC 无原生跨-compaction session state，disk 是 hook 唯一能读的持久通道。纪律落 `AGENTS.md` §12（红线级口吻硬规则）+ §2 树 + §N 阅读表；`adrs/AGENTS.md` ADR 表加 ADR-007 一行。
- **hook 武装纪律升格为第 6 条 non-negotiable 红线（用户拍板）** — 「所有 hook 武装后才激活（dormant-until-armed）」从 §12 硬规则升格为 `AGENTS.md` §3 红线 6，并把全仓「五条红线」framing 级联更新为「六条」：§3 计数 + 新增红线 6 条目（带 grep 硬卡点 `grep -rL 'board_matches\|isArmed' hooks/scripts/*.sh hooks/scripts/*.js` 须只剩 `bootstrap-board.sh`）、§2 不变式速览、frontmatter `agent-edit-policy`/`content-summary`；`CONTRIBUTING.md`、`.github/pull_request_template.md`、`.github/ISSUE_TEMPLATE/feature_request.md`、`SECURITY.md`、`README.md`/`README_zh.md`、`adrs/AGENTS.md` §5 同步为六条 + 列上武装这条；`ADR-007` 标注「已升格为 §3 红线 6」。前 5 条红线内容不动。

- **产品愿景 charter 持久化（docs）** — 把 cc-master 的六条产品愿景（① 异步并行多线程推进、目标完整落地；② 控制 token 消耗速度；③ 把握自主决策 vs 寻求人类接入的边界；④ 目标的分解 / 管理 / 更新 / 规划；⑤ 资源消耗速度合理前提下最大化实施效率的调度编排；⑥ 按复杂性 / 难度 / 时长选合适的模型）写入 canonical 文档作为持续指导迭代的北极星。**SSOT = `design_docs/spec.md` §1.0**（完整六条 charter，框为 aspirational「致力于」而非「已全部兑现」，附「目标 ≠ 既成事实、由 gap 审计度量差距」边界）；`README.md` / `README_zh.md`（新增「产品愿景 / The vision」节）与 `AGENTS.md` §1 各放一段紧凑摘要 + 回指 SSOT，不复述。
- **愿景落地 gap 审计 + living 追踪文档（docs）** — 新增 `design_docs/vision-landing-tracker.md`：六条愿景穿全产品面（command/hook/skill/board/script）追 trace，判落地真实性（🟢真落地/🟡半落地/🔴design-only/⚫缺失）+ adversarial 断点 + **诚实分「真 gap vs 设计意图」**。核心元模式：真 gap 几乎都不是「prose vs 机制」（多数 prose 是红线背书的设计意图），而是**非对称兜底**（C5 兜 idle 不兜顶满 / C3 Stop 闸不分未答终审与等上游）、**完整性·事务性无保障**（C1 board 完整性 / C4 supersession）、**愿景某维蒸发+overclaim**（C6 duration）。配兑现度矩阵 + 排序设计讨论清单（廉价护栏优先）+ 更新规约；`spec.md` §1.0 与 `AGENTS.md` §N 回指。
- **Claude Code hooks 权威调研 + 整体再设计（research + design 提案）** — `design_docs/research/claude-code-hooks-reference.md`（~30 个 hook 事件 × 能否 block / 能否注入 additionalContext 矩阵，主线 WebFetch 官方 + 二轮 claude-code-guide 对账双重核实）+ `design_docs/2026-06-11-orchestrator-as-program-redesign.md`（把 orchestrator loop 当程序、四层=运行时栈，据核实过的 hook 能力给 H1–H8 gap 闭合设计；最大赢=接通 `SubagentStop`/`PostToolBatch` 通知通道 + node hook 闭 C2）。
- **`requirement-elicitation`（第 4 个 dev-only meta-skill，住 `.claude/skills/`，不分发）** — cc-master 自成一体的需求发现 dev skill：动手任何 feature / skill / 行为改动**之前**的需求发现闸（道：用户字面话是症状、不是需求 + 五个 discovery moves + strawman + 设计闸 + 何时停止挖掘）。**取代本仓 dev 流的 `superpowers:brainstorming`**（self-contain + 接地到 board `goal` 模型与「发现 → 准入 → 造 → 度量」生命周期）。方法论自成一体、不依赖任何外部领域模型或跨链接，全中文；含 `SKILL.md`、`references/discovery_moves.md`、`DESIGN.md`、`OBJECTIVE.md`。它**非「为对仗凑的第四件造/评/治」**——是不同家族的上游发现层，过 Probe（强 B.1 覆写「照字面实现」）+ 补 self-containment 缺口挣得席位。
- **两个分发 skill 补 `DESIGN.md` 设计宪法** — `skills/orchestrating-to-completion/DESIGN.md` 与 `skills/authoring-workflows/DESIGN.md`（6 段模板：one-liner / craft 自分类 / value triad / 责任边界 / 触发与反例 / 演化锚），补齐「每个站得住的 skill 都配一份 DESIGN.md」此前只覆盖 dev-only meta-skill 的不对称。
- **meta-skill 三件套（dev-only，住 `.claude/skills/`，不分发）**：
  - 新建 `curating-skill-portfolios` — portfolio 准入判断：要不要建 skill / 该 skill 还是 reference / 一组 skill 边界与重叠（Counterfactual Probe A/B + 裁剪七维 + DESIGN 宪法）；含 `OBJECTIVE.md`、`DESIGN.md`、三份 references。
  - 新建 `grounding-skill-evals` — 度量与评测纪律：声明轻量 J（成功契约）/ 接现有 eval 三脚本（Track A 触发准确率 + Track B 行为 benchmark + codex 第二评委）/ holdout + predict-then-validate 防过拟合；含 `OBJECTIVE.md`、`DESIGN.md`、三份 references。
  - 改造 `cc-master-skillsmith` — 在现有 pressure-test Iron Law 基础上，增补 craft 两轴诊断（process-control × cognitive-override，各 5 题，四象限锁 Craft A/B/C）+ 4 类 body 内容（触发 / 命名锚 / 流程骨架 / 硬约束）+ progressive-disclosure 阈值（SKILL.md ≤500 行 / references ≥100 行带 TOC）；新增 `references/craft-axis-diagnosis.md`、`references/body-content-types.md`；各配 `OBJECTIVE.md`、`DESIGN.md`。
- **skill 正文中文语言纪律** — 确立：本仓所有 skill 正文 + references 一律中文；例外仅 `name`（kebab-case 英文）、代码/路径/CLI/API 字段/工具名等技术术语；`description` 中文为主可含英文触发词。纪律写入 `AGENTS.md` §6。
- **dogfood 沉淀结论** — baseline-must-fail 原则在强模型（Sonnet 4.x 级别）上存在天花板：建议式查询（advice-shaped queries）模型直接回答而不触发 skill stub，导致 Track A 每个正例 `trigger_rate` 均为 0.0；这种 before==after==floor 的对比无信号，须退回到定性审查（已记入 `design_docs/eval/README.md`）。

### Changed

- **README.md / README_zh.md 重定位为落地页 / 推广页** — 在**不丢失任何社区规范**（安装指南、致谢逐字保留、license、contributing）前提下重排信息架构:hero（沿用现 tagline + 灵魂钩子 + 「not a framework」定位 + 新增 5 枚 shields badges，此前缺失）→ 三范式差异表（加「③ 靠什么兑现」机制列，每条断言锚到真文件）→ **「Watch one run」worked-example demo**（一段做厚的编排:模型分档 + HITL `blocked_on:"user"` 决策节点 + RTL locale 升格 workflow 的 escalation + 5h 墙 pacing + compaction 存活 + 端点验收 + 强制自检列未答决策；附 `smoke.sh` 可跑证明）→ Quickstart（install 原样）→ **六愿景能力矩阵 C1–C6**（🟢 Live / 🟡 Partial / ⚪ Design-only 诚实状态徽章 + charter SSOT 回指，把原愿景散文改造为可扫读矩阵并下沉）→ 工作原理 → 贡献/致谢/许可证（原样）。双语严格同构（章节/badges/board JSON 快照 byte-identical）。
- **全仓 self-contain scrub（去保密场景 + 去外部出处痕迹）** — ① 把示例/demo/fixture 用的一个真实保密项目场景全部替换为通用合成的 **i18n 国际化场景**（README×2 / `examples/sample-orchestration/{walkthrough.md,smoke.sh}` / `skills/orchestrating-to-completion/{references/board.md,assets/board.example.json}` / `design_docs/{spec.md,eval/track-b-benchmark.md}`，三者对齐、`smoke.sh` 真跑过、`board.example.json` 结构测试绿）;② **彻底清除所有外部出处 / 上游项目的字眼与暗示**，让本仓所有文档项目内自洽（涉 `AGENTS.md`/`CHANGELOG.md`/`design_docs/` 多篇/`skills/.../references/async-hitl.md` 分发 ref/dev skills），repo-wide grep 两轴零残留。详见 dogfood Finding #29（must-fix 泄密，用户 review catch）。
- **distributed skills 内容母语化打磨** — 按 `cc-master-skillsmith` craft + `curating-skill-portfolios` 结构,对 `orchestrating-to-completion`（SKILL.md + 6 reference）与 `authoring-workflows`（SKILL.md + 3 reference）做纯中文母语化 + clarity 收紧;**牙齿零改动**（决策程序 dot-graph byte-identical、红线/Rationalization/Red Flags 语义与结构保留、所有代码块/公式/API 签名/board 契约 byte-identical，机器校验）。
- **`verify-board.sh` / `reinject.sh` / `bootstrap-board.sh` 扩展（接通 ADR-007 武装闸 + 非对称兜底）** —
  - `verify-board.sh`（`Stop` goal-hook）：完成态握手现额外**列出未答的 `blocked_on:user` 决策**，把「等上游 / 未答终审」与「真完成」分开（呼应 vision-tracker C3 的非对称兜底 gap）。
  - `reinject.sh`（`SessionStart`）：resume 时**报悬挂的 `stale`/`escalated` 节点**（上一轮 plan 更新未对账的遗留），并**会话域化**——从「home 里任一 active 板就重锚」收紧为「`owner.session_id == 本 session` 才重锚」，堵住 reinject false-activation gap（别的 session 留了 active 板就被误锚成 orchestrator）。
  - `bootstrap-board.sh`（`UserPromptSubmit`）：建板即把 `owner.session_id` 盖成创建它的 session（ARM 动作），让会话域化武装闸一出生即可满足。
- **`orchestrating-to-completion`（SKILL A）按六愿景重组** — `SKILL.md` 加**六愿景索引地图** + 「当 hook 对你说话」共鸣小节（把运行时 hook 注入与七镜头 / 决策程序接上，告诉编排者 hook 提示该如何消化）；六个 reference 各打**愿景 tag**；`DESIGN.md` §2/§6 同步。reinject 重注友好原则下，索引地图入主文件、深细节仍留 references。
- **`/cc-master:status` 命令变富** — board 摘要渲染更丰富（呼应新 hook 暴露的运行时状态：悬挂节点 / 未答决策 / pacing 信号）。
- **README C6（duration / 时长维）诚实校准** — 修正此前对「按复杂性 / 难度 / **时长**选模型」一维的 overclaim，使描述与实际兑现度对齐（vision-tracker C6：愿景某维蒸发 + overclaim）。
- **`AGENTS.md` §6 升级为三 meta-skill 导航 hub** — 明确「写 body → `cc-master-skillsmith`；判边界/准入 → `curating-skill-portfolios`；声明 J / 跑 eval → `grounding-skill-evals`」路由；补语言纪律段。
- **`AGENTS.md` §N 触发式深入阅读表** — 新增 `curating-skill-portfolios`（判断要不要建 skill / 边界 / 重叠）和 `grounding-skill-evals`（声明 J / 度量 / 跑 eval）两行。
- **`AGENTS.md` §4 增本仓对 superpowers 的一处覆盖** — dev 流「需求发现 / brainstorming」步改用项目自带 `requirement-elicitation`，不用 `superpowers:brainstorming`；其余「中间」段（plans / TDD / debugging / verification）与「前 / 后」仍按全局路由。
- **`AGENTS.md` §2 / §6 / §N + curating 版图自述同步** — dev meta-skill 由「三件套」扩为「三件套（造/评/治）+ `requirement-elicitation` 上游」，§6 路由四者正交（发现 → 准入 → 造 → 度量）；curating 的 portfolio 计数 2+3 → 2+4，并在 `references/counterfactual-probe.md` 注明第四件经 Probe 准入、非违背「为对仗而建第四个」警告。
- **红线 1 修订（[ADR-006](adrs/ADR-006-hooks-may-use-node-js.md) 取代 [ADR-001](adrs/ADR-001-hooks-pure-bash.md) 的「no node」立场）** — hook runtime 约束从「纯 bash」改为 **bash + node/JS（JS only；`jq`/`python`/TS-直跑仍排除）**：Claude Code 本身是 Node 应用，`node` 在任何能触发 hook 的环境天然在（原「no node」把模型后端 Bedrock/Vertex/Foundry 误当 CLI 宿主）。最大后果：**C2 usage 感知翻盘为可做成 node hook**（原判「唯一被红线1 否决」）；board 解析可 `JSON.parse`。ship-anywhere 精神保留。同步：`AGENTS.md` §3 红线1 + §2/§12/§N、`CONTRIBUTING.md`、`SECURITY.md`、PR/issue 模板、`README(_zh).md`、`grounding-skill-evals`、`vision-landing-tracker`。ADR-001 状态 → Superseded。
- **模型档位指导上提高杠杆裁决身份（`cost-and-pacing.md` + `decomposition.md`）** — 按「一次错判下游成本极大、且低并发」把判断 / 审查 / 咨询 / 裁决身份压到最强档:**Fable 5** = 独立 review / 二审 · 端点验收 · 决策咨询 · 架构仲裁 + 最难开放推理;**Opus** = 难实现 + 常规 review;**Sonnet** = 常规实现;**Haiku** = 机械活。相对输出倍率 10×/5×/3×/1× 不变;仍是 informational reference(非红线,Finding #26)。
- **`commands/` 全中文化 + `as-master-orchestrator` 整体重构** — 三个命令(`as-master-orchestrator` / `status` / `stop`)正文中文化;点火命令 `as-master-orchestrator` 重构为**薄点火层**(点火 + 指向 `orchestrating-to-completion` skill,不复述七镜头 / 红线 / 决策程序——红线 3 + reinject 重注友好),保留三步骨架 + 「指挥不演奏」收尾;bootstrap sentinel(`<!-- cc-master:bootstrap:v1 -->`)byte-exact 首行触发机制与所有技术字面量(`$ARGUMENTS` / `owner.session_id` / `tasks[]` / `blocked_on:"user"` 等)原样保留。

### Removed

- **移除 `subagent-stop.sh`（`SubagentStop` / H6）hook + 全仓级联引用** — 经官方文档 + codex 第二端点验收双重确认，`SubagentStop` 的 `hookSpecificOutput.additionalContext` 注入的是**刚结束的 sub-agent 自己的 context、不穿过父 orchestrator 边界**，故这个 hook 想做的「后台 sub-agent 完成 → 自动提醒父 orchestrator 去 integrate / 验收」根本做不到（递错对象）；且与 Claude Code 内建的「sub-agent 结果摘要自动回父线」**冗余**。「完成即整合」的纪律保留在 SKILL A 决策程序的 recon 步（integrate done background）+ 内建通知里，不靠此 hook（子 → 父通知属 background agents / agent teams，本仓红线 5 有意排除）。级联：`hooks/hooks.json` 删 `SubagentStop` 事件块、删 `hooks/scripts/subagent-stop.sh` + `tests/hooks/test_subagent-stop.sh`、`tests/content/structure.test.mjs` 改「5 hook / 4 事件」、`README(_zh).md` / SKILL A `SKILL.md`+`DESIGN.md` / `AGENTS.md` §2 / `SECURITY.md` / `ADR-007` Scope / `design_docs/` 两篇同步去引用或校正为「已评估并移除」。

## [0.2.0] — 2026-06-10

### Added

- **Model tiering & usage-aware pacing (SKILL A reference)** — new
  `skills/orchestrating-to-completion/references/cost-and-pacing.md`: the four
  model tiers + relative output cost, per-node tier selection, why the main
  thread stays on one model (prompt-cache), and pacing a long run against the
  5h/7d quota window (levers: downgrade model / lower WIP / defer float). Surfaced as soft pointers on lenses 2 & 5 — **reference knowledge,
  not a red line** (subagent pressure baselines showed agents already derive
  the behavior from the existing lenses; §6 Iron Law forbids fabricating an
  unviolated rule).
- **`scripts/cc-usage.sh`** — out-of-band 5h/7d usage signal for the
  orchestrator's main thread (system python3 parses local Claude Code JSONL,
  zero network / deps, ship-anywhere; **not a hook**). Emits 5h
  used/window-remaining/burn-rate + 7d used; optional `ccusage` accelerator.
- **codex as a second endpoint reviewer** — `scripts/codex-review.sh` wraps
  `codex exec review` in a read-only sandbox with a silent-pass-through guard
  (empty review / failed call → NOT passed); documented in
  `skills/orchestrating-to-completion/references/resume-verify.md`.
- **Eval mechanism** — Track A (trigger-accuracy: `scripts/eval-trigger.sh` +
  per-skill `evals/trigger.json`) and Track B (orchestration-discipline
  benchmark: `scripts/eval-benchmark.sh` + `design_docs/eval/`).
- **`nested-workflow-composition.js` example** — the first `workflow()` asset:
  composes a saved/file workflow as a per-item sub-step with shared
  budget/caps, one-level nesting, and catch-and-degrade fallback. Indexed in
  SKILL B + `patterns.md`, cross-linked from `api-reference.md`.

### Fixed

- **goal-hook is now JSON-layout-agnostic** — task counting, actionable
  detection, and the completion fingerprint in `verify-board.sh` are scoped to
  the bracket-matched `tasks` array (string- and escape-aware depth scan)
  emitting only task-object top-level fields, instead of relying on a
  one-task-object-per-line layout. Compact single-line boards no longer
  miscount log entries as tasks, a `status:"ready"` inside `log[]` no longer
  blocks forever, a log append between Stops no longer re-forces the self-check
  handshake, and flexible task-local fields — including a nested `log` with
  structured `{"id","status"}` entries — can neither truncate the scan nor
  masquerade as task state (codex review catches, two rounds).
- **Sidecar writes are atomic** (tmp + `mv`) — a concurrent Stop can never
  observe a torn handshake/fuse state.

### Changed

- **SKILL A: question-prefetch discipline (HITL)** — new `async-hitl.md` HITL
  bullet + Rationalization Table row: a foreseeable user decision on a
  not-yet-ready node is asked NOW while the user is reachable (the ask-trigger
  is "only the user can answer", never "the node became ready"), bounded
  against speculative question-peppering. Pressure-baselined per the
  skillsmith Iron Law: 6 baseline runs, 1 captured failure ("I'll stop and ask
  when we get there"), GREEN verified 2/2 with citations.
- **Skills optimization pass** — both shipped skills tightened (descriptions,
  reference TOCs, SSOT convergence per dogfood findings #7/#11/#13).
- **Eval sets expanded + Track A floor documented** — both `evals/trigger.json`
  grown 20→28 (cross-skill near-miss + strong-distractor negatives); SKILL B
  `description` de-escaped (`engine''s` → `the workflow engine`,
  semantic-equivalent). `design_docs/eval/README.md` gains a measured-floor
  warning: a real run scored every positive `trigger_rate 0.0` (root-caused in
  dogfood #25 — `find_project_root` lands on `$HOME`, advice-shaped queries are
  answered without invoking a stub, detector bails on the first tool), so a
  before==after==floor comparison carries no signal — fall back to qualitative
  review there.
- **Out-of-band scripts hardened** — `CODEX_REVIEW_MODEL` overrides the codex
  review model; `CC_MASTER_SKILL_CREATOR` overrides the skill-creator path in
  both eval wrappers; both eval wrappers pre-check that `uv` is on PATH and
  fail with an actionable message instead of `command not found`.
- **AGENTS.md** rewritten as the contributor entry point: five red lines with
  SSOT + grep/CI gates, a trigger-based deep-reading table, and the
  gstack × superpowers iteration paradigm.

## [0.1.0] — 2026-06-08

First public release. cc-master turns any Claude Code main-session agent into a
long-horizon **master orchestrator**: it picks the right dynamic-workflow
paradigm, dispatches background work, and keeps the main thread productively
advancing across context compaction and across sessions.

### Added

- **Commands** — one-shot ignition for the orchestrator role:
  - `/cc-master:as-master-orchestrator <goal>` — bootstrap a board and become the orchestrator.
  - `/cc-master:status` — render the board summary and validate the narrow waist.
  - `/cc-master:stop` — archive the board and stand down (the board is kept, not deleted).
- **Skill A — `orchestrating-to-completion`** — the main-thread orchestration method:
  goal → dependency DAG, dispatch-on-ready, productive idle windows
  (verify · look-ahead · HITL · distil), and endpoint verification.
- **Skill B — `authoring-workflows`** — how to write dynamic-workflow scripts:
  procedural `SKILL.md` plus `references/{api-reference, patterns}` and
  `assets/` (5 templates + 4 examples). The Claude Code harness is treated as
  the authoritative validator, so no separate workflow linter is shipped.
- **Hooks (pure bash, no jq/node)** — the memory that survives compaction:
  - `UserPromptSubmit` → `bootstrap-board.sh` — deterministically creates the
    board skeleton and injects its path + the orchestrator role on the command sentinel.
  - `SessionStart` (`startup|resume|compact`) → `reinject.sh` — re-injects role + board.
  - `Stop` → `verify-board.sh` — the **goal-hook** (see its dedicated entry below).
- **Board** — the orchestrator's persistent save file: a status-bearing task
  dependency graph and the single source of truth. Lives in a configurable home
  (`$CC_MASTER_HOME`, else `<project>/.claude/cc-master/`), with a per-orchestration,
  time-sortable file so concurrent runs never collide. Gitignored.
- **goal-hook** — the `Stop` hook (`verify-board.sh`) is upgraded from a bare
  empty-board backstop into a deterministic completion gate: it reads this
  session's active board, blocks while actionable (`ready`/`uncertain`) work
  remains, forces a one-time self-check handshake against the original goal
  before releasing a completion state, and carries an anti-deadlock fuse. This
  replaces the earlier native `/goal` plan — an agent cannot set a native
  `/goal` itself, so that guidance (and the `/loop` notes) was removed in favor
  of this hook-enforced gate.
- **Test harness** — `run-tests.sh` covering hook scripts (bash assertions) and
  the content contract (Node 22+ built-in test runner: board schema,
  skill/command structure). Validates against `claude plugin validate .`.
- **Docs** — `README.md` (EN) and `README_zh.md` (中文); design specification,
  design notes, and four research reports under `design_docs/`.

[Unreleased]: https://github.com/nemori-ai/cc-master/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nemori-ai/cc-master/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nemori-ai/cc-master/releases/tag/v0.1.0
