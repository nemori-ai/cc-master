# ADR-024 — pacing 从双侧走廊翻转为单侧（减速）+ 换号 + 停

> Status: **Accepted**
> Date: 2026-07-01
> Scope: pacing 引擎数学 `ccm/packages/engine/src/usage/pacing.ts` + `usage advise` handler + `hooks/scripts/usage-pacing.js` + `runtime.last_account_switch` + skills `pacing-and-estimation`/`using-ccm`
> Source: 本仓 pressure baseline（2/2 Hold·RED 未复现）+ 已批准的池感知设计

---

## 1. Context

ADR-010 把 pacing 从「单边上限护栏」升级为**双侧目标走廊**：5h reset 目标落 70–90% 区间，**欠用侧轻推加速** + 临界侧轻推减速，7d 窗口当加速硬总闸。走廊的加速侧建在一个单账户世界模型上——「5h 窗口没用满的额度 reset 那刻永久蒸发」，故欠用 = 一种容量失败（浪费），该轻推加速去填。

但 cc-master 早已不是单账户世界：号池（`ccm account`·ADR-016 的 policy 门控 + ADR-019 的 account 操作面）让「换到下一份配额」成为一个一等动作。在一个**多账户池**里，单窗口「欠用」**不是真的稀缺**——一次 `ccm account switch` 就换来一个全新的满血 5h 窗口。加速侧的两个前提因此都塌了：

- **(a) 不是需要的护栏**——欠用不再意味着「额度将不可逆蒸发、必须现在烧掉」；池里有备号时，蒸发的那份额度可以由「有真活时换号消费下一份配额」承接，无需在当前窗口填。
- **(b) 反诱导 busywork**——加速 advisory 把「填满正在蒸发的窗口」呈现为一个待办，诱导 agent **制造 busywork** 去填——而这正是 SKILL A（镜头 4 / 指挥不演奏 / no-busywork）本就明令禁止的反模式。

**pressure baseline（§6 TDD-for-skills·诚实记录）**：翻转「砍加速侧」这个决策前，我们对它跑了 subagent pressure baseline——2 runs、capable Opus-class 模型、三压（time + sunk cost + exhaustion）、强制 A/B/C 三选一、与本仓 skill 隔离。**两次都选 Hold**：agent **主动 overruled** 加速 advisory，明确推理「有号池时一次 switch 就是新窗口，故单窗口欠用不是真稀缺」+「为填走廊而加速是 manufacture busywork（正是那条反模式）」。即 **RED 未复现**（pressure-testing.md §9 强模型天花板：capable 模型在单个决策点自推出有纪律的选择）。

这个 baseline 结果**翻转了翻转的理由**：砍加速侧**不是**作为一个「纪律危害修复」（no-busywork 纪律已在 SKILL A 承重、压力下守住了），而是立在两条别的地基上——(a) 加速 advisory 是 capable agent 必须**浪费 cycle 去 overrule** 的冗余/误导噪声；(b)「欠用-带池」这个态在架构上更该由 `switch`（有真活时消费下一份配额）服务，而非编造工作去填。因为 RED 未复现，**不发明任何新的 judgment-bearing skill prose / Rationalization-Table 行**（那会是编造一个未发生的失败 = skillsmith iron law 下的谎）；本次改动主要落在引擎 + reference 词汇。

## 2. Decision

把双侧走廊翻转为**单侧（减速）+ 换号 + 停**模型：**砍掉整个加速侧**，把「配额吃紧」的响应从「减速 vs 加速」重构为**池感知的三态**——能换号则换号、换不动则减速、全池撞墙则停。

### 2.1 新 verdict enum：`{hold, throttle, switch, stop_5h, stop_7d}`

`pacing.ts` 的 verdict 从旧 `{accelerate, hold, throttle, hard_stop}` 换为 `{hold, throttle, switch, stop_5h, stop_7d}`：

- **`accelerate` 整个删除**——不再有任何「欠用 → 加速」路径（§1 的池感知论证 + baseline）。欠用侧从「轻推加速」变为「无 verdict / hold」——capable agent 本就在这个态自推出正确行为（继续手上的真活、或有真活可派时自然消费配额），不需要 hook 塞一条待办。
- **`hard_stop` 拆成 `stop_5h` / `stop_7d`**——旧模型把 7d 撞墙笼统当一个 hard_stop；新模型区分**短停**（5h 窗口撞墙、`stop_5h`）与**长停**（7d 窗口撞墙、`stop_7d`），两者停的时长量级不同，且各自 emit `nearest_reset`（epoch sec）让 agent 能 arm 一个 wakeup 精确等到 reset。
- **`switch` 新增**——配额吃紧但池里有健康备号时，verdict 是「换到下一份配额」而非「减速」（§2.3）。
- **`hold` / `throttle` 保留**——hold = 在走廊内 / 无信号，无动作；throttle = 配额吃紧但换不动（§2.3），沿用减速语义。

