---
point: hitl.step6-ledger
---

## 权威陈述

<!-- ccm:k:start point:hitl.step6-ledger -->
这是 SKILL.md 决策程序所指向的权威定义。goal-hook 读 board 来给你的 Stop 设闸，但**它读不到你的推理**——所以每当这一回合走到决策程序 step 6，就把结论**连同验收证据一起写进对话和 board 两边**，用一个固定形态：

- **每条仍未关闭的路径一行**：`<task-id> · <status> · <blocker | evidence>`
- 然后**一行裁决**，恰好是以下之一：
  - `goal met` —— 每条路径都 `done`、且已在端点验过；
  - `legitimate waiting: every path blocked or surfaced` —— 每条剩余路径要么被一个 in-flight 后台任务卡住、要么在等一个用户回答；
  - `still working` —— 还有可排程的工作（那你根本不该在 step 6——回到决策程序顶端）。

hook 对 board 状态设闸；这份写下的 ledger 才是让"done"*可信*、而不只是被嘴上断言的东西。一句光秃秃的"看起来做完了"、拿不出每条路径的证据，**不算**一次有效的 Stop。

---

<!-- ccm:k:end point:hitl.step6-ledger -->
