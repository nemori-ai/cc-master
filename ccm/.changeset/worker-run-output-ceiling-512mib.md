---
"ccm": minor
---

抬高 `ccm worker run` 的 stdout/stderr 输出上限：硬 ceiling 与默认值从 32 MiB 升至 512 MiB，stderr 独立上限从 8 MiB 升至 512 MiB。codex worker 的 stderr 动辄几十 MB，旧 8 MiB 独立上限会截断失败派发最需要的诊断流，32 MiB stdout ceiling 也会截断多十 MB 级真实载荷；新上限容纳多十 MB 级输出且仍 bound 失控 child（上限是 cap 不是预分配）。`--max-output-bytes` 允许范围相应变为 256..536870912、默认 536870912。
