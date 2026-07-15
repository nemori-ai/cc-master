### usage show（`ccm usage show --json`）

```jsonc
{ "available": true, "accounts_scope": "all", "effective_n": 3,
  "current": { "source": "account", "five_hour": { "used_percentage": 42 }, "seven_day": { "used_percentage": 50 } },
  "accounts": [ { "active": true, "snapshot_stale": false } ], "confidence": "high" }
```

无 registry 时 `accounts:[]`、`effective_n:1`；缺信号时 `available:false`。
