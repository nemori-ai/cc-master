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

## 失效类型

`motivation_conflict`（主体：行为约束） —— 删掉后 agent 在决策程序走到收口时,倾向于只给一句笼统的“看起来做完了”就转向 Stop,不逐条列出每条路径的状态与证据,让完成声明失去可信来源。

要求停下前逐路径写证据 ledger，直接宣称 done 明显更省事，动机完美的执行者知道格式就会照做。

## 为什么它随模型变强而更重要

模型越强,越能把“目标已达成”写成一段逻辑自洽、语气笃定的总结陈词,让缺失逐条证据的空判断读起来同样有说服力——跳过 ledger 的自我说服变得更容易得逞,而不是单纯更常撞见这个决策点。

## 失败形态

最隐蔽的形态是“形式合规但证据空心”——每条 task-id 都列了一行,但某几行的 evidence 栏填的是猜测性描述而非真实产物/日志指针,裁决行却仍写下“goal met”。
