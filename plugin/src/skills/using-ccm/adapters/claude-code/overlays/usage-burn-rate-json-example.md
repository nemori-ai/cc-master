### usage burn-rate（`ccm usage burn-rate --json`）

```jsonc
{ "available": true,
  "five_hour": { "used_pct": 42, "burn_pct_per_hour": 8.4, "method": "finite-diff" },
  "seven_day": { "used_pct": 50, "burn_pct_per_hour": 3.1, "method": "finite-diff" },
  "source": "account", "confidence": "medium" }
```

不可算时 `burn_pct_per_hour:null`；两窗都缺时 `available:false`。
