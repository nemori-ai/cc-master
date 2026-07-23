---
"ccm": patch
---

agent-stream 无源归因诚实化：区分「记录没绑上源」vs「agent 类型不支持」

真实事故形状：codex agent 以 `task-id` handle 登记（未走 `ccm worker dispatch`）、无 `transcript_ref`，viewer 的旧文案「no readable stream source for this agent type yet」把可修的绑定缺口误说成 harness 类型不支持——用户据此误判「只有 claude 的 stream 能正常显示」（实测 0.22.0 三 harness 解析/渲染均正常，缺的只是 session 绑定）。

- `buildAgentStream` 无源 reason 按归因分流（新 `noSourceReason`）：
  - 可流式 harness（claude-code / origin / codex / kimi-code）+ 非 session-id handle 且无 transcript_ref → 点名绑定缺口（含 handle kind）+ 两条操作出口（`ccm worker dispatch` 自动绑定 / `ccm agent amend <id> --handle session-id:<sid>` 或 `--transcript <abs path>` 补绑）
  - cursor 系（`CURSOR_HARNESSES`，自 agent-probe 导出复用）→ 点名 SQLite `state.vscdb` 不可 tail + `CURSOR_TRANSCRIPT_PATH` / `--transcript` 两条出口（此前 session-id handle 的 cursor 会落进「transcript file not found yet」误导分支）
  - `transcript_ref` 不可读 / session-id 未落盘 / 未知类型三条原归因保留
- web-viewer `AgentInspector` 无流 fallback 文案同步改为点名绑定缺口 + 操作出口（stream 抽屉本就透传 server reason，不动）
- native subagent 的源定位按已实证 host 布局分流：
  - Claude Code 由父 session JSONL + `task-id:<agentId>` 派生 `subagents/agent-<agentId>.jsonl`
  - Kimi Code 由父 `agents/main/wire.jsonl` + Task 返回的 agentId 派生 `agents/<agentId>/wire.jsonl`，复用 Kimi typed-wire parser
  - 派生子文件尚未出现时返回明确无源，绝不回退父 transcript 把 orchestrator/main 事件冒充成子 agent
