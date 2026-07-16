# Machine-wide quota signal notification contract v1

> 状态：**R2 signal contract frozen；ccm runtime candidate GREEN**
>
> 日期：2026-07-16 UTC
>
> 覆盖：本机各 execution surface 当前 authenticated login 的只读 quota signal 采集、machine-wide
> cached read / explicit refresh、decision edge、subscription fan-out、去重、三 origin cached landing
>
> 不覆盖：task-level quota reservation/admission、自动 route/spawn、自动换号、credential mutation、付费
> canary、per-board permit/nonce

## 0. 收窄结论

本合同服务的是“让任一 origin 中的 orchestrator 看见本机所有受支持 worker surface 的真实配额信号”，
不是另建一套 admission authority：

- **quota 属于 provider account / subscription / quota-pool，并跨 harness session 共享**；session 只是一条
  authenticated login 的采集入口，以及通知的订阅 destination，绝不是 quota scope；
- posture 的硬必需范围只有 `harness_id + surface_id + provider_id + window`。identity / payer / pool
  证据可作为 owner-only diagnostics 或可选的 agent-safe correlation digest，但缺失不能把一条 fresh、可解析的
  quota signal 降为 unknown；
- 同一 pool 被多个 surface 观察到时是**同一份额度的两个 surface view**，不得相加、乘二或解释成两份可用容量。
  只有 collector-proven `quota_scope_digest` 才允许相关联；digest 缺失时关系为 unknown，仍禁止按独立容量相加；
- `missing`、collector error、未认证、unsupported 或 TTL 过期才是 `unknown`。stale 是 unknown 的 reason / freshness，
  不再成为一套平行 posture state；
- Cursor IDE 与 Cursor Agent 本版都必须产出真实 `billing_period` signal。二者可复用 Cursor
  `DashboardService/GetCurrentPeriodUsage` backend，但 auth discovery 与 provenance 必须按 surface 区分。

## 1. Truth ownership 与 effect boundary

- 现有 provider usage / quota collector 拥有 raw signal；本合同不复制 provider response 或 credential。
- `ccm` 拥有 signal normalization、machine decision、checkpoint 与 fan-out；plugin hook 只读 ccm cache/inbox，
  不读 provider、不持 credential、不计算 quota。
- 现有 provider-specific pacing policy 继续拥有 percentage → `healthy|tight|exhausted` 的阈值；本合同只要求
  machine-wide projection 复用它，不引入 reservation、projected p80、task requirement 或新 safety margin。
- notification posture 是 ambient route input，绝不直接授权 spawn；task preflight 可以更紧。
- monitor 不是 correctness 前提，且不得因安装、upgrade、bootstrap 或 hook 调用自动从 cached-only 晋升 live。

## 2. Surface quota observation

collector 先规范化成既有 `ccm/quota-observation/v1` 语义。agent-visible decision 不暴露 raw value；但
production input 必须可证明下面的最小事实：

```json
{
  "harness_id": "cursor",
  "surface_id": "cursor-agent-cli",
  "provider_id": "cursor",
  "window": {"kind":"billing","name":"billing_period","duration_sec":2592000},
  "used_percentage": 42,
  "observed_at": "2026-07-16T08:00:00Z",
  "valid_until": "2026-07-16T08:05:00Z",
  "reset_marker": "2026-08-01T00:00:00Z",
  "quota_scope_digest": "sha256:<optional-collector-proven-shared-scope>",
  "source": {
    "collector_id": "cursor-agent-dashboard",
    "source_schema": "cursor/GetCurrentPeriodUsage/v1",
    "auth_source": "cursor-agent-current-login"
  }
}
```

规范：

1. **MQN-SIG-001**：collector 只观察本机该 surface 当前 authenticated login，不 login/logout/switch，不把
   “binary installed”或另一 surface 的 auth 当成本 surface auth。
2. **MQN-SIG-002**：Codex 只采 `seven_day` hard window；历史 `five_hour` 字段对 decision、edge、reset、
   wakeup、notification 与 account switch 零效果。Claude provider-owned 5h/7d 不受影响。
3. **MQN-SIG-003**：Cursor IDE 与 Cursor Agent 都采真实 `billing_period`。二者共享
   `DashboardService/GetCurrentPeriodUsage` backend，但 collector provenance 分别是 `cursor-dashboard` 与
   `cursor-agent-dashboard`，`auth_source` 分别是
   `cursor-ide-current-login` 与 `cursor-agent-current-login`；不得因 IDE token/installation 存在直接宣称
   Agent authenticated，反之亦然。
4. **MQN-SIG-004**：identity/payer/pool 缺失不阻塞 signal posture。若 collector 能证明两个 surface 属于同一
   provider quota scope，可发布 owner-home salted、不可逆的 `quota_scope_digest`；相同 digest 表示共享容量，
   不同 digest 表示不同容量，null 只表示关系 unknown。null 绝不表示“独立、可叠加”。
