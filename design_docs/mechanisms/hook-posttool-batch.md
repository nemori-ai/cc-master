# 机制契约：`hooks/scripts/posttool-batch.sh`

> 类别：hook（`PostToolBatch`，纯 bash + awk）。源码：`hooks/scripts/posttool-batch.sh`。WIP 过调度软警告（H5）。**只软提示、永不 block。**

## 触发输入
- `PostToolBatch` 事件（一批并行工具调用解析完后），stdin JSON 含顶层元数据（`session_id` / `agent_id` / ...）+ `tool_results[]`。
- 读 home 下 `*.board.json`。

## 业务流
1. **stdin 缩到顶层字段流**（`stdin_top_fields` awk）再 grep `session_id` / `agent_id`——`tool_results[]` 内同名字段整体丢弃（防主线 batch 的工具输出含 `"agent_id"` 误判 sub-agent·CODEX10）。
2. **sub-agent 闸（红线 4）**：顶层 `agent_id` 非空（sub-agent 上下文）→ 静默 `exit 0`（编排软警告绝不泄漏给单元 worker——把指挥的乐谱递给乐手）。
3. **武装闸 `board_matches`**（同其它 hook，只读 root owner）扫本 session 的 active 板。
4. **逐板独立**对各自 board-local cap 评估：数 ITS `in_flight`（`tasks_region` 内）= N，读 ITS top-level `wip_limit`（`board_root_stream` 内，防 task/log 里的 wip_limit 冒充）= M；缺/非数字 M → 跳过该板；N ≤ M → 该板不警告；N > M → 贡献携该板数字的警告。**绝不跨板聚合**（防 false-warn 两块各自合规的板、或大 cap 板掩护小 cap 板·codex round-2）。
5. 无匹配 active 板 / 无板超 cap → 静默 `exit 0`。

## 输出副作用
- 一块或多块板超各自 cap → stdout `PostToolBatch` additionalContext（非阻断警告，携 `N in_flight, wip_limit M`，建议下回合别加并行、defer 高 float、~75% 利用率）。**永不 `decision:block`、永不写 board。**

## 关键不变式
- **永不 block**——并行自由保留，只软 nudge（镜头 5 ~75% 利用率）。
- 只读 board、无 sidecar、只发 additionalContext。
- sub-agent 上下文（顶层 agent_id 非空）静默——编排软警告不下发给 leaf worker（红线 4）。
- `wip_limit` 是 board-LOCAL cap，逐板独立评估、绝不跨板聚合。
- `wip_limit` 从 board root top-level 读（防 task/log payload 里的冒充·红线 2）。

## 失败模式
- 每块板 `wip_limit` 缺/非数字 → graceful degrade（无阈值，跳过该板）。
- 未武装 → 静默 dormant。
