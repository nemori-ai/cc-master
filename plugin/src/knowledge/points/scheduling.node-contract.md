---
point: scheduling.node-contract
---

## 权威陈述

<!-- ccm:k:start point:scheduling.node-contract -->
派发一个节点之前，先定义它的契约：

- **Input deps** —— pin 住每条依赖喂进来的上游产物（version / hash）。依赖 pinning 与 stale 检测见 `resume-verify.md`。
- **Output schema** —— 按下游的需要来塑形：`verdict` · `evidence` · `confidence` · `blockers` · `open-q`（open questions）· `artifacts`。
- **Success predicate** —— 该节点算 done 的显式条件。**优先给可执行的验收物**——一个会失败的测试、一份评分标准、一个真实样例或反例——而不是散文式的验收描述。散文会被你和执行者各自脑补成两个东西，分歧要到交付才暴露；可执行的验收物当场就能判过没过。实在拿不到可执行物时，退回「一句无歧义、可观察的判据」，别写成一段愿望。
- **Timeout + budget** —— 该节点的时间 / token 上限。
- **Escalation condition** —— 该节点何时应当 STOP 并返回一个 escalation 结果，而不是硬撑下去（见 `dispatch.md` 的 re-altitude）。

没有契约的节点无法被安全派发、无法在端点验证、也无法从一个 content hash 续跑。

> **字段怎么落进 board**（`acceptance` / `estimate` / `deps` / `executor` 怎么写、撞哪条校验规则）见 {{USING_CCM_BOARD_MODEL_POINTER}}——本文只给排期判断，不教 ccm 命令与字段取值。
<!-- ccm:k:end point:scheduling.node-contract -->
