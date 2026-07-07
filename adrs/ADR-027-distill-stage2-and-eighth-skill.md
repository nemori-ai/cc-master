# ADR-027 — retro Stage 2 蒸馏：`/cc-master:distill` + 第八个分发 skill `distilling-lessons-into-assets`

> Status: **Accepted**（spec 六维用户拍板 2026-07-07，见 `design_docs/plans/2026-07-07-s2-user-decisions.md` + `design_docs/plans/2026-07-07-distill-spec.md`）
> Date: 2026-07-07
> Scope: 分发 skill 集 7→8（+I，成员新增，不动既有七个的边界）。新增 `plugin/src/commands/distill/`（`adapters/claude-code/{body.md,strategy.yaml}` + `adapters/codex/strategy.yaml`）+ `plugin/src/skills/distilling-lessons-into-assets/`（SKILL.md + 4 references + adapters + evals + `.design/`）+ `plugin/src/skills/cc-master-distill/`（Codex 命令入口的配对 skill，同构于既有 `cc-master-retro`）；`commands.yaml` 新增 `distill` 条目；AGENTS.md §3/§6/§14 计数与枚举同步为八；`scripts/skill-lint.sh` 的 `DIST_SKILL_NAMES` 同步收纳新成员。
> Source: `design_docs/plans/2026-07-07-distill-spec.md`（用户六维拍板 + 实现顺序/测试口径/验收清单）
> Co-signed: user (owner)

---

## 1. Context

`/cc-master:retro`（Stage 1，已实现）只读一块 board、产出一份"候选经验"清单，落到被编排项目内的一份
`*.retro.md` 文档,不做任何去重/合并/落地判断——它的产物明确留了一句"这是给未来'把候选经验落成项目
资产'的后续工作用的输入"。Stage 2 补上这条后续路径:一条候选经验最终该变成什么、怎么变,此前完全无人
负责。

用户在采访包基础上做了六维拍板（见 `design_docs/plans/2026-07-07-s2-user-decisions.md`）：入口形态选
独立命令 `/cc-master:distill`（不是给 `retro` 加 flag）；蒸馏执行结构选"单 agent 全局规划 + 按目标文件
fan-out"；落点解析选"自动探测 + 一次性呈现审阅 + 无基础设施降级"；执行方式**覆盖**采访包"按资产类型
分流直改/PR"的倾向、**一律走 PR**（或非 git 项目的变更草稿目录）；**新增需求**——"落成哪种资产、怎么
落"这层品味判断需要一个专门的 skill 承载，且命令要引导加载它；dogfood 关系上 cc-master 本仓无特殊路径。

第五维拍板直接决定了本 ADR 的结构性后果：**新增第八个分发 skill**。这不是"为了对称硬造一个 skill"——
是延续本仓"命令薄、skill 承重"的既有分层原则：命令体只管流程骨架（认参数、读文件、fan-out、PR），
"一条经验该归哪类资产、每类资产怎么落地不走样"这个真正需要判断力、且会被压力下合理化掉的规则（"这条
经验挺重要该进 skill" / "证据不够就写通用点" / "没地方放就别提了"）必须有独立于命令体的容器,否则要么
命令体膨胀成一份夹带判断力的流程文档,要么判断力干脆没地方站,蒸馏出的资产质量全凭执行 agent 临场发挥。

## 2. Decision

**新增 `/cc-master:distill` 命令 + 第八个分发 skill `distilling-lessons-into-assets`（记作 SKILL I）。**

### 2.1 `/cc-master:distill` 命令

- **消费对象是 retro 文件,不是 board**——这是它与 `retro`/`status`/`stop`/`discuss` 最本质的区别:不需要
  `--home`/`--board`,不调用任何 `ccm` 命令,不读写 cc-master board 的任何字段。
- **流程**:读取全部候选经验（只读）→ 单 agent 全局探测目标项目结构 + 去重合并 + 按
  `distilling-lessons-into-assets` 决策树路由 + 按目标文件分组产出蒸馏计划 → 蒸馏计划一次性呈现给用户
  审阅（**唯一强制 HITL 断点**,未批准不动一个文件）→ 按目标文件 fan-out 执行（组数 ≤2 顺序做,>2 才值得
  并行）→ 收口。
