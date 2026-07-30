---
point: ccm.account-select-method
---

## 权威陈述

<!-- ccm:k:start point:ccm.account-select-method -->
## 选号方法论判据

换号时从所有**非 active 且 token 未过期**的号中，选一个**预计可用配额最优**的切入。判据（权重 / 阈值是引擎可 env 覆写的常量·实现在 ccm 引擎的选号逻辑、本文只蒸馏 why）：

- **单窗口恢复度推算（保守二值，不插值）**：用切出快照 `{used_pct, resets_at}` + `now` 推「现在恢复了多少」——`now ≥ resets_at` 已过 reset → 满血；未过 → 保守仍按切出 used_pct。**为何二值不插值**：账户口径不给绝对 token 分母 + 不给 burn rate（见 `pacing-and-estimation` skill 的诚实天花板），线性插值是未经验证的精度假设；二值版在「选哪个号最优」的**相对排序**上多数够用（过 reset 一定优于没过）；多个号都未过 reset → 用 `resets_at` 早晚当 tiebreaker。
- **双窗口对称硬闸（5h ∧ 7d 都得健康才算能切）**：任一窗口逼顶就把号判作几乎不可用、排在所有正常号之后——7d 逼顶（默认 ≥85%）切进去马上被 7d 卡；5h 逼顶（默认 ≥90%·`CCM_SELECT_5H_HARD_GATE`）切进去落地即撞 5h 墙。两侧阈值不同（5h=90 比 7d=85 高 5·5h 是短窗、reset 快、激进侧让它快回血烧满点）但都是**硬**闸：**候选 ⟺ 双窗口都健康**（对齐 usage-pacing 的 dispatch gate）。判「逼顶」用的是 reset 恢复后的 used%——刚过 reset 回血的号不会被误杀。
- **可用度评分**：`score = W5×(100-p5) + W7×(100-p7)`——两窗口各自剩余额度加权，**7d 加权更重**（W7>W5·它是跨窗口总闸、最易不知不觉逼顶）。
- **source 信任分级（最大精度风险）**：切出快照带 `source`——`"account"`（账户权威）= 1.0；`"local-derived-approx"`（降级反推·reset 失真）→ 整号评分乘信任折扣 + warn 口径不可靠。**算法只保证相对排序方向性正确、不承诺精确**——真换号必 dogfood 验证选出的号是否真更经烧。
- **临到期降权 + 边界**：token 临近到期 → 降权（不归零·还能用、只是该续期）；无历史新号视作满血最优先；全池无双窗口健康号（每个都 5h 或 7d 逼顶）→ `NONE_ALL_EXHAUSTED`，**surface 用户别盲切**（是 `blocked_on:"user"` 决策·全池 5h 墙 / 7d 健康时也 stop、不空切）。
<!-- ccm:k:end point:ccm.account-select-method -->