### 2.2 池感知 verdict：引擎接 `predictPoolUsage` + `selectAccount`

verdict 不再只看当前账户的单窗口 `used%`，而是**池感知**：`pacingAdvice` 把 `predictPoolUsage`（对池的冻结备份投影）+ `selectAccount`（选哪个备号 / 全池是否耗尽）接进来。**池聚合只在引擎里做**（红线2/3：hook 不聚合、不 import 引擎，只 shell-call `ccm`）。engine 出 verdict、orchestrator 决策（红线3 · ADR-015 只读 advisory 分界）。

### 2.3 吃紧的三分：`switch`（有健康备号）/ `throttle`（池温但无逃逸）/ `stop`（全池撞墙）

配额临界时，verdict 由 `selectAccount` 的结果三分：

- **临界 + 有健康可切备号** → **`switch`**：轮到下一份配额（不减速）。emit `switch_candidate`（目标号 email）。
- **临界 + 池温（无健康逃逸号）** → **`throttle`**：减速。strength 分窗口——5h 侧 `weak`（临界轻推）、7d 侧 `strong`（跨窗口透支更硬）。
- **全池撞墙**（`selectAccount` 返回 `NONE_ALL_EXHAUSTED`·**权威锚**：这次 switch 尝试**本身**就是探针，全池确实无逃逸时它会如实返回此哨兵）→ **`stop`**：拆 `stop_5h`（短停）/ `stop_7d`（长停），emit `nearest_reset`（epoch sec）让 agent arm wakeup。

### 2.4 7d 单账户撞墙 → `switch`（不再 `stop`）——原则④

旧模型一个 over-braking bug：**单个账户的 7d 撞墙**会产出 `hard_stop`（整个停）。新模型纠正：**池里某单账户的 7d 到顶 → `switch`**（换到另一份还有配额的号），**只有全池撞墙**（`selectAccount` = `NONE_ALL_EXHAUSTED`）才 `stop`。这是原则④——「一份配额到顶」是换号信号、不是停机信号；只有「全池无逃逸」才是真的容量终点。

### 2.5 新 `PacingAdvice` 字段（引擎 emit·hook 直接消费）

`PacingAdvice` 新增四字段，引擎算好、hook 直接读用（hook token-blind、不重算）：

- **`strength`**（`'weak' | 'strong'`）——ADR-018 force mapping，引擎按 stakes emit（5h 临界 weak / 7d 透支 strong），hook 直接把它填进 `<advisory strength="…">`（不在 hook 侧判 stakes）。
- **`switch_candidate`**（email | null）——`switch` verdict 时的目标备号。
- **`stop_dimension`**（`'5h' | '7d' | null`）——`stop` 是短停还是长停。
- **`nearest_reset`**（epoch sec | null）——`stop` 时最近的 reset 时刻，供 agent arm wakeup。

### 2.6 换号通知：`runtime.last_account_switch` ambient

换号发生后 agent（含**手动换号**的情形）需知道「刚换过号、现在这份配额是新的」。落地：

- `ccm account switch --json` 返回换入号的投影配额；switch handler 写 ✎ `board.runtime.last_account_switch`（ISO 时间戳）——ADR-020 的 `runtime.*` 白名单**新增这个键**，经 `ccm board set-param` 带锁写（复用 ADR-020 的 least-privilege scoped setter + `FMT-RUNTIME` warn + `using-ccm` 锁步·同 `last_identity_remind` / `last_critpath_remind` 的同形扩展）。
- Stop hook 每回合读它，若较上次注入有更新则注入一条 **`<ambient source="usage-pacing">`**（ADR-018·背景类·决策归 agent），让 agent（及手动换号 case）得知换号已发生、更新世界模型。

### 2.7 退役 hook 本地反推 fallback（~200 行）

`usage-pacing.js` 里那条 ~200 行的**本地反推 fallback**（从 JSONL 反推 5h 窗口 `used%`）**退役**：ADR-021 已把 `ccm` 定为硬前置。新降级语义——**ccm / sidecar 不可用时 hook 直接静默**（exit 0、不注入、不 block），**不**再拖入带外 `cc-usage.sh`。这与 ADR-010 时代「反推路径禁加速、只留减速」的补丁一起被更干净地取代：不再维护一条会失真、还得为它写「反推路径禁 X」特例的第二信号路径。

### 2.8 红线保全

