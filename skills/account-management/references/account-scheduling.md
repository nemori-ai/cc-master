# 选号调度算法 —— 方法论

> 这是 SKILL.md「选号 + 换号」的方法论展开。`${CLAUDE_SKILL_DIR}/scripts/select-account.js` 是它的落地实现——本文讲**为什么这么选**，脚本讲**怎么算**；权重 / 阈值是脚本顶部可 env 覆写的常量（见下表）。本文不复制代码，只蒸馏判据。

## Contents

- [目标](#目标)
- [单窗口恢复度推算](#单窗口恢复度推算)
- [单号可用度评分（7d 硬总闸）](#单号可用度评分7d-硬总闸)
- [选号主流程](#选号主流程)
- [policy 机制硬闸（切号前读 board.policy）](#policy-机制硬闸切号前读-boardpolicy)
- [权重与阈值（可 env 覆写）](#权重与阈值可-env-覆写)
- [source 信任分级（最大精度风险）](#source-信任分级最大精度风险)
- [边界处理](#边界处理)
- [落点纪律（红线 1）](#落点纪律红线-1)
- [per-account 配额快照（录号 / 切出时采集）](#per-account-配额快照录号--切出时采集)

## 目标

给定此刻 `now`，从 registry 里所有**非 active 且 token 未过期**的号中，选一个**预计可用配额最优**的号切入。「可用配额最优」= 综合 5h + 7d 两个窗口、按各自 reset 推算「现在恢复了多少」。算法**只读 accounts.json 的非密元信息**（`last_switch_out` 快照），完全不碰 token——它是 token-blind 的。

## 单窗口恢复度推算

对一个号的某窗口（5h 或 7d），用切出快照 `{used_pct, resets_at}` + `now` 推算「现在的 used_pct」：

- **`now >= resets_at`**（已过 reset）→ 窗口刷新满血，`recovered_used_pct = 0`。
- **`now < resets_at`**（未过 reset）→ 配额还没恢复，**保守仍按切出时的 `used_pct`**。

**为何用保守二值（不插值）**：5h/7d 是**滚动**窗口、配额是**渐进**恢复的，所以「未过 reset 就当没变」是低估恢复。但账户口径**不给绝对 token 分母 + 不给 burn rate**（cost-and-pacing 诚实天花板），无法精确插值——线性插值是未经验证的精度假设，可能选错。二值版在「选哪个号最优」的**相对排序**上多数够用（过 reset 的号一定优于没过的）。多个号都未过 reset 时，二值版看不出谁离 reset 更近 → 用 **`resets_at` 早晚当 tiebreaker**（更早彻底满血者优），补这块盲区而不引入插值假设。

## 单号可用度评分（7d 硬总闸）

把一个号的 5h + 7d 恢复度合成一个可用度分。**关键非对称：7d 是硬总闸**——7d 已逼顶的号即便 5h 满血也几乎没用（切进去马上又被 7d 卡）：

- `p5 = recovered_used_pct(5h)`，`p7 = recovered_used_pct(7d)`。
- **`p7 >= SEVEN_DAY_HARD_GATE`（默认 85）→ 该号判作几乎不可用**（极低分 `SCORE_UNUSABLE`，排在所有正常号之后），对齐 `usage-pacing.js` 的 dispatch gate。
- 否则 `score = W5 × (100 - p5) + W7 × (100 - p7)`——两窗口各自剩余额度加权，**7d 加权更重**（它是跨窗口总闸、最易不知不觉逼顶）。

## 选号主流程

1. **筛候选**：跳过 active 号、跳过 token 已过期的号（切进去认证失败）、跳过 `switchable:false` 残缺号（只含 access token、无 refresh token——无重启换号靠 refreshToken 续期，切不进，`select-account.js` 硬排除并附「重跑 `--add` 录完整 blob」提示）。缺省 / 未设 `switchable` = 视作可切（不破既有完整号）。
2. **打分**：无历史新号（`last_switch_out == null`）视作满血、`SCORE_FRESH_FULL` 最优先；有历史的按上面 `account_score`；再 `apply_expiry_penalty`（临到期降权）。
3. **排序**：score 降序；tiebreak = `resets_at` 更早者优。
4. **裁决**：
   - 候选空 → `NONE`（无备号 / 单账号场景），保持现状。
   - 最优分 ≤ `SCORE_UNUSABLE_FLOOR` → `NONE_ALL_EXHAUSTED`（全员逼顶/不可用），**surface 用户**别盲切（脚本 exit 3）。
   - 否则返回 best email（脚本 stdout 纯 email，exit 0）。

## policy 机制硬闸（切号前读 board.policy）

`switch-account.sh` 在**真正覆写官方凭证存储之前**多一道**机制硬闸**：读 active board 的 `policy.autonomous_account_switch`，显式 `deny` 即**拒绝本次换号**（ADR-016 的纵深防御机制侧）。这是**机制**——「怎么 gate」；换号**决策**（何时换、谁授权、deny 时怎么 surface 给用户）归 `orchestrating-to-completion`（建议层 + 「绝不自授权」红线），不在本文复述（红线 3）。

机制流程：

1. **读 policy（进程边界·不 import 引擎·确定性 board selector）**：`switch-account.sh` 经 `ccm policy show --json` 读**目标板**，解析契约路径 `.data.effective.autonomous_account_switch`（`ccm policy show --json` 钉死形状）。纯 bash + node 解析 JSON（红线 1，不用 jq/python）。**闸用确定性 board selector（`--board` / `$CC_MASTER_BOARD`）而非 ambient discovery**——orchestrator 触发换号时应经 `switch-account.sh --board <选定板>` 或 `$CC_MASTER_BOARD` 提供板上下文；否则**多 active board 共享 home 时 ccm 拿不到 sid → ambient discovery 可能读错板或歧义失败**，让 deny 被误判放行（codex P1·`ccm policy show --board <path>` 是 discover.ts ① 最高优先、与 cwd/sid 无关的全局发现 flag）。
2. **deny → 拒绝切号**：值显式为 `"deny"` → **exit 7**（policy-deny-blocked 专属码），并：
   - **不取换号锁、不覆写任何官方凭证存储、registry 原封不动**——拦在覆写之前，零副作用。
   - **越界响亮**：stderr 提示「机制层硬闸：deny，拒绝本次自主换号」+ best-effort 往 board.log 记一条 `decision`（「机制层按 board.policy=deny 拦下一次自主换号」），供用户审计（ccm log 调用失败无害）。
   - 提示用户：如需换号，须先 `ccm policy set --autonomous-account-switch=allow --user-authorized` 改 board policy 再重试。
3. **fail-open 分两类（ADR-016 §2.3·codex P1 收窄）**：读不出 policy 时**不再一律放行**——按「是否知道该看哪块板」分流：
   - **(a) 真·无 ccm（CCM_BIN 未设且 PATH 无 ccm）→ 故意 fail-open `allow`**：环境根本没接 ccm 的 policy 机制，不该误锁（同既有「ccm 缺则优雅降级」模式）。值确实读到 `allow` / 缺 `policy` 字段 / 值非 `deny` 也照常放行。
   - **(b) 有明确目标板上下文（`--board` / `$CC_MASTER_BOARD` 给了）但 `ccm policy show` 失败 / 歧义（`{"ok":false}`）/ 坏 JSON / 缺字段 → deny 侧保守拦截 `exit 7`**：我们知道该看哪块板却读不到，绝不静默放行（这正是 codex 揪的核心——deny 不能因 discovery 失败被绕过）。
   
   即：**只有 (a) 真·无 ccm / 确实读到非-deny 才放行；deny 或「有板上下文却读不到」一律拦 exit 7。**

> **诚实记账**：这是纵深防御的安全网，**不是硬锁**——agent 有 shell，理论上能 `--force` 绕过或直接改文件；价值在「让擅自换号从一句合理化变成要主动绕两道闸、且每次都在 log 留痕」。机制层只在 deny 时拦下并报响，不替编排做「换不换」的决策。

## 权重与阈值（可 env 覆写）

`select-account.js` 把这些做成顶部常量 + env 覆写，便于 dogfood 调而不改逻辑：

| 常量（env 覆写名） | 默认 | 语义 |
|---|---|---|
| `SEVEN_DAY_HARD_GATE`（`CCM_SELECT_7D_HARD_GATE`） | 85 | 7d used% ≥ 此 → 号几乎不可用（对齐 usage-pacing dispatchGate / 85% 闸）。 |
| `W5`（`CCM_SELECT_W5`） | 0.4 | 5h 短窗、恢复快，权重低些。 |
| `W7`（`CCM_SELECT_W7`） | 0.6 | 7d 跨窗口总闸，选号优先看它的余量。 |
| `EXPIRY_WARN_DAYS`（`CCM_SELECT_EXPIRY_WARN_DAYS`） | 14 | token 距到期 ≤ 此天数 → 降权。 |
| `EXPIRY_PENALTY`（`CCM_SELECT_EXPIRY_PENALTY`） | 40 | 临到期大幅降权但不归零（号还能用、只是该续期）。 |
| `LOCAL_APPROX_TRUST`（`CCM_SELECT_LOCAL_APPROX_TRUST`） | 0.85 | local-derived-approx 来源快照的信任折扣（见下）。 |

> **W5/W7 是最该 dogfood 调的旋钮**：0.4/0.6 是直觉起点、无实证。真换号场景下观察「按这权重选的号是否真更经烧」回流调整。

## source 信任分级（最大精度风险）

切出快照的 `{5h,7d}` 各带一个 `source`：`"account"`（账户权威 `used_percentage` + `resets_at`）或 `"local-derived-approx"`（cc-usage.sh 降级——没接 statusline-capture / headless 时反推）。

**`local-derived-approx` 的 `resets_at` 是反推、可能失真到数量级**（Finding #37）——基于它的恢复推算不可信。算法的处置：任一窗口来源是 `local-derived-approx` → 整号评分乘信任系数 `LOCAL_APPROX_TRUST`（默认 0.85，粗排），并在 warnings 里**告知口径不可靠**。`account` 来源 = 1.0（权威）。**这是选号精度的最大风险点**——算法只保证**相对排序方向性正确**，不承诺精确；真换号必 dogfood 验证选出的号是否真更经烧。

## 边界处理

| 边界 | 处理 |
|---|---|
| 无历史新号（`last_switch_out == null`） | 视作满血、最优先（乐观假设：从没用过通常确实最经烧）；切入后第一次 pacing 探测拿真实 used% 纠正认知。 |
| token 已过期 | 排除候选（切进去认证失败）。 |
| `switchable:false` 残缺号 | 排除候选 + warning（只含 access token、无 refresh token，无重启换号切不进）；缺省/未设 = 视作可切。 |
| token 临近到期（≤ `EXPIRY_WARN_DAYS`） | 不排除、`EXPIRY_PENALTY` 降权 + 返回时附「X 天后到期、建议 refresh」提示。 |
| 全员逼顶 / 不可用 | `NONE_ALL_EXHAUSTED`（exit 3），surface 用户（`blocked_on:"user"`），别盲切。 |
| 无备号（候选空） | `NONE`，保持现状（单账号天然行为）。 |
| registry 不存在 / 坏 JSON | 选号不可用 → 降级单账号，绝不崩（fail-safe）。 |

## 落点纪律（红线 1）

选号算法是 `switch-account.sh` 切号前调用的逻辑——它**不进 hook**，是带外脚本（node·ADR-006 允许）。hook 注入号池信息时只注「号池有 N 个可用备号」这类**粗粒度事实**，**绝不在 hook 里跑完整选号**（避免把调度逻辑塞进 hook + 红线 1 风险 + 复杂度）。

## per-account 配额快照（录号 / 切出时采集）

选号算法（`${CLAUDE_SKILL_DIR}/scripts/select-account.js`）核心依赖的是 `last_switch_out` 快照——但备号在**首次切出之前**没有该字段（`null`），只能被当满血处理（`SCORE_FRESH_FULL` 最优先）。为让刚录入的备号也有配额参考信号，系统在两个时机写入快照：

### 采集时机

| 字段 | 采集时机 | 信号来源 | 信任度 |
|---|---|---|---|
| `last_observed_quota` | 录号（add / refresh）成功后 | `cc-usage.sh`（当前 session 的号·非被录号视角） | 弱信号（录的就是当前 session 号时才准） |
| `last_switch_out` | 切出该号之前（换号主流程·setActive 之前） | `cc-usage.sh`（当前号切出前的最新配额） | 高信任（该号最后一次活跃时的真实配额） |

`switch_history[]` 是 `last_switch_out` 的追加历史，每次切出都 append 一条——不覆盖、只追加（复盘 / 审计用）。

### 实现落点

- **`${CLAUDE_SKILL_DIR}/scripts/accounts-lib.js`**：`recordObservedQuota(reg, email, snap)` 写 `last_observed_quota`（不 append history）；`recordSwitchOut(reg, email, snap)` 写 `last_switch_out` + append `switch_history`。两者均通过 `mutateRegistry` 在锁内 RMW，防并发 lost-update。
- **`${CLAUDE_SKILL_DIR}/scripts/account-add.sh`**：`write_observed_quota()` 在 registry entry 写成后（best-effort）后台跑 `cc-usage.sh`（有 `CC_USAGE_TIMEOUT_S` 上限，默认 60s），解析结果调 `recordObservedQuota`。
- **`${CLAUDE_SKILL_DIR}/scripts/switch-account.sh`**：`record_switch_out()` 在 `set_active_in()` 之后（切入号 active 已翻转）后台跑 `cc-usage.sh`，解析结果调 `recordSwitchOut`。

### 优雅降级（best-effort·绝不阻断主流程）

- `cc-usage.sh` 缺失 / 超时 / 无输出 → **跳过快照**，打一行 `err` 提示，`return 0`，主流程继续。
- `cc-usage.sh` 降级（`source=local-derived-approx`，无有效 `used_percentage`）→ `used_pct` 为 `undefined`，validate 拒写（非 0-100 整数），干净跳过（不 throw stack trace）。
- registry entry 不存在（极端竞争）→ 跳过（不是错误）。

### 安全命门（HARD）

快照只含**非密**字段：`used_pct`（整数）/ `resets_at`（ISO 时间串）/ `source`（字符串枚举）/ `at`（ISO 时间串）。`saveRegistry` 写前过 `validateRegistry`，任何疑似 `sk-ant-` token 值 → 硬 error 拒写。token 那一坨全程只活在 vault（keychain / file）——绝不进 `accounts.json`。
