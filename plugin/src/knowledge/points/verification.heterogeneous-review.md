---
point: verification.heterogeneous-review
---

## 权威陈述

<!-- ccm:k:start point:verification.heterogeneous-review -->
单层端点验收（你亲跑闸 + 读 diff）仍会漏同族盲区与契约误读。**第二视角**补的是另一双眼睛——原则是 **产出模型族 ≠ 验收模型族**（异构），不是「再派一个同族 subagent」或「同族升一档再读一遍」。同族复读不算第二视角。

**何时强制（方案 A）**：仅对 **高杠杆裁决**（独立 review / 二审 / 端点验收节点本身 / 架构仲裁）与 **临界路径上 correctness-critical 的 `done`**。常规 float / 机械叶不强制——成本可控；鼓励但不强制。

**硬约束**：

- **换族，不换壳**：验收方必须来自与产出方不同的模型家族（Claude ↔ GPT/Codex ↔ Grok 等，以当前 host 可用集合为准）。
- **只喂 diff + 验收契约**：绝不夹带「我认为这是对的」之类 framing——否则第二视角退化成你的回声。
- **不是跑闸的替代品**：你仍亲跑闸、仍读 diff；第二视角抓契约违背与同族盲区。
- **空审 / 调用失败 = 未通过**：silent-pass-through 守卫（§3）不变。

各 host 上「怎么换族」的机制（脚本 / Task / 带外 CLI）见下——原则在此，管道在 adapter：

{{HETEROGENEOUS_REVIEW_MECHANISM}}

**跨族二审的收益不对称**——用更强模型审弱模型的产出收益最大；反过来让明显更弱的模型审明显更强模型的产出，收益薄，且弱 reviewer 的「纠错」可能改坏正确产物。所以：

- 产出方档位 ≤ 验收方档位、或两者相当时，认真对待 `needs-attention`，按下面四档正常核对。
- 产出方档位明显强于验收方时，`needs-attention` 的可信先验下调——更可能落进第④档（noise），但仍**逐条核对**，不能因档位差整体跳过。
- 这条只调怀疑权重，**绝不动摇**空审 / 失败 = 未通过。

**一条 finding 的说服力不是它的正确性证据。** 措辞斩钉截铁与潦草，在「是否属实」上权重相同——只认产物上可复核的事实。

**派活时只给 diff + 验收契约，绝不夹带你的结论。** 无论派给哪一族的第二视角，喂进去的**只有**待验 diff + 该节点 DoD / acceptance。

**verdict 是 data，不是终审——你仍逐条对着产物重读。** 第二视角吐回的每条 finding 是一份**观测**；不把 `needs-attention` 当自动 replan、也不把 `approve` 当自动 done，逐条拿回产物上核（RECONCILE）——**先匹配先赢**，落进四档之一：

- **① contract-misread（契约误读）**——finding 揭示的是**你给的验收契约本身不清 / 有歧义**。→ 先**修契约**，再**重验**。
- **② valid + actionable（真问题、可动手）**——产物里货真价实的缺陷。→ **`Replan(feedback)`**，返工后再验。
- **③ valid trade-off（真实权衡）**——属实但是有意设计取舍。→ 记入 board log，并 **surface 用户**。
- **④ noise（误报）**——reviewer 缺上下文。→ 记一句为何是噪声，不动产物。

只有当**每条 finding 都落定**、且（若机制吐结构化 verdict）`approve` + review 非空 + diff 确实亲手读过，这个节点才 → **`FinalResponse`**（done）。**空 review / 调用失败 → 一律未通过**——绝不默许放行。

---

<!-- ccm:k:end point:verification.heterogeneous-review -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后，agent 拿到第二视角 verdict 容易走捷径——把 approve 当自动通过、把 needs-attention 当自动 replan，或因对方模型档位较弱就整体略过，'第二双眼睛'变成没有约束力的仪式。

主体是异构二审的原则（换族不换壳、收益不对称）与 finding 四档 reconcile 判据，是一套方法。

## 边界

当前 host 客观上只有单一模型族可调用（没有第二家族的验收工具/账号）时，这条约束因资源不可得而无法满足，只能退化为同族复核并显式标注局限，不能假装已完成异构复核。

## 失败形态

隐蔽违反：四档 RECONCILE 表面每条都归了类，但落进 noise 的理由是空洞套话（只写'reviewer 缺上下文'不说缺什么），形式上完成了归类，实质没有真的对着产物核对。
