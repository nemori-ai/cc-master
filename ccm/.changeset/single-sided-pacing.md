---
'@ccm/engine': minor
'ccm': minor
---

pacing verdict 翻转为单侧（减速）+ 换号 + 停（ADR-024·supersedes ADR-010 双侧走廊）

- **verdict enum 翻转**——`{hold, throttle, switch, stop_5h, stop_7d}` 取代旧 `{accelerate, hold, throttle, hard_stop}`：砍掉整个 underuse 加速侧（号池令单窗口「欠用」非真稀缺——一次 `ccm account switch` = 新满血 5h 窗口，加速 advisory 反诱导 busywork）；`hard_stop` 拆成 `stop_5h`（短停）/ `stop_7d`（长停）；新增 `switch`。
- **池感知 `pacingAdvice`**——接 `predictPoolUsage`（冻结备份投影）+ `selectAccount`：临界 + 健康可切备号 → `switch`（换下一份配额，不减速）；池温无逃逸 → `throttle`（5h `weak` / 7d `strong`）；全池撞墙（`selectAccount` 返回 `NONE_ALL_EXHAUSTED`·权威锚，switch 尝试本身即探针）→ `stop_5h`/`stop_7d`（emit `nearest_reset` epoch sec 供 agent arm wakeup）。单账户 7d 到顶 → `switch`（不再 `stop`，修旧 over-braking bug；只全池撞墙才停）。
- **`usage advise` 输出改形**——`PacingAdvice` 新增 `strength`（`weak|strong`·ADR-018 force mapping·引擎 emit / hook 直接消费）、`switch_candidate`（email）、`stop_dimension`（`5h|7d|null`）、`nearest_reset`（epoch sec|null）；**drop `hard_stop_7d`**（并入 `stop_7d`）；underuse accelerate 侧移除。
- **`selectAccount` 补对称 5h 硬闸**——原来只用单窗口（7d≥85%）硬闸、5h 仅软权重，会切到 `5h=99% / 7d 健康` 的号（落地即撞墙）且全池 5h 墙 / 7d 健康时不返 `NONE_ALL_EXHAUSTED`（该 stop 却空切）。新增 `CCM_SELECT_5H_HARD_GATE`（默认 `90`·非 95），gate 改对称 `p5≥90 || p7≥85`（p5 用 reset 恢复后的值·不误杀刚 reset 的号）→「candidate ⟺ 双窗口都健康」「`NONE_ALL_EXHAUSTED` ⟺ 无双窗口健康号」。令 pacing 的 `switch`/`stop` verdict 正确性闭合（switch 目标保证双窗口有余量·全池含 5h 墙侧才 stop 不空切）。ADR-024 §3.1 amend。
- 池聚合只在引擎（红线2/3）；换号 policy 硬闸（`deny→exit7`）仍在 `ccm account switch`。`using-ccm` / `pacing-and-estimation` skill 手册同 PR 锁步。
