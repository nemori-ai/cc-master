# 设计 spec — skills 全面优化 + codex reviewer + eval 机制 + 迭代范式文档

状态:勘察完成(R1–R5)、D1 已用户拍板(2026-06-08)、本 spec 起草中(支柱 1/3/4 + 支柱二 codex 部分已定;§2.B AGENTS.md/CLAUDE.md 大纲待 R5 落地补全),**待用户 review** 后转 writing-plans。

源起:接续 dogfood 的深水区。参考高质量 skill 库(ljg-skills / superpowers)+ 官方 skill-creator,系统性打磨本仓 skills;引入 codex 当 reviewer;立 eval 机制让迭代有据可依。四路勘察(R1 本仓审计 / R2 exemplar 拆解 / R3 skill-creator+eval / R4 codex 路径)+ R5(omne 范式)为依据。

## D1 决策(用户拍板)

1. **支柱一 skills 优化 = 全面**:必修(authoring-workflows 文档资产漂移)+ 纪律武器(Rationalization Table / Red Flags / description 剥离 workflow)+ 结构性改造(decision-program 改 dot-graph / 按 `wc -w` 瘦身常驻 SKILL.md / 覆盖性金句 / 新增 **TDD-for-skills** 元规范)。
2. **支柱二 codex reviewer + 范式文档**:codex 当端点验收 reviewer;**新增 AGENTS.md + CLAUDE.md(仿 omne_harness)引导本项目未来整个迭代范式**,codex reviewer 为其一环。
3. **支柱三 eval = Track A + Track B**:触发准确率门 + 编排纪律 benchmark(codex 当 Track B 第二评委)。
4. **支柱四**:本轮顺手修 goal-hook 重复自检 finding。

## 硬约束(不可破)

- **hook 纯 bash,无 jq/node**,ship-anywhere(含 Bedrock/Vertex/Foundry)。codex reviewer / eval 脚本是**带外(out-of-band)手动调用**,不进 hook —— 故不受此约束,但须文档化其依赖(`uv` + Python 3.12 + `claude` CLI + `codex` CLI)。
- **codex 绝不入 Stop hook**(要联网 / OAuth / 多分钟超时 / JSON 解析,违背纯 bash ship-anywhere;openai-codex 插件自己的 stop-gate 也是 opt-in + Node)。codex 以 **sub-agent 端点验收节点**形态接入。
- **progressive disclosure**:AGENTS.md 不与 `orchestrating-to-completion` SKILL.md 重复编排哲学,只给指针;常驻 SKILL.md 越瘦越好。
- 现有确定性骨架测试(`run-tests.sh`,~46+ 条)与本变更无关者**必须保持全绿**;`claude plugin validate .` 通过。
- browse 一律走 gstack `/browse`;中文应答;commit/PR/merge 等 HITL 须先问。

---

## 一、支柱一 —— skills 全面优化

### 1.1 [必修·高] authoring-workflows 文档—资产漂移(纠正性)

R1 实证(我上轮 P2c-C 埋的回归):
- `SKILL.md:102-104` 称 "4 个 example",磁盘 `assets/examples/` 实有 **11 个**(多出 bug-hunt-loop / dep-upgrade-sweep / pr-issue-triage / test-generation-and-repair / tournament-bracket / self-repair-loop / staged-escalation)。
- `references/patterns.md:242-244` 称三个 niche shape "prose only — no bundled file",但 tournament-bracket / self-repair-loop / staged-escalation 文件都在且合约合规。
- 4 个 example(bug-hunt-loop / dep-upgrade-sweep / pr-issue-triage / test-generation-and-repair)在任何 markdown 零引用;决策树(`SKILL.md:32-53`)无入口。

**修法**:① 更新 SKILL.md example 索引为全部 11 个,各给一句 "when to read";② patterns.md 把三个 niche shape 从 "prose only" 改为 "demonstrated by `assets/examples/<x>.js`";③ 决策树末尾加"组合形态见 patterns.md / examples/"入口;④ 为 4 个孤儿 example 在 patterns.md 补对应 pattern 条目或 SKILL.md 列出。

### 1.2 [中] progressive disclosure 精修

