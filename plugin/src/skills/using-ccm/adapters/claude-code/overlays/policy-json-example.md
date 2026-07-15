### policy show / set

`ccm policy show --json` 的 `data` 包含 `{policy,effective}`；`ccm policy set ... --json` 返回写入后的 policy。决策层只读 `.data.effective.autonomous_account_switch`，agent 不自授权。

```json
{ "policy": { "autonomous_account_switch": "deny" }, "effective": { "autonomous_account_switch": "deny" } }
```
