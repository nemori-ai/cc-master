---
point: outside.unknown-and-amendment
---

## 权威陈述

<!-- ccm:k:start point:outside.unknown-and-amendment -->
无通道时有两个反面要一起堵：编造信心（「应该没问题吧」）和永久停摆（干等到用户上线）。协议五步：

1. **诚实记未知**——`ccm log add "假设 X 未验证·当前无外部通道" --kind finding` 记下这个假设本身；你**决定**在无通道时仍可逆推进（见下两步），这个决定才追加一条 `ccm jc add "决定在假设 X 未验证时可逆推进" --category drift --severity <按风险>`（`pending_review`）——jc 记的是这个决定，不是假设本身。
2. **设计一个可逆、有限范围的实验**——小 blast radius、廉价接触现实：保留可回退层 + 加一个开关，或切一薄片对真实端点发一个探测请求看响应，而不是把整个东西不可逆地建在假设上。
3. **可逆地推进**，把「上线 / 扩大前必须验 X」记成一个真实校准节点（`ccm task add <id> --title "验证假设 X"`，靠 deps 自动门控），不是一句空话。
4. **绝不**编造证据 / 声称已验。
5. **绝不**无限阻塞整块 board——只有真卡在这个未知上的那条 path 才等，其余独立就绪工作照常派。

**可逆性把「必须先验证」松绑成「先可逆地试、边试边接触现实」**——这正是它与闭门造车的分界：闭门造车是*不可逆*地大投入在未验证假设上；可逆有限实验是把 blast radius 压到能安全试错。假设既不可证实也不可证伪时，「没有凭证」本身就是答案——如实记下它，别把「找不到反驳」误当成「已被证实」。

## 组件 E — 外部证据改了 goal 语义 → 走 amendment（不静默漂移）

外部证据推翻的假设，若改变 outcome / scope / acceptance / 关键约束 / 权限边界，就是一次**目标语义变更**：过 `references/goal-contract.md` 的 Delta Classifier 判 `amendment`，走它的 amendment 流程（revision +1、逐个重跑受影响节点的 Trace Test、surface 用户确认）；若此前为「决定基于它推进」记过一条 jc，一并 `resolve` 成 `overturned`——若只是一条待验证假设（log note + 校准 task，未曾决定推进），直接收尾那条校准 task 并 `log add` 记下证伪结果即可，无需 jc。

**绝不**静默把下游实现细节改成新方向、当作没事发生——那正是要防的 scope 漂移。若外部证据只是实现细节的细化、不改 acceptance，那是 `in-scope`，`ccm log add … --kind finding` 记事实即可。

外部证据是 amendment 的**触发源**；amendment 的**机制**（怎么 amend、revision 规则、重切纪律）归 `references/goal-contract.md`，本文不复述。

<!-- ccm:k:end point:outside.unknown-and-amendment -->
