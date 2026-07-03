| `subagent` | Codex 子代理或等价并行 worker | 只有在你已经真实启动了可 recon 的 Codex 并行工作时才写；当前 cc-master 不把 Claude Code `run_in_background` 语义投影成 Codex 原语。 | `handle` 必填：记录 thread/run/terminal/外部任务引用，足以让后续对账。 |
| `workflow` | 未支持 | Codex adapter 没有 verified `Workflow` 等价物；不要为了表达“复杂任务”写 workflow。 | 不应进入 `in_flight`；拆成可追踪 task 或用 `external`。 |
| `external` | 外部系统 / 外部调度 | GitHub issue、CI job、人工任务、系统 cron、`codex cloud exec` 等不在当前 session 内的 work item。 | `handle` 或 `artifact` 必填：写可检查的外部 URL / run id / 文件路径。 |
| `user` | 用户 | 等人拍板、提供凭据、确认策略或回答需求。 | `blocked_on:"user"` + `decision_package`。 |
| `self` | 当前主线 agent | 只用于极小的编排维护动作；不要把单元实施伪装成 self。 | 写清为何不派发。 |
