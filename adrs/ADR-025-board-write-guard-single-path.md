# ADR-025 — board writes go through ccm only：PreToolUse board-guard 硬化单一写路径

> Status: **Accepted**（方向经用户拍板·2026-07-01）
> Date: 2026-07-01
> Scope: 新增 `hooks/scripts/board-guard.js`（PreToolUse hook·matcher `Write|Edit|MultiEdit|Bash`）拦截 agent 直接 file-edit 本 home `boards/` 下的 `*.board.json`，把「board 变更只走 `ccm`」从**纪律**硬化为**机制**；同 PR 删 skills 里所有「ccm 缺则降级 Write/Edit 手改」的 fallback 指导（ADR-021 后 ccm 已硬前置·fallback 前提已死）。dormant-until-armed（红线6·未武装静默放行）+ fail-open（异常静默放行·崩溃 guard 绝不卡死 agent）+ 只读窄腰判武装（红线2）+ node/JS only（红线1）。
> Source: 2026-07-01「board-write-guard」需求（把 ADR-013 写入关卡 + ADR-021 硬前置的既有意图在**工具入口**兜死）。
> Co-signed: user (owner)

---

## 1. Context

board v2（ADR-013）把 `ccm` 立为 board 数据模型的**唯一写入关卡**：持锁 / 落盘前校验 FMT·GRAPH·BIZ 不变式 / 守状态机转移 / 盖 derived 字段。ADR-021 进一步把 `ccm` 提升为**硬安装前置**——`bootstrap-board.sh` 缺 ccm 直接拒 arm，故一场已武装的 orchestration 里 `ccm` **必然在**。

但「只走 ccm」此前仍只是 **prose 纪律**：SKILL A / using-ccm 反复叮嘱「首选 ccm、别手改」，可 agent 在压力下（「就改一个字段、`Write` 更快」）随时能把它合理化掉——直接 `Write`/`Edit` 整个 board 文件，或用 `Bash`（`sed`/`echo`/`cat >`）手改。手改**绕过全部四道写关卡**，会静默腐蚀 deps 图 / 状态机转移 / 窄腰，让下游（viewer / resume / hooks）读到谎，且大多不报错、只在 resume 或 viewer 冻结时才现形。

更糟的是，多处 skill prose 还**主动给了这条错路**：以「`ccm` 缺则降级 `Write`/`Edit` + 手动 lint」的形态写进纪律。这套 fallback 的前提（ccm 可能没装）在 ADR-021 之后**已死**——ccm 缺则根本不 arm，agent 不会遇到「没 ccm、只好手改」。留着这些 fallback 指导等于给合理化背书。

**这是个入口盲区**：写关卡在 `ccm` 内部（落盘前），但 agent 有 `Write`/`Edit`/`Bash` 工具可以从**关卡外面**直接改文件。PostToolUse board-lint 只在**事后**软提示（编辑已落盘、撤不回）。缺一道**执行前**的硬闸把手改从源头挡住。

## 2. Decision

新增 **`board-guard.js`（PreToolUse hook）**，在工具**执行前**拦截并 **deny** 直接 file-edit 目标 board 的调用；同 PR 删掉所有「降级 Write」fallback prose。

### 2.1 拦什么（Gate 1·工具/路径判定）

- **`Write`/`Edit`/`MultiEdit`**：读 `tool_input.file_path`，`path.resolve` 后落在 `<home>/boards/` 下且 basename 以 `.board.json` 结尾 → **deny**（纯字符串判定·无需读文件内容·同 board-lint 的路径闸口径）。
- **`Bash`**：解析 `tool_input.command`——shell 写检测**不可判定**（解析任意 shell 找输出重定向 / 原地改写不可靠），故走**启发式·best-effort·偏假阴**：命令**同时**含 `.board.json` 路径**与**一个写操作符（`>`/`>>`/`sed -i`/`tee`/`cp`/`mv`/`dd`/`truncate`）才 deny；**命令含 `ccm` 调用则早放行**（绝不拦 ccm 自己去写 board）。漏网的 Bash 手改由 PostToolUse board-lint 事后兜（软提示）。

### 2.2 怎么 deny（PreToolUse 硬阻断 + directive）

PreToolUse 可硬阻断：输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":<reason>}}`。`reason` 包成 `<directive source="board-guard">`（ADR-018 §13·真硬闸用 directive·内含 why + fix）：说明手改绕过写关卡会静默腐蚀 board，并点名该改用哪个 `ccm` verb（status→`task start|done|block|set-status`；字段→`task update --set`；deps→`--add-dep/--rm-dep`；新任务→`task add`；板级→`board update`）。

### 2.3 六道约束（与 ADR-020 hook-writes-board 同框，但本 hook 只 deny·不写 board）

