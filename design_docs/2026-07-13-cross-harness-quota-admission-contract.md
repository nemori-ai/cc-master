# Cross-harness quota observation, reservation, and live-admission contract v1

> 状态：**C2/S4 bounded local runtime current；collector/supervisor dispatch integration target**
>
> 日期：2026-07-13 UTC
>
> 覆盖：quota observation、freshness/aggregation、Codex 7d-only hard admission、rolling-24h
> advisory、reservation/lock/idempotency、launch 前 live recheck、orphan audit、handoff/upgrade
> 边界
>
> 不覆盖：collector/provider driver 实现、真实 worker spawn、模型请求、provider billing、account
> login/logout/switch/auth write、board schema/waist 变更、7d hard ceiling 调整

## 1. 输入合同、范围与不可变式

本合同冻结 capability model 的 S4/SG3 机械边界。它消费以下既有合同，不修改其 authority：

- [`cross-harness-orchestration-capability-model.md`](cross-harness-orchestration-capability-model.md)：
  S4 quota admission、SG3 admission safety gate 与 current/target 证据晋升规则；
- [`2026-07-10-cross-harness-contract-spine.md`](2026-07-10-cross-harness-contract-spine.md)：
  planning/routing/candidate、`account_mutation:"forbidden"`、selection/attempt dedicated writer；
- [`cross-harness-runtime-supply-chain-spec.md`](cross-harness-runtime-supply-chain-spec.md)：exact immutable
  runtime selector；activation/rollback 只影响新 run；
- 已批准 supervisor contract exact commit
  `af41af29c9e7af008dfcd58279723dc2cc8ad3e0` 的
  `design_docs/2026-07-13-cross-harness-supervisor-contract.md`：launch claim、`run_ref`、journal/lease、
  orphan 与 active-run lifecycle；本分支只以 commit pin 消费，不复制其状态机；
- 用户批准的 `design_docs/plans/codex-7d-pacing-spec.md`：Codex 已退役 5h ceiling；7d 是唯一
  quota hard ceiling；rolling 24h 只作 advisory；
- `design_docs/plans/cross-harness-implementation-dag.md` 的 `xh_c2_quota_reservation` 切片：plan 是历史执行
  输入，不是 runtime/current evidence；本合同、production engine/store/CLI 与 executable oracle 共同构成
  bounded local runtime 的 current evidence。真实 collector、supervisor claim/spawn 与 provider/model probe 仍不在
  本切片内。

规范性不变式：

1. **QA-BND-001**：observation 忠实保存 source identity/payer/pool/bucket/unit/window/provenance；
   不同 aggregation key 永不 join、sum 或互相补缺。
2. **QA-BND-002**：对 `provider=codex`，hard admission 只消费 `seven_day`；任何历史/意外
   `five_hour` 输入被标记并忽略，不能导致 throttle/switch/stop/reset/wakeup，也不能把一个有效 7d
   observation 污染成 unknown。
3. **QA-BND-003**：本合同不定义或改变 7d hard ceiling 数值。实现必须读取已版本化的现有 pacing
   policy revision，并把 revision/ceiling 回显进 derivation；fixture 中的 `85` 只是对当前 policy 的 pin。
4. **QA-BND-004**：unknown、tight、exhausted、soft-stale 未刷新、hard-stale、conflict 或 orphan
   均令 automatic launch claim/spawn 上限为 0。只有全部承重 bucket fresh 且 ample 才可继续。
5. **QA-BND-005**：rolling-24h velocity 不进入 hard eligibility、reservation capacity 或 launch
   claim 判定；它即使高于日预算也只能产生 advisory。
6. **QA-BND-006**：reservation 是本地保守占位，不冒充 provider bill/charge。capacity 只会更保守，
   绝不能因 crash、manager death、handoff、upgrade 或未知 writer 被提前释放。
7. **QA-BND-007**：reservation 必须先 `committed`，supervisor launch claim 才可发布；
   `held`/missing/expired/orphaned reservation 下的 claim/spawn 均为 0。
8. **QA-BND-008**：Codex/Cursor 的 login/logout/account/session switch、credential import/copy/write、
   auth-store write 永久为 0；quota read/refresh authority 不蕴含 account mutation authority。
9. **QA-BND-009**：`authenticated` 只证明当前 surface 的认证事实，不证明 quota observation 存在、fresh、
   可比较或 ample。`auth=true, quota=missing|unknown|stale|conflict` 的 automatic claim/spawn 上限恒为 0。

本合同不新增中央 always-on daemon。collector 可由显式 command、现有 hook-triggered sampling 或未来
per-run supervisor opportunistically 调用；monitor 只可 prewarm，不是 correctness 前提。hook 始终
cached-only，live provider I/O 只发生在显式 preflight/admission composition root。

## 2. Observation、source key、TTL 与 freshness

### 2.1 Versioned observation

每条 observation 的最小 wire shape：

```json
{
  "schema": "ccm/quota-observation/v1",
  "observation_id": "obs-7d-a-42",
  "revision": "sha256:<canonical-observation>",
  "source_key": {
    "harness": "codex",
    "provider": "codex",
    "surface_id": "codex-cli",
    "identity_fingerprint": "sha256:<opaque-current-identity>",
    "payer_scope": "subscription",
    "pool_id": "codex-current-login",
    "bucket_id": "seven-day-global",
    "unit": "percent",
    "window": {
      "kind": "rolling",
      "name": "seven_day",
      "duration_sec": 604800
    }
  },
  "value": { "used": 41.5, "limit": 100, "resets_at": "2026-07-18T08:00:00Z" },
  "source": {
    "collector": "codex-app-server",
    "schema": "codex/account-rate-limits/v1",
    "raw_revision": "sha256:<redacted-payload>"
  },
  "observed_at": "2026-07-13T08:00:00Z",
  "valid_until": "2026-07-13T08:05:00Z"
}
```

- **QA-OBS-001**：`identity_fingerprint` 必须 opaque、稳定于同一当前 login 且不可逆；email/token/
  credential path/raw private response 不进入 observation、board、journal 或 agent projection。
- **QA-OBS-002**：`source_key` 除 `bucket_id` 外的字段加 window tuple 构成 aggregation key；
  `bucket_id` 标识同一 aggregation group 内不可互相替代的承重 bucket。provider、surface、identity、
  payer、pool、unit 或 window 任一不同即不可比较。
- **QA-OBS-003**：同 `observation_id` + 同 canonical revision 是幂等重复；同 ID 或同 source sequence
  对应不同 revision 是 `QUOTA_OBSERVATION_CONFLICT`，相关 aggregation group circuit-open/unknown，任何
  downstream admission 的 claim/spawn=0。
- **QA-OBS-004**：百分比必须为有限 `0..100`；limit/unit/window/source schema 不支持、reset 早于
  observation、observed_at 在未来超过允许 clock skew 均 fail closed，不做 clamp/猜测。
- **QA-OBS-005**：home snapshot store 是 owner-only `0600`、atomic revision、home+source-key single-flight
  collector；至少 10 个隔离 worker 同时 refresh 同一 home+source key 时，只执行一次 injected read-only
  collector，全部收到同一 published revision。store/collector 是 observation 的唯一 writer。hook、skill、
  viewer、route scorer 都不能写 observation。

### 2.2 TTL profile 与 freshness state

collector registry 必须给每个 source schema 固定：

```json
{
  "schema": "ccm/quota-source-profile/v1",
  "source_schema": "codex/account-rate-limits/v1",
  "fresh_ttl_sec": 60,
  "hard_ttl_sec": 300,
  "max_clock_skew_sec": 5
}
```

