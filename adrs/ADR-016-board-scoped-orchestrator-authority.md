# ADR-016 — board.policy：board 框定 master orchestrator 的自主权限（首条 = 自主换号）

> Status: **Accepted**（用户已 bless·2026-06-25）
> Date: 2026-06-25
> Scope: 新增 ✎ board 字段 `board.policy`（非 narrow-waist·hook 不读）+ `ccm` 新顶层 `policy` noun（`policy show` 只读 / `policy set` 写·自授权闸）+ `account-management` 的 `switch-account.sh` 加机制硬闸（读 active board policy）+ `orchestrating-to-completion`「绝不自授权」纪律段 + `using-ccm` 两份 reference 锁步（命令面 + board-model-guide，新增 `FMT-POLICY`·规则全集 45→46）。**hook 一字不动**（policy 是 ✎ 非窄腰、hook 不读它·红线2 不破）。
> Source: 2026-06-25「board 框定 orchestrator 自主权限」需求发现（用户拍板三决策：强制力模型 = 建议层 + 机制硬闸；新板默认 allow opt-out；policy 写为用户所有 self-grant 防护）。
> Co-signed: user (owner)

---

## 1. Context

cc-master 的 board 是 master orchestrator 的持久状态。今天 board 描述「这块板**有什么活、做到哪了**」（tasks / deps / cadence / baseline…），但没有任何字段描述「这块板的 orchestrator **被允许自主做什么**」。orchestrator 的自主边界全靠 SKILL A 的方法论纪律（镜头 7、step-6 ledger、红线 4「指挥不演奏」）在 prose 层约束——没有一个**随板持久、可被机制层校验**的权限声明。

第一个咬到这块空白的具体场景是**自主换号**。v0.8.0 起换号是「方案 A 无重启凭证覆写」：orchestrator 在 pacing 决策点（cost-and-pacing 的换号 lever）可以自主决定切到下一份配额，`switch-account.sh` 覆写 `$USER` 视角的官方共享凭证三存储 →**本机所有 claude session 一起切到新号**（不只本编排）。这是好处（pacing 口径变准），也意味着：

- 用户想把某块编排**锁死在某个账号上**（比如这是一块跑在专用号上、绝不能动别人配额的板）时，**没有任何开关能表达这个意图**。
- 换号是「换底层容量 + 覆写全局登录」的重动作（cost-and-pacing 把它列为最重的 lever、要求 surface 给用户拍板），但这条纪律只活在 prose 里——一个忘了规则、或在压力下把它合理化掉的 orchestrator，机制层**拦不住**它擅自切号。

需求因此是一个**可扩展的权限集合**——不是单个 bool，而是 board 上一组「框定 orchestrator 自主权限」的参数，首条是「是否允许自主换号」，未来可扩展到自主 merge、最大并行度、预算上限等。

设计张力（决定本 ADR 三个核心取舍的根）：

- **orchestrator-agent 有 shell 权限**。它能直接 `Bash` 跑任何脚本、能改任何它有权改的文件。OS 级硬沙箱在这个执行模型里**不可能**——任何「强制」本质上是纵深防御 + 让越界变响亮，不是密码锁。
- **一条「框定 orchestrator」的权限，若 orchestrator 自己能自由翻转，就形同虚设**——self-grant 是这类权限的天然攻击面（agent 在压力下「我先把它打开就能切号了」）。
- **换号的决策归 A、机制归 C**（红线 3）。policy 门控的是 A 的那个**决策**；机制硬闸不能让 C 变成「自己决定换不换」——它只是机制层的安全卫兵。

## 2. Decision

**在 board 上引入一个可扩展的 `policy` 段，框定本块板 master orchestrator 的自主权限；首条权限 `autonomous_account_switch` 门控「是否允许 orchestrator 自主换号」。** 强制力是**纵深防御**（建议层 + 机制硬闸），默认姿态 **allow（opt-out）**，写命令视权限为**用户所有**（self-grant 防护）。六条结构性子决策：

