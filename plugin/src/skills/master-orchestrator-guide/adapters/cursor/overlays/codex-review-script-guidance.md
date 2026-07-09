Cursor 自身作为 master-orchestrator 时，第二端点验收可显式派一个独立 Task subagent（review-only），只给 diff + 验收契约，并记录 subagent id / 输出文件作为 handle。若环境有 `codex` CLI，也可带外调用 `codex exec review`；不要假设 Claude Code skill-dir 脚本路径。
