---
point: verification.endpoint-procedure
---

## 权威陈述

<!-- ccm:k:start point:verification.endpoint-procedure -->
**end-to-end argument**（Saltzer-Reed-Clark, 1984）：一个放在低层的功能，相对于在端点实现它，往往是冗余的；正确性的最终保证必须活在端点。

- **你独立验收** —— 你**亲自跑闸**、**亲自读 diff**。低层 agent 那句"所有质量闸都绿"只是一个不可信的性能优化（agent 自报已经一再出错）。
- **gate-green 必要、但不充分** —— 过闸不代表改动正确；你仍然得读 diff。
- **null / 空 review 一律算未通过** —— 一个空的或缺席的 review 绝不是默许放行。这是 silent-pass-through 守卫。
- **靠在真实输入上*跑*来验，不靠纸上读。** 真实缺陷里出人意料地有一大块是 regex / shell / 边界 bug——它们在纸上看着对，只在真实数据或真实环境里才现形——比如一个 `grep -c` 在零匹配时吐出 `"0\n0"`、一条 shell pipe 的环境变量赋值 scope 落到了错误的一侧、一个 frontmatter regex 假设了一行根本不存在的空行。一次 LLM 二审*读*能抓**契约**违背；唯有一次真正的*跑*能抓**运行时**崩溃。两者都做——读 diff **并**对一个真实 fixture 执行闸。

验收是续跑缓存（§1）的校验步骤：唯有一个既存在**又**通过这道端点检查的产物，才算 done。

<!-- ccm:k:end point:verification.endpoint-procedure -->
