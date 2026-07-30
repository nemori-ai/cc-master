---
point: craft.contract-ssot
---

## 权威陈述

<!-- ccm:k:start point:craft.contract-ssot -->
## 根 2：契约即 SSOT

每个边界都有一份**先达成、被双方共同遵守**的合约。它在哪定、谁拥有、**改它的顺序**，比任何实现细节都先。

- **SDD**：spec 是**先于实现**的合约单一真相源——**整条 SDD 立在这根上**。改合约先改 spec，再改实现与测试。
- **DDD**：ubiquitous language 锁定术语；事件 / 命令 / 枚举名来自合约源，**临时起名在集成时必死**。
- **OOP**：domain 拥有接口 / Protocol，**不靠 wrapper 翻译**（DIP 的合约就是 spec）。
- **TDD**：test double 必须强制与真实后端**同样的约束**（constraint parity）——否则你测的是 mock 不是世界。

---

<!-- ccm:k:end point:craft.contract-ssot -->
