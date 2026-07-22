---
"@ccm/engine": minor
"ccm": minor
---

新增显式同步 tracked transport `ccm worker dispatch`，同时保持 `ccm worker run` 为零 board 副作用的 raw transport。新命令要求 idempotency key，只写 board 的 `agents[]`：在既有 board lock 内完成 prepare/唯一 claim/真实 spawn PID bind + agent-side task link/session identity 单调升级/sanitized terminal/reconciliation；绝不改 task status、handle、routing attempt 或 acceptance，也不持久化 prompt、stdin、secret、environment、完整 provider argv 或 provider output。

四个 harness 都提供真实 PID tracking；Codex 仅从已声明 `--json` transport 的 `thread.started.thread_id`、Kimi 仅从已声明 `--output-format stream-json` transport 的 `session.resume_hint.session_id` 升级 session/transcript/attach。Claude Code 可从显式 `--session-id`，或已声明 `--output-format json|stream-json` transport 的严格 `type=result / session_id` 信封取得 session identity，继而定位 transcript 并生成 `claude --resume <sid>` resume attach；绝不从任意模型文本猜身份，未观察到 session 证据时仍保持 PID-only，identity/attach 为 typed unavailable。显式 `--transcript` 指向已存在、可读的路径时，transcript 可独立为 typed supported；只有没有可读的显式 `--transcript` 时，transcript 才为 typed unavailable。Cursor 的 native session identity、SQLite transcript 与 exact attach 保持 typed unsupported，但显式 `--transcript` / `CURSOR_TRANSCRIPT_PATH` 可提供 raw transcript stream；无可读路径时仍可登记、stream 诚实为 none。claim 后 PID 前崩溃绝不自动重发；bind 失败取消并 reap owned process tree；terminal tracking failure 胜过 worker exit 0。`@ccm/engine` 新增 TrackedDispatch aggregate、BoardWriteAuthority/DispatchKey/TaskRef/RuntimeHandle value objects及 additive `agents[].dispatch` lint/model 合约。

Capability evidence 只允许 unavailable 与同值 supported 之间单调收敛；unsupported 与两者不可比，冲突 supported transcript/attach 也会 durable reconciliation。已落盘 closing replay 与 live terminal 使用同一套有界 persistence/reconciliation fallback，失败 receipt 只报告真正 durable 的 aggregate。
