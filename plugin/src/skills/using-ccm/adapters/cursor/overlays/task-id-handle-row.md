| `task-id` | Cursor Task 子 agent：value = Task 返回的真实 id。原生 SQLite `state.vscdb` 不可 tail；只绑定该 Task 子 agent 自己的纯文本日志，父日志不能作 fallback。 | 有精确子日志才传 `--transcript`；否则保持无源。 |
