| `subagent` | Codex 子代理或等价并行 worker | `ready` / `blocked` future task 可先写 `executor=subagent`，表达将由 Codex subagent 执行的计划；真实派发时，CLI / App 里显式要求 Codex subagent，API / tool 会话里先 `tool_search` 发现并调用 `multi_agent_v1.spawn_agent`。当前 cc-master 不把 Claude Code `run_in_background` 语义投影成 Codex 原语。 | 只有真实 spawn 返回的 agent id / thread / run 引用才是 `handle`；先回填该真实 handle，再转 `in_flight`。future task 不预填 placeholder，也不能用当前主会话 id 冒充。 |
| `workflow` | 未支持 | Codex adapter 没有 verified `Workflow` 等价物；不要为了表达“复杂任务”写 workflow。 | 不应进入 `in_flight`；拆成可追踪 task 或用 `external`。 |
| `external` | 外部系统 / 外部调度 | GitHub issue、CI job、人工任务、系统 cron、`codex cloud exec` 等不在当前 session 内的 work item。 | references 含 `kind=issue`≥1；`handle` 可记录 issue URL / run id；`artifact` 只在外部实际产出（PR / commit / report / run）可验时填写。 |
| `user` | 用户 | 等人拍板、提供凭据、确认策略或回答需求。 | `blocked_on:"user"` + `decision_package`。 |
| `self` | 当前主线 agent | 只用于极小的编排维护动作；不要把单元实施伪装成 self。 | 写清为何不派发。 |
