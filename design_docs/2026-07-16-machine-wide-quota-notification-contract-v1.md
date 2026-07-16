# Machine-wide quota observation notification contract v1

> 状态：**R1 contract frozen；production RED**
>
> 日期：2026-07-16 UTC
>
> 覆盖：machine-wide cached read / explicit refresh、decision projection、状态边沿、subscription fan-out、
> 去重、monitor 显式 quota-source mode、三 origin cached landing
>
> 不覆盖：provider collector 细节、task-level quota admission、自动 route/spawn、账号切换、credential
> mutation、付费 canary、per-board permit/nonce

## 0. R1 review resolution（bounded）

本轮只解决独立 review 的四个 blocker，不扩大实现面：

| review concern | resolution | deliberately not added |
| --- | --- | --- |
| notification state 与 task admission 含混 | 定义为 provider-scoped、`projected_p80=0` 的 current reservability posture；task preflight 可更紧 | 新 admission 算法 |
| scope 未绑定 identity/policy/requirement | agent-safe identity-specific 完整 scope + policy/requirement digest | 账号标识、raw fingerprint |
| RED 只扫源码、crash path 未证 | 真实 registry/handler composition seam + 可注入 inbox/checkpoint 的 partial-failure retry | receipt/outbox/跨文件事务 |
| Codex legacy 5h/switch 残留 | notification/reset/wakeup/switch 全路径零效果；Codex/Cursor 自动切号禁止 | 新 account policy |

本修订不引入 circuit、hysteresis、receipt、独立 outbox、per-board ledger 或第二 quota store。

## 1. Authority 与范围

本合同只补齐 quota truth 到 origin notification 之间的投影边界，不复制既有 quota authority：

- [`2026-07-13-cross-harness-quota-admission-contract.md`](2026-07-13-cross-harness-quota-admission-contract.md)
  唯一拥有 `ccm/quota-observation/v1`、source key、TTL/freshness、derived
  `ample|tight|exhausted|unknown`、Codex 7d-only hard ceiling 与 rolling-24h advisory；
- [`cross-harness-notification-subscription`](harnesses/capabilities/cross-harness-notification-subscription.md)
  与 `coordination-inbox` CONTRACT 唯一拥有 session/epoch subscription、七字段 delivery provenance 和
  inbox read-only landing；
- [`cross-harness-cached-context`](harnesses/capabilities/cross-harness-cached-context.md) 与
  `orchestrator-context` CONTRACT 唯一拥有 SessionStart/resume bounded cached context；
- 本合同唯一拥有 **agent-safe machine quota posture projection、闭集 edge、跨 current subscription
  fan-out、相同 revision 去重，以及 live producer 的显式启用边界**。

`ccm` 是 observation、projection 与 fan-out producer。plugin hook 不读 provider、不持 credential、不计算
quota、不写 machine projection。既有 admission、reservation、supervisor 与 opportunistic collector 入口继续按各自
合同工作；本合同只限制 **machine-wide notification refresh/fan-out** 的入口。monitor 不是 correctness 前提，且不得因为安装、upgrade、bootstrap 或
hook 调用而从 cached-only 自动晋升 live。

## 2. Agent-safe zero-candidate posture projection

notification producer 复用既有 observation + active reservation + policy + requirement authority，针对每个
provider scope 求一次 **zero-candidate current reservability posture**：required bucket 与 safety margin 仍来自
版本化 requirement/policy，但每个 bucket 的 `projected_p80` 固定为 `0`。它回答“此刻这个 provider scope 是否
还具备接纳任意新工作的基础余量”，不是某个 task/model/effort 的 preflight 或 admission；真实 task admission
会加入非零 p80、candidate identity 与 task-specific gate，因而可以比 ambient posture 更紧，绝不可由
`state:"healthy"` 直接授权 spawn。

authority 必须先投影成下面的 agent-safe decision；origin adapter 只消费投影，不消费 raw observation/provider
response：

