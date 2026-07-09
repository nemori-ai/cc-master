---
name: authoring-workflows
description: '当你在 Cursor IDE Agent 下想写 / 调试 / 启动 cc-master 的 workflow 脚本、或想套用 Claude Code dynamic-workflow API 时用——这是 Cursor adapter 的 unsupported stub。Triggers: 在 Cursor 里提到 Workflow 工具、`agent()` / `parallel()` / `pipeline()` / `phase()` / `workflow()`、后台 task id、workflow resume/cache/budget、"能不能把 Claude Code workflow 直接搬到 Cursor"。Do NOT use when 只是做普通 Cursor 任务规划、普通 shell 脚本、或使用已验证的 Cursor 产品面并行能力（Task + background shell + `/loop`）；本 stub 只负责阻止把 Claude Code Workflow API 当作 Cursor 可用机制。启用真正 Cursor 版前必须验证 deterministic multi-agent workflow execution、后台执行与完成通知、resume/cache 语义、脚本 runtime/API 形状、资源上限与 budget 报告。'
---

# Workflow Authoring Is Not Ported To Cursor Yet

Do not use the Claude Code Workflow API instructions in Cursor IDE Agent.

This skill is intentionally a stub in the Cursor projection because the source skill teaches Claude Code dynamic workflows: `Workflow` tool, `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, background task IDs, and `<task-notification>` completion.

Before enabling this skill for Cursor, verify and document a Cursor-native equivalent for:

- deterministic multi-agent workflow execution;
- background execution and completion notification;
- resume/cache semantics;
- supported scripting runtime and API shape;
- resource caps and budget reporting.

Until then, use Task subagent + background shell dispatch per master-orchestrator-guide rather than pretending the Claude Code Workflow tool exists.