### 2.1 `board.policy` 是 ✎ agent-shaped / hook-blind / **非 narrow-waist** 字段（红线2 不破）

`policy` 作 board 顶层 **✎ flexible** 字段（与 `baseline` 同档），**hook 完全不读它**——它不进 ADR-003 的 narrow waist，hook 武装闸只读 `owner.active`/`owner.session_id`（不变）。可扩展对象，首条键：

```jsonc
"policy": {
  "autonomous_account_switch": "allow"   // "allow" | "deny"，缺省 = allow（向后兼容旧板）
}
```

未来扩展位（**仅作展望、本 ADR 不实现**）：`autonomous_merge`（自主 merge PR）、`max_parallel_agents`（并行 sub-agent 上限）、`budget_ceiling_h`（配额预算上限）……每条都是「框定 orchestrator 自主权限」家族的同形成员。新增键 = 加一条 ✎ 字段 + 一条 warn lint，**不动 hook、不动窄腰**。

**为什么不进窄腰**：hook 不需要读 policy（强制力落点是 `switch-account.sh` 的进程边界读，不是 hook）；进窄腰会把每条权限的增删都升格成跨全 hook 的契约改动（ADR-003 §3.2 的「窄腰是协调点」摩擦），与「可扩展权限集合」的设计意图相悖。policy 是 agent / 带外脚本经 `ccm` 读的，不是 hook 读的——天然属 ✎ 档。

### 2.2 强制力模型 = 建议层 + 机制硬闸（纵深防御）

policy 同时被两层读取，缺一不可：

- **建议层（SKILL A 自律）**：orchestrator 在换号决策点（cost-and-pacing 的换号 lever）先 `ccm policy show` 读 `autonomous_account_switch`；`deny` → 不自主换号、把「要不要换号」作 `blocked_on:"user"` 决策 surface 给用户。
- **机制硬闸（`switch-account.sh` 校验）**：`switch-account.sh` 在真正覆写凭证三存储**之前**，经进程边界 `ccm policy show --json` 读 active board 的 policy；`autonomous_account_switch == "deny"` → **拒绝切号、exit 7、打日志**（在 board.log 留痕「机制层拦下一次越权换号」）。哪怕 orchestrator 忘了规则 / 把建议层合理化掉，机制层也拦住、且**越界响亮**（loud failure，不是静默放行）。（实现注：本 ADR 设计初拟 exit 4 当 policy-deny 码，落地时发现 `switch-account.sh` 的 0–6 已被既有失败语义占用，故 policy-deny 专属码落 **exit 7**——具体码不承重，「deny→专属非零码 + 响亮 + log」的语义才是决策。）

两层一起 = 纵深防御。承认这**不是硬锁**（orchestrator 有 shell，理论上能 `--force` 或直接改文件绕过——见 §3.2）；价值在「让擅自换号从『一句合理化就成』变成『要主动绕过两道闸、且每次绕过都在 log 里响亮留痕』」。

**这不破红线 3（A=决策、C=机制）**：换号**决策**仍归 A（何时换、值不值、谁拍板）；机制硬闸只是**机制层的安全卫兵**——它不替 A 做「换不换」的决策，它只在 A（或一个忘了规则的 A）已经发起切号动作时，按 board 声明的权限拦截越权。C 不因此变成决策者，它仍是「被调用就执行 / 被 deny 就拒绝并报响」的机制。

### 2.3 新建 board 默认姿态 = allow（opt-out）

新板默认 `policy.autonomous_account_switch = "allow"`——保持 v0.8.0「方案 A 无重启换号」的现状（自主 pacing 换号是已有能力，不因引入 policy 而被默默关掉）。权限是**想锁某账号时才关掉的 opt-out 开关**：用户显式 `ccm policy set --autonomous-account-switch=deny` 才锁。

