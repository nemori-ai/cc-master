直接 file-edit 目标 board（`Write`/`Edit`/`MultiEdit`，或 `Bash` 用 `sed`/`echo`/`tee`/`cat >` 手改）会被 PreToolUse hook **当场 deny**。手改绕过写关卡会静默腐蚀 deps 图 / 状态机 / 窄腰——机制层直接不给你这条路。
