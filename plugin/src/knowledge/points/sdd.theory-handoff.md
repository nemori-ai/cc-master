---
point: sdd.theory-handoff
---

## 权威陈述

<!-- ccm:k:start point:sdd.theory-handoff -->
## 与姊妹理论的衔接：四理论接力表

四个理论在 design→build→test 时间轴上有自然的接力关系，不是并列的四篇独立方法：

```
design ──────────── build ──────────── test
   │                  │                 │
  DDD                OOP               TDD
（领域建模）       （实现手艺）      （测试纪律）
   ↑
  SDD
（合约冻结，贯穿全程）
```

更精确地：

| 阶段 | 理论 | 做什么 | SDD 的角色 |
|---|---|---|---|
| **Design** | DDD | 发现 bounded context、ubiquitous language、aggregate 边界 | SDD 在此冻结**合约形状**：BC 间的接口签名 / 事件格式 / 命令结构先于实现定义好 |
| **Design→Build 交界** | SDD | 把 DDD 产出的术语和边界**形式化为 spec**（接口签名、schema、不变式列表）| SDD 是 DDD 建模成果的**可执行化**：把领域语言锁进合约里 |
| **Build** | OOP | 按 DDD 的领域模型实现——domain 拥有接口（DIP），类满足 spec 里的不变式 | 「domain 拥有接口」= OOP 的实现 *满足* SDD 的 spec；接口定义不在实现侧，SDD 说了算 |
| **Test** | TDD | 对着 spec 的行为示例 / 不变式 / 错误契约写失败测试，再让实现通过 | spec 是 TDD 的 **oracle**——红绿循环的「绿」定义来自 spec，不来自实现者自己的判断 |

**衔接规则**：
- SDD 冻结**合约形状** → DDD 在其上划 bounded context 与不变式**所有权**（谁负责维护这条不变式）→ OOP 实现到 spec（域对象的接口签名来自 spec，不是实现倒推）→ TDD 对着 spec 红绿。
- 不要跳过中间任何一步：没有 DDD 就没有领域语言，spec 的术语会漂移；没有 SDD 就没有 oracle，TDD 的测试只在验收实现的历史状态。

---

<!-- ccm:k:end point:sdd.theory-handoff -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道这四种理论之间存在设计→构建→测试的接力顺序，容易跳过某一环（直接从建模跳到写代码），或把它们当四篇互不相关的方法论各自套用，不知道后一环要吃前一环冻结下来的产物。

主体是 DDD/SDD/OOP/TDD 在 design→build→test 轴上的接力框架，缺了就不知道四套方法如何衔接。

## 失败形态

团队确实按顺序做了建模、写代码、写测试，看起来四步都走到了——但「形式化成合约」这一步被跳过了，领域建模的成果直接在写代码时口头拍板成接口，测试再照着这份口头接口写；测试全绿只证明测试和实现读的是同一份临时约定，不是证明实现符合一份独立冻结的合约。