**缺省即 allow（向后兼容）**：旧板没有 `policy` 段，读取时 `autonomous_account_switch` 缺省解析为 `allow`——旧板行为一字不变（不引入沉默的行为回归）。`switch-account.sh` 读不到 policy（无 active board / ccm 缺失 / 字段缺）也**降级放行**（同既有「ccm 缺则优雅降级」模式·ADR-014）——deny 是显式声明才生效的硬闸，不是「读不到就保守拒绝」（那会把每个没接 ccm 的环境都误锁）。

### 2.4 命令面：新增顶层 `policy` noun（写 noun·刻意置于只读 namespace 之外）

`ccm` 新增一个与 `board`/`task`/`usage`/`estimate`/`baseline` 平级的顶层 `policy` noun：

- `policy show`（**只读**）—— 出当前 active board 的 policy（含「缺→allow」的解析后有效值）。
- `policy set --autonomous-account-switch=allow|deny`（**写**·走写关卡 + §2.5 自授权闸）。

**policy 是写 noun，刻意置于只读 `usage`/`estimate` namespace 之外**——与 `baseline` 的定位完全同构（ADR-015 §2.1：baseline 是唯一写 noun、刻意置于只读 advisory namespace 之外）。`usage`/`estimate` 是「advise 不 act」的只读引擎；policy `set` 是改 board 状态的**写**动作，归写关卡，不能混进只读 namespace 的纯度里。

### 2.5 policy 写为「用户所有」（self-grant 防护）

一条框定 orchestrator 的权限，若 orchestrator 能自由翻转就形同虚设。故 `ccm policy set` 写命令视权限为**用户所有**：

- **非 TTY 下必须带显式 `--user-authorized` 标记才能写，否则拒（exit 2）**。orchestrator-agent 在非交互（非 TTY）上下文跑命令——没有这个标记，它的 `policy set` 直接被命令面拒掉。标记的语义是「这次写是用户授权的」，把「翻转权限」从 agent 能顺手做的事，变成需要一个显式的、可审计的授权信号。
- **SKILL A 正文明令「绝不自授权」红线**——orchestrator 绝不自己加 `--user-authorized` 去翻 policy（那正是 self-grant）。这是纪律段（judgment-bearing prose），按 §6 TDD-for-skills 先跑 pressure baseline 再落。
- **board.log 记录每次 policy 变更**（谁、何时、从什么改到什么、是否带 user-authorized）——供用户审计。

**诚实承认这是纪律 + 审计、非硬锁**（agent 有 shell，理论上能伪造标记 / 直接改 board 文件）。但同 §2.2：价值在让 self-grant 从「一行命令」变成「要主动伪造一个用户授权信号、且每次都在 log 里留痕」——纵深防御的同一精神。

### 2.6 lint：新增 `FMT-POLICY`（warn·校验形状/枚举）

`@ccm/engine` 的 board-lint 新增一条 `FMT-POLICY`（**warn**）：`policy` 存在却非对象、或 `autonomous_account_switch` 存在却不在 `{allow, deny}` 枚举内 → warn。与 `FMT-BASELINE` 同档同形（✎ 字段的形状校验、坏形状 warn 而非 hard——缺省/缺失一律优雅降级为 allow，不拦写盘）。board-model-guide 的校验规则全集从 **45 → 46**。

## 3. Consequences

### 3.1 Positive

- **board 第一次能表达「这块板的 orchestrator 被允许自主做什么」**——一个随板持久、可被机制层校验的权限声明，补上 charter ③（自主决策 vs 寻求人类接入的边界）在 board 上的落点。
- **纵深防御让越权换号变响亮**——建议层 + 机制硬闸两道闸，一个忘了规则的 orchestrator 也会被 `switch-account.sh` 拦下 + log 留痕，而非静默切号。
- **opt-out 默认零回归**——新板 + 旧板都默认 allow，v0.8.0 自主换号现状一字不变；想锁时才关。
- **可扩展权限家族**——`autonomous_merge` / `max_parallel_agents` / `budget_ceiling_h` 等未来权限是同形成员，加一条 ✎ 字段 + warn lint 即可，不动 hook、不动窄腰。
- **self-grant 防护 + 审计轨迹**——`--user-authorized` 闸 + 「绝不自授权」红线 + board.log 留痕，让翻转权限成为显式可审计动作。

