## namespace policy（kimi-code 兼容读取）

`ccm policy show --json` 可以诊断旧板保存的 `autonomous_account_switch`，但 kimi-code adapter 的 account switch 永久不可用：stored `allow` 不创建 candidate、不授权 login/logout/credential mutation，也不改变 `effective_n=1`。不要在 kimi-code 下把 policy 翻成 `allow`；若需收紧旧板，只能在用户明确授权下写 `deny`。