```json
{
  "schema": "ccm/machine-quota-decision/v1",
  "scope_digest": "sha256:<canonical-agent-safe-authority-scope>",
  "target": {
    "harness_id": "codex",
    "surface_id": "codex-cli",
    "provider_id": "codex",
    "identity_scope_digest": "sha256:<home-salted-identity-specific-digest>",
    "payer_scope": "subscription",
    "pool_scope_digest": "sha256:<agent-safe-pool-digest>",
    "bucket_id": "seven-day-global",
    "unit": "percent",
    "window": {"kind": "rolling", "name": "seven_day", "duration_sec": 604800}
  },
  "observation_revision": "sha256:<quota-observation-revision>",
  "decision_revision": "sha256:<canonical-agent-safe-decision>",
  "state": "healthy",
  "freshness": "fresh",
  "reason_codes": [],
  "policy_digest": "sha256:<canonical-policy-identity>",
  "requirement_digest": "sha256:<required-buckets+zero-p80+safety-margin>",
  "posture": {"projected_p80": {"seven-day-global": 0}},
  "observed_at": "2026-07-16T08:00:00Z",
  "valid_until": "2026-07-16T08:05:00Z",
  "reset_marker": null,
  "source": {
    "collector_id": "codex-app-server",
    "source_schema": "codex/account-rate-limits/v1"
  }
}
```

规范：

1. **MQN-DEC-001**：`target` 保留 harness/surface/provider/identity/payer/pool/bucket/unit/window 完整
   agent-safe scope；decision key 还必须绑定 `policy_digest+requirement_digest`。任一维变化都形成不同
   `scope_digest`，不可沿用 previous/checkpoint；
   Cursor IDE plugin 与 Cursor Agent CLI 永远是不同 `surface_id`，不可互相继承 auth/quota。
2. **MQN-DEC-002**：decision state 闭集为 `healthy|tight|exhausted|stale|unknown`。`healthy` 只可来自
   fresh `ample`；`tight|exhausted` 来自同名 derivation；soft/hard stale 都投影为 `stale` 并保留
   freshness；missing/error/conflict/unsupported 投影为 `unknown`。未安装或未认证不得投影成 healthy。
3. **MQN-DEC-003**：`decision_revision` 覆盖完整 agent-safe decision，但不把 routine collection time 当作
   decision change。相同 scope、state、freshness class、reason/policy/reset/source authority 的重采样保留
  同一 decision revision；raw observation revision 仍可更新用于审计。
4. **MQN-DEC-004**：`identity_scope_digest` 使用 ccm owner-only home salt + domain separation 从 authority
   identity 派生；它同一 identity 稳定、换 identity 必变，但不能反推出或跨 home 关联账号。
   `pool_scope_digest` 同样只暴露 agent-safe digest。email、account id、raw identity fingerprint、pool id、token、
   credential path、精确余额、raw provider response、argv/env、绝对私有路径不得进入 decision/delta/hook output。
5. **MQN-DEC-005**：Codex decision 只消费 `seven_day` hard gate与 rolling-24h velocity advisory。
   `five_hour` 即使出现 100%、reset 或 schema error，也只能列入 ccm 私有 ignored evidence；不得改变
   state/revision/edge、不得进入 notification/reset/wakeup/account-switch。Codex 与 Cursor 自动切号恒禁止；
   quota notification 不调用 `ccm account switch`。Claude 的 provider-owned 5h/7d 合同不受影响。
6. **MQN-DEC-006**：posture derivation 必须复用既有 quota authority 的 reservation/policy math；固定
   `projected_p80=0` 只定义 ambient comparison，不创建 hold/ticket/claim，也不建立 task admission authority。

## 3. 闭集 decision delta

只在同一 `scope_digest` 的 agent-visible 决策发生变化时产生 delta：

```json
{
  "schema": "ccm/machine-quota-decision-delta/v1",
  "producer": "machine-wide-quota-observer",
  "delta_revision": "sha256:<scope+previous+current+edge>",
  "scope_digest": "sha256:<same-as-decision>",
  "target": {
    "harness_id": "codex", "surface_id": "codex-cli", "provider_id": "codex",
    "identity_scope_digest": "sha256:<agent-safe>", "payer_scope": "subscription",
    "pool_scope_digest": "sha256:<agent-safe>", "bucket_id": "seven-day-global", "unit": "percent",
    "window": {"kind": "rolling", "name": "seven_day", "duration_sec": 604800}
  },
  "previous_state": "healthy",
  "current_state": "tight",
  "edge": "entered_tight",
  "decision_revision": "sha256:<current-decision>",
  "observation_revision": "sha256:<current-observation>",
  "freshness": "fresh",
  "reason_codes": ["QUOTA_TIGHT"],
  "policy_digest": "sha256:<policy-identity>",
  "requirement_digest": "sha256:<zero-candidate-requirement>",
  "observed_at": "2026-07-16T08:02:00Z",
  "valid_until": "2026-07-16T08:07:00Z",
  "reset_marker": null
}
```

Edge 是闭集：