### 3.2 Negative / 代价

- **不是硬锁（诚实记账）**——orchestrator 有 shell，理论上能 `--force` 越机制闸、伪造 `--user-authorized`、或直接改 board 文件绕过全部。强制力本质是纵深防御 + loud failure，不是不可破的密码锁。这是 cc-master 执行模型（agent 有 shell）的固有边界，由本 ADR 显式承认、不假装解决。
- **机制硬闸引入 C→ccm 的进程边界读耦合**——`switch-account.sh` 多一次 `ccm policy show --json` 调用。缓解：ccm 缺则降级放行（同 ADR-014 既有优雅降级），不新增硬依赖；读失败 fail-open（不把没接 ccm 的环境误锁）。
- **新增一个 ✎ board 字段 + 一个命令 noun + 一条 lint 规则** → 同 PR ripple `using-ccm` 两份 reference（红线 §6 锁步），漏一处则手册骗人。
- **「绝不自授权」是纪律型 prose，靠 pressure baseline + 审计守护，非 grep 能拦**——与红线 4「指挥不演奏」同类的行为型约束，存在被合理化的残余风险（由 board.log 审计兜底）。

### 3.3 Neutral

- **红线全保**：红线 1（机制闸进带外脚本 / 命令面，不进 hook）、红线 2（policy 是 ✎ 非窄腰，hook 不读、ADR-003 一字不动）、红线 3（A=换号决策、C=换号机制 + 机制层安全卫兵，policy 门控 A 的决策、机制闸不替 A 决策）、红线 4（self-grant 防护是「指挥不越权」的延伸：翻转自己的权限边界 = 不可逆/越权动作，须用户授权）、红线 5（带外脚本 + 进程边界，ccm 缺则降级，不破 ship-anywhere）、红线 6（hook 一字不动、武装闸不读 policy）。
- **policy 与 baseline 同构**——✎ 顶层字段 + 专属写 noun + warn lint + 刻意置于只读 namespace 之外，复用 ADR-015 已确立的「写 noun vs 只读 advisory namespace」分界，无新结构发明。
- **换号 lever 的 pacing 数学不变**——ADR-010 双侧走廊 / 7d 总闸 / effective-N 一字不动；policy 只是在「decide to switch」这个决策点前加一道权限闸，不改 pacing 怎么算。

## 4. Alternatives Considered

### 4.1 Alternative A：advisory-only（只在 SKILL A prose 约束，无机制闸）

只在 SKILL A 写「deny 时绝不自主换号」，不给 `switch-account.sh` 加校验。**拒**——这正是 §1 的痛点：纯 prose 纪律拦不住一个忘了规则 / 在压力下合理化掉它的 orchestrator，越权换号会静默发生。机制硬闸（建议层之外的第二道）是让越界响亮的关键；少了它，policy 形同一句没牙的建议。纵深防御 = 建议层 **+** 机制闸，缺一不可。

### 4.2 Alternative B：deny-by-default（新板默认锁、opt-in 才放开）

新板默认 `deny`、用户显式开启才能自主换号。**考虑过，但选 allow**——deny-by-default 会**默默关掉 v0.8.0 起已有的自主 pacing 换号能力**，引入沉默的行为回归（一个升级到新版的用户，他的编排会突然不再自主换号、且不知道为什么）。allow-as-default（opt-out）保持现状、把 policy 定位为「想锁时才关的开关」，符合「不因引入新机制而默默改变既有行为」的最小惊讶原则。安全侧由「deny 是显式声明才生效的硬闸 + self-grant 防护」承接，而非靠默认锁死。