- **收口只有两条路,没有第三条"悄悄改完就算"**：git 项目走 feature-branch + `gh pr create`；非 git 项目
  或显式 `--apply draft` 降级为 `<项目根>/.cc-master-distill-drafts/<UTC-STAMP>/` 变更草稿目录（完整
  `.proposed` 文件内容,非 diff）。这条覆盖了采访包"按资产类型分流直改/PR"的倾向——四类资产统一收口路径,
  不给任何资产类型开"直接改、单 commit、不开 PR"的特例。
- **质量硬闸六层**,唯一强制且写进命令体本身的是**证据可追溯性/忠实转录**：候选内容草稿到写进资产之间
  不允许脱离原始证据的改写/泛化,措辞不够具体时**收窄**而非泛化。其余（冲突检测、敏感信息扫描、端点
  验收、人工审阅）分层标注应做/强制。
- **Codex 侧**沿用 `retro` 已验证的模式:无 native slash command,配一个同构的 `cc-master-distill` skill
  作为 Codex 命令入口（`$cc-master-distill`），claude-code adapter 对该 skill 走 `unsupported_stub`（真正
  的 Claude Code 入口是 `commands/distill`）。

### 2.2 第八个分发 skill：`distilling-lessons-into-assets`（SKILL I）

**定位**：承载"一条候选经验该落成纪律文档 / skill / workflow / subagent 中的哪一种、以及每种资产该怎么
落地"的品味判断力。三问决策树（事实 vs 判断力 → 机制 vs 判断力 → 专职角色 vs 默认 skill）+ 四类资产判据
速查 + 每类资产落地手艺与 Rationalization Table + 唯一硬约束"证据忠实性"（泛化 vs 收窄，绝不静默丢弃）。

**准入论证（呼应 curating 心智,Probe A/B）**：
- **Probe A（增量）= 新判断力**：四类资产各自的判据、路由决策树、每类落地手艺——这是 agent 先验不携带
  的一套结构化归宿判断方法,此前完全没有对应的容器（既不适合塞进 `master-orchestrator-guide` 的
  reference——那个 skill 的读者是"正在编排"的 agent,不是"正在蒸馏经验"的 agent,触发语境不同;也不适合
  塞进命令体本身——命令体膨胀会破坏"命令薄、skill 承重"分层)。
- **Probe B（覆写）= 纪律型 body**：走了一轮真实的 pressure baseline（无 skill 的 subagent,时间压力下
  给 6 条候选经验路由）。结果显示 baseline 整体表现优于预期（未把重要一次性事实误判为 skill、未把单
  实例观察过早固化成 workflow),但**暴露了一个真实缺口**——面对"模糊、无具体证据"的候选经验,baseline
  agent 选择直接丢弃、不留痕迹。这正是本 skill 要堵的规则:弱证据不是不处理的理由,是"标注低置信 + 收窄
  措辞 + 落最低成本归宿"的理由。该发现已写入 skill 的
  `references/evidence-fidelity.md` 与 `references/landing-craft-by-asset-type.md`（Rationalization
  Table）。完整 baseline 记录见 `plugin/src/skills/distilling-lessons-into-assets/.design/DESIGN.md` §2。

**与既有七个 skill 的边界（逐条论证不重叠）**：
- 与 `engineering-with-craft` 不同 plane——craft 管"代码本身（领域/类/合约/测试）该长什么样",本 skill 管
  "一条经验该归属哪类资产、落地到该资产时的品味",不涉及代码工程内容本身。
- 与 `slicing-goals-into-dags` 无重叠——后者管"把目标切成 board DAG",输入输出形态完全不同（目标 vs
  候选经验清单）。
- 与 `dev-as-ml-loop` 无重叠——后者是"把已切好的任务优化到验收"的执行侧循环心智,本 skill 不涉及任务
  执行循环。
