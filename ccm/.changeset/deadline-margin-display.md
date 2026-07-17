---
"@ccm/engine": minor
"ccm": minor
---

交付 DDL margin/风险状态暴露到用户可见面（issue #149·契约 §4.3 验收项 8·D6）：把 `ccm estimate deadline-risk` 的 verdict 接进既有的只读展示面，**不重算算法**（复用单一 SSOT·红线3）。

- **`ccm estimate forecast`**：板有 `asserted`/`confirmed` DDL 时，`--json` 输出附 `deadline_risk` 摘要块（`deadline`/`deadline_state`/`time_remaining_hours`/`risk_band`/`strength`/`on_time_probability`/`margin`/`confidence`），人读输出加 `DDL:` + `DDL margin:` 两行（margin 带符号·负=越过 DDL）。摘要 margin 与 `estimate deadline-risk` endpoint 逐字段一致（复用 `computeDeadlineRisk`·单一计算路径）。无 DDL / `none` / `pending` → `deadline_risk: null`（诚实 n/a·不假绿·不为无 DDL 板白跑 MC）。
- **`ccm status-report`**：report 附一个**确定性、board-derived** 的 `deadline` 块（`present`/`state`/`at`/`precision`/`kind`/`time_remaining_hours`/`overdue`）+ 人读一行（settled → 截止时刻/剩余/OVERDUE；`none` → confirmed no-ddl；缺失 → 无行）。不跑 MC/不读跨板语料（保 board-hash 缓存语义）；相对 forecast 的 margin/risk band 指向 `ccm estimate deadline-risk`。
- **web-viewer**：mission 只读投影新增 board-derived `deadline` 事实（截止时刻/状态/精度/硬软）；goal-contract 面板渲染 deadline 行 + 实时倒计时/OVERDUE 徽章（客户端挂钟·同 board-watchdog 倒计时）+ overdue 提示 callout。viewer 不跑 MC——margin/risk band verdict 归 `ccm estimate deadline-risk`。

诚实降级贯穿三面：无 DDL 不崩、不假显示；`unknown` band 照实透出、绝不映射绿色。
