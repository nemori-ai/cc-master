# ADR-010 — pacing 从单边上限护栏改为双侧目标走廊（7d 当总闸）

> Status: **Superseded by ADR-024**
> Date: 2026-06-15
> Scope: pacing 认知层（`references/cost-and-pacing.md`）+ 魂镜头5（`skills/master-orchestrator-guide/SKILL.md`）+ `hooks/scripts/usage-pacing.js`
> Source: 本仓 Track B 行为 eval —— 欠 pace 探针下两个 agent 做出相反决策（一加速、一拒绝），暴露单边 pacing 无 setpoint 的结构缺陷

> **已被 [`ADR-024`](ADR-024-single-sided-pacing-switch-stop.md) 取代**（单侧减速 + 换号 + 停·砍加速侧）——号池让单窗口「欠用」不再是真稀缺（一次 `switch` = 新窗口），pressure baseline 实证加速 advisory 是 capable agent 必须 overrule 的冗余噪声，故整个加速侧连同走廊 setpoint 一并退役。

---

## 1. Context

cc-master 原本的 pacing 是一道**单边刹车**：所有杠杆都指向减速——降模型档位、降 WIP（并行度）、推迟 float 任务——目标也只有一句「~75% 上限护栏」（别撞墙）。它从不告诉 orchestrator「reset 时该把用量落在哪」，即**没有 setpoint**。

本仓 Track B 行为 eval 在「欠 pace 探针」下实证了这个缺口的代价：同一情形（5h 窗口剩大量余额、reset 临近）下**两个 agent 做出了相反决策**——一个判断该加速冲刺、把后续 float 拉进当前窗口；另一个把「reset 前冲刺」读成魂镜头5明令禁止的「过度利用 / manufacture busywork」而拒绝加速。指导沉默 → 决策掷硬币；更糟的是单边刹车的字面读法系统性地把 agent 推离**高效利用**，因为它只认识「减速」这一个方向。

配额是**用进废退**的：5h 滚动窗口里没用满的额度，reset 那一刻**永久蒸发**，不结转。这与「用到半截撞墙、任务做不完」在本质上同属**容量失败**——一个是浪费、一个是透支，两侧都是没把「合理前提下高效利用资源」这条用户诉求兑现。单边护栏只防住了透支那一侧，对蒸发那一侧完全失明。

## 2. Decision

### 2.1 目标从单边 ~75% 上限改为双侧目标走廊

pacing 的 setpoint 不再是一根「别超过 ~75%」的上限线，而是一条**两侧都有边的目标走廊**：默认在 5h reset 那一刻，用量落在 **~70–90%** 区间。低于走廊下沿 = 欠用（额度将蒸发，该加速）；高于上沿 = 逼近撞墙（该减速）。走廊给了 orchestrator 一个明确的「往哪收」的目标，消除 eval 里的掷硬币。

### 2.2 7d 窗口当加速的总闸

加速**只在 7d 窗口仍有余量时**才被允许。5h 欠用本身不构成加速理由——必须先过 7d 总闸：7d 吃紧则即便当前 5h 欠用也不准加速（把后续窗口的额度提前烧掉会透支更长的滚动周期）。7d 是加速侧的硬约束上闸，防止「填满每个 5h」累积成 7d 透支。

### 2.3 新增加速侧三杠杆，与减速侧镜像对称

减速侧原有三杠杆（降模型档位 / 降 WIP / 推迟 float）现各自获得一个对称的加速侧镜像：
- **升档模型**——把够格的节点从低档模型上调到更强档位。
- **升 WIP**——提高并行派发的在飞任务数。
- **float 提前**——把后续窗口的 float 任务提前拉进当前窗口执行（吃掉本会蒸发的额度）。

三组镜像让 pacing 成为一个**双向可调**的控制面，而非只能踩刹车。

### 2.4 `usage-pacing.js` 加对称的 `decideAccountUnderuse` 提示

