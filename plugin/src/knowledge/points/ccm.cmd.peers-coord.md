---
point: ccm.cmd.peers-coord
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.peers-coord -->
## namespace peers（协调感知·只读跨板）

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

多 orchestrator 协调的**感知层**：M 个 orchestrator 并行抽同一活跃配额缸，各自孤立 pacing 会公地悲剧——感知通道让每个 orchestrator 看见全体 peer 的 goal / workload / priority / 死活，喂价值感知的**独立**自我配速（不必双向协商即可单方面合理让路 / 认领 slack；通信通道**不存在**·只读感知 + 机械 fair-share floor 收口）。**纯只读跨板**——扫 `<home>/boards/` 全体板，零写、不抢 board-lock、**不需要 active board 自身**（感知是用户级跨板·同 usage/estimate）。**token-blind**：花名册只投影 goal / priority / workload / state% / liveness——**无任何 secret / token**。

> 数据源 = **只读** `<home>/boards/` 下全部 `*.board.json` 的 `owner`（active / heartbeat / session_id / harness）+ `goal` + ✎ `coordination` 块（priority + state.current/planned）。peers **绝不写任何板**。`coordination` 块由各 orchestrator 自己经 board 写命令 publish（决策点 / Stop / wake 时刷自身状态·写侧形态随 board 写命令面定），peers 只聚合读。

### peers list

**读**（别名 `ccm peers`）

- 行为：扫 `<home>/boards/` 全体 **`owner.active:true` 且心跳新鲜**（`owner.heartbeat` 距 now `< freshness-sec`·默认 600s=10min·与 bootstrap `--resume` live 判活同口径）的板 → 聚成花名册：每 peer 一行 `goal` / `harness` / `priority`（缺省解析 `normal`）/ `current`（active_tasks/workload/burn_contribution）/ `planned`（remaining_work/cost_to_complete_pct）/ liveness（heartbeat + age）。`count` = M（活+新鲜板数·喂多-orch headroom/M 防过冲）。同时按 `owner.harness` 生成 `pools[]`：同 harness 才在同一竞争池；缺失或坏值降为 `unknown`，且每块 unknown board 单独成池，避免不明来源互相混排。**fail-safe**：home 不存在 / 无活板 → 空花名册（`count:0`·exit 0·退单板 pacing·不报错）；某 peer `coordination` 缺 / 字段坏 → 该维度降级（`current`/`planned` 为 `null`·`priority` 退 `normal`）·仍计入（活+新鲜即在册）
- 排序：`priority` 降序（`urgent` 先 → `trivial`）→ 心跳新→旧 → 文件名（稳定 tiebreak）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化花名册（否则人类表格） |

---

## namespace coordination（通知收件箱）

多 orchestrator 协调的**入站通知面**：中介 / producer 把需要 agent 拍板或显式消费的建议写入本板 ✎ `coordination.inbox`，agent 读完并执行后用 `ack` 标记 consumed。写路径全走 `runWrite`：锁 → mutate → `reconcileGating` + `reconcileInbox` → lint → 原子写；过期、同 kind supersede、终态 GC 都在写关卡自动处理。`arbitrate` 已接入 deterministic pool arbiter：读取同 harness 池的活+新鲜 peer、把 usage pressure 归一成 PoolPressure，按 priority-weighted fair-share 只把**本板 own row**写入本板 inbox（从不写 peer board）。

通知 `kind` 闭集：`pacing_throttle` / `pacing_yield` / `pacing_claim` / `pacing_switch` / `pacing_stop` / `hitl_turn` / `artifact_serialize` / `quota_state_change` / `deadline_risk`（交付 DDL 风险 durable 审计条目·deadline-risk hook 直接注入 advisory 后立即 self-ack 一条）。

### coordination inbox

**读 / 写**（一个 verb 承载 `list|ack` 子动作）

```
ccm coordination inbox list [flags]
ccm coordination inbox ack <id...> [flags]
```

- 行为：
  - `list`：读取当前板 `coordination.inbox`；缺失 = 空 inbox；`--unconsumed` 只列未消费通知。
  - `ack`：把给定 id 从 `unconsumed` 标记为 `consumed`，写 `consumed_at`，可选写 `consumed_note`；已 consumed/expired 的 id 幂等 no-op；未知 id → exit 2。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

`--current-subscription` 还要求全局 `--session-id` 与可解析的精确 board；缺 `origin` / session / capability、
identity 不匹配或 epoch 已旧都返回空，不降级成宽读。

### coordination subscription

**写注册表 / 读当前精确订阅**

```
ccm coordination subscription register --origin <host> --session-id <sid> --capability coordination-inbox [flags]
ccm coordination subscription current --origin <host> --session-id <sid> --capability coordination-inbox [flags]
```

- `--origin` 必填，取 `claude-code|codex|cursor|kimi-code`；`--session-id` 是全局必填 flag；
  `--capability` 当前只接受 `coordination-inbox`。board 仍按全局 `--board` / session / home 发现规则精确解析。
- `register` 对同一 `board_path + origin + capability + session_id` 幂等；新 scope 由 ccm 签发 opaque
  `subscription_id` 与 `session_epoch`。`current` 只读同一精确 identity，不创建 fallback。

### coordination notify

**写**（低层 append）

- 行为：append 一条 `unconsumed` 通知到当前板 `coordination.inbox`。写关卡随后自动执行：过期通知转 `expired`；同一 kind 只保留最新 unconsumed，旧 unconsumed 标 `expired` 并写 `superseded_by`；终态通知按 TTL / capacity GC。此命令是低层机制面，通常由 producer / Tier2 流程调用；普通 agent 消费通知用 `inbox list|ack`。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

### coordination arbitrate

**写**（deterministic pool arbiter）

- 行为：运行 pool-aware allocation。流程：解析当前 board → 扫 `<home>/boards/` 的活+心跳新鲜 peer → 按 `owner.harness` 分池（只看当前板所在池）→ 读取当前 harness 的 usage signal / quota model / pollable → 归一为 `PoolPressure` → 按 priority-weighted fair-share 算每个 peer 的 row（`pacing_yield` / `pacing_claim` / `pacing_throttle` / `pacing_switch` / `pacing_stop` / `hold`）→ 只把当前 board 的 row 在命中边沿条件时 append 到**本板** `coordination.inbox`。M==1 时退化为 `ccm usage advise` 的单板 verdict 行为。边沿去重：同内容 dedup、不足冷却不刷屏；只有 band 跨越 / roster 变 / 本行目标份额 delta 超阈值 / kind 变化才追加。通知 payload 带 `producer:"coordination-arbiter"`、`dedup_key`、`pressure_band`、`roster_signature`、`target_headroom_pct`、`delta_headroom_pct`、`base_verdict` 和 own peer 摘要。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出（含 `mode` / `appended` / `append_reason` / `own_row` / `allocation` / `notification` / `unconsumed`） |

---

<!-- ccm:k:end point:ccm.cmd.peers-coord -->

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm 二进制对 peers 与 coordination namespace（list、inbox、subscription、notify、arbitrate）的具体实现事实

peers 花名册字段与 coordination inbox/notify/arbitrate 的 kind 闭集、写关卡行为是本项目数据模型事实。
