# board v2 规格(schema spec)—— 实现蓝图

> 状态:**设计定稿 / 实现蓝图**(v0.10.0)
> 决策依据:[`adrs/ADR-013-board-v2-data-model-and-cli.md`](../adrs/ADR-013-board-v2-data-model-and-cli.md)(架构 + narrow-waist 演进)· ADR-003(被演进)· ADR-006(node hook)· ADR-012(parent waist)
> 需求来源:Epic #27 + #28/#29/#30/#31 + C1 #32 + C6 #34
> 本文是 board v2 在 v0.10.0 设计定稿时的**历史实现蓝图**，不再是当前协议 SSOT。当前权威定义在 `@ccm/engine` 的 `board-model`（enums / 字段档位 / 不变式注册表 / 状态机）；本文与引擎冲突时一律以引擎为准。
> 标记:🔒 load-bearing(hook 机器读)· 👁 observed(hook 若有则用、缺则降级)· ✎ flexible(agent 自由、silent-on-unknown)· ⚙️[实现期细化] · ❓[待确认]

---

## 1. 总览与架构

**board** = 一张带状态的任务依赖图(DAG),编排者跨 compaction 的存档 + 各消费者的状态窗口。v2 把它从「被动 JSON + 各消费者各自解析」升级为「**完整 JS 数据模型 SSOT + 统一 CLI 访问层**」(ADR-013)。

- **三消费者**:agent(invoke CLI)/ web viewer(只读)/ human(shell)。
- **写入纪律**:agent / human 写 board **必经 CLI**(唯一写入关卡 = 机械约束层);viewer 只读;hook 只读(除 bootstrap)。
- **三档体系**(narrow-waist 演进):完整建模所有字段 + 每字段标注档位。**红线2 真正保护的只是 🔒 子集**;✎ 仍 agent 自由 + silent-on-unknown。
- **schema 版本锚**:`schema: "cc-master/v2"`(v1→v2,大改;lint R 校验该字面、content 契约断言它)。

---

## 2. 顶层模块(11)

### 2.1 总览
| 模块 | 主档 | 结构 | 职责 |
|---|---|---|---|
| `schema` | 🔒 | `"cc-master/v2"` | 协议版本锚 |
| `meta` | ✎ | 对象 | 板级元数据 |
| `goal` | 🔒 | string | 目标 |
| `owner` | 🔒 | 对象 | 所有权/武装/生命周期 |
| `git` | 🔒 | 对象 | 版本控制上下文 |
| `scheduling` | 👁 | 对象 | WIP/调度控制 |
| `watchdog` | 👁 | 对象 | 自我唤醒 |
| `tasks` | 🔒+混 | 数组 | 任务图核心实体(见 §3) |
| `log` | 混 | 数组 | 审计轨迹 |
| `judgment_calls` | 👁 | 数组 | 自决诚实台账(见 §4.2) |
| `cadence` | 👁 | 对象 | 节奏/timebox(见 §4.3) |

### 2.2 各模块数据模型 + 六要素