### 4.3 Alternative C：policy `set` 写进只读 `usage`/`estimate` namespace

把 policy 命令塞进 advisory namespace。**拒**——`usage`/`estimate` 是 ADR-015 确立的「advise 不 act」纯只读引擎；policy `set` 是改 board 状态的**写**动作，混进去会破坏只读 namespace 的纯度（同 ADR-015 §4.6 拒绝「baseline 写进只读 namespace」）。policy 与 baseline 同为写 noun，置于只读 namespace 之外、走写关卡。

### 4.4 Alternative D：把 policy 设为 hook-read narrow-waist 字段

把 `policy` 升入 ADR-003 窄腰、让某个 hook 读它来 block 换号。**拒（非必要）**——强制力落点是 `switch-account.sh`（带外脚本，本就在换号路径上），不是 hook；hook 没有「拦截一次 Bash 跑 switch-account.sh」的能力（红线 4：hook 感知不替主线做调度），让 hook 读 policy 既无机制收益、又把每条权限的增删升格成跨全 hook 的窄腰契约改动（ADR-003 §3.2 摩擦）。policy 留 ✎ 档、由 `switch-account.sh` 经进程边界读，是更小、更对的落点。

## 5. Related

- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) — `policy` 是 ✎ flexible 字段，**不进窄腰**，hook 不读；ADR-003 一字不动（同 ADR-007/009/012/015 守窄腰的姿态）。本 ADR §2.1 / §4.4 是「为什么不进窄腰」的论证。
- [`ADR-015-estimation-and-pacing-engine.md`](ADR-015-estimation-and-pacing-engine.md) — `policy` noun 复用 ADR-015 确立的「写 noun（baseline）vs 只读 advisory namespace（usage/estimate）」分界（§2.4 / §4.3）；policy 与 baseline 同构（✎ 顶层字段 + 专属写 noun + warn lint）。
- [`ADR-010-two-sided-pacing-corridor.md`](ADR-010-two-sided-pacing-corridor.md) — policy 门控的是 cost-and-pacing 换号 lever 这个**决策**；ADR-010 的双侧走廊 / 7d 总闸 / effective-N pacing 数学不变，policy 只在「decide to switch」前加权限闸。
- [`ADR-014-cli-decoupling-as-independent-product.md`](ADR-014-cli-decoupling-as-independent-product.md) — 机制硬闸经**进程边界** `ccm policy show --json` 读 board（绝不 import 引擎）+ ccm 缺则优雅降级，沿用 ADR-014 的进程边界 + 降级模式。
- `account-management` skill — 换号**机制**的 SSOT；`switch-account.sh` 的 policy 机制硬闸是机制层的安全卫兵（不破红线 3：换号决策仍归 `orchestrating-to-completion`）。
- [`../AGENTS.md`](../AGENTS.md) §3 红线 2（窄腰）/ 红线 3（A=决策、C=机制）/ 红线 4（指挥不演奏·self-grant 防护是其延伸）/ 红线 §6（`ccm` ⟷ `using-ccm` 锁步）。
- evergreen 实现计划（schema / 命令面 / 强制力流程 / lockstep / fixture / 实现排序）：`../design_docs/plans/2026-06-25-board-policy.md`。

## 6. References

- 纵深防御（defense in depth）/ loud failure 设计原则——强制力对一个有 shell 的 agent 不可能是硬锁，只能是「多道闸 + 越界响亮 + 审计留痕」的纵深防御；与红线 4「gate-green ≠ passed」、cost-and-pacing「换号是最重的 lever、surface 给用户拍」同精神。
- self-grant / privilege-escalation 防护——一条约束主体的权限若主体自己能翻转即失效，故 policy 写权归「用户所有」（`--user-authorized` 闸 + 「绝不自授权」红线 + 审计轨迹），是最小权限 + 审计的常规落点。
