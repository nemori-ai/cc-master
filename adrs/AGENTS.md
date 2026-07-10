# adrs/ — Architecture Decision Records (decision snapshots)

> This file is the navigation entry point and authoring discipline for `adrs/`.
> An ADR (Architecture Decision Record) = a **decision snapshot**: it answers
> "why X and not Y / when may this be overturned." It is a **structural-decision
> record carrying Status + Date**, kept strictly separate from `design_docs/`
> (evergreen description of the current state).
> The ADR-vs-design_docs test is in §3 — read it before creating a new ADR.

---

## 1. What this directory is

`adrs/` carries cc-master's **structural architecture decisions**. Each ADR is an
immutable / explicitly-superseded snapshot that answers one of:

- **Structural shape** — a root form choice that constrains the whole plugin
  (e.g. ADR-001 hooks are pure bash, ADR-003 the board narrow waist).
- **Scope boundary** — what cc-master deliberately does *not* do, and why
  (e.g. ADR-002 ship-anywhere excludes agent-teams / scheduled routines).
- **Supersession history** — when an earlier stance is retired, record explicitly
  "when and why it can be overturned" (e.g. ADR-004 `/loop`·`/goal` dissolution).

If something is "how it currently works / where the boundary is right now," it is
**not an ADR** — it goes in `design_docs/`. See §3.

### Existing ADRs