`0 < fresh_ttl_sec <= hard_ttl_sec`。实际 hard expiry 是
`min(observed_at + hard_ttl_sec, valid_until, resets_at if present)`；identity/payer/pool change、collector
schema conflict 或已证 reset 立即 invalidate，不等 TTL。

| State | 判定 | automatic admission |
| --- | --- | --- |
| `fresh` | age ≤ fresh TTL，且未过 valid/reset，identity/pool/source revision 一致 | 可继续其余 gate |
| `soft-stale` | fresh TTL < age ≤ hard TTL | cached report 可读；须 live refresh，refresh 前 claim/spawn=0 |
| `hard-stale` | age > hard TTL 或过 valid/reset | ineligible；claim/spawn=0 |
| `unknown` | missing/partial/unsupported/conflict/collector error | ineligible；claim/spawn=0 |

- **QA-FRESH-001**：freshness 在每次读取时用明确 `checked_at` 计算并回显 age/profile revision；不把
  文件 mtime 当 observed time。
- **QA-FRESH-002**：所有 candidate 声明的 `required_bucket_ids` 都必须 fresh；缺一个就是
  `QUOTA_REQUIRED_BUCKET_UNKNOWN`，不能由可见 sibling bucket 补齐。
- **QA-FRESH-003**：soft-stale 可触发 single-flight refresh；refresh unavailable/429/schema drift
  不退回 last-known 作为 launch authority。
- **QA-FRESH-004**：reset-crossing/decreasing 7d history 对 rolling rate 不可比较；新的 reset 后
  observation 可重新成为 fresh hard-gate input，但 reset 前后样本不做 velocity 差分。

## 3. Codex 7d-only aggregation 与 derived headroom

### 3.1 Required-bucket aggregation

candidate 的 quota requirement 是显式 bucket refs，不是“当前账号有一个 quota 值”：

```json
{
  "schema": "ccm/quota-requirement/v1",
  "candidate_id": "codex-cli-inspect",
  "aggregation_key": "sha256:<provider+surface+identity+payer+pool+unit+window>",
  "required_bucket_ids": ["seven-day-global"],
  "projected_p80": { "seven-day-global": 4.5 },
  "safety_margin": { "seven-day-global": 2.0 },
  "policy_revision": "ccm/codex-7d-pacing/v1"
}
```

- **QA-AGG-001**：Codex hard aggregation 先过滤到 `window.name=seven_day` 且 duration=604800；
  `five_hour` 无论值为 0、100、null、malformed 或未来 reset，都进入 `ignored_inputs[]`，不进入 required
  set、status、reason、reservation amount 或 live ticket。
- **QA-AGG-002**：同 aggregation key 的 required bucket 各自求 headroom，group status 取最保守状态；
  bucket 之间不求和、不平均。不可比较 group 必须分别 admission/reservation，不能共享容量。
- **QA-AGG-003**：多 bucket reservation all-or-nothing；按 canonical aggregation-key 顺序获取全部锁，
  任一 bucket 不 fit/不 fresh/锁失败则写入 0 个 hold。
- **QA-AGG-004**：generic Claude/其他 provider 的 5h contract 不因 Codex 7d-only 被删除；provider-scoped
  registry 决定 required window。本 spec 只禁止 Codex 5h 复活。

### 3.2 Pure derivation

对每个 required bucket：

```text
reservable_headroom =
  hard_ceiling_used_pct(policy_revision)
  - observed_used_pct
  - sum(active held|committed|release_pending|orphaned reservations)
  - safety_margin_pct
```

`projected_p80` 必须来自与 candidate/model/effort/task bucket 对齐的版本化 estimate evidence；missing/
NaN/negative/错误 unit 均 unknown，不用平均值或 prompt 猜。

| Derived state | 条件 |
| --- | --- |
| `ample` | 每个 required bucket fresh，且 `projected_p80 <= reservable_headroom` |
| `tight` | 尚未触及 hard ceiling，但任一 bucket 的 p80 fit 不成立 |
| `exhausted` | 任一 bucket observed+active reservation 已触及/越过既有 hard ceiling |
| `unknown` | observation/estimate/policy/aggregation 任一不可证明 |

- **QA-DER-001**：只有 `ample` 可进入 hold/live recheck；`tight|exhausted|unknown` automatic
  launch claim/spawn=0。
- **QA-DER-002**：derived result 回显 observations、policy revision、active reservation refs、p80、margin、
  per-bucket math 与 reason codes；不写回 provider、不声称真实 billing headroom。
- **QA-DER-003**：同一 immutable input revision 的 derivation 是 pure/deterministic；engine 不做 I/O、
  不硬编码 provider/model preference，也不把 rolling-24h advisory 混进 state。

## 4. Rolling-24h 7d-consumption advisory

只对同一 Codex 7d aggregation key 的 timestamped fresh/历史有效 snapshots 计算：

```text
daily_budget_pct = 100 / 7
observed_daily_velocity_pct = delta_used_pct / coverage_hours * 24
velocity_ratio = observed_daily_velocity_pct / daily_budget_pct
```

- **QA-R24-001**：优先选 `as_of` 与 `as_of-24h` 两端最近且不跨 reset 的样本；没有完整 24h 时可用
  最长覆盖 interval，但必须回显 `coverage_hours` 与 `coverage_kind:"partial"`。
- **QA-R24-002**：至少 2 个样本且 coverage ≥ 6h 才可出 rate；`6..<12h=low`、`12..<20h=medium`、
  `20..24h=high` confidence。coverage>24h 截到 trailing 24h，不用古老均值掩盖近期 burn。
- **QA-R24-003**：used decrease/reset-crossing、同 timestamp 冲突、mixed aggregation key、hard-stale
  endpoint、coverage<6h 均 `unavailable`；不发明 rate。
- **QA-R24-004**：`velocity_ratio>1` 可产生 `throttle-risk` advisory；ratio 本身永远
  `hard_gate_effect:"none"`。若 live 7d ample，high velocity 也不把 automatic spawn limit 从 1 改为 0。
- **QA-R24-005**：history retention 有界、owner-only、token/credential blind；本合同不要求 daemon
  定时采样或跨机器聚合。

## 5. Reservation record、locks、idempotency 与状态机

### 5.0 Owner-only store 与 crash boundary

production store seam 固定为
`ccm/apps/cli/src/quota-admission-store.ts`；纯判定从 `@ccm/engine` 的
`quota-admission` 公共 export 进入，CLI composition 从现有 router/registry 的 `quota` noun 进入。删除旧的
单文件 `ccm/apps/cli/src/quota-admission-contract.ts` evaluator seam：它既不拥有 engine contract，也没有
CLI/store/lock 边界，不能作为 production GREEN 的落点。

最小 owner-only layout：

```text
<CC_MASTER_HOME>/quota/v1/
  observations/<source-key-sha256>/current.json
  reservation-keys/<idempotency-key-sha256>/current.json
  reservations/<aggregation-key-sha256>/
    events/<zero-padded-seq>-<event-id>.json
    snapshot.json
    lock
```

observation `current.json` 与 reservation `snapshot.json` 必须经同目录 temp + file fsync + atomic replace +
best-effort directory fsync 发布；mode 固定 `0600`。reservation event 先以 immutable no-replace 文件 durable
发布，snapshot 只是可重建 projection。event durable 后、snapshot replace 前 crash 时，重开 store 必须从
连续 event prefix 恢复；残留 temp、截断 snapshot 或缺 snapshot 都不能删除 durable event、释放容量或把
状态退回 `absent`。

future store 的 filesystem boundary 是 production composition port，不是 fixture-only repository：

```ts
createQuotaAdmissionStore({ home, filesystem? })
```

