---
point: workflow.pattern-test-repair
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-test-repair -->
## test-generation-and-repair

**何时：** 你想给很多 module 生成 test suite，*并且*要让每个失败的 suite 被自动驱动到绿。
把一个 fan-out 的 test-generation stage 和一个 per-suite 的 **self-repair-loop**（带有界的
attempt cap）组合起来。用它来「跨 codebase 生成并稳住 test」，而不是处理单个 test 文件。

**由谁演示：** `assets/examples/test-generation-and-repair.js`。

---

<!-- ccm:k:end point:workflow.pattern-test-repair -->