| edge | 条件 | strength |
| --- | --- | --- |
| `entered_tight` | current=`tight` 且 previous!=`tight` | strong |
| `entered_exhausted` | current=`exhausted` 且 previous!=`exhausted` | strong |
| `became_stale` | current=`stale` 且 previous!=`stale` | strong |
| `became_unknown` | current=`unknown` 且 previous!=`unknown` | strong |
| `recovered` | current=`healthy`，previous 属于 tight/exhausted/stale/unknown，且没有 reset edge | weak |
| `reset` | ccm authority 证明 reset marker 改变；used% 下降本身不构成 reset proof | weak |

规范：

- **MQN-EDGE-001**：初次看到 healthy 只建立 baseline，不制造 recovery；初次看到非 healthy 必须产生对应
  decision-grade edge，使已运行 session 不会错过风险。
- **MQN-EDGE-002**：已证 reset 优先形成一个 `reset` edge，携带 reset 后 current state；不同时再制造一份
  `recovered`，避免一次事实两次打断。reset 后若仍 tight/exhausted，current state必须如实保留。
- **MQN-EDGE-003**：same `decision_revision`、同 state routine refresh、rolling-24h 数值变化但 advisory class
  不变，均无 edge。velocity advisory class 改变可更新 decision revision，但永远不变更 hard eligibility。
- **MQN-EDGE-004**：一个 scope 的 edge 不得覆盖或抑制另一 scope；多 provider 同 kind 的 inbox item 按
  `scope_digest` 分区 supersede，不能继续使用“每 kind 只留一条”的全局折叠规则。

## 4. Subscription fan-out 与 crash-safe 去重

Machine-wide producer 只向现有 `coordination-inbox` current subscriptions fan-out，不另建 subscription
registry。每个 destination 仍须通过既有 board/origin/session/epoch/capability 精确 binding；扫描 active board
不是 subscription 的替代。

Fan-out notification：

- `kind: "quota_state_change"`；这是 target-scoped advisory，不复用会暗示全局停止的 `pacing_stop`；
- degraded edge 使用 strong advisory，recovery/reset 使用 weak advisory；任何 target edge 都不是自动
  route/spawn/account-switch directive；
- payload 是完整 `ccm/machine-quota-decision-delta/v1`；hook 继续附加既有七字段 delivery provenance；
- 每个 destination 的 notification id 由 `subscription_id + delta_revision` 确定性派生。重试若已有相同
  producer/scope/delta revision 必须 no-op，不得自动加 `-2` 形成重复。

Checkpoint 是 observation store 旁的 ccm-owned derived projection，不是第二 quota truth。最小协议：

1. 读取 last completed decision checkpoint，计算 edge；
2. 对 tick 开始时所有 current valid subscriptions 逐个带锁写 board inbox；
3. 任一 current destination 写失败则不前移 scope checkpoint；重试完整 fan-out，已成功 destination 由确定性
   id no-op；
4. 全部成功后原子发布新 checkpoint；若当时没有 current subscriptions，可直接前移，后来的 session 由
   SessionStart/resume full summary获得当前事实；
5. crash 发生在最后一块 board 写后、checkpoint 前，只会导致幂等重试，不会重复通知；不需要 per-board
   nonce、permit、签发系统或跨文件事务。

### 4.1 可测 composition seam（不是新 authority）

CLI router 只允许测试/组装层替换既有的**原始 effect ports**：provider collector、owner-only quota
authority/reservation store、subscription list 与 inbox delivery。collector 返回 usage evidence 与来自已认证本地
provider 事实的 authority refs；identity 不可可靠取得时必须返回 unknown，不得用 `current` 或 provider 常量伪造。

composition 必须把 collector evidence 规范化后写入既有 quota authority store，再从该 store 读取 observation、
active reservation、policy 与 requirement authority，构造 `ccm/machine-quota-posture-input/v1` 并调用 canonical
`machine-wide-quota-posture` pure projector。测试不得注入现成 decision/posture/notification，也不得用
`readPostures()` 一类 final-decision boundary 绕过 projector。checkpoint 仍是同一 machine projection 的派生部分，
inbox 仍是现有 coordination inbox；不新增 authority、inbox 或 reservation store。status、refresh、partial failure
与 retry 必须经真实 registry→handler→composition 调用。

## 5. 两条且仅两条 machine-wide notification refresh/fan-out 入口

这里的“仅两条”只约束 ambient machine-wide notification 的 live refresh/fan-out composition root；它不关闭、
替代或绕过既有 task admission/preflight、supervisor live recheck 与 provider-owned collectors。

### 5.1 显式 CLI floor

```text
ccm quota status --machine-wide --json
ccm quota refresh --machine-wide --json
```