`filesystem` 缺省时使用 Node filesystem implementation；注入时必须覆盖 store 的全部 filesystem I/O，
不得一半走 port、一半绕回 `node:fs`。port 使用 async `open/readFile/readdir/stat/lstat/mkdir/rename/unlink`
等 Node-compatible primitive；`open()` 返回的 handle 至少有 `writeFile/sync/close/stat`。这条 port 让测试在
真实临时目录上观察并故障注入，而不是用无 filesystem 约束的内存 fake。atomic publish 的固定序列为：

```text
open same-directory unique temp with wx + 0600
  -> write complete
  -> temp file handle.sync() succeeds
  -> rename(temp, final) on the same filesystem
  -> open parent directory + directory handle.sync() attempt
```

final path 禁止以 `w`/truncate 直接打开。rename 前任何异常必须让旧 final 保持完整可见；temp 不具 authority。
rename 后 directory fsync 必须至少尝试。Linux/macOS/filesystem 对 directory fsync 返回
`EINVAL|ENOTSUP` 时可作为明确的 `directory_sync:"unsupported"` 成功结果降级；其余错误（包括
`EACCES|EPERM`）不可静默吞掉。支持 directory fsync 时结果为 `directory_sync:"durable"`；reservation
receipt 对 event/snapshot 分别使用同义字段 `event_directory_sync` / `snapshot_directory_sync`。无论哪种
结果，authority 前的 file fsync 都是硬前置，不能降级成 `fdatasync`、flush 或“写完大概就行”。

- **QA-STORE-001**：`createQuotaAdmissionStore({home})` 是 CLI composition 使用的唯一 production store
  factory；测试与 CLI 共用它，不准另建 fixture-only repository。
- **QA-STORE-002**：observation/snapshot 发布是 owner-only `0600` atomic replace；reader 只看到完整旧
  revision 或完整新 revision，永不看到半截 JSON。残留 temp 不拥有 revision authority。
- **QA-STORE-003**：reservation event 是 immutable no-replace linearization evidence；snapshot 删除/损坏后
  `inspectAggregation()` 从 event prefix 恢复同一 reservation/state/active total，并重建 snapshot。
- **QA-STORE-004**：event sequence gap、同 seq 不同 event、event JSON 冲突、authoritative event 截断或
  无效 JSON 均 fail closed 为 `RESERVATION_STORE_CONFLICT`；不得把损坏 event 当有效、截坏尾后释放或继续
  接受新 hold。
- **QA-STORE-005**：store API 不接 fixture name/path/`expected`，返回 durable `event_ref`、`snapshot_ref` 与
  revision，供 executable oracle 破坏 snapshot、重开 store 并验证 replay；这些 refs 不是 provider billing
  evidence。
- **QA-STORE-006**：contract test 给 production filesystem port 套 observation/fault layer：必须观察
  `wx+0600 temp -> write -> file fsync -> same-dir rename -> directory fsync attempt` 的严格次序；在 rename 前
  注入故障时 publish 明确失败且旧 revision 仍完整可见；pause 在 rename boundary 时 reader 只见旧 revision，
  resume 后只见完整新 revision。直接 truncate/write counterfeit 必须被 oracle 拒绝。
- **QA-STORE-007**：directory fsync 是三态 durability matrix，contract test 必须覆盖全部三态而非只证 happy
  path。① 支持时 → `directory_sync:"durable"`；② filesystem 明确不支持（directory handle fsync 抛
  `EINVAL|ENOTSUP`）时 → 可作为明确的 `directory_sync:"unsupported"` 成功降级——rename 已使 final durable，
  publish 仍成功，nominal 断言**不得**因诚实上报 unsupported 而拒绝一台合规平台；③ 其余 errno（含
  `EACCES|EPERM` 硬权限失败）→ store 必须 surface 该错误、publish 明确失败，**绝不**静默降级成
  `unsupported`/`durable`。soft 与 hard 由 errno 集合区分（非单 code 特判）。reservation event 是 immutable
  no-replace log durability：以 `wx+0600` 独占创建 → write → file fsync → directory fsync attempt，event 文件
  禁止被 truncate 或 replace；directory fsync 缺失（file 或 event）与 no-replace/truncation counterfeit 必须被
  oracle 拒绝。file fsync 在 rename/authority 前始终是硬前置。
  event/snapshot 两个 receipt 字段分别可观测各自的 `durable|unsupported`，不能由一个 publication 的结果
  替另一个 publication 背书。

`createQuotaAdmissionStore({home})` 的 v1 test/production 共用最小 surface 为
`refreshObservation(request, collector)`、`publishObservation(request)`、`readObservation(sourceKey)`、
`reserve(request)`、`inspectAggregation(aggregationKey)`；method 可返回值或 Promise，语义相同。这个 surface
不是 public npm stability 承诺；`createQuotaAdmissionStore({home, filesystem?})` 的 filesystem port 是同一个
production factory 的 infrastructure dependency，不是第二 repository。CLI handler 必须把同一 injected
`QuotaEffectBoundary` 适配成这个 filesystem port；缺 boundary/capability 时须在任何 store I/O 前失败，不能
使用 factory 的 ambient Node filesystem 缺省值。direct store tests 可显式使用缺省 Node implementation，以
验证真实 filesystem 约束。若另起一套
fixture-only adapter，或注入后仍绕开 port 直写，不能通过本合同。

### 5.1 Record 与 capacity accounting

```json
{
  "schema": "ccm/quota-reservation/v1",
  "reservation_id": "qres-7",
  "idempotency_key": "sha256:<dispatch-key+attempt+candidate+input+permission+worktree>",
  "request_hash": "sha256:<canonical-reservation-request>",
  "attempt_id": "attempt-7",
  "candidate_id": "codex-cli-inspect",
  "aggregation_key": "sha256:<quota-aggregation-key>",
  "amounts_p80": { "seven-day-global": 4.5 },
  "source_revision": "sha256:<live-quota-revision>",
  "state": "held",
  "held_at": "2026-07-13T08:00:10Z",
  "hold_expires_at": "2026-07-13T08:01:10Z",
  "launch_binding": null
}
```

capacity 计入 states：`held|committed|release_pending|orphaned`；不计入：`released|expired`。

```text
absent
  └─ held
      ├─ committed ──> release_pending ──> released
      │      └───────────────────────> orphaned
      ├─ audited pre-claim abort ───────> released
      ├─ proven no-claim after TTL ─────> expired
      └─ claim/process evidence unknown ─> orphaned

orphaned ──audit proof──> committed | release_pending | released
released/expired are terminal; retry returns the same receipt
```

- **QA-RES-001**：创建 hold、capacity-changing transition 和 read-modify-write derivation 必须在
  aggregation-key exclusive lock 内完成；multi-key 锁按 canonical key 排序，all-or-nothing，避免死锁。
- **QA-RES-002**：lock owner identity 至少含 boot ID、process start identity、owner nonce；mtime/PID
  单独不能回收 lock。拿不到/无法证明 stale owner 时 `QUOTA_LOCK_BUSY`，write/claim/spawn=0。
- **QA-RES-003**：request hash 由 owner store 对 authority revision + 完整承重 binding canonical 计算，
  caller 的 hash 不拥有 authority；同 idempotency key + 同 canonical hash 返回原 reservation/receipt，
  新增 reservation=0；同 key + 不同 hash/attempt/candidate/source group 是
  `RESERVATION_IDEMPOTENCY_CONFLICT`。`expired|released` 是单调 terminal，audit retry 返回既有 receipt，
  不新增 event、不复活或重新占容量。idempotency key 在 machine authority scope 有独立 lock 与 durable
  key→reservation index；不同 provisional ID 或不相交 aggregation 也必须先解析同一 key authority，不能各建
  一份 hold。reservation event/journal durable 后、key index publish 前 crash 时，retry 从全局 authority replay
  修复 index，不新增 reservation/event。
