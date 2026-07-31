---
point: ccm.board.executor-choice
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.executor-choice -->
## C. executor 五种语义 + 选择决策树

### 各 executor 语义

| executor | 谁来做 | 典型场景 | 必须的字段 |
|---|---|---|---|
{{USING_CCM_EXECUTOR_TABLE_ROWS}}

### executor 选择决策树

```
这个任务需要人类拍板 / 操作？
  ↓ 是 → executor: user
  ↓ 否

这是编排决策本身（replan / 整合结果 / HITL 消化）？
  ↓ 是 → executor: master-orchestrator
  ↓ 否

这个任务会用外部系统完成（CI / 外部 review / 第三方 API）？
  ↓ 是 → executor: external  （必须带 reference kind=issue 指向外部 ticket）
  ↓ 否

{{USING_CCM_EXECUTOR_DECISION_TAIL}}
```

**executor 与 handle 的关系：** `executor` 是谁来执行的计划，因此 `ready` / `blocked` future task 可先选 `subagent` 或 `workflow`，**不要预填 placeholder / phantom handle**。legacy 调用真实派发工具后，立即把其返回的句柄写入 task（`task update --handle <句柄>`），再转 `in_flight`；只有 `status=in_flight` 且 `executor∈{subagent,workflow}` 时，缺 handle 才触发 `BIZ-EXECUTOR-HANDLE`。opt-in native attempt 的 handle 只能由认证 evidence 经 `native-attempt-bind/reconcile` 投影，generic update 会被拒。`external` 节点靠 `reference kind=issue` 的 URL 去外部系统查；`handle` 可选地记录 issue URL / issue number / 外部 run id，方便 recon。`user` 和 `master-orchestrator` 没有后台句柄。

### external + issue tracking 语义

`executor: external` 表示这件工作由当前 session 外的人或系统推进，board 只跟踪它。`references.kind=issue` 是**进度追踪锚点**（tracking anchor），不是完成证据。GitHub issue open / in-progress / closed 都只是外部状态：**closed 不等于 board done**。

| 字段 | external issue task 怎么用 |
|---|---|
| `references[{kind:"issue"}]` | 指向 GitHub issue / ticket，作为外部进度的固定入口（`BIZ-EXTERNAL-ISSUE` warn 兜） |
| `handle` | 可选；写 issue URL、`owner/repo#N`、CI run id 等可续查句柄 |
| `artifact` | 外部实际产出：PR、commit、release、报告、CI run、交付文档等；**不要只填同一个 issue URL**（`BIZ-EXTERNAL-ARTIFACT` warn 兜） |
| `status` | issue 仍 open / in progress → 通常保持 `in_flight`；issue closed 但尚未端点验收 → `uncertain` 或保持非 done；只有验收 artifact 后才 `done --verified --artifact` |

外部实现方说“done”或 GitHub issue 被关闭时，你先把 task 视为“待验收信号”，不要直接 `done`。若 artifact 已可查但你还没验，落 `uncertain`；若发现外部进度停滞 / 被 block / 长期无响应，用 `blocked` / `stale` / watchdog 记录真实状态与下一步 follow-up。

**反模式：**
- 把 `user` 任务标成 `subagent`——看起来在跑、其实没人做。
- 真实派发后把 `executor: subagent` 任务标成 `in_flight`，却不带派发工具返回的真实 `handle`——会触发 `BIZ-EXECUTOR-HANDLE` warn，resume 时也找不到后台任务；唯一例外是通过 hard native projection 校验、尚不应有 active handle 的 native attempt 状态。反之，future `ready` / `blocked` 任务不应为了消 warning 预填 phantom handle。
- 把 orchestrator 自己的整合工作标 `subagent`——指挥不演奏（orchestrator 协调、不亲手做单元工作），orchestrator 的工作应标 `master-orchestrator`。

---

<!-- ccm:k:end point:ccm.board.executor-choice -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型会凭通用直觉猜 executor 该填什么值，可能选错枚举或漏填 external 必须的 issue 引用，导致 board 记录的执行方式与实际不符。

主体是 executor 五个枚举值的语义、必填字段与 handle 关系，反模式是附加条款不改变接口事实的主体。

## 失败形态

隐蔽违反：任务已转 in_flight 且 handle 非空、能过 lint，但那个 handle 是编造或照抄他处格式，并非派发工具真实返回的句柄——形式合规，resume 时却按图索骥找不到真实任务。
