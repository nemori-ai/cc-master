| `subagent` | Cursor Task 子代理 | `ready` / `blocked` future task 可先写 `executor=subagent`，表达将由 Cursor Task 子代理执行的计划；真实派发时再调用 Task tool。当前 cc-master 不把 Claude Code `run_in_background` 语义投影成 Cursor 原语。 | 只有真实 Task 结果返回的 subagent id 才是 `handle`；先回填该真实 handle，再转 `in_flight`。future task 不预填 placeholder，也不能用当前主会话 id 冒充。 |
| `workflow` | 未支持 | Cursor adapter 没有 verified `Workflow` 等价物；不要为了表达“复杂任务”写 workflow。 | 不应进入 `in_flight`；拆成可追踪 task（Task / Shell）或用 `external`。 |
| `external` | 外部系统 / 外部调度 | GitHub issue、CI job、人工任务、系统 cron 等不在当前 session 内的 work item。 | references 含 `kind=issue`≥1；`handle` 可记录 issue URL / run id；`artifact` 只在外部实际产出（PR / commit / report / run）可验时填写。 |
| `user` | 用户 | 等人拍板、提供凭据、确认策略或回答需求。 | `blocked_on:"user"` + `decision_package`。 |
| `self` | 当前主线 agent | 只用于极小的编排维护动作；不要把单元实施伪装成 self。 | 写清为何不派发。 |