- **QA-RES-004**：并发 contenders 在锁内重算 active total；linearized committed/held 总量绝不超过
  每个 bucket 的 reservable headroom。cache 中的 pre-lock fit 不能授权 hold。验收不得把
  `linearization_order` 当输入；至少 10 个真正同时开始的 contenders 竞争同一 home/store。
- **QA-RES-005**：`held` TTL 只限制未 claim 的 admission ticket。TTL 到达后必须在 launch store lock
  下证明 claim absent、writer/process absent 才可 `expired`；claim store 不读/冲突即 `orphaned`，继续占容量。
- **QA-RES-006**：`committed` 不按墙钟自动过期。只有 terminal/pre-spawn-abort + audit proof 才进入
  release；manager/session death、heartbeat silence、PID missing、upgrade 都不释放。terminal/audit proof 必须是
  闭合 schema，并绑定 reservation ID/request hash、attempt、run 与 committed ticket digest；任一 binding
  missing/mismatch/conflict 均保留容量，不能把任意非空对象当 proof。
- **QA-RES-007**：reservation events append-only，snapshot 可原子投影；crash 后从 durable events 恢复，
  不能删除/覆盖目录来“解锁容量”。single-key capacity transition 在 event durable、snapshot replace 前 crash
  时，terminal audit retry 必须从 event authority 主动修复 snapshot 后再返回既有 terminal receipt。
- **QA-RES-008**：同一 idempotency key + 同一 request hash 的至少 10-way 并发只有一个 `created`、一个
  reservation/event/ref，其余全部 `idempotent-existing`；所有 caller 返回同一 reservation ID，新增
  reservation/launch/spawn 分别最多 `1/0/0`。不同 provisional caller ID 不产生第二份 authority。
- **QA-RES-009**：public reserve request 是闭合 schema；amount 与 caller capacity assertion 必须 positive
  finite，identity/key/source/attempt/candidate/account/pool 不可为空，request hash 由 store 生成，且创建
  操作只能写 `held`。multi-key success 以
  recoverable coordinator/journal 作为单一可见性点；preparing 不计容量，committed 才同时投影全部 legs，
  crash/retry 不得暴露 split hold 或把残腿误报为完整幂等成功。
- **QA-RES-010**：capacity/headroom 只从 owner-only observation/config 的 hard-window buckets 锁内推导；
  caller capacity 只能作为一致性断言，不一致为 `RESERVATION_AUTHORITY_MISMATCH`，绝不覆盖 store authority。
  reservation ID 在本机 authority scope 全局唯一：同 ID 不同 key/aggregation/binding 必须 typed conflict。
- **QA-RES-011**：multi-key committed journal 同时是 reservation-ID lookup 与所有 capacity-changing
  transition（audit/expiry/orphan/release）的唯一 authority；transition canonical-lock 全部 legs 后一次发布，
  snapshot 只是可重建 projection。任一 crash/retry 只能看到完整旧状态或完整新状态。

### 5.2 Commit 与 supervisor launch bind

`held -> committed` 必须写 immutable binding：

```json
{
  "schema": "ccm/quota-admission-ticket/v1",
  "ticket_id": "ticket-7",
  "reservation_id": "qres-7",
  "reservation_request_hash": "sha256:<request>",
  "reservation_expires_at": "2026-07-13T08:01:10Z",
  "attempt_id": "attempt-7",
  "run_ref": "ccm-run:v1:run-7",
  "account_id": "account-7",
  "pool_id": "pool-7",
  "launch_idempotency_key": "sha256:<supervisor-dispatch-key>",
  "launch_nonce": "nonce-7",
  "runtime_sha256": "sha256:<exact-image>",
  "identity_fingerprint": "sha256:<same-current-identity>",
  "aggregation_key": "sha256:<same-quota-group>",
  "live_source_revision": "sha256:<rechecked-revision>",
  "issued_at": "2026-07-13T08:00:19Z",
  "committed_at": "2026-07-13T08:00:20Z",
  "launch_by": "2026-07-13T08:00:35Z",
  "canonical_identity": {
    "schema": "ccm/canonical-launch-identity/v1",
    "origin": {
      "harness": "codex",
      "session_ref": "session:<opaque-origin-ref>"
    },
    "target": {
      "harness": "cursor",
      "adapter": "cursor/agent-cli-v1",
      "surface": "cli-headless",
      "transport": "cursor-agent-json-stream-v1",
      "candidate_id": "cursor-cli-composer-standard"
    },
    "provider": {
      "id": "cursor",
      "model": "composer-2.5",
      "effort": "standard"
    },
    "account": {
      "fingerprint_ref": "sha256:<same-current-identity>",
      "account_id": "account-7",
      "pool_id": "pool-7",
      "identity_fingerprint": "sha256:<same-current-identity>"
    },
    "workspace": {
      "workspace_ref": "workspace:<opaque-owner-ref>",
      "worktree_ref": "worktree:<opaque-lease-ref>",
      "baseline_commit": "<40-hex-commit>"
    },
    "permission": {
      "snapshot_ref": "permission:<opaque-owner-ref>",
      "profile": "workspace-write",
      "denies": ["account-mutation", "credential-write", "push-remote"]
    },
    "input": {
      "digest": "sha256:<actual-worker-argv-utf8-bytes>"
    },
    "request": {
      "digest": "sha256:<canonical-provider-extension-plus-dispatch>"
    },
    "dispatch": {
      "run_ref": "ccm-run:v1:run-7",
      "idempotency_key": "sha256:<supervisor-dispatch-key>",
      "launch_nonce": "nonce-7",
      "claim_id": "nonce-7"
    },
    "runtime": {
      "image_sha256": "sha256:<exact-image>",
      "selector": {
        "kind": "exact",
        "model_id": "composer-2.5",
        "effort": "standard"
      }
    }
  },
  "canonical_identity_digest": "sha256:<canonical-identity>",
  "provider_extension": {
    "schema": "ccm/cursor-provider-launch-extension/v1",
    "selector": "composer-2.5[fast=false]",
    "workspace_path": "/absolute/worktree/path",
    "executable_path": "/absolute/path/from-the-pinned-runtime"
  }
}
```

`committed_at` 由 reservation writer 在 `held -> committed` transition 内生成；caller 不可预填。
immutable digest 同时绑定 ticket 与 attempt/run/account/pool/identity/aggregation/source/reservation-expiry/
launch-expiry lineage，后续幂等重放只接受同一 ticket request digest。

quota owner 与 provider 之间的 launch authority 不是一个 digest-only seam。owner preflight 在允许 claim 时必须
同时返回闭合的 `owner_receipt` 与其对应的完整 `committed_ticket` preimage；provider 必须用共享 parser 解析
preimage、用 `@ccm/engine` 的 canonical JSON 重算 digest、与 receipt 及 request projection 同时比对，随后才可
进入 executable resolution。provider 不得只接收 caller 投影的 `ticket_digest`，也不得自建 ticket/receipt
parser、canonicalizer 或 binding table。

`canonical_identity` 是 ticket 内不可变的实际启动身份 envelope，而不是 planning hint。它必须直接使用 native
attempt 已拥有的唯一 `@ccm/engine` contract `ccm/canonical-launch-identity/v1` 及其 field registry、normalizer、
canonical JSON、SHA-256 与 digest；CLI/provider 不得复制 identity schema、字段表、canonicalizer 或 hash。
这里复用的只有 transport-neutral identity vocabulary；Cursor provider ticket 不因此进入 Codex-only
`ccm/native-attempt/v1` descriptor registry、create/bind/reconcile writer 或其 evidence contract。
origin session、target descriptor/candidate、provider model/effort、account/pool/fingerprint、workspace/worktree/
baseline、permission、input/request digest、dispatch 的 canonical run/idempotency/launch nonce/claim 与 runtime
exact selector 都属于该共享 identity；字段集合以 engine 的
`CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY` 为唯一真相源。

