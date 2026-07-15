### usage burn-rate（`ccm usage burn-rate --json`）

```jsonc
{ "available": true,
  "billing_period": { "used_pct": 5.5, "burn_pct_per_hour": 0.2, "method": "finite-diff" },
  "source": "cursor-dashboard" }
```

不可算时 `burn_pct_per_hour:null`；账期信号缺失时 `available:false`。
