---
point: ccm.cmd.calibration
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.calibration -->
## namespace calibration（显式写校准语料）

### calibration capture

写 home 级 calibration store，**board 只读**。语法 / flags / 例 / 幂等键 / 落盘路径 / 边界一律以 `ccm calibration capture --help` 为准。

只有一条 help 不说的（help 说「是什么」，不说「为什么这么设计」）：

- **`board_id` 是 canonical board 文件路径的 SHA-256**，不是 goal 或 session。同一块板在不同采集时刻因此保持同一身份——**用可变的 goal 当实体键，会让同一块板的历史观察在改过 goal 之后断成两截**。

---

<!-- ccm:k:end point:ccm.cmd.calibration -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型无法正确调用 calibration 命令，不知道 capture 的参数（scope/as-of/runs）、幂等性保证、与 deadline-risk 的分工。

calibration capture 的落盘路径、board_id 身份算法与幂等键都是本实现的具体事实。