Cursor 独有但不属于跨 provider identity 的 raw selector、absolute workspace path 与 absolute executable path
只进入闭合的 `ccm/cursor-provider-launch-extension/v1`。该 extension **不是第二 canonical identity root**：它不
复制任何 identity atom，且只使用 engine `canonicalJson` + `sha256Hex`；共享 identity 的 `request.digest` 由
`provider_extension` 与 ticket 顶层 attempt/run/idempotency/nonce 的 closed projection 唯一生成。ticket parser
同时重验 `canonical_identity_digest`、identity 与顶层 account/runtime 字段交叉绑定，以及 extension/request
digest。`input.digest` 必须等于 Node 实际通过 worker argv 边界产生的标准 UTF-8 bytes；unpaired UTF-16
surrogate 按 WHATWG/Node replacement semantics 编为 U+FFFD，或在 resolution 前显式拒绝，绝不哈一套字节、
spawn 另一套字节。

所有名为 SHA-256 的承重 runtime/identity digest 必须匹配 `^sha256:[0-9a-f]{64}$`；uppercase、非 hex、长度
错误、斜线或首尾空白一律在 executable resolution 前拒绝。`fingerprint_ref` 若是明确声明的 opaque owner
reference，不冒充 digest；`identity_fingerprint` 则必须满足上述严格格式。

provider 生成 launch binding context 时，descriptor/candidate/selector/model/effort、account、workspace/worktree、
permission、完整 input/request digest、runtime image/path、attempt/run/idempotency/nonce 必须来自**实际将用于
组装 argv/cwd/env 的 request 与 pinned runtime seam**，不得从 ticket 回填。任一实际启动身份与 ticket 不同，
即使 receipt/ticket 自身完全未变且 digest 有效，也必须在 `resolveExecutable`、claim 和 `spawnProvider` 之前
fail closed。

共享 production registry 分为三个互不重叠的 binding class，Cursor 与未来 Claude provider 都直接 import
同一实现：

```text
reservation binding:
  reservation-id, reservation-request-hash, reservation-expiry, attempt-id,
  account-id, pool-id, identity-fingerprint, aggregation-key, live-source-revision

owner receipt binding:
  reservation-id, reservation-request-hash, ticket-digest, attempt-id, run-ref,
  account-id, pool-id, source-revision, authority-digest

provider launch binding:
  ticket-digest, reservation-id, reservation-request-hash, reservation-expiry,
  attempt-id, run-ref, account-id, pool-id, identity-fingerprint, aggregation-key,
  live-source-revision, runtime-sha256, launch-idempotency-key,
  launch-nonce, checked-at-window, canonical-identity, provider-extension
```

provider launch context 的值必须来自实际将要执行的 request/runtime seam，而不是从 ticket 自己回填：resolved
candidate 的 absolute executable path + pinned runtime hash、token-blind identity fingerprint、quota aggregation/source
revision、attempt/run、launch idempotency key/nonce，以及 owner receipt 的 `checked_at`。共享 validator 必须证明：

1. ticket canonical digest 等于 receipt 的 `ticket_digest`；
2. reservation/request/attempt/run/account/pool/identity/aggregation/source 每项精确一致；
3. ticket 的 `runtime_sha256` 与 provider extension 的 `executable_path` 精确等于即将进入 resolution 的 pinned runtime facts；
4. launch idempotency key 与 nonce 精确一致；
5. `checked_at >= committed_at` 且严格早于 `launch_by` 与 `reservation_expires_at`。
6. canonical identity 的 closed schema、identity digest、request/input digest 与 native-attempt SSOT 全部有效；
7. canonical identity + provider extension 精确等于由实际 request/runtime/argv/cwd 身份生成的 context，且与
   ticket 顶层交叉字段一致。

任一 parser、digest、receipt binding 或 provider launch binding 失败时，executable resolution/claim/spawn 全为 0。
mutation oracle 必须把每个 production registry 的 exact key set 与测试 mutant map 双向比较；新增、删除或改名
任一 production binding 而未新增对应 kill mutant，默认 focused suite 必须 RED。

- **QA-COMMIT-001**：supervisor `claimed` event 必须引用并重验 committed ticket digest；missing/held/
  released/expired/orphaned、binding mismatch 或 `launch_by` 已过均 `ADMISSION_COMMIT_MISSING_OR_INVALID`，
  claim publish=0、spawn=0。
- **QA-COMMIT-002**：reservation commit 先于 launch claim；launch claim 是唯一 spawn authority，
  但它不拥有 reservation writer。两 store crash window 用 audit/saga 收口，不用跨文件假原子事务。
- **QA-COMMIT-003**：claim 已发布但 hello 未确认时 reservation 保持 committed 或 orphaned；不得因
  “没看到 worker”释放，也不得创建第二 reservation/worker。
- **QA-COMMIT-004**：proven pre-spawn aborted claim 可请求 release_pending；只有 audit 同时证明无 child/
  no later claim 才 released。provider terminal 也只请求 release，不直接完成 task。
- **QA-COMMIT-005**：允许 claim 的 owner preflight 输出必须携带同一 committed ticket preimage 与带
  `checked_at` 的 closed receipt；provider 在任何 executable resolution/claim/spawn 前经共享 parser/digest/
  receipt-binding/provider-launch-binding validators 全部重验。digest-only receipt、ticket A + runtime B、任一
  launch binding mutation 都必须 fail closed，effects count=0。
- **QA-COMMIT-006**：保持 receipt/ticket 字节完全不变，只改变实际 selector/model/effort，或只改变
  workspace/worktree/full input，必须在 executable resolution 前以 canonical-identity/provider-extension binding
  mismatch 拒绝；
  candidate/provider/input identity、nonce replay、expired ticket 与 claim replay 也必须由 production registry
  驱动的 mutation oracle 杀死，且 `process.spawn=0`。

## 6. Two-read live admission transaction

quota I/O 不在 reservation file lock 内等待；revision compare/hold/commit 在锁内：

```text
validate accepted planning/routing/authority and candidate requirement
  -> live refresh #1 (single-flight; outside reservation lock)
  -> lock sorted aggregation keys
       re-read published revision -> derive -> create held (all-or-nothing)
  -> unlock; run worktree/permission/env/runtime/side-effect gates
  -> live refresh #2 immediately before launch (outside reservation lock)
  -> lock same keys
       identity/pool/buckets unchanged
       refresh #2 fresh; rederive including own hold
       still ample -> held -> committed + admission ticket
  -> unlock
  -> supervisor publishes claimed event referencing committed ticket
  -> exact one spawn authority; hello proof -> running projection
```

- **QA-ADM-001**：refresh #2 是 launch 前 live recheck；cached route evidence、refresh #1 或 existing hold
  不能替代。recheck 变 unknown/tight/exhausted/hard-stale/identity-changed 时 commit/claim/spawn=0。
- **QA-ADM-002**：refresh #2 revision 可变化但必须仍同 identity/payer/pool/window/required buckets；在锁内
  对新 revision 重算。换 identity/pool 不是自动 reroute，而是 `LIVE_QUOTA_IDENTITY_CONFLICT` + orphan/release audit。
- **QA-ADM-003**：429/rate-limit 打开对应 collector/provider facet circuit，当前 candidate claim/spawn=0；
  circuit 不拖垮 origin-native/其他 provider，但 fallback 仍受 §8 安全收口。