- `quota status --machine-wide` 只读 owner-only observation cache/projection，零 provider/network/credential effect，输出
  `schema:"ccm/machine-quota-status/v1"` 与每 scope freshness/state/revision；missing 是 explicit unknown。
- `quota refresh --machine-wide` 是用户或 orchestrator 显式调用的 live producer：枚举已安装且 ccm-supported
  target surfaces，调用各自只读 collector、更新既有 quota authority store、计算 edge并 fan-out。未带
  `--machine-wide` 必须 usage error，不偷偷退回 origin-local refresh。
- refresh 可部分成功，但每 scope 独立报告 `refreshed|unknown|unsupported|error`；一个 provider error 不可把
  另一个 provider 的 observation/revision 覆盖或伪造。

### 5.2 显式 monitor quota-source mode

```text
ccm monitor start --quota-source machine-wide
ccm monitor install-service --quota-source machine-wide
```

- monitor 缺省且升级后的默认恒为 `quota_source_mode:"cached-only"`，保持 PR #131 的
  cached-only/no-autostart；cached-only tick 零 provider/network/credential effect。
- `--quota-source machine-wide` 是显式 opt-in。mode 写入现有 monitor service state（owner-only + durable），
  `status` 回显；普通 process restart、`monitor restart` 与 `services reconcile` 保持已选 mode。显式传
  `--quota-source cached-only` 才降级关闭 live refresh。
- install/upgrade/reinstall/bootstrap/hook 不得自行 start monitor 或把 cached-only 改成 machine-wide。
- monitor 只周期调用与显式 refresh 相同的 ccm-owned composition；不另做 quota math，不成为调度脑。

## 6. 三 origin landing

1. `orchestrator-context`：SessionStart/resume（Cursor 使用既有 Track B 时点）可投递 bounded machine summary，
   每 scope 仅含 agent-safe target/state/freshness/revision/reason；完整 payload 仍受 4096-byte 与 canonical
   redaction contract。
2. `coordination-inbox`：运行中只投递 `quota_state_change` delta。Claude/Codex/Cursor 的 envelope 可不同，
   delta/provenance/revision 必须相同；hook 本身只 current/list，不 refresh、不 provider probe。
3. `usage-pacing`：origin-local hook 只是 monitor/explicit refresh 缺席时的 universal floor；ccm 若回显相同
   scope+decision revision 已由 machine-wide fan-out 覆盖，hook必须静默，不再 direct-inject 或另写一份。
   未覆盖时只可发布带明确 target scope/revision 的同类 delta，不得声称它观察了其他 harness。

Landing fail-open 只影响 agent context；dispatch/admission live gate仍由 ccm fail-closed。

## 7. Executable acceptance

Executable RED fixture 必须同时证明：

1. Codex、Claude Code、Cursor Agent target 的 decision-grade edge 各自 fan-out 到 Claude Code、Codex、
   Cursor 三个 current subscriptions，九个 destination 均保留相同 target delta revision。
2. healthy→tight、exhausted、stale、unknown、recovery、reset 均命中闭集；unchanged revision 与 routine
   re-observation 不新增 notification。
3. 两个 provider 同时变化时各自保留，不能被 kind-only supersession 折叠。
4. Codex 5h/switch evidence 产生零 decision revision/edge/notification/reset/wakeup/account-switch；7d tight 与
   rolling-24h advisory class 按既有政策工作。Codex/Cursor 自动切号为零。
5. 同 delta 重试、部分 fan-out 重试与 checkpoint crash 重放无重复；错 session/epoch/board subscription 不收件。
6. output 不含 raw account、identity fingerprint、credential、token、provider response；uninstalled/
   unauthenticated/unsupported 只能 unknown。
7. Cursor IDE/Agent 即使 provider/pool 相同也保持不同 scope；同 pool 换 identity 形成新 scope，绝不沿用
   previous/checkpoint 或 supersede 另一 identity。
8. known-good fixture通过；origin-local-only、kind-collapse、duplicate-on-retry、Codex-5h-sensitive、
   secret-leak、scope-collapse、checkpoint-early 等 counterfeit 至少各被一个 fixture杀死。
9. production baseline 经真实 registry→handler/composition seam 执行：status 证明零 live/write effect；refresh
   必须显式；一次 partial inbox write failure 后 checkpoint 不抢跑，retry 使用 stable id、无丢件/重复；stale/
   wrong subscription 不收件；monitor 默认 cached-only 且不自动启用 live source，显式 mode 持久化。RED 不以
   源码字符串、import/syntax/fixture setup 错误冒充行为失败。
