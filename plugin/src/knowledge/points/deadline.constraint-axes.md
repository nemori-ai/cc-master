---
point: deadline.constraint-axes
---

## 权威陈述

<!-- ccm:k:start point:deadline.constraint-axes -->
你已经在一条走廊里配速：**配额消耗**走廊（5h / 7d / billing-period 窗口，别顶满）。DDL 是**另一条正交的轴**——**挂钟时间**。配额没烧穿不代表你按期，按期也不代表配额够。两条各有各的信号源、各有各的收紧动作：配额侧读 `usage` verdict（消费机制见 `pacing-and-estimation`），DDL 侧读 `estimate deadline-risk` verdict（同上）。别拿一条替另一条判。

<!-- ccm:k:end point:deadline.constraint-axes -->
