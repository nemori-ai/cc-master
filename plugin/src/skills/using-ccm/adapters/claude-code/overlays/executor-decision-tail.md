这个任务需要多个 leaf 并行 + 聚合产物？
  ↓ 是 → executor: workflow  （带 --handle <workflow句柄>）
  ↓ 否

→ executor: subagent  （带 --handle <后台句柄>）