- **红线2/3**——池聚合（`predictPoolUsage` / `selectAccount`）**只在引擎**；hook 只 shell-call `ccm`、**绝不 import** `@ccm/engine`；新状态落 ✎ `runtime.*`（非窄腰·hook 武装闸不读）。窄腰一字不动。
- **红线（policy 硬闸）**——hook **不读 policy**；`switch` 的 policy 授权（`deny → exit 7`）硬闸仍在 `ccm account switch` 引擎里（ADR-016）。verdict 出 `switch` ≠ 越过 policy——真正切号仍过引擎的 policy 闸。
- **红线1/5/6**——hook 仍 bash+node/JS、进程边界 shell-call、dormant-until-armed；ccm 缺优雅降级（现在是干净静默，比旧反推更 ship-anywhere 诚实）。

## 3. Consequences

### 3.1 Positive

- **不再有诱导 busywork 的加速 advisory**——capable agent 不必再浪费 cycle 去 overrule 一条它本就该拒的建议；欠用态回归「continue real work / 有真活则自然消费」的沉默默认。
- **池感知的正确响应**——配额吃紧优先 `switch`（消费下一份配额）而非无脑减速；只有池温无逃逸才 `throttle`、只有全池撞墙才 `stop`。资源利用与 no-busywork 两条诉求同时兑现。
- **修掉单账户 7d over-braking bug**（§2.4）——一份配额到顶不再误停整个编排。
- **停机更可操作**——`stop_5h`/`stop_7d` 分短长停 + `nearest_reset` 让 agent arm wakeup 精确等 reset，而非笼统 hard_stop。
- **换号通知闭环**（§2.6）——含手动换号在内，agent 都能经 ambient 得知「刚换过号」，世界模型不失同步。
- **信号路径更干净**——退役 ~200 行本地反推 fallback，不再维护一条失真的第二路径 + 它的一堆特例补丁；ccm 缺失即诚实静默（对齐 ADR-021 硬前置）。
- **双窗口对称硬闸兜住 `switch`/`stop` 的正确性**（`selectAccount` 补丁·集成评估 a9b573c）——`switch`/`stop` verdict 锚在 `selectAccount` 的 candidate / `NONE_ALL_EXHAUSTED` 判定，而 `selectAccount` 原来只用**单窗口（7d）硬闸**、5h 仅软权重：会切到一个 `5h=99% / 7d 健康` 的号（落地即撞 5h 墙），且全池 5h 墙 + 7d 健康时不返 `NONE_ALL_EXHAUSTED`（该 `stop` 却空切）。补成**对称硬闸**——`5h≥90%`（`CCM_SELECT_5H_HARD_GATE`·激进侧让短窗快回血烧满点·**非 95**：95/5% buffer 是估算 p95 预测区间约定、非 switch gate）∨ `7d≥85%`（`CCM_SELECT_7D_HARD_GATE` 不变）任一逼顶即 gated，令「candidate ⟺ 双窗口都健康」「`NONE_ALL_EXHAUSTED` ⟺ 无双窗口健康号」。判「逼顶」用 reset 恢复后的 used%（刚过 reset 回血的号不误杀）。这令 §2.3 的三分 / §2.4 的「7d 单号→switch」自动闭合：`switch` 目标现在保证双窗口都有余量、`stop`（全池撞墙含 5h 墙侧）不再空切到一个落地即撞墙的号。

### 3.2 Negative（诚实天花板，必须写明）

- **账户口径无绝对分母**——沿 ADR-010 §3.2 天花板：账户权威给 `used_percentage`/`resets_at` 但**不给绝对 token 分母 + 不给权威 burn rate**。故 `switch`/`stop` 仍是**方向性**判断，不是精确闭环——「临界」「吃紧」是区间信号，不是「还剩 X token」的精确账。
- **`predict` 是保守估计**——`predictPoolUsage` 用的是冻结备份投影（换号那刻的配额快照 + 投影），非实时权威 burn；它系统性偏保守（宁可早报吃紧），不承诺精确。
- **全池 stop 锚在 `selectAccount` 的 `NONE_ALL_EXHAUSTED`**——「该不该停」不由 hook 独立算，而锚在引擎 `selectAccount` 返回的哨兵：**switch 尝试本身就是那个探针**。若 select 因某种上游信号缺失误判「无逃逸」，stop 会偏保守（早停）——方向安全（停优于透支），但非零误差。
- **switch verdict ≠ 保证切成**——verdict 出 `switch` 只是「引擎判断有健康备号该切」；真正切号仍过 `ccm account switch` 的 policy 硬闸（deny→exit7）+ token 抢救等机制，可能失败降级（回 throttle / 停）。verdict 是建议不是执行保证。

### 3.3 Neutral

