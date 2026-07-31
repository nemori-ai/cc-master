---
point: ccm.status-state-machine
---

## 权威陈述

<!-- ccm:k:start point:ccm.status-state-machine -->
## 心智锚 2:board 是状态机,status 不是你赋值的字段 ★硬规则

这是本 skill 最容易踩、也最不能踩的一条。**task 的 `status` 不是一个你 `--set` 赋值的普通字段——它是一台状态机的当前态,只能经生命周期 verb 转移。**

- 改 status **只有**这几条命令:`task start`(→ in_flight)、`task done`(→ done)、`task retry`(stale/failed/escalated → ready,开启新 attempt)、`task block --on`(→ blocked)、`task unblock`(清 `blocked_on`·交回 deps 门控)、`task set-status <id> <status>`(通用转移)。
- **没有** `task set`;`task update` **不接** `--status`;`--set tasks[T].status=…` 被 🔒 守门拒(exit 3);裸 `--set status=done` 同样被拒(exit 3)——task verb 的裸 path scope 到本 task,`status` 命中 🔒 守门,不会静默落 board 顶层。
- **`ready → done` 非法**:必须先 `task start`(ready → in_flight)再 `task done`。直接 done 撞 `illegal transition: ready → done`(exit 3)。
- **native-active projection 是更窄的专属状态机**：板启用 `ccm/native-attempt/v1` 且 latest attempt 为 `starting|running|uncertain` 时，generic `start/done/block/unblock/set-status`、`task update --handle` / 通用 setter、legacy `route-bind` 和 `--force` 都不能构造或修复 status/handle；只走 `native-attempt-create/bind/cancel/terminal/reconcile`。可信 terminal 证据只把 task 投影到 `uncertain`，父层完成端点验收后仍须满足普通 `task done --verified --artifact` 不变式。
- **`ready ↔ blocked` 由系统按 deps 自动归一**:每次 ccm 写命令落盘前引擎跑一趟 `reconcileGating`——**无 `blocked_on`** 且 status∈{ready,blocked} 的 task 按 deps 满足度重定(deps 全满足→ready,否则→blocked)。普通历史板和 declared 板里没有显式 requirement 的边保持 legacy；用 `task add|update --review-gate APPROVE` 声明的 review gate 必须有当前 attempt 的精确 `APPROVE`，`REQUEST-CHANGES`、缺失、空或 null 都 fail closed。显式 delivery requirement 还先要求上游 `taskTrulyDone`，再按 `candidate` 或指定 target 的 `delivered` 资格判定。review 的 `status=done` 只表示审查工作执行完，不等于批准。**手动 `set-status <id> ready` 会被 deps 否决**(deps 未满足下一趟归回 blocked)。**有 `blocked_on`(等 user / 等某 task)= 语义阻塞,豁免自动门控**;解除用 **`task unblock <id>`**,别用 `set-status`。手改 board 造出的不一致态由 `BIZ-STATUS-DEPS` warn 兜。

完整转移表:

| 从 | 合法到 |
|---|---|
| `ready` | in_flight, blocked |
| `in_flight` | done, uncertain, escalated, failed, blocked |
| `blocked` | ready, in_flight |
| `done` | stale |
| `uncertain` | done, failed, in_flight |
| `escalated` | ready |
| `failed` | ready, escalated |
| `stale` | ready |

> `verified` 是与 status **正交的布尔**(`--verified`),不是一个 status 值。`done` 且 `verified:true` 且 `artifact` 非空,才是真完成(端点验收过);缺任一项会被 `BIZ-DONE-VERIFIED` hard gate 拒绝落盘(exit 3)。
> 对显式 review gate，`verified:true` 只验收「review 工作与报告已完成」，是否批准由**当前 attempt** 的 `review_verdict` 单独表达；只有 `APPROVE` 满足下游 deps。`stale|failed|escalated → ready` 开新 attempt 时旧 verdict 自动失效，重跑后必须产出新 verdict。

> `stale` / `failed` / `escalated` 要重跑时优先用 `task retry <id>`。它把旧 attempt 的 `started_at`、`finished_at`、`artifact`、`verified`、`review_verdict`、`delivery` 以 `ccm/task-retry/v1` 结构归档进 append-only log,再原子复位当前 attempt;合法的通用 `set-status <id> ready` 也共享同一 reset,不会把旧验收 / delivery 证据带进新一轮。retry 的 lifecycle 目标是 `ready`,但写入关卡随后仍按同一依赖资格求值归一:只有 deps 全满足（declared edge 已 `qualified`，legacy edge 按既有 satisfied 规则）的 task 才落 `ready`,否则最终落 `blocked`;human/JSON 输出按每个 task 的最终态回显。

### Rationalization Table —— status 这条最常见的自我说服

| 你会对自己说 | 现实 |
|---|---|
| "status 不过是个字段,改字段的通用 idiom 就是 `set --status <值>`,赋值就行,不用懂状态机。" | ccm **故意**不给 status 一个通用 field-setter。赋值绕过转移闸、不盖 `started_at`/`finished_at`——所以 `--set status=…` 无论带不带 `tasks[]` 前缀都被 🔒 守门拒(exit 3)。verb 才是对的路:它校验转移合法 + 盖 derived 字段。 |
| "我赶时间,`task update --status done` 一条搞定,省得 start 再 done 两步。" | `task update` 没有 `--status` flag(exit 2),`ready→done` 也非法(exit 3)——这条"省一步"两次都会失败,反而更慢。`start` 再 `done` 才是真正的两步到位。 |
| "ccm 报 illegal transition,我加 `--force` 推过去得了。" | `--force` 只给非 native-active 的真异常态留逃生口、会记 log；重跑 stale/failed/escalated 有 `task retry`，native-active projection 则在 mutation boundary 明确拒绝 `--force`。正常完成用它跳过 `in_flight`，等于亲手制造一个没 `started_at` 的 "done"——你在伪造审计轨迹。 |
<!-- ccm:k:end point:ccm.status-state-machine -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型知道也记得要走状态机 verb，但在报错或赶时间时会说服自己用字段赋值或 --force 抄近道更快，删掉这条会让这种「这次特殊情况」式抄近道失去唯一的正面拦截。

主体是 status 状态机的合法转移表、生命周期 verb 与自动门控规则，是接口事实；末尾 Rationalization Table 是附加条款。

## 失败形态

用 --force 顶过一次不合法转移后，board 上呈现的完成态字段齐全、终态检查形式上通过，但这个 task 从未真正经历过中间运行态，时序字段是伪造出的完成假象——审计链已经断裂，却难以从静态快照看出。
