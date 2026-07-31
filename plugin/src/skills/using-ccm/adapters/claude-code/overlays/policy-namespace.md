## namespace policy

`board.policy.autonomous_account_switch` 是**用户对「后台容量层能不能自动替这块看板换号」的开关**（`allow | deny`，缺省 `allow`），不是给编排 agent 放权的开关。`ccm policy show --json` 只读原值与 effective；`ccm policy set --autonomous-account-switch=allow|deny --user-authorized` 写入并记审计。agent 绝不自行添加 `--user-authorized`，也绝不把缺省 `allow` 读成「我可以自己切号」。
