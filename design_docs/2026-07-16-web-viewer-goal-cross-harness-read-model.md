# Web Viewer：Goal Contract 与 cross-harness 只读投影合同

## 问题

ccm board 已经能表达 Goal Contract、任务规划和 cross-harness routing，但 Web Viewer 仍只展示旧式 goal 字符串、executor 和 handle。操作者无法从 Mission Brief 看出目标是否被确认、从任务 Inspector 看出为什么选择某个 harness / surface / model，也无法在 DAG 与 List 中按这些维度缩小范围。

本增量只补齐**可观察性**：ccm engine / CLI 仍是 board 语义、验证、ready-set、routing outcome 与调度决策的唯一所有者；浏览器只渲染 ccm 产出的 typed、agent-safe read model。

## Read model 合同

`/view-model.json` 增加两个可选块：

- `mission`：`kind`（`goal-contract | legacy`）、goal 摘要、assurance、revision、updated_at、brief anchor 与 pending 状态。只有 `assurance: pending` 表示 Goal Contract 尚未收敛；`asserted` 与 `confirmed` 都是可推进状态。旧 board 返回 `kind: legacy, pending: false`，不伪造 assurance，也不报错。
- 每个 compact task 的 `execution`：
  - `state`：`legacy | planned | routed | partial`；
  - `planning`：复杂度 dimensions、quality effect floor、budget posture / max attempts、required / preferred / forbidden capabilities；
  - `route`：由 engine 的 `routeOutcomeClass` 给出的 outcome、policy objective、候选与最终选中的安全快照、ample / tight chain、fallback 分类和 reason codes；
  - `attempts`：只保留 attempt id、candidate id、state、规范化时间和 terminal class。`created_at` / `terminal.{class,observed_at}` 是 canonical 来源；仅在它们缺失时读取旧式 `started_at` / `finished_at` / `failed_at` / `failure_class`。

`graph.nodes[]` 只投影高频扫描所需的 route facets：`route_outcome`、`harness`、`surface`、`surface_label`、`model`、`role_grades`。surface label 只按已知的 `(harness, surface)` 精确映射：Cursor 的 `host-native` 展示为 **Cursor IDE**，`cli-headless` 展示为 **Cursor Agent**；未知组合统一显示 **Unknown surface**，不根据 harness 猜测。

`/task.json` 返回与 compact task 相同的 `execution`，并且只返回 server allowlist 投影；不返回 `raw_task`，未知字段与嵌套 payload 不进入响应或 Inspector。UI 的 raw schema fold 也只渲染这一 typed task 投影。

## UI 纵切

- Mission Brief 展示 assurance、revision、brief anchor 与 pending 提示。
- Inspector 展示 planning、selected route、fallback / reason 和 attempt lifecycle。
- DAG tile 与 List row 只显示最小 route badges。
- 左栏增加 Harness、Surface、Model tier、Route outcome filters；Graph 与 List 共用同一 matcher。
- `task` 与 `filter` 查询参数保存选择和 filters；稳定排序写回 URL。未知 filter group 在解析时忽略；已知 group 下、但当前 board 不再存在的 stale value 在 workspace 加载后 fail-soft 清除。现有 `board` share URL 语义保持不变。

## 明确不做

- 不在 browser 重新验证 board、不重新计算 ready-set、不重跑候选排序 / quota / route selection。
- 不改 board schema、routing contract、quota 机制或 worker runtime。
- 不新增图形框架、不重做现有三栏布局。
- 不显示 raw account identity、credential、payer、token 或 selection evidence。

## 验收 oracle

1. pending / asserted / confirmed Goal Contract 和 legacy board 都能稳定返回 typed mission readout，且只有 pending 触发未收敛提示。
2. `other-harness-cli` 等 route outcome 来自 engine；Cursor IDE / Cursor Agent 分开显示。
3. task detail 可读 planning / selected model / fallback / attempts，响应 JSON 不含敏感或原始 routing evidence。
4. Graph 与 List 对同一组 cross-harness filters 得到同一任务集合，filters 与选择可从 URL 恢复。
5. server handler tests、web viewer typecheck/build、generated assets check 通过；若环境有 Browser plugin，则用它做桌面 / 手机宽度的 filter → select → Inspector 冒烟并检查 console error；当前开发环境既无 Browser plugin，也无仓库已安装的 Playwright/Chromium，因此视觉冒烟作为明确 residual，不能伪称已验收。