- **QA-ADM-004**：ticket 到 claim 的短窗口若过期，claim=0；reservation 进入 release_pending 或
  orphan audit，不能偷偷再签/延长。
- **QA-ADM-005**：automatic mode 的机械输出必须显式给 `automatic_spawn_limit:0|1`、blocking reasons、
  reservation/ticket/source revisions；不允许 boolean 缺失被 caller 当 true。
- **QA-ADM-006**：本 spec/fixture slice 不调用 collector、provider、supervisor 或 model；所有 spawn、model
  request、account/auth write 实际计数必须为 0。
- **QA-ADM-007**：认证事实不能填补 quota 事实。`auth_state:"authenticated"` 且承重 observation missing/
  conflict 时必须给明确 quota reason，hold/commit/claim/spawn 均为 0。
- **QA-ADM-008**：provider-neutral registry input 可声明非 Codex window/pool；pure engine 不加 provider
  品牌分支。非 Codex case 仍走相同 freshness→derivation→reservation→admission 语义；只有 Codex-specific
  registry rule 才过滤 5h。

CLI composition 已接入现有 `router.ts` / `registry.ts`，不另建测试入口。executable oracle 冻结以下 current
command surface：

```text
ccm quota status --json
ccm quota preflight --input <JSON|@file> --json
ccm quota reserve --input <JSON|@file> --json
ccm quota audit --input <JSON|@file> --json
```

`--input` 复用既有 `io.readInputSpec`。`reserve` request 必带明确 `checked_at`，owner store 在锁内以
source profile 的 `fresh_ttl_sec` / `hard_ttl_sec` / `max_clock_skew_sec` 对 `observed_at`、`valid_until` 与
required bucket reset 重算 freshness；caller 持久化的 `freshness:"fresh"` 不拥有 authority。过期 observation
不能创建 hold，过期 reservation 不能 commit，过期 reservation/ticket 不能取得 launch authority。
`preflight` 是从 owner-only observation/reservation authority
store 读取 reference 并重验后形成的纯机械判定，caller 自给的 derived live/policy/effect 结论不产生
授权，且 provider/model/account effect=0；带 `requested_effect` 的 lifecycle deny 仍是 pure engine
路径。`reserve`/`audit` 必须经同一个 `createQuotaAdmissionStore`。空 store 的 `status` 以
`{ok:true,data:{schema:"ccm/quota-status/v1",available:false,...}}` 诚实返回，不把 missing 当 ample。

## 7. Orphan audit、expiry 与 release

audit 输入固定为 reservation event prefix、launch prepared/claimed/aborted、SupervisorHello、journal prefix、
supervisor lease、platform process identity、provider terminal/usage evidence。mtime、PID-not-found、manager
lease 或 handoff prose 都不是单独证据。

| Audit class | 必要证据 | reservation 动作 | 新 spawn |
| --- | --- | --- | ---: |
| `confirmed-unlaunched` | claim store locked/readable，claim absent/aborted，process identity 证明无 child | held→expired/released | 上层新 attempt 才可 |
| `active` | claim+hello+lease/process/journal identity 一致 | committed 保留 | 0（attach same run） |
| `terminal-pending-cleanup` | 合法 terminal，identity/journal 连续，尚未完成 cleanup/accounting audit | release_pending 保留 | 0 |
| `releasable` | terminal/abort + no live writer + cleanup/evidence retention 完成 | released | 新 attempt 另 reserve |
| `orphan-audit` | claim/hello/lease/journal/process 任一 unknown/conflict/PID reuse | orphaned 保留 | 0 |

- **QA-ORP-001**：orphan-audit 是 evidence/identity class，不是 provider mechanical failure；不能触发
  fallback、release、re-dispatch 或 signal。
- **QA-ORP-002**：expired 只适用于 proven-unlaunched `held`；`committed|release_pending|orphaned`
  没有时间一到自动清空的路径。
- **QA-ORP-003**：同 audit input revision 重放幂等；conflicting audit receipt fail closed 并保留较保守 state。
- **QA-ORP-004**：释放只改变本地 capacity accounting，不声称/推断 provider 已退款、返还或停止计费。
- **QA-ORP-005**：public `terminal_evidence` / `audit` 是闭合、版本化 proof envelope；必须绑定当前
  reservation ID/request hash、attempt ID、run ref 与 ticket digest，并携带连续 terminal journal ref/revision、
  proven-dead process identity、cleanup/evidence-retention 证明。缺字段、额外字段、binding mismatch、partial 或
  conflicting proof 均 release=0，且 committed/release_pending/orphaned capacity 继续计入。

## 8. Error taxonomy 与 fallback legality

| Code | Class | Automatic action |
| --- | --- | --- |
| `QUOTA_REQUIRED_WINDOW_UNKNOWN` / `QUOTA_REQUIRED_BUCKET_UNKNOWN` | missing evidence | claim/spawn=0；不 fallback |
| `QUOTA_SOFT_STALE` / `QUOTA_HARD_STALE` / `QUOTA_SOURCE_SCHEMA_UNSUPPORTED` | stale/schema circuit | claim/spawn=0；refresh/circuit only |
| `QUOTA_OBSERVATION_CONFLICT` / `QUOTA_AGGREGATION_MISMATCH` | evidence conflict | claim/spawn=0；orphan/circuit audit |
| `QUOTA_TIGHT` / `QUOTA_EXHAUSTED` / `RESERVATION_CAPACITY_CONFLICT` | capacity | claim/spawn=0；可映射 generic `quota-tight` |
| `QUOTA_RATE_LIMITED` | provider mechanical/rate | claim/spawn=0；circuit；可映射 `rate-limited` |
| `QUOTA_LOCK_BUSY` | retryable local contention | write/claim/spawn=0；same candidate retry |
| `RESERVATION_IDEMPOTENCY_CONFLICT` | hard request conflict | write/claim/spawn=0；不 fallback |
| `RESERVATION_EXPIRED` | proven pre-claim expiry | old key spawn=0；新 attempt 重走全 transaction |
| `RESERVATION_ORPHANED` / `LIVE_QUOTA_IDENTITY_CONFLICT` | orphan/security | release/re-dispatch/claim/spawn=0 |
| `ADMISSION_COMMIT_MISSING_OR_INVALID` / `ADMISSION_TICKET_EXPIRED` | ordering/TOCTOU | claim/spawn=0；audit reservation |

- **QA-ERR-001**：`quota-tight`/`rate-limited` 只有在 launch claim 尚未发布且原 reservation 已
  `released|expired`（或根本未创建）后，才可按 accepted S0 chain 创建**新 attempt/key**；否则 fallback=0。
- **QA-ERR-002**：unknown/stale/conflict/idempotency/orphan/policy/permission/security/workspace/business/
  acceptance failure 永不自动 fallback。
- **QA-ERR-003**：error 不能静默变 default、`available:true` 或空 reason；JSON output 回显 code/class/
  revisions/effects counts，但不得含 credential/raw private payload。

## 9. Handoff、upgrade、rollback 与 active-run 边界

- **QA-LIFE-001**：`durable_run_ref` handoff attach/poll 同一 run、同一 committed reservation；new
  manager reservation=0、spawn=0。`journal_only` 同样保留 reservation，只降 control capability。
- **QA-LIFE-002**：`legacy_session_bound` 在 handle/writer 未审计前保留 reservation；有限 drain 或
  session death 不等于 release。`orphaned` handoff 一律进 audit。
- **QA-LIFE-003**：runtime activation/rollback linearization 后，新 run 解析 current 并创建自己的
  reservation；active run 保持旧 exact hash + 原 reservation，interruption/re-reserve/release 均为 0。
- **QA-LIFE-004**：active/unresolved run 或 committed/release_pending/orphaned reservation 引用的
  runtime image 不可 GC/uninstall/quarantine。journal floor 不兼容时 activation 仍按 supervisor contract 拒绝。
