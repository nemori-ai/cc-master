### policy show（兼容诊断）

`data.policy` 可能含历史 `autonomous_account_switch`，但 Codex 的运行时 effective capability 始终是 no-switch。不要根据 stored `allow` 执行 account 命令。
