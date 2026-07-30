---
point: pacing.honest-fields
---

## 权威陈述

<!-- ccm:k:start point:pacing.honest-fields -->
## 诚实字段：什么时候降低对预测的信任权重

估算引擎对冷启动 / 数据不足是**诚实**的——它不假装精确。读预测**先读这几个诚实字段**，命中即**降低信任权重**（别拿一个 cold-start 点估当承诺）：

- **`coverage_pct` 低**（如 <50%）→ 估值通道覆盖不足、吞吐通道主导（#NoEstimates），ETA 更粗。
- **`source:"no-history"` / `"local-derived-approx"`**→ 没有可校准的历史语料（退原估值）/ 账户口径降级——方向性参考，非精确。
- **`confidence:"low"`**→ 引擎自评低置信。
- **conformal `interval` 很宽**（p95 与 p50 差距大）→ 不确定性大，区间比点估诚实。
- **`5% 硬墙`**：`p95` 永远是 95% 分位、不是最坏情况——别把 p95 当「绝对上限」。

**用区间不用点估**：报 ETA / cost 时带上 p50–p80–p95 区间（或至少 p80），而非一个假精确的单点数——这正是「量力而行」镜头「方向性走廊而非精确收尾」在估算侧的镜像。

<!-- ccm:k:end point:pacing.honest-fields -->