- **QA-LIFE-005**：停止新 dispatch 不等于杀 active run或释放容量。`CCM_CROSS_HARNESS_DISABLE=1`
  令新 hold/commit/claim=0；已有 reservations 继续由 terminal/orphan audit 收口。
- **QA-LIFE-006**：外部 credential rotation/identity change 使新 admission fail closed；已 committed run
  保留并审计，不能以账号变化为由 signal/release。Codex/Cursor 不提供自动修复账号的 mutation path。

## 10. Effects boundary

允许的 future composition root effect 只有：owner-only quota store 的 atomic/no-replace/append 写、明确
quota collector 的 read-only refresh、reservation-key lock、读取 pinned route/runtime/supervisor refs。

这条边界的最小公共契约位于 `@ccm/engine`，CLI composition 只注入这个 port，不把
provider SDK、process/network/keychain/board/repo writer 或 service locator 交给 quota domain：

```ts
interface QuotaEffectBoundary {
  readonly profile: "production" | "test";
  readonly declaredCapabilities: readonly string[];
  execute(capability: string, input: Readonly<Record<string, unknown>>): unknown | Promise<unknown>;
}

createQuotaEffectBoundary({ profile?, allow, handlers, quotaRoot? });
```

`execute` 不接收临时 callback；它只能调用构造时拷贝并冻结的 handler registry。`allow` 是每个
boundary instance 的显式能力声明，不是“允许任意 string”的开口。全局允许集也是闭集：

```text
production:
  auth.observe
  quota.observe
  filesystem.quota.open
  filesystem.quota.read_file
  filesystem.quota.read_directory
  filesystem.quota.stat
  filesystem.quota.lstat
  filesystem.quota.make_directory
  filesystem.quota.rename
  filesystem.quota.unlink
  filesystem.quota.lock
  pinned.route.read
  pinned.runtime.read
  pinned.supervisor.read

test-only additive:
  test.clock.now
  test.random.id
  test.trace.record
```

filesystem capability 是窄的 quota-store primitive，不是 generic filesystem authority；只要 instance 声明任一
`filesystem.quota.*`，`quotaRoot` 就必填且须为绝对路径（production 为
`<CC_MASTER_HOME>/quota/v1/`，test 为 test-owned temp root 内的对应目录）。每次执行前 boundary 对
`path` 或 rename 的 `from`/`to` 做 root containment 检查；缺 path、前缀碰撞或任一端越界都在
handler 前 `QUOTA_EFFECT_FORBIDDEN`。`test.*` 在 `profile:"production"` 中不可声明。
`auth.observe` 只返回当前 surface 的 token-blind 认证事实；`quota.observe` 只返回 quota
observation。两者不共享 handler，任一都不含登录、切号、导入或写凭证权限。

禁止集至少显式包含 `process.spawn`、`network.connect|socket|dns|http`、
`provider.invoke|spawn`、`model.invoke`、`keychain.read|write|delete`、`board.write`、`task.done`、
`repo.write`、`runtime.activate` 以及 QA-EFX-002 的 8 种 account/session/credential/auth mutation。
构造时声明禁止或未知能力、向未声明能力求值、或向已声明能力求值但没有 handler，都必须在
handler 调用前同步 fail closed：分别为 `QUOTA_EFFECT_FORBIDDEN`（account mutation 为
`ACCOUNT_MUTATION_FORBIDDEN`）、`QUOTA_CAPABILITY_UNDECLARED`、`QUOTA_CAPABILITY_UNAVAILABLE`。

- **QA-EFX-001**：quota collector/manager 不拥有 board generic/dedicated writer、task done、provider spawn、
  runtime activation、repo/worktree write 或 credential value。
- **QA-EFX-002**：完整 mutation matrix 为 `{codex,cursor}` ×
  `{account_login,account_logout,account_switch,session_switch,credential_import,credential_copy,
  credential_write,auth_write}`。16 个单元在 quota boundary 中必须 absent 或 throw
  `ACCOUNT_MUTATION_FORBIDDEN`；每项 effect count=0。
- **QA-EFX-003**：fixture/contract test 使用 in-memory input 与 spies；普通 CI/opt-in RED 均不发 network、
  不启动 provider/model process、不读真实 credential/home、不写 board。
- **QA-EFX-004**：CLI mutation oracle 只使用 test-owned fake Codex/Cursor roots，绝不打开真实 credential。
  对每个 matrix cell 都递归比较 path/type/content digest/mode/size/mtime/ctime/symlink target，并用 directory
  watcher 捕捉 mutate-then-restore；create/delete/rename/content/chmod/metadata 任一 effect 都令测试失败。
- **QA-EFX-005**：`QUOTA_PRODUCTION_EFFECT_ALLOWLIST` / `QUOTA_TEST_EFFECT_ALLOWLIST` / forbidden set、
  boundary 本身、instance `declaredCapabilities` 与构造时 handler registry 都冻结；caller 在构造后
  修改原始 array/map 不能扩权或替换 handler。
- **QA-EFX-006**：允许但未声明、已声明但未绑定、禁止、未知四类请求全在调用 handler 之前
  fail closed；不存在 fallback handler、service lookup 或默认放行。
- **QA-EFX-007**：CLI `run(...,{quotaEffects})` 只把同一 boundary 透传到 quota handler context；
  contract test 注入 in-memory spies，future production composition 注入明确 handlers。任一 effectful quota path 无
  boundary 或无所需 capability 时失败，不回落到 ambient Node/provider/account API。
- **QA-EFX-008**：可执行 calibration matrix 分别注入 process spawn、network connect/socket/DNS/HTTP、
  provider/model invocation、OS keychain、board/repo write、credential mutation 与 test fixture ambient
  filesystem I/O 伪实现；每个伪实现都必须
  使 oracle RED，而对应 spy effect count 仍为 0。quota runtime source 同时受 direct-import/global-call
  guard，不能绕过 port 直接使用 `child_process` / net/tls/dgram / dns / http(s)/http2 / `fetch`、
  provider SDK、keychain/account writer、board mutation 或 repo write。`fs|node:fs|fs/promises|node:fs/promises`
  在 controlled test/fixture source closure 中属于 test-only `ambient-filesystem-io` hard deny；这不禁止 future
  production quota store composition 通过 §5.0 的窄 filesystem port 实现 owner-only quota I/O。
- **QA-EFX-009**：`auth.observe` 与 `quota.observe` 是两个独立、可单独声明的 observation
  capability；声明任一 observation 不会使 8 种 mutation 或另一 observation 可用。
- **QA-EFX-010**：direct-effect oracle 的 exact effect-class/API/root/source-kind contract 必须来自独立、版本化的
  `ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/registry.json`。registry 与 guard implementation 的
  effect class/API/source-kind row 必须 exact-equal，counterfeit probes
  必须与每条 API row exact 对齐，source-mutation probes 必须与 effect classes exact 对齐；拒绝 missing、
  extra、duplicate、无 counterfeit/source mutation 命中的 dead row。逐类删除真实 guard
  implementation，或把逐类 direct import/call mutation 插入 controlled handler 后，普通 focused oracle
  （不设 counterfeit/calibration 环境变量）必须 RED。source-mutation matrix 必须由默认 focused suite 直接
  执行；一个未被默认 suite 调用的独立 calibration script 不能单独充当 acceptance evidence。
- **QA-EFX-011**：registry 中 production/test source root 只有 `required` 与 `honest-absent` 两种显式
  状态。`required` root 缺失、`honest-absent` root 意外出现、source domain 内存在 root 闭包不可达文件、
  或任一 reachable relative module 含 process/network/provider/model/keychain/board/repo/account escape，
  均默认 RED。扫描必须基于 AST 的 static/export/dynamic-import/require 传递闭包，不得只扫 entry 文本或
  静默跳过缺失 root。