- **无新 judgment-bearing skill prose**——RED 未复现，故不新增 Rationalization-Table 行 / Red Flag（编造未发生的失败 = 违 iron law）。no-busywork 纪律已在 SKILL A 承重、本 baseline 证其压力下守住；本次改动落引擎 + `pacing-and-estimation`/`using-ccm` 的 reference 词汇（verdict 表 + 字段），非魂的纪律段。
- **`usage advise` 输出向后不兼容改形**——drop `hard_stop`（含 `hard_stop_7d`）、加 `strength`/`stop_dimension`/`nearest_reset`；消费方（hook + skill 手册）同 PR 锁步更新（§6 `ccm ⟷ using-ccm`）。
- **ADR-010 走廊数学退役**——走廊 70–90% setpoint + 加速侧三杠杆镜像（升档/升WIP/float 提前）随加速侧一并退役；减速侧杠杆（降档/降WIP/defer float）语义并入 `throttle`。

## 4. Alternatives Considered

### 4.1 Alternative A: 维持 ADR-010 双侧走廊

不改，继续「欠用轻推加速 / 临界轻推减速」双侧对称。**否决**：pressure baseline 直接实证加速侧是**冗余噪声**——capable agent 2/2 主动 overrule 它、自推出 no-busywork 的正确选择，加速 advisory 只是让 agent 多花 cycle 去拒。且号池让「单窗口欠用」在架构上根本不是一个问题（一次 switch = 新窗口），走廊的加速侧建在一个已不成立的单账户前提上。对称好看，但对称的一半是错的。

### 4.2 Alternative B: 保留加速但给它加 pool-gate（池空时才加速）

保留 `accelerate` verdict，但用「池里无健康备号」当门——只在真无逃逸时才轻推加速填当前窗口。**否决**：这仍在**跟 agent 正确的直觉打架**——baseline 里 agent 的推理不是「因为有池所以不加速」这么窄，而是更根本的「为填一个走廊而加速 = manufacture busywork」。即便池真空了，正确响应也是「继续手上的真活 / 没真活就是没真活」，而不是「编点活把窗口填到 90%」。pool-gate 只是把一条 agent 每次都要 overrule 的噪声从「常出」改成「偶出」，没消除它本质的误导性；且徒增一条「池空 → 加速」的特例路径要维护、要为它写 prose。不如整条砍掉。

## 5. Related

- [`ADR-010`](ADR-010-two-sided-pacing-corridor.md)（**superseded by 本 ADR**）——双侧走廊 + 加速侧三杠杆是本 ADR 翻转的直接对象；其 §3.2 诚实天花板（无绝对分母 / 无权威 burn）在本 ADR §3.2 承继。
- [`ADR-015`](ADR-015-estimation-and-pacing-engine.md)——估算 + 配速引擎（`usage`/`estimate` 只读 advisory namespace·ccm 出 verdict / orchestrator 决策）；本 ADR 的新 verdict enum + `predict`/`select` 接线落在这套引擎里。
- [`ADR-016`](ADR-016-board-scoped-orchestrator-authority.md)——`policy` 段 + 自主换号 policy 硬闸（`deny→exit7`）；`switch` verdict 的授权仍锚在这道引擎硬闸，hook 不读 policy。
- [`ADR-020`](ADR-020-hook-writes-flexible-board-via-ccm.md)——`runtime.*` ✎ 白名单 + `ccm board set-param` 带锁 setter；`last_account_switch` 是其第三个白名单键（同形扩展）。
- [`ADR-021`](ADR-021-ccm-install-presence-hard-precheck.md)——ccm 硬前置；本 ADR 据此退役 hook 本地反推 fallback（ccm 缺 → 干净静默，不再拖带外脚本）。
- Finding #82（本 ADR 的 pressure baseline 诚实记账·2/2 Hold·RED 未复现）；Finding #45 / ADR-010（走廊立起的前身）。

## 6. References

- Status line JSON schema（账户权威 `used_percentage` / `resets_at`·无绝对 token 分母）：https://code.claude.com/docs/en/statusline.md
- 配额滚动窗口口径（5h / 7d·用进废退不结转）：https://code.claude.com/docs/en/costs.md
- 落地物：`ccm/packages/engine/src/usage/pacing.ts`（verdict enum + `pacingAdvice` 接 `predictPoolUsage`/`selectAccount`）· `usage advise` handler（新增 strength/stop_dimension/nearest_reset·drop hard_stop_7d）· `hooks/scripts/usage-pacing.js`（消费新字段 + 退役本地反推 + `last_account_switch` ambient）· `skills/pacing-and-estimation/` + `skills/using-ccm/`（verdict 表 + 字段锁步）。