- **大 reference 加 TOC**:`orchestrating-to-completion/references/dispatch.md`(167)、`board.md`(122);`authoring-workflows/references/patterns.md`(272)、`mechanism.md`(198)。顶部加小节锚点 TOC(skill-creator:>300 行需 TOC,patterns.md 已逼近且一节一 pattern 最受益)。
- **去 step-6 ledger 重复**(Finding #7 残留):`orchestrating-to-completion/SKILL.md:95-101` 与 `references/async-hitl.md:64-78` 重复整段。SKILL.md 收敛为一句指针,详述留 async-hitl 一处。
- **按 `wc -w` 瘦身常驻 SKILL.md**:`orchestrating-to-completion/SKILL.md` 是 SessionStart 每次 compaction 全文重注的常驻手册。把 "Board protocol essentials" 等已有 references/board.md 兜底的细节收敛成指针,主文件只留路由表 + 红线 + 决策程序硬核。目标:主文件显著变短,每回合不稀释 7 步硬核。验证:`wc -w skills/*/SKILL.md` 前后对比。

### 1.3 [纪律武器·借 superpowers] 给 orchestrating-to-completion 加封堵层

R2 提炼(superpowers 标志性结构,均有实测/baseline 背书):
- **Rationalization Table(借口→现实两列)**:针对编排者最常见合理化("后台都在跑我闲着也是闲着先 review 一遍"→ fake-busy;"就改一行我自己上"→ 破"指挥不演奏";"gate 绿了就算过"→ 破 silent pass-through;"这次特殊我替用户定了 merge"→ 破越权)。
- **Red Flags 自检清单("STOP and re-run the decision program")**:让编排者自查"我是不是正在空转/越权/把空 review 当通过/亲自下场"。
- **description 剥离 workflow → 纯触发条件**:superpowers 实测——description 剧透流程会让 Claude 照 description 行事跳过正文。把 `orchestrating-to-completion` 与 `authoring-workflows` 的 description 瘦成 "Use when…" 触发条件(含中文锚点 + 即将违规的症状,如 "when you catch yourself idle-waiting or manufacturing busywork")。
- **覆盖性金句**:借 superpowers "违背字面就是违背精神",一句切断"我遵循精神"类合理化。

### 1.4 [结构性] decision-program 改 dot-graph

`orchestrating-to-completion` 的 7 步决策程序(尤其 step-6 容易误判为可停)是"可能过早停止的循环",R2 判定为 dot-graph 标准候选。把 7 步 + step-6 ledger gate 画成带回边的流程图(graphviz),比纯文本更难被跳步。遵 superpowers graphviz 元规则:只画非显然决策点 / 易过早停止的循环 / A-vs-B 选择,不画线性步骤。

### 1.5 [结构性·新增] TDD-for-skills 元规范

把"纪律型 skill 必须先跑 subagent pressure baseline 再写堵漏"固化。形态:做成 cc-master 自己的一个 meta-skill,**最终命名 `cc-master-skillsmith`、放 `.claude/skills/`(项目自用 dev 工具,不随插件分发——见 Finding #23)**,而非分发的 `skills/`。内容:Iron Law(无 failing baseline 不写纪律 skill)+ pressure scenario 配方(time + sunk cost + exhaustion 三压)+ verbatim 记录合理化 → 回填 Rationalization Table。与支柱三 eval 的 Track A/B 互补(pressure baseline 是定性、eval 是定量)。

---

## 二、支柱二 —— codex reviewer + 迭代范式文档

### 2.A codex reviewer(R4 推荐)

**形态:codex = sub-agent 端点验收节点**(不入 hook)。落地物:
- `scripts/codex-review.sh`(committed,纯 shell 封装,带外调用):
  - 核心:`codex exec review "<review-only 指令>" --base <branch> -m gpt-5.5 -c model_reasoning_effort=high --json -o <out> < /dev/null`(`< /dev/null` 防 stdin 死锁;只读 sandbox)。
  - review 指令含 R4 提炼的"filesystem boundary"(忽略 `~/.claude/`、`.claude/skills/`、`agents/` 等别的 AI 的 skill 定义)+ skill 质量聚焦(description 触发力 / 指令是否歧义 / bash 块是否真能跑 / dead ref)。
  - 输出按插件自带 `review-output.schema.json` 解析 `verdict: approve|needs-attention` + 每条 finding 的 severity/file/line/confidence。
  - 失败(空 review / OAuth 过期)→ **按"未通过"处理**(silent-pass-through guard,resume-verify.md:52),不静默放行。
- **文档化**:在 `orchestrating-to-completion/references/resume-verify.md` 的端点验收段补"codex 作为独立第二验收者"小节——`verdict` 直接映射现有 `FinalResponse` / `Replan(feedback)` Joiner 闸(`needs-attention` → Replan;`approve` + 非空 + 已读 diff → done)。
- **批量**(评审多 skill):走 workflow stage,每 leaf `codex exec review --output-schema review-output.schema.json` 对一个 skill 的 diff,fan-in 成质量 scorecard。顺带沉淀为 `authoring-workflows/assets/examples/codex-review-fanout.js`。

### 2.B AGENTS.md + CLAUDE.md 迭代范式文档(仿 omne_harness)

**范式确认**(R5 初定 + 已核):`CLAUDE.md = @AGENTS.md`(一行 include),AGENTS.md 是单一真相源,让 Claude Code 与 codex 等读同一份。omne_harness/AGENTS.md(569 行)是主范本,harness 配 `adrs/`(ADR 决策记录)、`design_docs/`、`contracts/`、`.benchmarks/`。

**核心定位(R5 定调)**:AGENTS.md = 「未来迭代者/贡献者 + 进入本仓的 agent 的**着陆页/最小心智地图 + 渐进式披露导航表**」,**不是手册**。元原则 = **SSOT + 跨引用而非复述**(omne 红线 #5)。**绝不复述** SKILL.md(运行时灵魂、reinject 每次 compaction 重注、Finding #7 已证重复是负担)、README(用户视角)、CONTRIBUTING(已有 dev loop + 5 不变式)——只把它们织进一张导航地图,并补 omne 有而 cc-master 缺的「迭代纪律层」。目标篇幅 **180–260 行**(比 omne 小一个量级)。

**cc-master AGENTS.md 章节 outline**(【正文】=写进 / 【指针】=一行链到现有 SSOT):
- **Frontmatter**【正文 ~12】:`path/version/last-edited` + **`agent-edit-policy` 三级编辑分级**(照搬 omne:① 自主刷新=命令表/触发表/findings/last-edited ② 走 PR 人审=红线/章节重排/目录拓扑 ③ 禁止=把 SKILL.md 灵魂公式塞回正文)+ content-summary。
- **导语**【正文 ~5】:「进入 cc-master 仓库的第一站」+ progressive disclosure 声明 + 「运行时灵魂在 SKILL A,本文不复述」。
- **§1 这个插件是什么**【正文 ~12,多指针】:定位(把 CC 主会话变 long-horizon orchestrator)+「不是什么」(非 agent framework、不依赖 agent-teams/scheduled routines)+ 指针(用户→README、方法论→SKILL A、脚本→SKILL B)。
- **§2 仓库形态 + 关键不变式**【正文目录树 + 指针 ~30】:目录树;5 条不变式各一句话 + 链回 SSOT;临时计划 `design_docs/plans/`(gitignored)vs 正式 design_docs。
- **§3 Non-negotiable 红线**【正文 ~15】:cc-master 版 omne §4——每条一句话 + 链回 SSOT + 标 PR/CI grep 硬卡点(如「hooks 纯 bash」→ `grep -rE 'jq|node' hooks/scripts/` 须 0)。**去重拍板点:红线 SSOT 定在 AGENTS.md,CONTRIBUTING 改指针**(二选一)。
- **§4 迭代范式总图(gstack × superpowers 路由)**【指针 ~8】:一句话 + 指针到用户全局 CLAUDE.md;强调本仓收口用 github-pr(不用 gstack ship)。
- **§5 编排纪律(SKILL A 是灵魂)**【指针为主 ~10】:**绝不复述**七镜头/红线/决策程序;只放定位 + 「改方法论→改 SKILL A 而非这里」+ 改 SKILL A 的纪律(reinject 重注友好/越短越好、决策程序骨架不动、Finding #7 收敛结论)。
- **§6 Skill 创作/维护纪律(含 TDD-for-skills)**【正文+指针 ~22】:两 skill 不重叠;**frontmatter YAML 引号纪律(Finding #1 血泪:`:`/`"` 必引号)写成反模式**;**TDD-for-skills**(纪律型 skill 改前跑 subagent pressure baseline)指针 skill-creator;content contract = `run-tests.sh` node 段 + `claude plugin validate .` 为权威 validator。
- **§7 codex 作为 reviewer 范式**【正文 ~12】:codex=端点验收节点(呼应红线「只信端点验收/gate-green≠passed」);`codex exec review --json` + `review-output.schema.json`;指针 codex skill。
- **§8 Eval 机制**【正文+指针 ~14】:Track A(description 改动跑触发准确率)+ Track B(`uv run --python 3.12` 跑 benchmark);何时跑(纪律型改前后必跑 baseline、description 改必跑 A);指针 skill-creator。
- **§9 Dogfood 循环**【正文+指针 ~12】:用本插件改本插件;behavioral 改动必 dogfood;**findings 台账 `design_docs/dogfood-findings.md` = omne 式「已踩反模式永久写入纪律」**,立纪律「用着不爽/指导不对/效率没拉满必落台账」。
- **§10 测试纪律 + 验收门**【正文 ~12】:`run-tests.sh` 全绿 + `plugin validate` 无错;**测试只保 correctness,quality 靠 dogfood + 端点验收**;并行后端点必跑全套(Finding #12);红线零违反 grep 门。
- **§11 分支/PR/commit 约定**【正文 ~10】:feature branch;`gh` + PR body 带 Claude 署名 + github-pr 收口;commit 末尾 Co-Authored-By + type 前缀(feat/fix/docs/chore/adr);CHANGELOG/README 同步指针。
- **§12 目录与文件约定**【正文 ~10】:command/skill/hook 文件约定 + sentinel 注释;design_docs 命名;board 不入版本控制。
- **§13 ADR 约定**【指针 ~6】:一段话 + 链到 `adrs/AGENTS.md`(见下)。
- **§N 触发式深入阅读**【正文大表 ~25】:cc-master 版 omne §9 单层「做 X→读 Y」表(改方法论→SKILL A;写 workflow→SKILL B+refs;改 hook→hooks/+tests/+CONTRIBUTING;改 board schema→board.md+content 测试;写 ADR→adrs/;落 dogfood→findings 台账;跑 eval→skill-creator;codex review→/codex;设计留痕→spec.md §12)。

**ADR(R5 建议:值得轻量引入)**:建 `adrs/`(无语言分层),首批回填 4–5 条结构性决策:`hooks-pure-bash`、`ship-anywhere-scope`、`board-narrow-waist`、`loop-dissolution-and-goal-hook`(Finding #2 supersession 典型)、`two-skills-separation`。命名 `ADR-NNN-<slug>.md` + Status/Date/Scope frontmatter + Context/Decision/Consequences/Alternatives/Related/References 模板 + judgment checklist——全照搬 omne `adrs/AGENTS.md`。**此项可独立成 P2c(ADR 回填),非 AGENTS.md 硬前置,可作为全面档的一部分;若想收敛范围,首版 AGENTS.md 先放 §13 指针、adrs/ 回填留后续。**

**CLAUDE.md**:确认照搬 `@AGENTS.md` 一行 include(已逐字核实 omne 全仓 CLAUDE.md 均为 11 字节单行)。cc-master 仓库根目前无 CLAUDE.md / AGENTS.md,干净起点。

---

## 三、支柱三 —— eval 机制(Track A + Track B)

R3 实证。运行钥匙:`uv run --python 3.12 python -m scripts.<x>`(系统 Python 3.9.6 跑不了 PEP-604;`uv` 已装且 cpython-3.12.11 就绪);`claude` CLI(v2.1.168)就位,无需 API key(复用 session 认证)。

### 3.A Track A —— 触发准确率门(全自动、可复现)

- **量什么**:每个 skill 的 `description` 在一组 query 上的 precision/recall/accuracy。
- **落地物**:每个 skill 仓内 `skills/<s>/evals/trigger.json`(8–10 条 should-trigger 含隐式需求措辞 + 8–10 条 near-miss should-not-trigger);仓内 `scripts/eval-trigger.sh` 薄封装:
  `uv run --python 3.12 python -m scripts.run_eval --eval-set <repo>/skills/<s>/evals/trigger.json --skill-path <repo>/skills/<s> --runs-per-query 3 --model <session-model> --verbose`(cwd=skill-creator 目录或设 PYTHONPATH)。
- **改前后对比**:对旧/新 description 各跑一遍比 accuracy;或用 `run_loop.py --max-iterations 5` 提议优化 description 并报 test-score delta(seed=42 train/test split 防过拟合,best-by-test)。
- **天花板(诚实标注)**:Claude 只对非平凡任务查 skill,简单 query 不触发与 description 质量无关 → eval query 须 substantive,100% 非目标。

### 3.B Track B —— 编排纪律 benchmark(codex 当第二评委)

- **量什么**:`orchestrating-to-completion` 让编排者行为更好的端到端断言(行为型,从 transcript 评),with_skill vs without_skill 各 3 run,mean±stddev。fixture 用 `examples/sample-orchestration/`。
- **断言示例**:派活前先把 goal 拆成 DAG / board(查 board.json 合 schema)；等待窗口主线不空转(transcript 无前台 sleep)；声明 done 前端点验收;模拟 compaction 后能重读 board 续跑。
- **跑法**:skill-creator Track-B workflow(with/without subagent → grader.md → `aggregate_benchmark.py` → eval-viewer)。
- **codex 配对**:grader 写完 `grading.json` 后,跑 codex(review/challenge)对同一 transcript+断言出非-Claude 裁决;**两评委分歧 = 高信号**(grader.md 哲学:弱断言上的 pass 比没有更糟)。
- **诚实**:行为型断言 LLM 评分有噪 → 看 stddev gap 不只 mean delta;codex 当 tiebreaker;数字仅方向性,不当权威;非每-commit CI 门,作 pre-release 检查。

---

## 四、支柱四 —— 修 goal-hook 重复自检

本轮 dogfood 实撞(已撞 2 次):`verify-board.sh` 在「纯等后台(只剩 in_flight/blocked/done)」与「真完成」两态行为相同 → 触发自检握手;且 sidecar 每次 allow 清零,导致长背景等待期**每个 yield 周期重复同一份自检**(board 状态未变也重问)。

**修法**:握手以 **board 的 status 集合 hash(或排序后 status 多重集的稳定指纹)** 为键存入 sidecar。完成态分支:若当前 status 指纹 == 上次已自检通过的指纹 → **直接 allow**(状态未变,无需重问);指纹变化(有任务完成/新增/状态迁移)才重新要求自检握手。纯 bash 实现(状态指纹可用 `grep '"status"' | sort | cksum` 之类),FUSE 防呆保留。

**测试契约**(`tests/hooks/test_verify-board.sh` 增):
- 同一 status 指纹连续两次完成态 Stop → 第一次握手 block、第二次 **allow**(现状)；**第三次(指纹仍未变)→ 仍 allow**(新契约:不再重问)。
- 指纹变化(如一个 in_flight→done 后又出现新 in_flight)后的完成态 Stop → **重新 block 握手**(新契约)。
- 既有 30 条 case 中与指纹无关者保持全绿。

### 4.2 [新增·本轮 live·Finding #16] 修 bootstrap marker 误触发

本轮 dogfood 实撞:R5 报告正文逐字引用了 sentinel 标记 `cc-master:bootstrap:v1`(§12 讲 command 约定),该报告经 task-notification 走 UserPromptSubmit 时,`bootstrap-board.sh` 的「stdin 含 marker 子串」判据命中,**误建空 board**(`20260608T121833Z-2069.board.json`,已清理)。这是 Finding #15 同类残留——P2c-F 只收紧了 `/cc-master:as-master-orchestrator` 前缀分支,marker 那条 OR 分支仍是裸子串匹配,任何提及该 marker 的文本(sub-agent 报告 / 文档 / 本对话)都会误触发。

**幸:** goal-hook 的 session 过滤(Finding #4 修复)兜住了——误建 board 的 `owner.session_id=""` ≠ 本 session,故 goal-hook 不会 gate 它、不误伤。但 bootstrap 仍不该建这块空壳。

**修法**(P4b,改 `hooks/scripts/bootstrap-board.sh`):marker 触发从「stdin 含子串」改为「**marker 须是 prompt 首个非空行的独立 sentinel**」(prose 内联提及不触发),与 P2c-F 前缀纪律同源。`as-master-orchestrator.md` 的 command body(frontmatter 之后)首个非空行正是 `<!-- cc-master:bootstrap:v1 -->`,而报告里 marker 是句中内联,故可区分。

**测试契约**(`tests/hooks/test_bootstrap-board.sh` 增):
- prompt 首个非空行 == marker 独立行 → 触发建 board(保留现契约)。
- prompt 正文中段内联提及 marker(如 R5 报告那样在句子里)→ **不触发**(新契约,直验 Finding #16 修复)。
- 既有 Cases A–G 与本变更无关者保持全绿。

---

## 五、测试契约 & 验收标准

1. `bash run-tests.sh` 全绿(含支柱四新增 case);`claude plugin validate .` 通过。
2. 支柱一:`grep -c` 校验 example 索引数=磁盘数(11);patterns.md 无 "prose only — no bundled file" 残留;大 reference 均有 TOC;`wc -w` 证明常驻 SKILL.md 变短;Rationalization Table / Red Flags / dot-graph / 金句 就位。
3. 支柱二:`scripts/codex-review.sh` 可非交互跑通(对一个测试 diff 出 verdict);resume-verify.md 有 codex 第二验收者段;AGENTS.md + CLAUDE.md(`@AGENTS.md`)就位且不与 SKILL.md 重复哲学。
4. 支柱三:`scripts/eval-trigger.sh` 对至少一个 skill 跑出 precision/recall 数字(uv 3.12);Track B harness 能对 sample-orchestration 出一份 benchmark + codex 第二评委裁决。
5. **dogfood 自审**:用本轮新建的 `scripts/codex-review.sh` 对本轮全部改动跑一次 codex review,verdict=approve(或 needs-attention 项已处理)——新 reviewer 审自己的诞生。
6. 收口:feat 分支 + 分组 commit + PR(HITL)。

## 六、实施分解(P1/P1b/P2/P2b/P3/P3b/P4)+ single-committer

文件重叠分析(防并行写冲突):
- P1 改 `orchestrating-to-completion/SKILL.md`+references/* 与 `authoring-workflows/SKILL.md`+references/*。
- P1b 新增 meta-skill 目录 或 改 CONTRIBUTING(若并入)——与 P1 可能在 CONTRIBUTING 重叠,需协调。
- P2 新增 `scripts/codex-review.sh` + 改 `resume-verify.md`(与 P1 重叠 references!需串行或同一 agent)。
- P2b 新增 `AGENTS.md`/`CLAUDE.md`(独立文件,无重叠)。
- P3 新增 `skills/*/evals/*.json` + `scripts/eval-trigger.sh`(与 P3b 都动 scripts/ 与 eval 资产)。
- P3b 新增 Track B harness 资产。
- P4 改 `hooks/scripts/verify-board.sh` + `tests/hooks/test_verify-board.sh`(独立,无重叠)。

**协调策略**:按 cc-master single-committer —— 各 sub-agent 写文件 + 自证测试绿,**不 commit**,orchestrator 端点验收(含 codex 自审)后统一分组 commit。重叠文件(`resume-verify.md` 被 P1+P2 都碰;scripts/ 被 P2+P3+P3b 碰;CONTRIBUTING 被 P1b 碰)→ 要么并入同一 agent,要么按依赖串行。具体波次编排留 PLN(writing-plans)细化。

---

> 本 spec 待 §2.B 补全(R5)后整体提交用户 review(SPECREV)。review 通过 → writing-plans → 分波实施。