5. **MQN-SIG-005**：email、account id、raw identity fingerprint、pool id、token、credential path、raw provider
   response、argv/env 与绝对私有路径不得进入 decision/delta/hook output。

### 2.1 统一查询面

provider collector 的正式用户查询面不是 debug-only probe，而是既有只读 `usage` namespace：

```text
ccm usage show --harness cursor-agent --accounts current --json
ccm usage advise --harness cursor-agent --json
```

1. **MQN-QUERY-001**：`usage show` 对 authenticated Cursor Agent current login 返回
   `data.available:true`，并在 `data.current.billing_period` 原样投影
   `{used_percentage,resets_at}`；`resets_at` 是 billing cycle end 的 epoch 秒，`data.as_of` 是该次
   observation 的 RFC 3339 时间。`--accounts current` 不要求存在 account registry，也不能回退读取 Cursor IDE login。
2. **MQN-QUERY-002**：`usage advise` 消费同一份 Agent signal，返回
   `data.window_billing_period_pct`、`data.billing_period_resets_at` 与 `data.as_of`。reset 是 signal
   provenance，不是 stop-only action hint：即使 verdict 为 healthy `hold` 或 non-stop `throttle`，
   `billing_period_resets_at` 也必须保留；`nearest_reset` 可继续只表达需要 arm wakeup 的 action 语义。
3. **MQN-QUERY-003**：两条命令均须通过 `cursor-agent-dashboard` +
   `cursor-agent-current-login` collector/auth-source 读取 Agent 自己的 current login。Cursor IDE token 即使同时
   存在也不得被复用或改标签；collector 不可用时以 `available:false` 诚实降级，不能用另一个 surface 的 signal 点亮。
4. **MQN-QUERY-004**：`usage show` 与 `usage advise` 复用 machine observation store 的同一 TTL 结果。cache
   miss 时由 observation store 在同一 source lock 内最多执行一次 live collect，并原子发布可复用 observation；后续
   命令在 fresh TTL 内只读该 observation，不再次请求 provider。TTL 过期才允许下一次 live collect。

## 3. Machine quota decision

```json
{
  "schema": "ccm/machine-quota-decision/v1",
  "scope_digest": "sha256:<harness+surface+provider+window>",
  "target": {
    "harness_id": "cursor",
    "surface_id": "cursor-agent-cli",
    "provider_id": "cursor",
    "window": {"kind":"billing","name":"billing_period","duration_sec":2592000}
  },
  "quota_scope_digest": "sha256:<optional-shared-scope>",
  "observation_revision": "sha256:<normalized-signal>",
  "decision_revision": "sha256:<agent-safe-decision>",
  "state": "healthy",
  "freshness": "fresh",
  "reason_codes": [],
  "observed_at": "2026-07-16T08:00:00Z",
  "valid_until": "2026-07-16T08:05:00Z",
  "reset_marker": "2026-08-01T00:00:00Z",
  "source": {
    "collector_id": "cursor-agent-dashboard",
    "source_schema": "cursor/GetCurrentPeriodUsage/v1",
    "auth_source": "cursor-agent-current-login"
  }
}
```

规范：

1. **MQN-DEC-001**：`scope_digest` 只绑定 harness/surface/provider/window。Cursor IDE 与 Cursor Agent 因
   surface 不同而有不同 decision scope；policy 更新、login session 更换与可选 diagnostics 不能制造第三个 surface。
2. **MQN-DEC-002**：state 闭集为 `healthy|tight|exhausted|unknown`。fresh、可解析 signal 按现有 provider pacing
   policy 得到前三者；missing/error/unauthenticated/unsupported/soft-stale/hard-stale 得到 unknown，并用
   freshness + reason 区分。
3. **MQN-DEC-003**：routine collection time 不改变 `decision_revision`；相同 scope/state/freshness class/
   reason/reset/source policy 保持 revision。raw observation revision仍可更新审计。
4. **MQN-DEC-004**：`quota_scope_digest` 不参与 posture eligibility，也不改 `scope_digest`；它只为消费者合并
   shared-pool capacity view。消费者按 digest 去重容量，null 保守为 non-additive unknown relation。

## 4. Decision delta 与 fan-out

只在同一 surface `scope_digest` 的 agent-visible decision 变化时产生
`ccm/machine-quota-decision-delta/v1`：

| edge | condition | strength |
| --- | --- | --- |
| `entered_tight` | current=tight, previous!=tight | strong |
| `entered_exhausted` | current=exhausted, previous!=exhausted | strong |
| `became_unknown` | current=unknown, previous!=unknown | strong |
| `recovered` | current=healthy, previous 属于 tight/exhausted/unknown 且无 reset | weak |
| `reset` | collector 证明 reset marker 改变 | weak |