- **QA-EFX-012**：controlled-handler root 只验证 boundary primitive，不能替代 current production
  `quota.status|preflight|reserve|audit` registry/handler/store 路径。focused oracle 必须直接穿 production registry：
  missing boundary 在任何 handler/store work 前失败；unknown/forbidden/undeclared/unbound filesystem capability
  在任何 quota file mutation 前失败；allowed path 的每个 filesystem primitive 必须消费 injected boundary 的
  返回值。把 production handler 改回 `createQuotaAdmissionStore({home})` ambient fallback，或把 router gate 收窄
  到 fixture-only handler，必须令默认 focused suite RED。controlled test closure 仍拒绝 registry 中每个 ambient
  effect class，不能靠未连接 callback 的零值宣称 effect=0。

## 11. Executable promotion contract

版本化 fixtures 位于：

```text
ccm/apps/cli/test/fixtures/quota-admission-contract-v1/
```

`ccm/apps/cli/test/quota-admission-contract.red.ts` 保留历史文件名且故意不匹配默认 `**/*.test.ts` glob；它现在
是 bounded runtime 的显式 promotion gate。结构校准使用 tracked runner 直接执行 TypeScript entry；不要额外加
`--test`，以免外层只报告一个泛化 file-level failure：

```bash
cd ccm/apps/cli
CCM_QUOTA_ADMISSION_FIXTURES_ONLY=1 node --import tsx test/quota-admission-contract.red.ts
```

完整命令当前必须 GREEN：

```bash
cd ccm/apps/cli
node --import tsx test/quota-admission-contract.red.ts
```

- **QA-FIX-001**：结构模式先验证 spec path、manifest、case order/uniqueness、全部 `spec_ids` 在本文存在、
  required coverage（fresh/unknown/tight/hard-stale/duplicate/concurrent/expired/orphan/5h-poison）齐全。
- **QA-FIX-002**：每个 evaluator 只收到 deep-frozen `case.input`；test 不传 case name、fixture root 或
  `expected`，且拒绝 input 内出现 `expected|oracle|answer` key，防 expected echo/oracle leakage。
- **QA-FIX-003**：full mode 分别穿三条 production seam：① `@ccm/engine` 公共 barrel 的 provider-neutral pure
  quota exports；② existing CLI router/registry 的 `quota status|preflight|reserve|audit`；③
  `createQuotaAdmissionStore({home})` 的 owner-only filesystem/lock/event replay。任一缺失都以带 seam 名的
  `HONEST RED` 失败；manifest/spec/fixture 自洽问题必须先在 fixture-only mode 暴露。
- **QA-FIX-004**：production GREEN 不得按 fixture filename/name/input serialization hard-code。runner 会扫描
  production seam 禁止引用 fixture root/case names，并生成不在 JSON fixtures 内的 arithmetic/permutation
  probes；store/CLI oracle 主动制造 temp residue、snapshot loss、10-way simultaneous start。真实 provider
  canary 仍是另一个需要用户 opt-in/budget 的节点。
- **QA-FIX-005**：fixture-only 只检查 schema/spec-ID/coverage/oracle isolation；不 import production runtime。
  full mode 至少分别执行 engine、CLI、store/concurrency 三条 production seam，不能用一个 generic evaluator import 把全部
  case 折成同形失败或被 input→expected lookup 一次骗绿。
- **QA-FIX-006**：manifest 明列 engine whole-file 与 store exact-row execution domains。engine domain 的新增
  row 自动进入 evaluator loop；`store.json`/`concurrency.json` 的每一 row 必须经 `storeCase()` 注册并穿真实
  production store。fixture row、manifest row、execution registry 三者任一不一致时 fixture-only 先失败，
  不允许“结构上计入 coverage、full mode 从未执行”。这条 exact contract 必须双向比较 `manifest.files`、
  实际 fixture rows、manifest execution-domain 展开结果与 runner 实际注册结果，拒绝 duplicate、alias、
  manifest+fixture dead row、handler-only 与 fixture-only counterfeit；负例校准本身也必须可执行。

fixtures 覆盖：

- fresh/unknown/soft+hard stale、partial required bucket、aggregation mismatch、5h poison ignored；
- ample/tight/exhausted、7d multi-bucket worst-state、不跨 key join；
- rolling 24h high/partial/insufficient/reset/conflict，并证明 advisory 不 block ample；
- fresh hold、same retry、conflicting retry、commit、duplicate、10-way concurrent capacity、同 key 10-way
  single reservation、multi-bucket atomicity；
- 10-way refresh single-flight、0600 atomic observation/snapshot publish、rename 前故障/old-or-new visibility/
  directory fsync portability、event-durable/snapshot-missing recovery 与 event conflict/truncated/invalid JSON
  fail-closed；
- expired-with-no-claim、expired-but-claim-unknown→orphan、release-pending capacity retention；
- live recheck changed/identity changed/429/ticket expired/spawn-before-commit；
- parent death、claimed-no-hello、PID reuse/journal conflict、terminal cleanup/release；
- durable/journal-only/legacy/orphan handoff、active-old-runtime upgrade/rollback/GC；
- auth 不等于 quota、observation conflict spawn=0、至少一个 non-Codex provider-neutral window case；
- Codex/Cursor 的 16-cell account/session/credential/auth mutation matrix 全部为 0；完整 fake config tree 的
  create/delete/rename/content/metadata/symlink effect 均为 0。

## 12. Acceptance、kill、rollback 与 current/target 声明

bounded local runtime 的 current 完成条件：

1. 本文与 manifest/fixtures 的 spec IDs、schemas、case coverage 自洽；
2. fixture-only 与 full promotion 命令均 GREEN；full mode 真实穿 engine、production CLI/registry/handler 与
   owner-only store/concurrency/effect boundary；
3. 默认 build/typecheck/lint/test 不收集 `.red.ts`，不因 fixtures 变 RED；
4. 实际 provider/model request/spawn、board/account/auth/credential/runtime write 全为 0；
5. capability model 把 engine/store/CLI reservation/preflight 标为 bounded current，把 collector、supervisor
   claim/spawn integration 与完整 S4/SG3 promotion保留为 partial/target。

current bounded runtime 与 future full SG3 共同 acceptance：

- unknown/tight/exhausted/soft-stale-unrefreshed/hard-stale/conflict automatic spawn=0；
- Codex 5h poison 永久 ignored，7d hard gate authority/threshold 不变，rolling 24h 只 advisory；
- concurrent same-pool committed+held 不超订；同 idempotency key 10-way 只有一个 reservation/event，
  duplicate reservation/claim/spawn=0；
- 10-way refresh single-flight collector call=1；snapshot atomic/0600；event 后 crash 可 replay 恢复；
- spawn-before-commit=0；launch 前 live recheck 变坏即 claim/spawn=0；
- expired/orphan/parent-death/handoff/upgrade 不提前释放；audit 后幂等收口；
- auth=true 但 quota missing/conflict spawn=0；provider-neutral non-Codex case 不靠品牌分支；
- Codex/Cursor account/login/logout/switch/session/credential import/copy/write/auth-write=0。

kill/rollback：`CCM_QUOTA_REFRESH_DISABLE=1` 禁新 refresh，`CCM_CROSS_HARNESS_DISABLE=1` 禁新
hold/commit/claim；都不删除 cached report、active/orphan reservation 或 run evidence。删除本 spec-only slice
只移除本文、fixtures 与 opt-in RED test，不迁移 board/home、不修改 runtime、不影响 legacy origin-only。
