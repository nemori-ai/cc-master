---
point: ccm.footgun-table
---

## 权威陈述

<!-- ccm:k:start point:ccm.footgun-table -->
## footgun 速查(踩过就记住)

| 现象 | 真相 / 怎么做 |
|---|---|
| `task update --set status=done` 被拒 exit 3 | task 语境的裸 path scope 到本 task,`status` 是 🔒。status 永远走 verb(锚 2)。 |
| `task done` 报 `illegal transition: ready → done` | 先 `task start`。`ready` 不能直接 `done`。 |
| 重跑后 task 还显示旧 artifact / verified | 用 `task retry <id>` 开新 attempt,不要用字段 setter 拼 reset。合法的 `set-status <id> ready` 也会走同一原子 reset。 |
| native attempt 活跃时 `task start/done/set-status/update --handle` 或 `route-bind --force` 被拒 | 这是 `BIZ-NATIVE-ATTEMPT-PROJECTION` 对专属 writer 的硬闸，`--force` 也不能绕。只用五个 `native-attempt-*` verb；terminal 后先独立验收，再从 `uncertain` 走普通 true-done。 |
| `--set` 的值不知道落哪了 | 看非 `--json` 输出的 `set <path>` 回显行:task verb 裸 path=本 task,`board update` 裸 path=board 顶层,`jc add`/`cadence *` 裸 path=board 顶层。 |
| `task show <id>` 返回 `data:null` 还 exit 0 | 读不存在的 id **不报错**——调用方自己判 null。 |
| `board lint` exit 3 但 stdout 是 `{"ok":true,...}` | 外层信封 `ok` 恒 true;**lint 是否净看 `data.ok` 与 exit code**(3=有 hard error)。 |
| `block --on user` 写进去了却被 lint 挡 | awaiting-user 节点**必须**带 `decision_package`(`--decision @file`),否则 BIZ-AWAITING 硬闸。 |
| `board update --goal` 在新板被拒 | Goal Contract 已激活；用 `ccm goal amend --summary ... --reason ... --assurance ...` 生成新 revision。`board update --goal` 只服务 legacy board。 |
| `goal check` 返回 pending | 目标还没 settled；澄清后 `goal set` / `goal amend`，不要切 DAG 或派发。复杂背景用 `--brief-file` 落成受管 Goal Brief。 |
| `goal check` 返回 deadline_pending | 目标 settled 但交付 DDL 未 settle（`goal_contract.deadline` 缺失或仍 pending）；先 `ccm goal deadline set/confirm`（确认截止期）或 `ccm goal deadline confirm-none`（确认无 DDL），再切 DAG。deadline 只走专属 verb，`--set goal_contract.*` 被拒。 |
| review task 已 `done`，下游仍 blocked | 若它声明了 `--review-gate APPROVE`，这是正确行为：检查 `review_verdict`；只有 `task done ... --review-verdict APPROVE` 开门，REQUEST-CHANGES/缺 verdict 都不开门。 |
| review 上轮已 `APPROVE`，retry 后下游又 blocked | verdict 只属于当前 attempt；`stale|failed|escalated → ready` 会清旧 verdict。新一轮 `task done` 必须显式给新的 `--review-verdict APPROVE` 才重新开门。 |
| 上游 true-done，但 declared 下游仍 blocked | true-done 只证明 candidate-complete，不证明已到指定 target。用 `delivery check` / `dependency explain` 看本地 containment、target drift 或 missing-object diagnostic；branch/worktree 存在不是 delivery proof。 |
| waiver 让 edge ready，却看到 `target_delivered:false` | 这是设计语义：waiver 只把这一条 user-authorized、edge-scoped、未过期 requirement 资格化，输出 `qualified_by=waiver`；它从不伪装 target 已交付。 |
| 想把 declared 一键变 strict-default | 本版本没有这个写口。只有 `delivery audit --strict-dry-run` / explain 的 ephemeral preview；不得持久化 `mode:strict`。 |
| `set-routing` 写好了，就以为 ccm 会自动选择 / spawn / fallback | routing contract 是 opt-in planning/ledger，不是 dispatcher。显式派发仍由 orchestrator 发起；只有拿到真实派发面的 opaque running handle 后才可 `route-bind`。同步 `ccm worker run` 不会自动回填 board。 |
| ISO 时间字段被 lint warn | 一律严格 `YYYY-MM-DDTHH:MM:SSZ`(UTC 定宽),别用本地时区 / 带毫秒。 |
| 多个 active 板时命令报 Ambiguous | 用 `--goal <子串>` 或 `--board <path>` 消歧。 |
| open cadence iteration 出 overbooked / critical-path / oversized warn | 这不是 hard gate,但说明本轮节奏不健康。先拆小、移出 scope、删假依赖或重估;不要靠 `cadence ship` 把超载藏起来。 |
| 想用 `--set-json` 手拼 `agents` 段 / 手改 agent 状态 | agent 生命周期走专属 verb:`agent create/bind/link/terminal/probe`——bind 无真实 handle 证据被拒(exit 3)、状态转移有校验、link 幂等、probe 字段由 ccm 落盘;通用 setter 手拼会把这些全绕过。 |
| 收割完 agent 产出、roster 却还满是 `running` | 收割 / 端点验收掉 agent 产出后要显式 `ccm agent terminal <id> --outcome "..."` 收口——「凡派发皆登记」的对称另一半是「凡收割皆收口」。`agent probe` 只判死活、**永不 →terminal**;不收口 = 永久 `running` 僵尸污染 recon 的 in_flight/phantom 判定(`agent terminal ≠ task done` 只挡正向,不豁免这条反向闭环)。 |
| 以为批量 `agent terminal` 要一个个小心防锁竞态 | 顺序 bash 背靠背跑多条 `ccm agent terminal`(已知 id)**无 race**——每条各抢一次 O_EXCL board 锁·天然串行。别 `&` 后台并行 ccm 写(争锁 exit 4)。真正要定序的是**单 agent 的 create→bind→link 三连**(bind/link 吃 create 返回的 id·靠数据依赖定序),不是「所有 agent 操作都必须逐个」。 |
<!-- ccm:k:end point:ccm.footgun-table -->
