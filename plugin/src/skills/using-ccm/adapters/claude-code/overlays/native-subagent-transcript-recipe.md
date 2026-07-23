**Claude Code in-session subagent 登记配方（Task tool 派生）**：为让 viewer 选择 Claude transcript parser，创建登记时用具体 `--harness claude-code`，handle 用 Task 返回的 `task-id:<agentId>`，并把 master 的父 session JSONL 绝对路径作为定位锚：

```bash
ccm agent create --type subagent --harness claude-code --intent "<任务摘要>"
ccm agent bind <id> --handle task-id:<agentId> --transcript <父-session.jsonl>
```

viewer 由 `<父-session.jsonl>` 派生 `<父-session-去.jsonl>/subagents/agent-<agentId>.jsonl`，并按 Claude Code JSONL 解析。**父 transcript 只作定位锚**：子文件尚未落盘时返回无源，绝不把 master 的事件冒充成子 agent；文件出现后下一轮轮询自动命中。反模式：把 agentId 登成 `session-id`、漏 `--transcript`、或直接把父 transcript 当子 transcript。
