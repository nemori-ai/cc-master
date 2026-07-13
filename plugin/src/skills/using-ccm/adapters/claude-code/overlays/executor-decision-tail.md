这个任务需要多个 leaf 并行 + 聚合产物？
  ↓ 是 → executor: workflow  （真实派发后回填 workflow handle，再转 in_flight）
  ↓ 否

→ executor: subagent  （真实派发后回填后台 handle，再转 in_flight）
