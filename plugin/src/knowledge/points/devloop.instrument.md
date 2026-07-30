---
point: devloop.instrument
---

## 权威陈述

<!-- ccm:k:start point:devloop.instrument -->
## 心智锚 3:测试 / 检查 = 你的测量仪器(梯度的来源)

没有测量,优化就是闭眼下山。**先架好仪器,再下降**——这正是 TDD 的优化学解读:先写验收 / 测试 = 先把目标函数和测量装置摆好,之后每一步都有读数。

- 一次**失败不是噪声,是梯度**:它精确告诉你"哪里、往哪个方向调"。**读懂这次失败** > 盲目再改一版。
- 测不了的东西优化不了。任务里若有"说不清怎么测"的验收维度,那一维你是闭眼的——把它变可测,或显式标注它没法机械验收(留给人验)。
- 先校准仪器,再相信梯度:flaky test、错 endpoint、mock-only 检查、过期 fixture、不可复现失败,都会给你假梯度。TDD 的红绿铁律和 constraint parity 怎么做,见 `engineering-with-craft`;本 skill 只讲它们在优化 loop 里的位置。

---

<!-- ccm:k:end point:devloop.instrument -->
