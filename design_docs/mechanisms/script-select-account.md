# 机制契约：`skills/account-management/scripts/select-account.js`

> 类别：运行时带外 node 库 + CLI（NOT a hook·switch-account.sh 切号前调用）。源码：`skills/account-management/scripts/select-account.js`。选号调度算法——从非 active 且 token 未过期的号里选最优切入号。**完全不碰 token。**

## 触发输入
- `node select-account.js [--registry <path>] [--json] [--now <ISO>]`，或被 require（`selectAccount` 等）。
- 读 accounts.json registry 非密调度元信息（last_switch_out / last_observed_quota 快照的 used_pct/resets_at/source + token_expires_at + active/switchable）。
- 可调常量（env 覆写）：W5=0.4 / W7=0.6、7d 硬闸 85（CCM_SELECT_7D_HARD_GATE）、临到期降权 14 天/-40、local-approx 信任 0.85、observed_quota 信任 0.7。

## 业务流
1. 筛候选：跳过 active 号、`switchable:false` 残缺号（+ warning）、token 已过期号（字典序 `token_expires_at < now`）。
2. 单窗口恢复度推算（二值版·不插值）：过 reset → 满血 used=0；未过/不可比 → 保守用原 used_pct（账户口径无 burn 无法插值）。
3. 单号评分：avail=100-used_pct，base=W5×avail5h+W7×avail7d；**7d ≥ 硬闸（gated）→ SCORE_UNUSABLE 且从可选候选里彻底排除**（codex round#4：硬闸是硬的·gated 号永不进 candidates·只留在 sorted 输出供 --json 看·绝不被它的 -1 干扰 best 排序或被选中）；含 local-derived-approx 来源 → ×信任折扣。无历史新号（无 last_switch_out + 无 last_observed_quota）= 视满血最优先；只有 last_observed_quota（录号快照）= 弱信号兜底（×0.7 折扣 + warn）。临到期降权（-40 + warn·用**降权前**的配额分判地板·临近到期只降权不排除）。
4. 主排序：score 降序，tiebreak earliestReset 更早者优；候选**配额分**（scoreForExhaustionFloor·取全候选最大值）≤ 地板（0）→ NONE_ALL_EXHAUSTED（surface 用户）。无候选时区分退出语义：非 active 备号**全 gated** → NONE_ALL_EXHAUSTED（exit 3·等 reset）；**混合**排除（有 gated 但也有 expired/not_switchable·可刷新/可补录）→ NONE_NO_CANDIDATES（exit 1·修号池·codex round#6 别误判纯逼顶）。

## 输出副作用
- 无（纯只读 + 纯函数）。默认 stdout 打印选中 email；`--json` 打印完整结构（selected/reason/candidates/warnings）；选不出 → stdout 空 + 非 0 退出码 + reason/warnings 走 stderr。

## 关键不变式
- **完全不碰 token**（HARD）——只读 accounts.json 非密调度元信息。
- 与 board 正交（红线 2），绝不进 hooks/（红线 1/5），纯 node stdlib 零依赖。
- **7d ≥ 85% 硬闸（对齐 usage-pacing.js dispatchGate / cost-and-pacing.md）= 硬排除候选**：gated 号 SCORE_UNUSABLE 且永不进可选 candidates（不只是低分），绝不被选中、绝不用其 -1 干扰 best 排序。
- **switchable:false 排除候选**：残缺号（无 refreshToken·只 access token·account-add fallback 标）无重启换号切不进 → 从 candidates 排除 + warning，缺省（未设 switchable）= 视作可切。
- 严格 ISO 字典序 == 时间序（过期/恢复判定纯字符串比较，非严格 ISO 须先 isStrictIso 守）。
- token 过期判定保守：缺/非严格 ISO 当「未过期」（宁可切进去现场失败，也不因坏时间戳误杀可用号）。

## 失败模式
- 全员逼顶 → 退出码 3（NONE_ALL_EXHAUSTED·调用方区别对待 surface 用户）。
- 无候选 / registry 不可用 / 单账号 → 退出码 1（保持现状）。
- registry 坏 JSON / IO → CLI 捕获降级「无号池」（fail-safe，绝不崩）。
- 含 local-derived-approx 来源 / observed_quota 弱信号 → 评分折扣 + warning 告知口径不可靠。