- 与 `using-ccm` 无重叠——本 skill 从不操作 board/ccm。
- 与 `pacing-and-estimation` / `master-orchestrator-guide` 无重叠——两者是编排决策/配速消费,本 skill 的
  调用场景是蒸馏阶段的资产路由,不涉及编排调度。
- 与 `authoring-workflows` 无重叠——后者教"workflow 脚本怎么写"（机制层实现细节),本 skill 只在决策树
  里判断"这条经验该不该落成 workflow",不教 workflow 脚本本身怎么写。
- 与项目自用 dev-only skill `curating-skill-portfolios`（不分发）不重叠——那个 skill 服务 cc-master 项目
  自己"要不要新建一个 skill"的治理判断,读者是 cc-master 贡献者;本 skill 是**分发**给任意目标项目 agent
  用的"经验落地"判断力,服务对象和自包含要求完全不同（本 skill 正文不引用 `curating-skill-portfolios`
  这类 cc-master 专属路径,遵循 AGENTS.md §6 自包含纪律）。

## 3. Consequences

- **正面**：`retro` → `distill` 补齐了"复盘→资产"这条闭环,候选经验不再止步于一份只读文档;命令薄、
  skill 承重的分层原则被延续到第八个 skill,而不是让 `distill` 命令体膨胀成一份夹带判断力的流程文档。
- **正面**：证据忠实性硬约束（收窄而非泛化 + 绝不静默丢弃）两处落位（命令体 A.4 边界段 + skill 心智锚）,
  呼应 Stage 1 已点名的"记录问题时把问题本身又泛化了一遍"这类自指盲区,以通用规则形态落地（不是
  cc-master 专属分支)。
- **代价**：分发 skill 数目从七增到八,`skill-lint.sh` 的 `DIST_SKILL_NAMES` 数组、AGENTS.md 多处计数与
  枚举、Track A trigger eval 基线都要同步维护;未来任何新增分发 skill 都要重复这套同步纪律——这是
  portfolio 增长的固有维护成本,不因本次拍板改变。
- **已知限制（拍板明确接受、不在本切片解决）**：`distill` 不做"多次调用间的记忆",对同一份 retro 跑两次
  会重新生成蒸馏计划,可能与已落地的资产产生重复。留给未来切片（需要在 retro 文档或独立 sidecar 里标记
  "已蒸馏"状态）。

## 4. Alternatives considered

- **把归宿判断力塞进 `master-orchestrator-guide` 的一节 reference**——否决:读者语境不同（MOG 服务"正在
  编排"的 agent,本判断力服务"正在蒸馏经验"的 agent),塞进去会让 MOG 的 reinject 负担进一步加重,且这套
  判断力与"该编排什么"没有关系,MOG 的 router 也不会在"蒸馏经验"这个语境下被自然触发。
- **把归宿判断力写进命令体本身,不建独立 skill**——否决:用户第五维显式拍板要求专门 skill 承载,理由是
  "命令体只管流程、道层指导归 skill"这一既有分层原则;且命令体若夹带决策树与 Rationalization Table,会
  在下次改判断力时被迫跟着改一份本该薄的命令体。
- **`retro` 命令直接加 `--distill` flag,不建独立命令**——被采访包倾向提出,拍板第一维否决:`retro` 是
  纯只读命令,`distill` 可写且有完全不同的收口语义（PR/草稿目录),混进同一个命令会让 `retro` 的"绝对
  只读"边界变得可疑,也让参数契约膨胀成两套互不相关的语义。

## Related

- `design_docs/plans/2026-07-07-s2-user-decisions.md`（六维拍板）
- `design_docs/plans/2026-07-07-distill-spec.md`（spec + 实现 plan）
- `adrs/ADR-005-two-skills-separation.md`（skill 互不重叠原则的原始决策，本 ADR 延续其精神）
- `adrs/ADR-019-skill-portfolio-rework.md`（上一次 skill portfolio 重排先例,本 ADR 沿用其"成员变更不动
  既有边界"的处理方式）
