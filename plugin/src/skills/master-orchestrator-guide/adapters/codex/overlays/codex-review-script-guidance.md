Codex 自身作为 master-orchestrator 时，第二端点验收不需要经 Claude Code skill-dir 脚本路径。要拿独立视角，就显式派一个独立 Codex subagent / cloud task / `codex exec` review-only 任务，只给 diff + 验收契约，并记录 agent id / task id / 输出文件作为 handle。
