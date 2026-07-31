### policy show / set

`ccm policy show --json` 的 `data` 包含 `{policy,effective}`；`ccm policy set ... --json` 返回写入后的 policy。`.data.effective.autonomous_account_switch` 说的是**后台自动换号在这块板上是否放行**，不是 agent 的换号许可；agent 不自授权。

```json
{ "policy": { "autonomous_account_switch": "deny" }, "effective": { "autonomous_account_switch": "deny" } }
```