Stop hook 在撞墙提示之外，新增一条对称的**欠用提示** `decideAccountUnderuse`：
- **账户口径限定**——只在读到账户权威 `used_percentage`（`source:"account"`）时给出，本地反推路径（`source:"local-derived-approx"`）**禁加速**（反推信号可失真，不足以支撑「主动多烧」这种不可逆方向的决策）。
- **与撞墙提示互斥**——同一次评估不会既提示加速又提示减速。
- **fail-safe 静默**——任何缺信号 / 解析失败 / 不确定，默认不提示加速（沉默优于错误加速）。
- **sidecar 新鲜度闸（codex 二审 P2 finding 收口）**——加速提示额外要求 sidecar `captured_at` 距今 ≤ `CC_MASTER_UNDERUSE_MAX_STALE_MIN`（默认 15min）；陈旧/缺失即静默。主线 idle 等后台时 status-line 不刷新、sidecar 停在偏低旧 `used%`，而后台仍在烧配额，据此 stale-low p5 会**误催加速多烧**（危险方向）。**不对称**：撞墙侧无此闸，因 stale-low 在刹车侧只是少报一次警（安全方向）。

### 2.5 魂镜头5 极简双向化

`SKILL.md` 镜头5 从「单向防过度利用」改为极简的**双向表述**：既防撞墙透支，也防额度蒸发欠用，指向走廊 setpoint。改动保持 reinject-friendly 的极简（delta 下沉，不整篇重写）。

### 2.6 7d≥85% 暂停 dispatch（硬总闸从挡加速强化到挡派发）

§2.2 立了「7d 当加速硬总闸」——但它原本只挡**加速**（5h 欠用时是否升档/升WIP/提前拉 float）。本节把这道总闸强化：**当 7d `used%` 达 85% 时，它从「挡加速」收紧到「挡派发本身」**——orchestrator **停止 dispatch 任何新节点**（哪怕维持性的、哪怕在临界路径上），把「是否继续消耗 7d 配额」作为一个 **`blocked_on:"user"` 决策 surface 给用户**，等用户确认后再续派发；在飞任务可跑完、可端点验收，只是不再派新活。

**为何是「暂停 dispatch」而非「自动停」——双轨（机械 + 心智）**。`usage-pacing.js` 是 Stop hook，输出只能是 `additionalContext` 软提示，**物理上不能真 block 主线下一回合的 dispatch 工具调用**（红线4：hook 感知、不替主线做调度决策）。故 7d≥85% 暂停 dispatch 必然落成双轨：
- **机械轨**：hook 在 7d≥85% 时把那条撞墙提示从泛泛「减速（降档/降WIP/defer）」**升级措辞**为点名 dispatch 闸——「暂停 dispatch 新节点、把『是否续耗 7d 配额』作 `blocked_on:"user"` surface 用户」。它仍只是注入提示，不真拦截。
- **心智轨**：决策程序 dispatch 节点 + cost-and-pacing.md 的纪律——真正「执行」暂停的地方（orchestrator 自律）。这是 judgment-bearing prose，经 TDD-for-skills pressure baseline 验证（RED：无此闸的 agent 在 7d 87% + 临界路径 + 「今天 ship」+ 疲惫三压下照样硬派新节点，逐字合理化「配额在授权内 / 临界路径不停 / 非阻断即 FYI」）。

**num_account 耦合（措辞层，非机制）**：握多份配额（`num_account`>1）时，「切到下一份配额（切账号会刷新 7d 窗）」是用户可选的**一个响应**，与「暂停续耗」并列由用户拍。本闸只让 orchestrator 把该选项 surface 给用户，**不实现任何切换动作**（切换机制是另一个范围）。

## 3. Consequences

### 3.1 Positive
- pacing 第一次**双向**：既能踩刹车也能踩油门，eval 里的相反决策被 setpoint 消解。
- 第一次有明确 **setpoint（目标走廊）**——「reset 时落 ~70–90%」是可对齐的目标，不再是只防上限的开环。
- Stop hook 能在主线 idle / 欠用时**主动唤醒**（对称于它原本只在逼近撞墙时提示）。
- 加速一律过 **7d 总闸**，防止「填满每个 5h」累积透支更长周期。
- **7d≥85% 时把不可逆的「续耗 7d 配额」消耗决策交还用户**（§2.6）——orchestrator 不擅自跨这条跨窗口的消耗边界，与镜头 7 的「merge / 不可逆步骤归用户」一致；临界路径节点也不例外。

