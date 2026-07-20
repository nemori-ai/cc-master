---
"ccm": minor
"@ccm/engine": minor
---

usage/quota 输出层重构(agent-facing 正确性 + 工效学):
- **cursor 多池**:`GetCurrentPeriodUsage` 的 first-party 与 usage-based/spend-limit 池不再塌成一个数,`UsageSignal` 新增 `pools[]`(named·`kind:first_party|usage_based`)承载多池,`billing_period` 保留兼容;machine-wide TARGETS 分列 cursor 两池;provider-model-facts 标注模型→池归属。
- **codex 按模型池**:`normalizeCodexRateLimits` 解析 `rateLimitsByLimitId`,每模型独立配额池透传(此前只读 legacy 顶层 primary/secondary·丢弃 per-model)。
- **machine-wide refresh_hint**:`safeQuotaReading` 新增可选 hint 字段,unavailable/expired target 携带同源可执行提示(含 agent_authorized/authorization),不再只有不透明 reason_codes。
- **agent-parse-proof**:`usage show` 新增顶层 plain-language `agent_summary`,一句话给出状态+可执行动作,消费 agent naive 读即得正确结论(此前窗口嵌 `current.*`、顶层空易致误判)。
- doc 锁步:using-ccm command-catalog + pacing-and-estimation usage-signals 补 kimi-code、多池/hint/agent_summary 描述。全 additive·现有消费方字段语义不变。
