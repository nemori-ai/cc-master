## namespace policy

`board.policy.autonomous_account_switch` 是用户所有的 `allow | deny` 权限闸。`ccm policy show --json` 只读原值与 effective；`ccm policy set --autonomous-account-switch=allow|deny --user-authorized` 写入并记审计。agent 绝不自行添加 `--user-authorized`，也不把缺省 `allow` 当成应当换号的指令。