```
schema: "cc-master/v2"        🔒
  类型 string 字面量 · 缺省必填 · 读:lint+content契约+resume · 写:bootstrap · 何时:建板 · 缺失:hard error(R2a)

meta {                        ✎
  template_version: int,      // board 模板代际(timeline 版本门读)
  created_at?: ISO            // 建板时刻
}
  缺省 {template_version:N} · 读:viewer timeline · 写:bootstrap/agent · 缺失:timeline 当旧板降级

goal: string                  🔒
  缺省必填(可空串) · 读:resume 选板/viewer · 写:agent 经 CLI · 何时:建板/重定目标 · 缺失:hard error(R2b)

owner {                       🔒
  active:     bool,           // true=活跃;false=归档(/stop)
  session_id: string,         // 武装身份;""=待认领(合法)
  heartbeat:  ISO             // 活 session 每回合 flush;resume 探测读
}
  读:全 hook 武装闸 + bootstrap resume 探测 · 写:bootstrap(session_id/active/heartbeat)+ 活 session flush(heartbeat)
  缺失:active/session_id 缺 → hard error;★heartbeat 纳入 lint 校验(v1 漏)

git {                         🔒
  worktree: string,           // 可空
  branch:   string            // 可空
}
  读:viewer · 写:agent 经 CLI/bootstrap · 缺失:对象缺 hard error;子字段非 string hard error

scheduling {                  👁
  wip_limit:        int,      // 全局 WIP cap
  owner_wip_limit?: int       // per-owner 默认 cap
}
  读:posttool-batch(C5/两级 WIP 软警告)· 写:agent 经 CLI · 缺失:对应警告静默关闭(graceful)
  ★owner_wip_limit 纳入 lint 校验(v1 漏)

watchdog {                    👁  (v1 名 wakeup,已重命名)
  armed_at:   ISO,
  fire_at:    ISO,            // watchdog 预定 fire 时刻
  mechanism:  cron|loop|monitor|shell,
  job_id:     string,         ✎
  checklist:  string[]        ✎
}
  读:verify-board(到点/缺失提醒 + 过期 self-heal)· 写:agent 经 CLI(arm/退役)
  缺失:watchdog 提醒按需注入 · ★fire_at 格式纳入 lint(v1 漏)· 退役须删整个对象(不留残骸)

log: [                        // append-only
  { ts: ISO(必填), summary: string(必填),
    kind?: dispatch|recon|verify|finding|decision|replan|handoff|note,
    task?: <id>, detail?: string, refs?: string[] }
]
  读:viewer activity · 写:agent 经 CLI(只增不改不删)· 缺失:空数组合法
```

`tasks` 见 §3;`judgment_calls`/`cadence` 见 §4。**已退役**:`num_account`(移除)、`accounts[]`(移除,effective-N 走 registry)。

---

## 3. task 实体

### 3.1 字段全集(四层)
| 区 | 字段 | 类型 | 档 | 缺省 |
|---|---|---|---|---|
| **身份·图** | `id` | string | 🔒 | 必填(非空唯一) |
| | `status` | enum(8,§6) | 🔒 | 必填 |
| | `deps` | string[] | 🔒 | `[]` |
| | `parent` | string? | 🔒 | 缺省=顶层 |
| **载体** | `title` | string | ✎ | `""` |
| | `description` | string? | ✎ | 缺省 |
| | `acceptance` | string\|obj? | ✎ | 缺省(特定 type 必须,§4.1) |
| | `references` | obj[]? | ✎ | 缺省(特定 type 必须) |
| **软工/PM** | `created_at`·`started_at`·`finished_at` | ISO | ✎ | 缺省 |
| | `estimate` | obj? | ✎ | 缺省(预估,喂 cadence) |
| | `blocked_on` | `"user"`\|id? | ✎ | 缺省 |
| | `verified` | bool? | ✎ | false |
| | `executor` | enum(5) | ✎ | 缺省 |
| | `type` | enum(8,开放) | ✎ | 缺省 |
| | `role` | normal\|fill-work | ✎ | normal |
| | `handle`·`justification`·`artifact` | string?/obj? | ✎ | 缺省 |
| | `output_schema`·`dep_pins` | ? | ✎ | 缺省(低频) |
| | `wip_limit` | int? | 👁 | 缺省(覆写 owner cap) |
| **遥测/HITL** | `observability` | obj? | ✎ | 缺省 |
| | `hitl_rounds` | int? | ✎ | 0 |
| | `decision_package` | obj? | ✎ | 缺省(awaiting-user 必须) |

