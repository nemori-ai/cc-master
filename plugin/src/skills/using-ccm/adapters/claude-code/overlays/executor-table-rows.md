| `user` | 人类操作者 | 需要人工判断 / 操作 / 授权的任务 | — |
| `master-orchestrator` | 主线 orchestrator 自己 | 调度决策本身、replan、验收整合 | — |
| `subagent` | 后台 sub-agent（`run_in_background`） | 独立可并行的实现工作 | `in_flight` 时必须有真实 `handle`（后台句柄）；future task 不预填 |
| `workflow` | workflow 脚本（fan-out + join） | 跨多个 leaf 的并行 + 聚合 | `in_flight` 时必须有真实 `handle`；future task 不预填 |
| `external` | 外部第三方（CI / GitHub issue / PR review 系统） | 等外部开发者 / CI / review 系统推进 | references 含 `kind=issue`≥1；`handle` 可记录 issue URL/number；`artifact` 留给 PR / commit / report 等外部实际产出 |