- **红线6 dormant-until-armed**（Gate 0）：`arm:'custom'` + body 顶部 `isArmed(HOME_DIR, sid)`，**未武装一律静默放行**——普通非编排 session 必须能自由 `Write`/`Edit` 任意文件（含碰巧叫 `*.board.json` 的）。
- **红线2 只读窄腰**：只读 `owner.active`/`owner.session_id` 判武装（复用 hook-common `isArmed`），deny 判定纯靠 `tool_name` + 路径字符串 + Bash 启发式，**绝不读 / 写 board 内容**。
- **红线1 node/JS only**：复用 `hook-common.runHook` harness，纯 stdlib（`path`），零 spawn jq/python，零网络，零依赖。
- **fail-open**：全裹在 runHook 的 try/catch，任何异常 → 静默 exit 0（放行）。**崩溃的 guard 绝不能卡死 agent**——这与其余 hook 的 fail-silent 同纪律，但方向是「放行」而非「静默」（一道拦截闸崩了宁可漏拦，绝不误锁工具）。
- **运行时路径识别**：`boardsDir(resolveHome())` 认 board 目录（honors `$CC_MASTER_HOME`，否则 `$CLAUDE_CONFIG_DIR/cc-master/boards`）——**绝不写死**。
- **bootstrap 豁免不受影响**：`bootstrap-board.sh` 经 `ccm` 建板、不走 `Write` 工具，与本 guard 零冲突。

## 3. Consequences

### 3.1 Positive

- 「board 变更只走 ccm」从**能被合理化掉的 prose 纪律**升级为**工具入口硬闸**——写关卡从「ccm 内部（关卡里面）」延伸到「工具调用前（关卡外面也堵死）」，agent 想手改也改不动。
- 删掉全部「降级 Write」fallback prose，消除 ADR-021 后已死的错路指导，纪律不再自相矛盾。
- 与 PostToolUse board-lint 形成纵深：PreToolUse guard 挡结构化 Write/Edit（可靠）+ 明显 Bash 写（启发式）；board-lint 事后兜漏网 Bash 手改（软提示）。

### 3.2 Negative

- **Bash 启发式偏假阴**：shell 写检测不可判定，刁钻的手改形态（变量拼路径、heredoc、间接 eval）绕得过 guard——由 PostToolUse board-lint 事后软提示兜底，非硬保证。诚实记账：guard 挡「明显的手改」，非「一切手改」。
- 多一道 PreToolUse hook（挂 `Write|Edit|MultiEdit|Bash`·高频事件）——但未武装即静默早退（isArmed 一次目录扫描），开销可忽略。

### 3.3 Neutral

- 窄腰一字不动（guard 只读 `active`/`session_id` 判武装·不写 board）——红线2 不破。
- `CC_MASTER_AUTOSWITCH` 式 kill-switch 未设：guard 是安全闸、不该有随手关的开关；真要绕过（如 dev 调试）可 `/stop` 解除武装。

## 4. Alternatives Considered

### 4.1 Alternative A：只靠 PostToolUse board-lint（现状 + 不加 PreToolUse）

board-lint 是**事后**软提示——编辑已落盘、撤不回，坏 board 已经写进真相源、下游可能已读到谎。它检测「写坏了」，不阻止「写」。要把「只走 ccm」兜死，必须在**执行前**硬闸。**否决**：事后检测 ≠ 事前阻断。

### 4.2 Alternative B：ccm `--set` 拒绝 unset / 收窄 ccm 写口

收窄 ccm 自己的写命令挡不住**绕过 ccm 的手改**——问题恰恰是 agent 用 `Write`/`Bash` 从 ccm 外面直接改文件，ccm 根本不在这条路径上。**否决**：管不到工具入口。

### 4.3 Alternative C：arm-but-warn（注 advisory 提醒但放行手改）

board 完整性是硬约束（写坏了下游全崩），不是「顺手权衡」的 advisory——这正是 ADR-018 P4「硬约束才 directive」的落点。放行手改 = 把硬约束降格成建议。**否决**：stakes 配 directive/deny，非 advisory/warn。

## 5. Related

- [ADR-003](ADR-003-board-narrow-waist.md) — 窄腰契约（guard 只读 `active`/`session_id`·不碰 agent-shaped）。
- [ADR-013](ADR-013-board-v2-data-model-and-cli.md) — ccm 立为唯一写入关卡（本 ADR 把它延伸到工具入口）。
- [ADR-014](ADR-014-cli-decoupling-as-independent-product.md) — 进程边界（guard 不 import 引擎·纯 path 判定）。
- [ADR-018](ADR-018-hook-agent-message-protocol.md) — deny reason 用 `<directive source="board-guard">`（硬约束·含 why + fix·P4/P5）。
- [ADR-020](ADR-020-hook-writes-flexible-board-via-ccm.md) — hook 写 board 的六约束框（本 hook 同框但只 deny·不写）。
- [ADR-021](ADR-021-ccm-install-presence-hard-precheck.md) — ccm 硬前置（fallback 前提已死·本 ADR 删「降级 Write」prose 的依据）。
- [ADR-007](ADR-007-hook-arming-gate.md) — dormant-until-armed（Gate 0）。

## 6. References

- Claude Code PreToolUse hook `permissionDecision:"deny"` 契约（执行前硬阻断工具调用）。
