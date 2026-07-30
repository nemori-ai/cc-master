---
point: sdd.drift-red-line
---

## 权威陈述

<!-- ccm:k:start point:sdd.drift-red-line -->
## 红线：spec 漂移是契约谎言

**违背字面就是违背精神。** 没有哪个项目特殊到 spec 可以不是 SSOT。

### spec 漂移的定义

实现悄悄偏离 spec 而不更新 spec。结果：spec 声称一件事，实现做另一件，消费者相信 spec——这是一个**主动的谎言**，不只是文档过期。

### 常见 rationalization（借口 → 现实）

| 借口 | 现实 |
|---|---|
| 「这个变更太小，不用改 spec」| 消费者不知道「太小」的边界在哪；小漂移累积成大断裂 |
| 「先改实现，之后再补 spec」| 「之后」永远不会来；补的 spec 是从实现逆向生成的，不是合约 |
| 「spec 是理想状态，实现可以稍微灵活」| 这不是灵活——这是 spec 失去了裁判地位；消费者应该依赖谁？ |
| 「只有我们自己消费，spec 可以松一点」| 「只有我们自己」是当下状态；六个月后你的代码会成为别人（或自己）的遗留系统 |
| 「测试还在过，没有问题」| 测试验的是实现历史快照，不是 spec 合约；测试绿 ≠ spec 没漂移 |

**与根 2（契约即 SSOT）和根 5（证据优于声称）同源**：spec 漂移是同时违背两根的行为——它既让 spec 不再是 SSOT，又用「感觉没问题」代替了「有证据 spec 与实现对齐」。

### 预防机制

1. **spec 有版本**：spec 文件进版本控制，修改 spec 必须有 commit，不能只改实现不改 spec。
2. **breaking change 显式标注**：在 spec 里加 `breaking:` 标记或 deprecation notice，消费者可以 grep。
3. **spec-test 连接可追溯**：每一条 spec 断言（不变式 / 行为示例）对应的测试用注释 / 测试名标注「验证 spec §N.M」，评审时可以检查覆盖率。
4. **PR review 问「spec 改了没」**：任何改变接口行为的 PR，第一问是「spec 改了没」——没改 spec 就没有权利说这个变更是对的。

---

<!-- ccm:k:end point:sdd.drift-red-line -->
