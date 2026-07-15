### usage runway（`ccm usage runway --json`）

```jsonc
{ "available": true,
  "five_hour": { "verdict": "ample", "ceiling_pct": 90 },
  "seven_day": { "verdict": "ample", "ceiling_pct": 85 },
  "source": "account" }
```

每窗 verdict 为 `ample | will-exhaust-before-reset | unknown`。
