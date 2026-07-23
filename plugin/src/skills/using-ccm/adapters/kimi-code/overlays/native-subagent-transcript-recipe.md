**Kimi Code Task 子 agent 登记配方**：Kimi 在同一 session 下分别保存 `agents/main/wire.jsonl` 与 `agents/<agentId>/wire.jsonl`。创建登记时用具体 `--harness kimi-code`，handle 用 Task 返回的完整 agent id（例如 `agent-0`），并把父 main wire 的绝对路径作为 session 定位锚：

```bash
ccm agent create --type subagent --harness kimi-code --intent "<任务摘要>"
ccm agent bind <id> --handle task-id:<agentId> --transcript <session>/agents/main/wire.jsonl
```

viewer 由父路径与 agentId 派生 `<session>/agents/<agentId>/wire.jsonl`，并按 Kimi typed wire 解析。**父 main wire 只作定位锚**：子文件尚未落盘时返回无源，绝不把 main agent 的事件冒充成 Task 子 agent；文件出现后下一轮轮询自动命中。反模式：把 agentId 登成 `session-id`、漏父 main wire 锚、或把父 main wire 直接当子流。
