### usage runway（`ccm usage runway --json`）

```jsonc
{ "available": true,
  "seven_day": { "used_pct": 18, "hours_to_reset": 120, "verdict": "ample" },
  "source": "codex-app-server" }
```

Codex 只返回 7d `ample | will-exhaust-before-reset | unknown`；rolling-24h 不新增硬窗口。
