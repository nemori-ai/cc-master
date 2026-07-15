### usage burn-rate（`ccm usage burn-rate --json`）

```jsonc
{ "available": true,
  "seven_day": { "used_pct": 18, "burn_pct_per_hour": 1.2, "method": "finite-diff" },
  "rolling_24h": { "state": "within-daily-pace", "confidence": "medium" },
  "source": "codex-app-server" }
```

rolling-24h 只作 advisory；不可算时保持 `null` / `unknown`。
