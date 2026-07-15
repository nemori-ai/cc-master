Claude Code 例：

```jsonc
{
  "verdict": "switch",
  "strength": "weak",
  "stop_dimension": null,
  "window_5h_pct": 92,
  "window_7d_pct": 20,
  "effective_n": 3,
  "switch_candidate": "c@c.com",
  "source": "account",
  "available": true
}
```

`hold` 静默；`throttle` 减速；`switch` 是候选事实而非越权许可；`stop_5h` / `stop_7d` 进入对应硬停决策。
