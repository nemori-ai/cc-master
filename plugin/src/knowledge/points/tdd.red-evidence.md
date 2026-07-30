---
point: tdd.red-evidence
---

## 权威陈述

<!-- ccm:k:start point:tdd.red-evidence -->
## 验证失败原因，不只是看它失败

这一点值得单独强调，因为它是最常被跳过的。

「我看到它失败了」和「我确认它因为正确的原因失败了」是两件不同的事。

**正确的失败**：测试失败，因为被测功能不存在（`AttributeError: module has no attribute 'new_feature'`、`AssertionError: expected X, got None`）——说明测试覆盖了正确的路径，继续写最小通过代码。

**错误的失败**：测试失败，因为测试本身有 bug（`ImportError`、fixture 名字打错、语法错误、断言写反了）——此时修的是**测试**，不是实现，修完之后**重新验证 RED**。

**危险的通过**：测试在 RED 阶段就通过了——意味着测试覆盖的是已有行为（不是新行为），或者测试根本没经过真正的被测路径。这种情况删掉，重新写。

不读失败输出、不确认失败原因，TDD 就退化成了「写完产码再写测试然后看一眼通过」——铁律的全部意义都在这个确认里。

---

<!-- ccm:k:end point:tdd.red-evidence -->