### 3.2 Negative（诚实天花板，必须写明）
- **用当前信号做不到精确闭环到 100%。** 账户权威口径给 `used_percentage` + `resets_at`，但**不给绝对 token 分母**（算不出剩余的绝对额度）；也**不给权威 burn rate**（权威 burn 只存在于可失真的本地反推路径，账户口径没有）。精确预测「reset 时会落在百分之几」需要「剩余绝对额度 ÷ 权威 burn rate」，而这两个量**永不在同一条可信路径上凑齐**——账户路径有分母信息但无 burn，反推路径有 burn 但失真。故走廊只能做**方向性 / 区间**调节（欠用→偏加速、逼近→偏减速），**不是精确收敛**。
- 账户 `used_percentage` 仅 **Pro/Max 交互式**可见；headless / API-key / 未接 status-line 的环境降级到本地反推，**加速侧在反推路径被禁用**（只剩减速侧刹车，与 ADR-008 的 fallback 链一致）。
- **绝不承诺 reset 时配额精确归零**——任何把走廊读成「保证用满 100%」的实现或措辞都是过承诺，违背本节诚实天花板。
- **7d≥85% dispatch 闸（§2.6）只在账户口径可用时由 hook 触发**——本地反推算不出 7d `used%`（无窗口绝对 token 分母），故 headless / API-key / 未接 status-line 的环境拿不到这道机械轨提示（与加速侧反推禁用同精神）。心智轨的 dispatch 闸纪律仍靠 orchestrator 自律执行，但失去了 hook 这一层提醒。
- **hook 无法真 block dispatch**——「暂停 dispatch」的执行落在 orchestrator 的认知判断（心智轨），hook 只升级措辞（机械轨）。若 orchestrator 把「非阻断」误读为「可忽略」，闸就漏——这正是 §2.6 心智轨经 pressure baseline 堵的合理化（回流 SKILL.md Rationalization Table + Red Flag）。

### 3.3 Neutral
- 减速侧三杠杆与原 ~75% 护栏的减速行为向后兼容；走廊上沿 ~90% 只是把原上限的语义并入双侧框架，不改撞墙侧的保护强度。
- `usage-pacing.js` 输出新增 `decideAccountUnderuse` 提示字段，与既有撞墙提示并列，向后兼容扩展。

## 4. Alternatives Considered

### 4.1 Alternative A: 维持 ~75% 单边上限护栏
不改，继续只防撞墙。**否决**：不解决根因——仍无 setpoint，eval 仍掷硬币，字面读法仍系统性把 agent 推离高效利用。单边护栏对「额度蒸发」这一侧的容量失败完全失明。

### 4.2 Alternative B（即「Alternative C」）: 把目标定为榨满 ~100%
setpoint 直接设成「reset 时用到 ~100%」，最大化单窗口利用。**否决**：① 与 7d 窗口冲突——填满每个 5h 会累积透支 7d；② 变量噪声（burn 波动、任务时长不可预测）下「冲到 100%」极易**半截撞墙**，任务做不完反而是更大的容量失败；③ 信号根本给不了精确收尾（见 §3.2 天花板——无绝对分母 + 无权威 burn），追求 100% 是在用不支撑该精度的信号下注。走廊的 ~90% 上沿正是为这三点留的安全裕度。

## 5. Related
- [`ADR-008`](ADR-008-account-authoritative-usage-and-script-placement.md)（账户权威 5h/7d `used_percentage` + `resets_at` 口径——本 ADR 加速侧决策的**信号前置**：没有账户权威口径，加速侧就没有可信依据，只能降级到禁加速的反推路径）
- [`references/cost-and-pacing.md`](../skills/master-orchestrator-guide/references/cost-and-pacing.md)（pacing 认知层 evergreen SSOT——走廊 setpoint + 双向杠杆落点）
- [`skills/master-orchestrator-guide/SKILL.md`](../skills/master-orchestrator-guide/SKILL.md) 镜头5（魂的双向 pacing 表述）
- [`hooks/scripts/usage-pacing.js`](../hooks/scripts/usage-pacing.js)（`decideAccountUnderuse` 对称提示落点）

## 6. References
- Status line JSON schema（账户权威 `used_percentage` / `resets_at` 来源，无绝对 token 分母）：https://code.claude.com/docs/en/statusline.md
- 配额滚动窗口口径（5h / 7d，用进废退不结转）：https://code.claude.com/docs/en/costs.md