- 初次 healthy 只建 baseline；初次 non-healthy 产生对应 edge。
- stale signal 形成 `became_unknown` + `QUOTA_SIGNAL_STALE`，不另造 `became_stale` state machine。
- reset 优先于 recovered；used percentage 下降本身不是 reset proof。
- same decision revision、routine re-observation 与 Codex 5h 变化无 edge。
- 多 surface/provider edge 独立保留；`quota_state_change` supersession 按 surface `scope_digest` 分区。
- payload 保留 `quota_scope_digest` 与完整 `source.collector_id/source_schema/auth_source`，使相同共享池的多
  surface view 可相关联而不相加，并能证明每条 signal 来自目标 surface 自己的认证与 collector。

Machine-wide producer 只向既有 `coordination-inbox` current subscriptions fan-out：

1. notification `kind:"quota_state_change"`，target-scoped advisory，不是全局 stop/account-switch directive；
2. destination 必须经 board/origin/session/epoch/capability exact binding；session 只属于 delivery，不属于 quota；
3. notification id 由 `subscription_id + delta_revision` 确定性派生；相同 producer/scope/delta retry no-op；
4. fan-out 任一 current destination 失败则不前移 scope checkpoint；重试稳定 id；全部成功后原子 publish；
5. 无 current subscriptions 时可前移，后来的 session 由 bounded cached summary拿当前事实。

## 5. Live producer 入口

只有两条 ambient machine-wide refresh/fan-out 入口；既有 task admission/supervisor live recheck 不在此闭集：

```text
ccm quota status --machine-wide --json   # cached-only, zero provider effect
ccm quota refresh --machine-wide --json  # explicit live read-only collection + fan-out
ccm monitor start --quota-source machine-wide
ccm monitor install-service --quota-source machine-wide
```

- `status` 返回每 surface scope 的 state/freshness/revision；missing explicit unknown。实现可在独立 safe
  `readings` 投影返回 used%/reset/observed/valid/source，并以 `capacity_views` 对非 null shared digest 去重；
  bounded hook `summary` 的 exact contract 不因此扩宽。
- `refresh` 枚举 installed + ccm-supported surfaces；每 surface 独立报告
  `refreshed|unknown|unsupported|error`，一处失败不污染另一处。
- monitor 默认及升级默认恒为 `cached-only`；显式 opt-in mode 持久化，显式 cached-only 才关闭。
- install/upgrade/reinstall/bootstrap/hook 不得自启动 monitor 或改 mode。

## 6. 三 origin landing

1. `orchestrator-context`：SessionStart/resume（Cursor 既有 Track B 时点）投 bounded cached summary；每 row 仅含
   agent-safe target/quota-scope-correlation/state/freshness/revision/reason/source provenance。
2. `coordination-inbox`：运行中只投 `quota_state_change` delta；Claude/Codex/Cursor envelope 可不同，
   delta/provenance/revision 相同。
3. `usage-pacing`：origin-local cached hook 是 monitor/explicit refresh 缺席时的 floor。相同
   scope+decision revision 已 fan-out 时静默；否则只发布 local surface delta，不冒充 remote observation。

Landing fail-open 只影响 agent context；dispatch/admission live gate仍由自己的合同负责。Codex/Cursor 自动切号恒禁止。

## 7. Executable acceptance

1. Codex、Claude Code、Cursor IDE、Cursor Agent 四个 target 都有可执行 fixture；两条 Cursor surface 都是
   `billing_period` 真实 signal，同 dashboard backend、不同 collector/auth-source provenance；production RED
   必须经独立 IDE credential 与 Agent auth-file discovery 各发起一次真实 `GetCurrentPeriodUsage`，不能只伪造字段。
   同一 production RED 还必须实际调用 `usage show --harness cursor-agent --accounts current --json` 与
   `usage advise --harness cursor-agent --json`，用 healthy Agent observation 验证 billing percentage、cycle reset 与
   `as_of`；runtime 尚未实现时须在 `available`/字段行为断言处 RED，不得以 setup/import failure 冒充。
2. 任一 target edge fan-out 到 Claude Code/Codex/Cursor current exact subscriptions；同 target delta revision一致。
3. healthy/tight/exhausted/unknown 与 entered-tight/entered-exhausted/became-unknown/recovered/reset 闭集；
   stale→unknown；unchanged revision不通知。
4. Cursor IDE/Agent decision scope不同；collector-proven shared `quota_scope_digest` 相同，消费者不能把它们当
   两份额度；digest 缺失不阻塞 posture，也不能被解释成可相加。
5. Codex 5h/switch 产生零 revision/edge/notification/reset/wakeup/account-switch；7d 继续工作。
6. 同 delta retry、partial fan-out retry、checkpoint crash replay 无重复；stale/wrong subscription 不收件。
7. output 不含 raw account/identity/payer/pool/credential/token/provider response；未安装/未认证/unsupported/stale
   只能 unknown。
8. production test 经真实 registry→handler/composition seam：status 零 live/write effect；refresh 必须显式；
   monitor cached-only default + opt-in persistence。RED 不以源码字符串、import/syntax/fixture setup 错误冒充行为失败。