| # | Topic | Status | One line |
|---|---|---|---|
| **ADR-001** | [hooks are pure bash](ADR-001-hooks-pure-bash.md) | **Superseded by ADR-006** | (historical) Hooks parse JSON with shell tools only — no `jq`/`node`. The "no node" rested on a model-backend vs CLI-host conflation; corrected by ADR-006. |
| **ADR-002** | [ship-anywhere scope](ADR-002-ship-anywhere-scope.md) | Accepted (partially narrowed by ADR-011; ship-anywhere 口径 amended by ADR-014) | Supported background **dispatch** mechanisms = background shell + sub-agent + workflow only; agent-teams and cloud scheduled routines stay out of scope (not reliably available everywhere). ScheduleWakeup/cron exclusion **narrowed by ADR-011** (local timer primitives unblocked for the watchdog). **「不依赖外部预置」口径 amended by ADR-014**（主机预置 `ccm` 二进制 + 进程边界；dispatch scope 不变）。 |
| **ADR-003** | [the board narrow waist](ADR-003-board-narrow-waist.md) | Accepted | A small, fixed set of pinned fields is the only contract the hooks read; everything else is flexible edges the agent shapes freely. |
| **ADR-004** | [`/loop`·`/goal` dissolution + goal-hook](ADR-004-loop-dissolution-and-goal-hook.md) | Accepted (supersedes the native-`/goal` integration stance) | Native `/goal` is unexecutable by an agent (Finding #2) and `/loop`/`ScheduleWakeup` break ship-anywhere; both are replaced by background shell + completion re-entry and a deterministic Stop hook (goal-hook). |
| **ADR-005** | [two-skill separation](ADR-005-two-skills-separation.md) | Accepted | `master-orchestrator-guide` (main-thread orchestration) and `authoring-workflows` (inside-the-script authoring) stay self-contained and non-overlapping. |
| **ADR-006** | [hooks may use node/JS](ADR-006-hooks-may-use-node-js.md) | Accepted (supersedes ADR-001) | Hooks may use bash + Node.js/JavaScript (JS only; `jq`/`python`/TS-direct still out) — Claude Code *is* a Node app, so `node` is guaranteed wherever a hook fires. Unblocks C2 usage-sensing as a hook + trivial JSON parsing. |
| **ADR-007** | [hook arming gate](ADR-007-hook-arming-gate.md) | Accepted | Every hook is dormant-until-armed; armed ⟺ home holds a `*.board.json` with `owner.active:true` AND `owner.session_id == stdin session_id` (degraded to any-active on empty sid). Reuses pinned waist fields (ADR-003 untouched); `bootstrap-board.sh` is the sole exempt ARM action; disarm = `/stop`. Disk is the only cross-compaction channel a hook can read. |
| **ADR-008** | [account-authoritative usage + script placement](ADR-008-account-authoritative-usage-and-script-placement.md) | Accepted | 账户权威 5h/7d `used_percentage`+`resets_at` 只在 status-line stdin → `statusline-capture.js` 捕获到 sidecar，`cc-usage.sh`/`usage-pacing.js` 优先读它（本地反推退 fallback，标 approx）；capture 不受武装闸（只缓存账户全局只读信号，无注入/无 block，红线 6 精神之外）；运行时带外脚本落 `skills/<skill>/scripts/`（随 skill 分发，`${CLAUDE_SKILL_DIR}` 引用），dev-only 留顶层 `scripts/`。Source: Finding #37/#38。 |
| **ADR-009** | [resume = explicit cross-session re-arm](ADR-009-resume-cross-session-re-arm.md) | Accepted (refines ADR-007) | `as-master-orchestrator --resume [selector]` 让全新 session **显式接管**一块已存在的 board（跨 session re-arm）——bootstrap（唯一武装豁免 hook）第二种 ARM 形态：盖 `owner.session_id`/`active:true`/`heartbeat`、保留 `tasks`/`log`/`goal`、**可复活 `/stop` 归档板**（`false → true`）；区分「ADR-009 显式命令接管 + selector + live 安全闸」vs「CODEX14 拒绝的隐式自动收养」（后者仍禁）。ADR-007 武装闸 + 其余 4 hook 一字不变；`/stop` 终态语义弱化为「显式可逆归档」。Source: 2026-06-15 resume-board 设计（fork #2/#4 用户拍板）。 |
| **ADR-010** | [two-sided pacing corridor](ADR-010-two-sided-pacing-corridor.md) | **Superseded by ADR-024** | pacing 从单边 ~75% 上限护栏改为双侧目标走廊（5h reset 落 ~70–90%，欠用侧轻推加速 / 临界侧轻推减速），7d 窗口当加速硬总闸；ADR-008 的账户权威用量口径是其加速侧决策的信号前置（非 refines）。**加速侧连同走廊 setpoint 被 ADR-024 翻转退役**（号池令单窗口欠用非真稀缺）。Source: Track B 行为 eval（欠 pace 探针下两 agent 相反决策）。 |
| **ADR-011** | [self-wakeup watchdog](ADR-011-self-wakeup-watchdog.md) | Accepted (partially narrows ADR-002) | Idle-wait watchdog: before a `wait` blocked on in_flight background tasks, arm a self-wakeup (CronCreate one-shot / ScheduleWakeup / Monitor / background-shell floor) so silent failures (hang / death / phantom — no completion event) get reconned. Layered on harness auto-re-entry (补盲区非替换). Unblocks ScheduleWakeup + local `CronCreate` for the watchdog (cloud routines / agent-teams still out); `wakeup` is a soft-observed flexible edge — hard waist untouched (红线2). Source: Finding #17/#46 + 2026-06-16 idle-self-wakeup 设计（用户开放 ScheduleWakeup/cron）。 |
| **ADR-012** | [parent waist + rollup-aware Stop gate](ADR-012-parent-waist-and-rollup-aware-stop-gate.md) | Accepted (扩展 ADR-003 waist 集合) | `tasks[].parent`（子→父单值指针）升入 narrow-waist，承载 nested（max depth=1）调度图——一个扁平节点集背两条正交边（`deps` 调度 / `parent` 容器）；Stop gate 变 rollup-aware（父任务完成度由子任务汇总）。加一个 pinned 字段，不推翻「窄腰 + silent-on-unknown」原则。Source: D3 nested-DAG 设计稿（用户拍板走 hook 感知 rollup 路）。 |
| **ADR-013** | [board v2 data model + unified CLI](ADR-013-board-v2-data-model-and-cli.md) | Accepted (演进 ADR-003；CLI 定位/零依赖/hook-require 被 ADR-014 修订) | board 从「被动 JSON + 各消费者各自 bash 解析 + 只钉一小撮 waist」演进到「完整 JS 数据模型 SSOT + 统一 CLI 访问层」：narrow-waist 三档建模（🔒 load-bearing / 👁 observed / ✎ flexible）、JS model SSOT、CLI 唯一写入关卡、bash hook 收编 node、轻量 advisory 锁。**CLI 的「内部访问层 + 零依赖纯 stdlib + hook in-process require」三点被 [ADR-014] 修订**（board 契约本身不变）。Source: v0.10.0 board 重构需求发现（Epic #27 等）。 |
| **ADR-014** | [CLI 解耦为独立产品](ADR-014-cli-decoupling-as-independent-product.md) | Accepted (修订 ADR-013 CLI 定位；进一步修订 ADR-002 ship-anywhere 口径) | `ccm` CLI 解耦为独立安装的产品/引擎（`@ccm/engine` TS SSOT），cc-master plugin 降为消费方之一（未来 desktop/web 平行消费）；plugin hooks/skills 经 **shell 调全局 `ccm` 二进制 + JSON 契约**访问 board、**绝不 import 引擎**（进程边界 = 红线1 新落点）；ship-anywhere 从「单件自包含 + 零依赖」改为「主机预置 per-OS Node SEA 二进制 + 进程边界」（「宿主 vs 模型后端」之分同 ADR-006）。红线 1/2/3/4/6 精神不变。Source: 2026-06-24 三次 CLI pivot（用户拍板）。 |
| **ADR-015** | [估算 + 配速引擎](ADR-015-estimation-and-pacing-engine.md) | Accepted（用户主导设计·2026-06-25 blessing）| `ccm` 扩成 **OR/ML 估算 + 配速引擎**：新增 `usage`/`estimate` **只读 advisory** namespace（ccm 出 verdict、orchestrator 决策·红线3）+ `baseline` 写 noun；**home 级跨板历史语料读**（超出单板·多层收缩 + recency + conformal）；算法层 **0 新 dep 全 hand-roll**、约束过滤现代 SOTA（双通道 Monte Carlo / conformal+Mondrian / EWMA+Bayesian ≅ RCF / Earned Schedule / SLE / CI-CRI-SSI / CCPM·重型 ML 逐条排除）；配速数学收口进引擎、`usage-pacing.js` hook shell-out + 优雅降级、`cc-usage.sh` 退役去 python3；`baseline`/task `model` 作 ✎ 非窄腰字段。演进 ADR-013/014、实现 ADR-010 走廊数学。Source: 2026-06-25 设计讨论（用户主导）+ 3 路现代 SOTA 调研（web-verified）。 |
| **ADR-016** | [board 框定 orchestrator 自主权限](ADR-016-board-scoped-orchestrator-authority.md) | Accepted（用户已 bless·2026-06-25）| board 新增可扩展 **`policy` 段**框定本块板 orchestrator 自主权限，首条 `autonomous_account_switch`（allow/deny）门控**自主换号决策**。强制力 = **纵深防御**（建议层 SKILL A 自律 + 机制硬闸 `switch-account.sh` 经进程边界 `ccm policy show --board <确定性目标板>` 校验·deny→拒+exit7+log·越界响亮）；新板默认 **allow（opt-out）**保 v0.8.0 现状；fail-open 分两类（codex round-6 P1 细化·§2.3）：真·无 ccm/无板上下文→allow，有目标板上下文却读不到/歧义→保守 deny exit7（堵「多 active board 下 deny 被 discovery-failure 绕过」）；写命令视权限**用户所有**（非 TTY 须 `--user-authorized`·SKILL A「绝不自授权」红线·board.log 审计·self-grant 防护）。`policy` 作 **✎ 非窄腰字段**（hook 不读·红线2 不破·hook 一字不动）+ 顶层 **`policy` 写 noun**（show/set·刻意置只读 namespace 外·同 baseline 定位）+ `FMT-POLICY` warn（规则全集 45→46）。诚实记账：agent 有 shell 故是纪律+审计、非硬锁。守红线 2/3/4/5/6 不变；复用 ADR-015 写 noun vs 只读 namespace 分界。Source: 2026-06-25「board 框定 orchestrator 自主权限」需求发现（用户拍板三决策）。 |
| **ADR-017** | [多-orchestrator 协调](ADR-017-multi-orchestrator-coordination.md) | Accepted（用户拍板·2026-06-29；§2.2 配速协调形态由 **ADR-032 Accepted** 演进）| 多块板同时活跃时的 orchestrator 间**协调感知层**：跨板**只读花名册**（`ccm peers` 读 verb·扫 home 全 active 板出 goal / owner / 进度，不抢锁）+ board 新增 ✎ `coordination` 块（agent-shaped·hook 不读·红线2 不破）。协调走**感知 + 板级优先级 + 机械 floor**（换号协调溶解进 LOADBAL 选号、配速协调走各板独立感知），**砍掉**显式通信通道（无 message-passing·避免分布式复杂度）。Source: 2026-06-29「多-orchestrator 协调」需求发现（用户拍板砍通信通道）。 |
| **ADR-018** | [hook→agent 标签注入协议](ADR-018-hook-agent-message-protocol.md) | Accepted（用户拍板·2026-06-29）| 立一套**标签化消息协议**约束所有 hook 往 agent context 注入的文本——洞察「没有中性注入，凡注入即潜移默化塑造行为」：三类 closed-set taxonomy（`<ambient source>` 背景·决策归 agent·最低力度但 ≠0 / `<advisory source strength="weak\|strong">` 建议·喂判断·agent 最终拍 / `<directive source>` 指令闸·决策归 system·绑定遵从 + why）+ 所有标签必带 `source`（可追溯）+ P1–P6 作者纪律（没有中性注入 / 默认 advisory 慎用 directive / 标签即承诺 / 力度配 stakes / directive 内含 why）。作者侧落 AGENTS.md §13、读者侧契约进 SKILL A（须先跑 pressure baseline）。纯文本注入·不动窄腰·不改武装闸（红线 1/2/5/6 不破）。Source: 2026-06-29「hook→agent 通信协议」需求发现（用户拍板 closed set）。 |
| **ADR-019** | [skill portfolio 重排](ADR-019-skill-portfolio-rework.md) | Accepted（用户拍板·2026-06-29）| 分发 skill 集 7→7：**退役** `account-management`（SKILL C·两 strong 形态〔A.2 选号配方 + B.1 token 命门〕均被 ccm `account` 引擎迁移塌缩 → 装饰）+ **新增** `pacing-and-estimation`（SKILL H·A.1 advisory 命令 schema + B.2 estimate 整轴 out-of-mind 触发召回·覆写 2026-06-26「做 A 的 reference」判定）+ 切 A/H 边界（决策锚 / 镜头留 A、消费机制抽 H·镜头 5/2 正文不删 + 决策程序 §(f) 牙齿不动）+ account 操作面归 D（command-catalog namespace account + `account-pool.md`·号池/选号/vault **实现**归 ccm `account` 引擎·换号决策锚下沉 A `cost-decisions.md`）+ `/cc-master:accounts` 命令**直接退役删除**（账号操作全归 `ccm account` CLI·用户直接敲·零增量零覆写 = 装饰）。退役 C 同删测它旧 bash 脚本的 6 个 plugin-side 测试 + 7 个 account mechanism 契约（机制已由 ccm CI 测）。hook 一字不动。Source: `design_docs/plans/2026-06-29-skill-portfolio-rework.md`（curating 设计闸 + Probe A/B）。 |
| **ADR-020** | [hook 经 ccm 写特定 ✎ board 字段](ADR-020-hook-writes-flexible-board-via-ccm.md) | Accepted（方向经用户拍板·2026-06-29）| 松绑 §12「hook 永不碰 board」这条 pre-ccm 保守默认——许可 hook 经 `ccm` 带锁字段级 setter 写特定 ✎（非窄腰）board 字段，受六硬约束框死（只写 ✎ `runtime.*` / 进程边界 spawn / 带锁 + lint / 武装后 + 确定性目标板 / ccm 缺优雅降级 / token-blind）。落地：`@ccm/engine` 新增 ✎ `board.runtime` + `FMT-RUNTIME` warn（规则 46→47）、`ccm board set-param <key> <value>` least-privilege scoped 写 verb（候选 B·收窄 `runtime.*`·白名单 + 值校验·走 runWrite 带锁）、首个写 board 的 hook `identity-nudge.js`（IDNUDGE 周期身份提示·Stop·写回成功才注入）、`using-ccm` 两份 reference 锁步。clobber 走**轻解**（hook 独占 `runtime.*` + agent 不写它 + board.md 一句澄清·非退役整文件 Write）。**narrow waist（红线2）一字不动**（runtime 是 ✎·hook 不读）·红线 1/4/5/6 不变。Source: `design_docs/plans/2026-06-29-periodic-prompt-and-board-params.md`（用户拍板 setter 候选 B + clobber 轻解）。 |
| **ADR-021** | [ccm install-presence 硬前置](ADR-021-ccm-install-presence-hard-precheck.md) | Accepted（方向经用户拍板·2026-06-30）| 把 `ccm`（ADR-014 主机前置）从「运行时静默降级才暴露」提升到「ARM 入口 fail-loud 硬前置」：`bootstrap-board.sh` 触发后建板前硬查 `command -v ccm`（`CCM_BIN` 覆写则 `[ -x ]`），缺则**拒 arm**（不建 board·不武装）+ 注 `<directive source="bootstrap">` agent-relay 提醒用户装 ccm + exit 0（不 `decision:block`·否则 agent 收不到 directive）。框定边界：bootstrap 硬查管「装没装」（二元·install presence·起点硬拦·用户可修），运行时 hook 软降级管「装了但这一下没响应」（瞬态·软扛·**绝不动**·不让一次抽风崩长程编排）。纯 bash `command -v`（红线1 floor·不 spawn ccm）·窄腰无关（缺 ccm 不建板）·红线6 不破（不武装→runtime hook 续休眠）·不破 ship-anywhere（只把既定前置提前 fail-loud·不新增依赖）；README×2 安装段改「ccm 必须先装」。Source: `design_docs/plans/2026-06-29-hooks-enhancements-v2.md` §3（用户拍三决策）。 |
| **ADR-025** | [board writes go through ccm only](ADR-025-board-write-guard-single-path.md) | Accepted（用户拍板·2026-07-01）| 新增 `board-guard.js`（PreToolUse·matcher `Write\|Edit\|MultiEdit\|Bash`）在工具**执行前** deny agent 直接 file-edit 本 home `boards/` 下 `*.board.json`（Write/Edit/MultiEdit 路径判定 deny·Bash sed/echo/tee 手改启发式偏假阴 deny·含 ccm 调用早放行）+ 注 `<directive source="board-guard">`（why + ccm verb），把「board 变更只走 ccm」从纪律硬化为机制（写关卡从 ccm 内部延到工具入口）；同 PR 删 skills 全部「ccm 缺则降级 Write」fallback（ADR-021 后 ccm 硬前置·前提已死）。dormant-until-armed（红线6·未武装静默放行）+ fail-open（异常静默放行·崩溃 guard 不卡死 agent）+ 只读窄腰判武装（红线2）+ node/JS only（红线1·复用 runHook）；board-lint 降为事后 backstop。**注：023/024 由并行在飞分支占号·本分支临时跳至 025·合并补齐。** Source: 2026-07-01 board-write-guard 需求。 |
| **ADR-026** | [done true semantics](ADR-026-done-true-semantics.md) | Accepted | `status=done` 的真完成语义升级为 `status=done && verified===true && artifact 非空`；`BIZ-DONE-VERIFIED` 从 reserved 激活为 hard invariant，`ccm` 写入关卡拒绝裸 done（exit 3）。`verified` / `artifact` 仍是 ✎ flexible 字段，不进 narrow waist，hooks 不直接依赖它们。Source: GitHub #32 true-done hard gate。 |
| **ADR-022** | [ccm 与 plugin 版本线解耦](ADR-022-version-line-decoupling.md) | Accepted（用户拍板方案 A·2026-06-30）| `ccm` 与 cc-master plugin 拆成**两条独立版本线**，非对称 tag 前缀区分（方案 A）：plugin 保留裸 `vX.Y.Z`（延续历史·手动门 + `CHANGELOG.md`·`plugin.json`/`marketplace.json` 归 plugin 线），ccm 改用 `ccm-vX.Y.Z`（changesets + CI·`ccm/apps/cli` 与 `ccm/packages/engine` `fixed` 锁步成单一 ccm 版本号）。`ccm-release.yml` 拆为只产 ccm 二进制（触发 `ccm-v*`）+ 新增 `plugin-release.yml` 只打插件 zip（触发 `v*`）；两 tag glob 天然互斥（`ccm-v…` 以 `c` 开头不撞 `v*`），零交叉触发。是 ADR-014 的自然 follow-up（解耦代码/分发后补上版本维度），兑现 `.changeset/README.md` 早已声明却未落地的「不共享版本号」意图。否决 B（对称前缀·裸 v 退役·churn 最大）/ C（路径式 `ccm/v*`·`/` tooling 坑）/ D（维持现状）。首个真实分叉：plugin `v0.10.1` / ccm `ccm-v0.11.0`（**不存在 `ccm-v0.10.0` 锚点**·旧合并式 `v0.10.0` 属 plugin 历史·§2.5）。Source: `design_docs/plans/2026-06-30-version-decoupling-strawman.md`。 |
| **ADR-024** | [single-sided pacing: switch/stop](ADR-024-single-sided-pacing-switch-stop.md) | Accepted（用户拍板·2026-07-01·supersedes ADR-010）| pacing 从双侧走廊翻转为**单侧（减速）+ 换号 + 停**：砍掉整个加速侧（号池令单窗口「欠用」非真稀缺——一次 `switch` = 新满血窗口，加速 advisory 反诱导 busywork）；新 verdict enum `{hold, throttle, switch, stop_5h, stop_7d}`（取代 `{accelerate, hold, throttle, hard_stop}`）；池感知 `pacingAdvice` 接 `predictPoolUsage`+`selectAccount`——临界+健康备号→`switch`、池温无逃逸→`throttle`（5h weak/7d strong）、全池撞墙（`selectAccount`=`NONE_ALL_EXHAUSTED`）→`stop_5h`/`stop_7d`（emit `nearest_reset` arm wakeup）；单账户 7d 到顶→`switch`（修旧 over-braking bug，只全池撞墙才停）；新 `PacingAdvice` 字段 strength/switch_candidate/stop_dimension/nearest_reset（引擎 emit·hook 直接消费）；换号写 ✎ `runtime.last_account_switch`（ADR-020 白名单第三键）+ Stop hook 注 `<ambient>` 通知；退役 hook ~200 行本地反推 fallback（ADR-021 硬前置→ccm 缺即静默）。**pressure baseline 2/2 Hold·RED 未复现**：翻转立在「加速 advisory 是 capable agent 必须 overrule 的冗余噪声 + 池态更该由 switch 服务」而非纪律危害修复；故**不新增 Rationalization-Table 行**（编造未发生的失败=违 iron law·Finding #82）。红线2/3（池聚合只在引擎·hook 不 import）/policy 硬闸（deny→exit7 仍在 ccm）/窄腰不动全保。Source: 本仓 pressure baseline + 已批准池感知设计。 |
| **ADR-028** | [hook parity contract + normalization](ADR-028-hook-parity-contract-and-normalization.md) | Accepted（用户拍板·2026-07-07·HOOKPAR-DEC）| 新增 `plugin/src/hooks/<hook>/CONTRACT.md`（7 个双端 `implemented` 业务 hook 各一份·host-neutral 业务规则 SSOT + 三分类学降级行为声明）+ `scripts/gen-hook-parity-matrix.sh`（生成只读 `design_docs/hook-parity-matrix.md`·接入 `run-tests.sh`）+ `hook-common.js` 最小归一化桥接（`normalizePayload`/`ctx.normalized`·纯附加只读字段·收敛在 `runHook` 单点·零业务行为变化）+ `tests/hooks/test_parity-fixtures.sh`（行为级 fixture parity test，首批覆盖 FUSE / `segmentTouchesRealBoard` / 握手 dedup）+ CONTRACT.md PARITY anchors 结构级检查（`tests/content/hook-injection-contracts.test.mjs`）+ `scripts/check-hook-parity-touch.sh`（PR-diff 存在性检查，未接入 run-tests.sh）+ AGENTS.md 新增「hook 双端锁步」纪律段。同 PR 修复四处 `host-convention-divergence`（codex 侧补 verify-board FUSE 熔断 + rollup 检查、对齐 board-guard bash 手改判定〔删兜底分支 + 补 `segmentTouchesRealBoard`〕、补齐 verify-board/board-guard/usage-pacing/identity-nudge 的 ADR-018 标签协议）+ `hooks.yaml` 的 `verify-board.host_coverage.codex` 陈旧标注纠正（`implemented-advisory`→`implemented-blocking`）。红线 1/2/5/6 不动。Source: `design_docs/plans/2026-07-07-hook-parity-system.md` + HOOKPAR-DEC 决策。 |
| **ADR-029** | [`ccm web-viewer` namespace](ADR-029-ccm-web-viewer-namespace.md) | Accepted（用户 scope change·2026-07-08·实现 WV12/WV13/WV8/WV29） | board web viewer 的正式入口改为 `ccm web-viewer`（不是 `ccm view`，也不是 `/cc-master:view` / `$cc-master-view`）；ccm owns home-scoped lifecycle（start/open/status/stop/restart + internal `serve --state`、`<home>/services/web-viewer/` service files、pid + `/_ccm/health` stale 检测、token redaction、restart 新 token、扫描 `<home>/boards/` 并在 viewer 内列出/切换 boards；`--board`/`--goal` 只设初始 selection，不按 board 创建独立 service）；viewer 继续只读、127.0.0.1、token-gated、viewer/data routes GET-only、零外网、无 board writes、路径 containment。旧 plugin command / Codex skill 与 plugin-era `view-server.js`/`view.html`/`vendor/` 已删除。Source: WV11-WEBVIEWER-DESIGN scope change。 |
| **ADR-030** | [`ccm status-report` generated report](ADR-030-ccm-status-report-and-viewer-module.md) | Accepted（WV15 impl·2026-07-08） | board status 从 prompt-time agent prose 迁到 `ccm status-report` 静态可程序化报告：`render` 纯计算、`write` 原子写 `<home>/reports/status-report/boards/*.status-report.json`、`show` 用户入口、`watch` 前台周期刷新；输出稳定 `ccm/status-report/v1` schema，freshness 由 `board_hash`/`topology_hash`/`advisory_hash`/`input_hash`/TTL 判定；web viewer board 页新增 Status module 读 `/status-report.json?board=<file>`；旧 `/cc-master:status` / `$cc-master-status` 正式入口直接删除（无 one-release shim）；全程只读 board、127.0.0.1/token/path-containment/零外网、不让 plugin import engine。 |
| **ADR-031** | [N-host capability parity](ADR-031-n-host-capability-parity.md) | Accepted（用户拍板·2026-07-09） | 将 ADR-028 双端 hook 锁步升为 **N-host**（claude-code \| codex \| cursor）：`required_hosts` / `host_coverage` / parity matrix 三列；新增跨 surface **Capability INTENT** 层（`design_docs/harnesses/capabilities/` + `gen-capability-parity-matrix.sh`）；降级三分类学不变；Cursor 双轨——Track A SAP/PHIP 1:1 + Track B 需求级替代（禁止沉默省略）；Accepted 时仅设计落盘 + manifest 占位，Cursor runtime 实现走 follow-on PR。Source: Cursor dual-track design plan。 |
| **ADR-032** | [deterministic pool arbiter + notification inbox](ADR-032-deterministic-pool-arbiter-and-notification-inbox.md) | Accepted（用户拍板·2026-07-09） | 否决 #66 点对点协商；演进 ADR-017 §2.2「独立推理」→「确定性池中介（关联均衡）+ `coordination.inbox`」：`owner.harness` 分区、`pacingAdvice` pool-aware、双投递（ephemeral 直注 / durable inbox）、`coordination-inbox` 只读 surface hook、本机 harness 注册表地基；窄腰不动；daemon-less 核心可跑。Source: #66 + 2026-07-09 设计稿。 |
| **ADR-033** | [`ccm monitor` advisory daemon + binary co-lifecycle](ADR-033-ccm-monitor-daemon.md) | Accepted（用户拍板·2026-07-09） | 可选建议型连续监控 daemon（补 idle 烧配额盲区）：Node 自管 detached + 可选 launchd/systemd；tick=registry→usage→pool arbitrate→边沿写 inbox；缺席时 ADR-032 hook 路径仍跑；复用 ADR-029 service 模式；**HARD：home 常驻服务（monitor + web-viewer）⟷ ccm 二进制同生命周期**——`ccm services reconcile --after-binary-replace` 挂 `upgrade ccm` / `install.sh`，start/status 自检 `binary_match`；修订 ADR-002/017 对 advisory daemon 的默认排斥。Source: 同设计稿 §14 / §14.6。 |
| **ADR-034** | [additive routed-task contracts](ADR-034-additive-routed-task-contracts.md) | Accepted（用户批准 cross-harness A–F·2026-07-10） | 保持 `cc-master/v2`/窄腰/`executor` 不变；以显式 activation epoch 激活 planning+routing 条件闸并 grandfather 历史 terminal，字段 tier 与 writer policy 分轴，dedicated bind 冻结 selection snapshot+append attempt+opaque handle claim+in-flight，generic setter/`--force` 不得绕过；真实 handle attestation 延后。 |

---

## 2. ADR naming

```
ADR-NNN-<slug>.md
```

- `NNN` — three-digit zero-padded incrementing number (001, 002, ...); no gaps, no
  reuse, no skipping.
- `<slug>` — short kebab-case topic (e.g. `hooks-pure-bash`).
- The frontmatter block must carry: `Status` (Proposed / Accepted / Superseded /
  Deprecated) + `Date` (YYYY-MM-DD) + `Scope` (blast radius) + optional `Source`
  (the finding / interview / design review that triggered the decision) + optional
  `Co-signed` (when a decision needs explicit sign-off).

---

## 3. Writing an ADR vs writing design_docs

| | ADR | design_docs |
|---|---|---|
| Nature | **Decision snapshot** — carries a timestamp, Status, and an explicit supersede chain | **Evergreen description** — the live current fact, edited freely |
| Answers | "why X and not Y" + "when may it be overturned" | "what it is now / how it works / where the boundary is" |
| Mutability | Immutable (unless explicitly superseded) | Evolvable (revised continuously) |
| Trigger | Structural decision, cross-file impact, may be overturned later | State description, reference material, runbook |

**Checklist before writing an ADR** (run through it once):

- [ ] Is this a **structural decision** (not a state description, not reference
      material, not a runbook)?
- [ ] Does the decision have a clear **X-vs-Y alternative**? No alternative = it is
      not a decision, it is the current state.
- [ ] Does it have **cross-file / cross-component impact**? Touching a single
      design_doc / spec = just edit that design_doc.
- [ ] Does it carry **potential supersession value** (some day a new stance may
      overturn it and you want to keep "why we chose this then")?
- [ ] **Don't write a "phase kickoff ADR"** — phase progress is reflected naturally
      by `design_docs/plans/` (gitignored) plus the concrete ADRs/design_docs.

Any No → file it in `design_docs/` instead; do not create an ADR.

---

## 4. When to write a new ADR — workflow

1. **Decide**: run the §3 checklist; confirm it is worth an ADR.
2. **Claim the number**: grep `adrs/ADR-*.md` for the latest number + 1 (no reuse /
   no skipping).
3. **Write**: follow the template below.
4. **Review** (if the decision needs sign-off): record co-signers in frontmatter.
5. **Cross-ref back**: update related design_docs / other ADRs to cross-reference
   the new ADR; keep the relevant evergreen SSOT in sync.
6. **Commit message**: `adr(NNN): <slug> — <decision summary>`.

### ADR template

```markdown
# ADR-NNN — <Topic>

> Status: **Proposed | Accepted | Superseded | Deprecated**
> Date: YYYY-MM-DD
> Scope: <blast radius — which hooks / skills / files this constrains>
> Source: <the finding / interview / design review that triggered it>
> Co-signed: <only if the decision needs explicit sign-off>

---

## 1. Context

<background / current pain / why we are deciding now>

## 2. Decision

<the decision itself — say "we choose X" plainly — split into subsections>

## 3. Consequences

### 3.1 Positive

### 3.2 Negative

### 3.3 Neutral

## 4. Alternatives Considered

### 4.1 Alternative A: <...>

### 4.2 Alternative B: <...>

## 5. Related

<other ADRs / design_docs / findings cross-referenced>

## 6. References

<external references / pattern sources>
```

---

## 5. Relationship to other SSOTs (cross-ref)

| Concern | Where |
|---|---|
| Repo-wide navigation + the six design invariants (red-line SSOT) | [`../AGENTS.md`](../AGENTS.md) |
| Contribution dev loop + invariant pointer | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Plugin spec (intentional exclusions in §12) | [`../design_docs/spec.md`](../design_docs/spec.md) |
| Dogfood findings ledger (the anti-pattern record many ADRs cite) | [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) |
| goal-hook design spec (ADR-004 detail) | [`../design_docs/2026-06-08-goal-hook-design.md`](../design_docs/2026-06-08-goal-hook-design.md) |
