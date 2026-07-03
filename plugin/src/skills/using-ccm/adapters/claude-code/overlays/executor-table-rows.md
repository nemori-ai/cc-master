| `user` | 人类操作者 | 需要人工判断 / 操作 / 授权的任务 | — |
| `master-orchestrator` | 主线 orchestrator 自己 | 调度决策本身、replan、验收整合 | — |
| `subagent` | 后台 sub-agent（`run_in_background`） | 独立可并行的实现工作 | `handle`（后台句柄） |
| `workflow` | workflow 脚本（fan-out + join） | 跨多个 leaf 的并行 + 聚合 | `handle` |
| `external` | 外部第三方（CI / 第三方服务 / PR review 系统） | 等 CI 跑完、等人工 review | references 含 `kind=issue`≥1 |
