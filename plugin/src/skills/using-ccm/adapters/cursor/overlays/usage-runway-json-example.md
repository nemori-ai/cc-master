### usage runway（`ccm usage runway --json`）

```jsonc
{ "available": true,
  "billing_period": { "used_pct": 5.5, "hours_to_reset": 360, "verdict": "ample" },
  "source": "cursor-dashboard" }
```

Cursor 只返回账期 `ample | will-exhaust-before-reset | unknown`。