### 3.2 枚举
- `executor`(5,取代 v1 `mechanism`):`user` · `master-orchestrator` · `subagent` · `workflow` · `external`(#31)。
- `type`(8,**开放可扩展**,未知值 lint warn 不 fail):`design` · `planning` · `development` · `development-demo` · `acceptance` · `e2e-integration` · `doc-alignment` · `pr`。
- `role`:`normal` · `fill-work`。
- `references[].kind`(开放):`spec` · `plan` · `doc` · `web` · `code` · `issue` · `other`;`ref` = 绝对路径或 URL(**禁相对路径**)。

### 3.3 references 结构
```
references?: [ { kind, ref, note? } ]   ✎
  ref:【不变式】绝对路径(/…)或 URL(http(s)://…),禁相对路径(hard error)
```

### 3.4 派生不存(由 graph lib / viewer 现算,绝不存第二份)
`successors`(反向边)· `actual_duration`(finished−started)· owner 角色(反查 parent)· owner `progress`(done/total)· task `due_at`(由所属 iteration deadline 推)· Kanban `column`/`swimlane`/`color`/`comments`。
**整层砍除**:leaf `progress` · `rank` · `checklist` · `labels` · `priority` · v1 `mechanism`/`assignee`(并入 executor)。

---

## 4. 深模型

### 4.1 acceptance(目标函数,两态)[归 P3 / #32,另需 ADR]
```
acceptance?: string | {
  criteria: [ { desc, kind?(test|metric|manual|review), check?, target?, measured?, status(pending|met|failed) } ]
}
```
- 轻任务写 `string`(一句话 DoD);复杂 task 用目标函数对象。
- ML 比喻:objective=criteria;loss=未 met 项;convergence=全 met;验证集防自欺=`verified`。
- **done 真语义** = 收敛(∀ criteria.status==met)∧ `verified` ∧ `artifact` 非空(归 P3,需 ADR)。
- lint:特定 type 必须有 acceptance(string/obj 皆可);若 obj 则 criteria 非空。
- `criteria[].status` 是收敛快照(跨 compaction 可读),真相以 check 重跑/端点 verified 为准。

### 4.2 judgment_calls(自决诚实台账)
```
judgment_calls?: [                    👁
  { id, summary,
    category: architecture|drift|spec-impl-misalignment|other,
    decision, rationale, impact,
    severity: low|medium|high|critical,
    refs?: ["commit…","path…","PR…"],   // 已落盘定位、可回滚
    task_ref?, raised_at,
    status: pending_review|upheld|overturned,
    resolved_at? }
]
```
- **定位**:agent 自驱时撞到本该人拍板的重大事项,为不阻塞**先自决落盘**,但秉持「人是最终裁决者+诚实原则」分级归档,供人回前台感知、重拍、**推翻**。HITL 第三姿态(自决+可逆披露)。
- 读:回前台 hook 按 `severity` 告知(high/critical 必显眼)· 写:agent 经 CLI · 缺失:空/无,无告警。
- **`overturned` 联动**:人推翻 → seed 纠正/回滚 task(refs 提供定位)。

### 4.3 cadence(节奏/timebox)[红线2,另需 ADR]
```
cadence?: {                          👁
  target?: { ship_every: "3h", min_unit: "1 PR" },
  iterations?: [
    { id, started_at, deadline?, goal?, members?: [<task-id>], status: open|shipped }
  ]
}
```
- **定位**:DAG **之上的策略层**——不违反 deps(依赖永远硬),在合法就绪集里指导「优先推哪条纵切链、几点收口 ship」。**≠ pacing**(pacing 管 token 配额速度)。
- 每字段牙齿:`target`→拆解期 CLI 校验 estimate vs timebox(🔩);`members`→派发期优先(🪶 skill);`deadline`→收口期 Stop-block 逼(🔧);`status:shipped`→收口完整性 CLI/lint(🔩,shipped ⇒ members 全 done+verified)。
- **timebox = 软目标**:拆解期 CLI 对超 timebox estimate 给警告(不硬拒);执行期 deadline 软提醒(DAG 依赖优先)。
- **slice 用 `members` 表达**(不给 task 加 slice 字段)。

---

## 5. 不变式 / 业务规则

**分级原则**:FMT/GRAPH = 坏数据/坏链路 → hard;BIZ = 条件语义 → warn + in_flight 起触发(容瞬态)。校验落点 = CLI 写入关卡(机械拒绝)+ lint(端点闸)。

### 5.1 FMT 格式/类型(hard)
`id` 非空唯一 · `status`∈enum8 · `deps` string[] · `parent` 非空串或缺 · 时间锚 ISO-8601 UTC 格式 · `executor`∈enum5 · `role`∈枚举 · `type`∈enum8(**未知值 warn**) · `references[].ref` 绝对路径或 URL(禁相对) · `blocked_on`="user"或存在 id · `scheduling.wip_limit`/`owner_wip_limit` number · `owner.{active,session_id,heartbeat}` 类型 · `watchdog.fire_at` 格式 · `decision_package` 形状。

### 5.2 GRAPH 图(hard,rollup 除外)
`deps` 无悬挂/自环/环 · `parent` 引用存在/depth=1/无环 · rollup:done-owner 子全 done(**warn**,容瞬态)。

### 5.3 BIZ 业务规则(条件式)
| 规则 | 级别 |
|---|---|
| `type=development` ⇒ references 含 kind=spec≥1 且 kind=plan≥1 | warn |
| `type`∈{development, development-demo, acceptance, e2e-integration} ⇒ acceptance 非空 | warn |
| status=`in_flight` ∧ `executor`∈{subagent, workflow} ⇒ handle 存在 | warn |
| `executor=external` ⇒ references 含 kind=issue≥1 | warn |
| awaiting-user(blocked_on:"user" + status∈{blocked,in_flight}) ⇒ decision_package 对象 | **hard** |
| `status=done` ⇒ verified ∧ artifact 非空 | **P3 预留**(#32,ADR) |
| cadence:`iteration.status=shipped` ⇒ members 全 done+verified | **hard**(收口完整性) |
| 时间序 created≤started≤finished;in_flight⇒started;done⇒finished | warn |

---

## 6. status 状态机 ⚙️[实现期细化]
8 值(`board-lint` STATUS_ENUM):`ready · in_flight · blocked · done · escalated · failed · stale · uncertain`。
`verified` 是与 status **正交的布尔**,非 status 值。
| status | 路由 | 主要转入 |
|---|---|---|
| `ready` | deps 按 `dependencySatisfied` 全满足,可派发 | (建)/blocked 解锁/failed 重试/stale 重跑 |
| `in_flight` | 已派发执行中 | ready 派发 |
| `blocked` | 等 blocked_on(user/task) | (建)/ready |
| `done` | 完成并验 | in_flight/uncertain 验过 |
| `uncertain` | 做了未验 | in_flight |
| `escalated` | sub-agent 返回 escalation → supersede | in_flight |
| `failed` | 失败 → 按 escalation 路由 | in_flight |
| `stale` | 上游产物变 → 重跑 | done |

### 6.1 retry / reactivation 合约

`stale|failed|escalated → ready` 是**新 attempt 的边界**，不是普通 status setter。所有合法 retry
transition（含通用 `task set-status <id> ready` 走到这些边时）必须共享同一原子后置条件；CLI 另提供
具名正门 `ccm task retry <id...>`，调用者不需手工拼字段 reset：

1. 在同一笔 mutation 内，把旧 attempt 的来源 status 与已存在的
   `started_at`/`finished_at`/`artifact`/`verified`/`review_verdict` 序列化进 append-only `board.log`（`kind:replan`、
   `task:<id>`、detail schema=`ccm/task-retry/v1`），先留审计证据再重置当前视图。
2. retry mutation 把 task 转为 `ready`，删除旧 `started_at`/`finished_at`/`artifact`/`review_verdict`，
   并把 `verified` 重置为**布尔** `false`（不得写字符串 `"false"`）。随后既有写入关卡仍执行
   `reconcileGating`：只有 deps 按 `dependencySatisfied` 全满足时最终持久态才为 `ready`，否则为
   `blocked`；普通依赖以 `status=done` 满足，显式 review gate 还要求当前 attempt 的精确
   `review_verdict=APPROVE`，缺失、空、null 或 `REQUEST-CHANGES` 均 fail closed。human/JSON 输出都必须按
   reconcile 后逐 task 的最终态渲染。因此当前 attempt 永不携带上一轮 terminal evidence，也不谎报可派发性。
3. 批量 `task retry <id...>` 是一次 mutate + 一次 lint + 一次落盘；任一 id 不存在或当前 status
   不是 `stale|failed|escalated`，整批拒绝、零部分写。
4. 普通首次 `ready → in_flight → done` 语义不变；非法状态边仍按既有状态机拒绝。`done` 要重跑仍先
   `done → stale`，再 `task retry`，不新增 `done → ready` 边、不改 status enum/deps/narrow-waist。

## 7. 机械约束总图 + 写入 + 并发
- **真机械 🔩**:CLI 写入校验(违 FMT/GRAPH/BIZ-hard 拒绝)+ lint 端点闸。
- **半机械 🔧**:Stop-block(goal-hook)——还有活/cadence 到点未收口,不让 agent 停 + 注入。
- **软 🪶**:hook context 注入施压 + skill 指导。**机械够不到**:「此刻派哪个 task / 现在 ship」(agent context 内决策)。
- **写入**:agent/human 必经 CLI;非 CLI 直接写由 lint 端点兜底(挡多数,不堵死 100%)。
- **并发**:轻量 advisory 文件锁(lockfile/flock,acquire→write→release + 简单 stale),不重型。

## 8. 完整示例(board v2 形态)⚙️
```json
{
  "schema": "cc-master/v2",
  "meta": { "template_version": 3, "created_at": "2026-06-23T10:00:00Z" },
  "goal": "Ship feature X (敏捷:3h≥1 PR)",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-23T12:30:00Z" },
  "git": { "worktree": "/repo/.worktrees/x", "branch": "feat/x" },
  "scheduling": { "wip_limit": 4, "owner_wip_limit": 2 },
  "cadence": {
    "target": { "ship_every": "3h", "min_unit": "1 PR" },
    "iterations": [
      { "id": "I1", "started_at": "2026-06-23T10:00:00Z", "deadline": "2026-06-23T13:00:00Z",
        "goal": "ship 登录", "members": ["T1","T2"], "status": "open" }
    ]
  },
  "tasks": [
    { "id": "T1", "status": "done", "deps": [], "type": "development", "executor": "subagent",
      "handle": "bg-3c", "artifact": "commit a1b2", "verified": true,
      "acceptance": { "criteria": [ { "desc": "登录测试绿", "kind": "test", "status": "met" } ] },
      "references": [ { "kind": "spec", "ref": "/repo/docs/login-spec.md" }, { "kind": "plan", "ref": "/repo/docs/login-plan.md" } ],
      "estimate": { "value": 2, "unit": "h" },
      "created_at": "2026-06-23T10:00:00Z", "started_at": "2026-06-23T10:05:00Z", "finished_at": "2026-06-23T11:50:00Z" },
    { "id": "T2", "status": "in_flight", "deps": ["T1"], "type": "development", "executor": "subagent", "handle": "bg-7a",
      "started_at": "2026-06-23T11:55:00Z" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "PR 拆一个还是两个?",
      "decision_package": { "ask_type": "decision", "context_md": "…", "what_i_need": "…", "inputs_hash": "sha256:…", "enter_cmd": "/cc-master:discuss D1 --board …", "options": [] } }
  ],
  "judgment_calls": [
    { "id": "J1", "summary": "登录用 JWT 而非 session", "category": "architecture",
      "decision": "选 JWT", "rationale": "无状态、为不阻塞先定", "impact": "认证全链路",
      "severity": "high", "refs": ["commit a1b2"], "task_ref": "T1", "raised_at": "2026-06-23T11:00:00Z",
      "status": "pending_review" }
  ],
  "watchdog": null,
  "log": [
    { "ts": "2026-06-23T10:05:00Z", "kind": "dispatch", "task": "T1", "summary": "派发登录开发" }
  ]
}
```

---

## 9. 实现注记(给 #4 地基)
- **JS model SSOT**:字段元数据(类型/档/缺省/读者/写者/降级)+ 不变式(FMT/GRAPH/BIZ)+ status 状态机 + mutations,一处定义,lint/graph/CLI/viewer 派生。
- **lint/graph 重写**:复用现有 `buildGraph`/`findCycle`/`analyzeGraph`,扩 v2 字段 + 新不变式(BIZ 条件规则、cadence 收口完整性)。
- **hook 收编**:`verify-board`/`reinject`/`posttool-batch` → node,`require` 同一 model;武装闸/红线6 不变。
- **CLI**:board management + dag/graph ops + analysis;写入校验 + 文件锁。
- **schema v1→v2**:content 契约断言 `"cc-master/v2"`;旧板兼容/迁移策略 ⚙️[实现期定]。
