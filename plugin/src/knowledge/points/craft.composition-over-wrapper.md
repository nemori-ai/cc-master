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

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后,agent 更容易为一层只转发、不改合约、不翻译语言、不挂载行为的包装找一个听起来专业的理由留下它——原文自己把这种层点名为 idle wrapper 红线。

主体是设计判据：一层要挣到开销（改合约/翻译/挂行为）、ACL 只放边界、继承仅限三个合法形，删掉后缺的是判断该不该加层的框架。

## 失败形态

新增一个 Service/Manager 类,方法体只是原样转发调用,不改参数、不改返回值、不做校验也不挂事件,但类名和文档字符串看起来专业,乍看像合理分层;或者一个继承关系只是为了复用几行代码,既不是 template-method、也不是契约 ABC、也不是泛型 family,却打着『复用』旗号长期存在。
