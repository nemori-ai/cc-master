---
point: craft.composition-over-wrapper
---

## 权威陈述

<!-- ccm:k:start point:craft.composition-over-wrapper -->
## 根 3：组合优于包装

每多一层都要**挣到**它的开销——它得改变合约、翻译语言、或挂上行为。只「转发一下」的层是负债。

- **idle wrapper 红线**：无 hook、无翻译、无合约变化的层 = 死重，删。
- ACL（anti-corruption layer）只放在**边界**翻译外部语言，不渗进 domain。
- 继承只在三个合法形（template-method pipeline / class-var 契约 ABC / 泛型后端 family）里用，其余一律组合。

---

<!-- ccm:k:end point:craft.composition-over-wrapper -->
