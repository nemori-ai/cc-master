Codex 例：

```jsonc
{
  "verdict": "hold",
  "strength": "weak",
  "stop_dimension": null,
  "window_7d_pct": 18,
  "rolling_24h": { "state": "within-daily-pace", "confidence": "medium" },
  "effective_n": 1,
  "switch_candidate": null,
  "source": "codex-app-server",
  "available": true
}
```

`hold` 静默；`throttle` 与 `stop_7d` 只由 7d authority 产生。rolling-24h 不单独硬停，任何换号字段都必须保持无动作权威。
