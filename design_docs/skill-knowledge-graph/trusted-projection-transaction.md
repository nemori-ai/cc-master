# Trusted Projection Transaction

> Status: **v1alpha1 normative contract; host publisher and release bundler landed, final integration reconciliation pending**
>
> Scope: `plugin/src` → `plugin/dist/<host>` → release bundle 的冻结、投影、验证、发布与恢复。
>
> Machine schema:
> [schemas/trusted-projection-transaction.schema.json](schemas/trusted-projection-transaction.schema.json)

本合同把 source-to-adapter 构建视为一笔有明确提交点的事务，而不是一串“复制、校验、再复制”的
脚本。任何 host 或 surface 都必须证明：发布出去的字节来自同一份冻结 source、同一份冻结 plan，
且 verifier 看过的字节就是最终提交和打包的字节。

它只定义事务脊椎，不拥有 SAP/PHIP、skill knowledge graph、host adapter 或 release policy 的业务
语义。那些领域先产生 projection inputs；本合同负责把它们安全地变成可安装 artifact。

## 1. 边界与统一语言

### 1.1 三个边界

| 边界 | 输入 | 输出 | 禁止 |
|---|---|---|---|
| compiler | 冻结的 `SourceSnapshot` + `ProjectionPlan` | 私有 candidate tree | 直接写 live dist |
| publisher | `VerifiedSnapshotAttestation` 指向的 sealed candidate | `PublishReceipt` | 自己重新发现或扩展文件集合 |
| release bundler | committed receipt + 冻结的 `release_bundle` ProjectionPlan | `ReleaseBundleAttestation` | 从 `plugin/src`、未验 candidate 或 attestation 自报 expected 打包 |

compiler 是 repo-private proof engine。publisher 是纯提交器。release bundler 只消费已经提交且可追溯的
artifact。三者不能互相代替。

compiler 启动前必须同时冻结 source snapshot 与由 trusted policy 独立产生的 projection plan。
sealed verified snapshot 是 publisher 唯一可接受的字节权威。release package 只消费 committed
receipt、对应 attestation 与冻结 bundle plan；它永不 sync dist、重新 compile source 或现场扩大
文件集合。`plugin/src/knowledge/` 及任何顶层 `knowledge/` 输出都是 repo-only，不能进入
host/package/release closed set。

### 1.2 事务 aggregate

一笔 transaction 以 `transaction_id` 为 aggregate identity，拥有：

- 一个锁；
- 一条单调状态轨迹；
- 一份 `SourceSnapshot`；
- 每个 `{host,surface}` 恰好一份冻结 `ProjectionPlan`；release 时另有一份
  `surface=release_bundle` 的 bundle plan；
- 一个 candidate `ArtifactSnapshot`；
- 一个 `VerifiedSnapshotAttestation`；
- 零或一个 `PublishReceipt`；
- release 场景下零或一个 `ReleaseBundleAttestation`。

同名 host、路径、staging 目录或 Git ref 都不是 transaction identity。

### 1.3 支持的 surface

closed set：

- `host`：完整 `plugin/dist/<host>`；
- `skills`：仅在 host contract 明确允许时使用的 skills projection；实现仍必须以完整 host
  `SourceSnapshot` 和完整 live precondition 保护非 skills surface；
- `release_bundle`：从已提交 host artifact 生成的 archive。

新增 surface 是 schema 与本合同的显式变更，不允许自由文本扩展。

## 2. 六类 artifact

六类 artifact 的主 ID 都使用同一条 domain-separated canonical hash 公式：

```text
digest = sha256(
  utf8("cc-master/trusted-projection/<artifact-kind>/v1alpha1\0") ||
  utf8(JCS(artifact_without_its_own_id))
)
id = "tpt:<typed-prefix>:" + lowercase_hex(digest)
```

`JCS` 是 RFC 8785 JSON Canonicalization Scheme；本合同进一步限制 value domain 为 NFC string、
safe integer（禁止 float、`-0`）、boolean、null、array 与 plain object。object key 按 UTF-16
code unit 排序，数组保留合同顺序，无额外空白。typed prefix/domain 固定为：

| artifact | domain | prefix |
|---|---|---|
| `SourceSnapshot` | `source-snapshot` | `tpt:source:` |
| `ProjectionPlan` | `projection-plan` | `tpt:plan:` |
| `ArtifactSnapshot` | `artifact-snapshot` | `tpt:observation:` |
| `VerifiedSnapshotAttestation` | `verified-snapshot-attestation` | `tpt:verify:` |
| `PublishReceipt` | `publish-receipt` | `tpt:publish:` |
| `ReleaseBundleAttestation` | `release-bundle-attestation` | `tpt:release:` |

ID 不参与自身哈希。绝对路径、mtime、随机数与 wall-clock 不得进入 artifact。六类固定 golden vector
在 `tests/content/helpers/trusted-projection/golden-fixtures.mjs`；变更公式/domain 必须显式更新固定
literal，而不是运行时重生成 expected。

### 2.1 `SourceSnapshot`

冻结 planner/compiler 可以读取的完整 source denominator：

```text
schema
transaction_id
source_snapshot_id
source_content_id          # location-independent closed-tree identity
source_root_id             # 逻辑根，例如 plugin-src；不是绝对路径
git_tree                   # 可空；存在时为已解析 commit/tree identity
mode_model                 # v1alpha1 固定 posix-12bit
entries[]                  # exact closed set，按 path byte-order 排序
tree_sha256
```

`entries[]` 使用 §3 的独立文件身份。source snapshot 一经进入 `SOURCE_FROZEN` 不再修改；后续重新扫描
只能产生 comparison observation，不能覆盖原 snapshot。
`source_content_id=tpt:content:<tree_sha256>`，不包含逻辑根。

### 2.2 `ProjectionPlan`

planner 对一个 host/surface 的完整、精确、可重放决定：

```text
schema
transaction_id
projection_plan_id
host
surface
input_kind                 # source_snapshot | committed_artifact
input_snapshot_id
input_content_id
upstream_publish_receipt_id
trusted_policy_id
trusted_policy_sha256
operations[]               # 有序 projection operators
expected_entries[]         # exact artifact closed set + expected identity
```

`expected_entries` 只能由独立 planner 对冻结 input 运行**已注册且 digest 匹配的 trusted policy**
得到。它不是调用者、candidate 或 archive 自报，也不是路径 allowlist。validator 必须从
`input snapshot + trusted policy + operations` 独立重算并 exact 比较；所以“恶意 candidate 与自己
附带的 expected 自洽”仍失败。

- `host` / `skills` plan：`input_kind=source_snapshot`，绑定冻结 `SourceSnapshot`，无 upstream receipt。
- bundle plan：仍是 `ProjectionPlan`，但 `surface=release_bundle`、
  `input_kind=committed_artifact`，绑定 committed live observation/content 与
  `upstream_publish_receipt_id`。

计划冻结后，publisher/bundler 不能自行增加 README、knowledge、docs、manifest 或任何“看起来
合法”的文件。

### 2.3 `ArtifactSnapshot`

独立 oracle 对 candidate/live/extracted bundle 的观察：

```text
schema
artifact_snapshot_id
artifact_content_id
root_id                    # candidate / live-before / live-after / extracted-bundle
mode_model
entries[]
tree_sha256
```

这里有两个不可混用的 identity：

- `artifact_content_id=tpt:content:<tree_sha256>`：只由 exact entries 产生，**不含位置**；candidate、
  live-after 与 extracted tree 内容相同就必须相同。这是 attestation 授权/跨位置比较的 identity。
- `artifact_snapshot_id=tpt:observation:<digest>`：六类公式中的 observation artifact ID，包含
  `root_id`、content ID、entries 与 mode model；candidate/live 的观察 ID 应不同。

snapshot 是一次观察事实，不自行声明字节被允许。用 observation ID 比 candidate/live 会制造
location-dependent false mismatch；用 content ID 追踪某一次观察则会丢 provenance。

### 2.4 `VerifiedSnapshotAttestation`

verifier 对一组冻结事实的授权：

```text
schema
transaction_id
verified_snapshot_attestation_id
source_snapshot_id
projection_plan_id
candidate_snapshot_id
authorized_content_id
verifier_id
verifier_contract_sha256
checks[]                   # stable invariant/code/witness；只能 ok:true
trace_head_sha256
sealed_content_id
```

attestation 只在所有适用 hard invariant 都为 `ok:true` 时存在；`ok:false` 是 verification
diagnostic，不能伪装成 attestation。它同时固定 candidate observation provenance 与 exact
`authorized_content_id`。seal 后重新扫描必须得到相同 content ID；publisher 只能提交这一 content。

### 2.5 `PublishReceipt`

publisher 对 live endpoint 已发生的唯一权威陈述。它是以 `outcome` 区分的 sealed union：

```text
common:
  schema / transaction_id / publish_receipt_id
  verified_snapshot_attestation_id / live_before_snapshot_id
  outcome / trace_head_sha256

outcome=committed:
  live_after_snapshot_id / committed_content_id
  commit_method / durability_barrier / backup_retained / recovery_ref

outcome=recovery_required:
  last_observation_snapshot_id / recovery_journal_id
  operator_action / backup_retained=true
```

`committed_content_id` 必须 exact 等于 attestation 授权 content 和 live-after content。
`recovery_required` 不声称 live-after 已确定，也不得夹带 committed fields。两者都属于
`PublishReceipt` artifact，但语义互斥。cleanup 是否成功不改变已经发生的 commit；cleanup warning
由 committed receipt 的 `backup_retained`/`recovery_ref` 诚实表达。

### 2.6 `ReleaseBundleAttestation`

release bundler 在 archive 生成后重新解包、重新扫描得到：

```text
schema
transaction_id
release_bundle_attestation_id
publish_receipt_id
bundle_projection_plan_id
archive_sha256
archive_format
extracted_snapshot_id
extracted_content_id
checks[]
```

attestation **没有 expected entries 字段**；expected 的唯一 SSOT 是它引用的冻结 bundle plan。
archive SHA 不替代 extraction audit。validator 必须从 bundle plan 的 committed input + trusted
package policy 独立重算 expected，再与 extracted snapshot exact equality；receipt 必须是
`outcome=committed`。恶意 archive 即使同时重写 attestation/extracted snapshot 使二者自洽，也不能
重写冻结 bundle plan。不得包含 repo-only knowledge/source、strategy、eval、`.design` 或未声明成员。

## 3. 文件系统身份与独立 oracle

每个 snapshot entry 至少包含：

```text
path
kind                    # file | directory
sha256                  # file bytes；directory 为规范化直接子项 identity 的 hash
size
executable
posix_mode
```

规则：

1. `path` 为 `/` 分隔的相对 NFC string；根是 `.`；排序按 UTF-8 byte order。
2. 路径段不得为空、为 `.`/`..`，不得含 NUL、C0 control 或 DEL。
3. 只接受普通文件和真实目录；拒绝 symlink、hardlink、socket、FIFO、device 与未知 kind。
4. 普通文件 `nlink` 必须恰好为 1；inode alias 不是两个独立 artifact。
5. v1alpha1 mode model 是 `posix-12bit`（`stat.mode & 07777`）；不提供可信 POSIX mode 或
   `O_NOFOLLOW` 的平台 fail closed，不能把 mode 归零继续。
6. 普通文件以 `O_NOFOLLOW` 打开，同一 fd 在读取前后 `fstat`；located `lstat`、fd-before、
   fd-after 与 path-after 的 dev/inode/nlink/size/mode/mtime 必须一致。
7. 目录以 no-follow fd 固定 identity，在 traversal 前后对同一 fd `fstat`、对 path `lstat`，
   并 double-list exact 比较；漂移为 `TPT-ORACLE-UNSTABLE-DIRECTORY`。
8. executable 与 `posix_mode` 都进入 identity；内容未变但 mode flip 仍改变 content ID。
9. oracle 不 import production planner、manifest builder、auditor 或 publisher helper。

测试 oracle 是独立裁判；production 后续必须实现自己的 scanner，但不得复用测试 oracle 来制造
同源假绿。测试 oracle 的机械边界是检测普通并发漂移；它不声称能抵御一个有权限的恶意进程在全部
checkpoint 之间把整棵目录换出又恢复。production 的安全边界必须再叠加 transaction-private
workspace、排他锁与 freeze/seal 后禁止写。

### 3.1 三个独立 test oracle

合同测试故意分三层，避免“一份 helper 同时生产 expected 与判自己正确”：

1. `json-schema-validator.mjs` 解释本 schema 的 shape/typed-ID/conditional union；它不 import
   semantic validator 或 snapshot oracle。
2. `semantic-validator.mjs` 重算 canonical IDs、trusted policy expected、P1–P8、合法 transition 与
   cross-artifact equality；它不调用 production。
3. `snapshot-oracle.mjs` 只从文件系统 fd/lstat/fstat/bytes 形成 observation；它不 import production
   manifest/planner/auditor/publisher。

canonical hash 是合同共享 primitive，因此另外用六类 artifact 的**固定 literal golden vectors**
打破同源自证。恶意 fixtures 覆盖 typed-ID/hash、duplicate/order/NFC、`ok:false`、P1–P8、
illegal transition、cross-artifact mismatch，以及 candidate/archive 连 expected 一起重写的
self-consistent forgery。

## 4. 状态机

### 4.1 正常路径

```text
NEW
  → LOCKED
  → SOURCE_FROZEN
  → PLAN_FROZEN
  → CANDIDATE_BUILT
  → VERIFIED
  → SEALED
  → COMMIT_PREPARED
  → COMMITTING
  → COMMITTED
  → CLEANED
```

| State | 进入条件 | 允许的副作用 |
|---|---|---|
| `NEW` | transaction identity 已分配 | 无文件写 |
| `LOCKED` | 对目标 `{host,surface}` 持排他锁 | 只创建 transaction-private workspace |
| `SOURCE_FROZEN` | 独立扫描 source 成功 | 写 immutable `SourceSnapshot` |
| `PLAN_FROZEN` | plan exact 绑定 source snapshot | 写 immutable `ProjectionPlan` |
| `CANDIDATE_BUILT` | candidate 仅在 private root 完整产生 | 只写 candidate |
| `VERIFIED` | source fresh、candidate exact、所有 hard check 通过 | 写 attestation draft |
| `SEALED` | candidate 再扫描与 attestation exact；禁止继续写 candidate | 固化 attestation |
| `COMMIT_PREPARED` | live-before 已扫描，backup name/空间/权限预检完成 | 创建可恢复 commit journal |
| `COMMITTING` | commit journal durable | 允许第一次 live mutation |
| `COMMITTED` | live-after exact、durability barrier 完成、receipt durable | live 指向新 artifact |
| `CLEANED` | transaction-owned staging 清理；保留的 backup 已入 receipt | 无业务语义变化 |

### 4.2 终止状态

- `ABORTED`：只允许从 `NEW` 到 `COMMIT_PREPARED`，或 `COMMITTING` 已成功恢复并重新证明
  live-before exact 后进入。必须证明 live 与进入 transaction 前相同。
- `RECOVERY_REQUIRED`：只允许从 `COMMITTING`/`COMMITTED` 进入，表示 endpoint 状态不能自动判定或
  rollback 不能证明。它不是普通 nonzero failure；必须保留 journal、before/after observation、
  recovery material 与稳定 operator action。

禁止从 `COMMITTED` 倒退为 `ABORTED`。禁止把“已 commit 但 cleanup 失败”报告成普通失败。

## 5. P1–P8 hard invariants

| ID | 不变量 | 最小失败码 |
|---|---|---|
| `P1` | **Exact plan closure**：plan expected 只由冻结 input + trusted policy 重算；candidate/live/bundle 的成员集合和身份 exact 等于它；自报 expected 与合法额外文件都非法 | `TPT-PLAN-DRIFT` |
| `P2` | **Alias-free portable identity**：所有 source/artifact tree 只含普通文件/真实目录，拒绝 symlink、hardlink、special、control path；bytes、size、executable、mode 都入 identity | `TPT-ARTIFACT-UNSAFE` |
| `P3` | **Freeze freshness**：source 在 plan freeze、verify、commit prepare 三个 checkpoint 都 exact 等于 `SourceSnapshot`；verify 与 commit-prepare observation 必须从各自 `entries` 独立重算 tree/content/observation identity，不能信任随 observation 自报的 identity；变化只能启动新 transaction | `TPT-SOURCE-DRIFT` |
| `P4` | **Verify before write**：attestation 的 candidate observation 与 authorized/sealed content 必须一致；publisher 提交同一 content；进入 `COMMITTING` 前 live 不得变化 | `TPT-UNVERIFIED-COMMIT` |
| `P5` | **Failure atomicity and truthful outcome**：普通 nonzero/`ABORTED` ⇒ live-before exact；live 已变 ⇒ committed receipt 或 recovery-required union，绝无普通 failure + residual live 的中间真相 | `TPT-OUTCOME-CONTRADICTION` |
| `P6` | **Unbroken attestation chain**：source→host/bundle plan→artifact→attestation→receipt→release 全链共享唯一 `transaction_id`，其 ID、contract digest 与 trace head 逐跳一致；任何内部重新 hash 后看似自洽的 split transaction 仍非法，stale/自报 attestation 无授权力 | `TPT-ATTESTATION-STALE` |
| `P7` | **Release extraction equality**：archive extraction exact 等于 frozen bundle plan 的独立重算结果并回指 committed receipt；attestation 不持有第二份 expected | `TPT-RELEASE-DRIFT` |
| `P8` | **Deterministic serialized ownership**：同输入同 plan 得同 artifact；目标锁排他；重试/cleanup 幂等；fault trace checkpoint 与 witness 稳定 | `TPT-NONDETERMINISTIC` |

P1/P2 是 closed-set 身份，不是 extension/path allowlist。P3/P4 是 TOCTOU 边界。P5 是事务对外真相。
P6/P7 是 provenance。P8 是并发与可复现性。

## 6. Failure semantics

| 失败 checkpoint | 必须结果 | 禁止结果 |
|---|---|---|
| `NEW`…`PLAN_FROZEN` | `ABORTED`；无 candidate/live 写 | 吞错继续 |
| `CANDIDATE_BUILT`…`SEALED` | `ABORTED`；live-before exact；清 transaction staging | 先发布再补验 |
| `COMMIT_PREPARED` | `ABORTED`；journal 可清；live-before exact | 半个 backup |
| `COMMITTING` 且 rollback 可证 | rollback + 重新 snapshot + `ABORTED` | 只尝试 rollback、不验证 |
| `COMMITTING` 且状态不确定 | durable `PublishReceipt(outcome=recovery_required)`；保留 journal、last observation 与全部 recovery material | 报普通失败、夹带 committed fields 或自动清证据 |
| `COMMITTED` 后 cleanup 失败 | success receipt + warning + `backup_retained:true`，然后可停在 `COMMITTED` | nonzero + live changed |
| `COMMITTED` 后无法验证 live | recovery-required receipt；不声称确定的 live-after | 假称 success 或 abort |
| release build/audit 失败 | host receipt 不变；不发布 archive | 回写 live dist 或上传未验 archive |

错误必须包含稳定 `code`、`transaction_id`、`state`、`checkpoint`、最小 `witness` 与
`remediation`。错误不得含随机临时路径作为 identity，也不得因相同 seed 改变排序。

## 7. Property/fault harness contract

测试入口固定为：

```js
runScenario({ host, surface, mutation, failpoint, seed })
```

参数是 closed vocabulary：

- `host`：产品 host；TX0 显式 probes 只跑一个代表 host，不冒充四 host integration；
- `surface`：TX0 scenario scope **只有 `host`**；artifact contract 的 `skills/release_bundle` 不等于
  当前 scenario driver 已覆盖；
- `mutation`：
  `add-legal-artifact-after-attestation` /
  `rewrite-existing-artifact-after-attestation` /
  `flip-executable-bit-after-attestation` /
  `replace-with-hardlink-after-attestation` /
  `none` /
  `mutate-source-after-attestation`；
- `failpoint`：`none` / `sync-host-surface:post-publish`；
- `seed`：非负安全整数；相同输入必须产生相同 witness。

返回稳定 witness：

```text
schema = cc-master/trusted-projection-scenario-witness/v1alpha1
scenario_id
host / surface / seed
operator { mutation, failpoint }
production_subject
trace[] { seq, checkpoint, state, observation_sha256 }
outcome {
  process_status              # 真实 child process status，不由 harness 指派
  production_returned
  production_error_code
  live_changed
  live_before_content_id / live_after_content_id
  live_before_forensic_sha256 / live_after_forensic_sha256
  production_residues[]
}
contract { ok, primary_violation, violations[] }
```

property verdict 只依赖真实 trace checkpoint、实际 `mutation:applied`、production commit
结果、live before/after forensic identity 与 residue；调用方选择的 `mutation`/`failpoint`
只用于驱动实验，不能直接决定 pass/fail。未来 production 若在 commit 前以 nonzero 正确拒绝变异，
且 live 未变、无 residue，则满足相应 property，不得被 harness 误报为 caller-precondition error。

production checkpoint closed set：

```text
projectAndPublishHostSurface:return
projectAndPublishHostSurface:throw
sync-host-surface:injectLateFault:after-compile-attestation-before-publish
sync-host-surface:injectPostPublishFault:after-publish
postcondition:live-snapshot
```

显式 RED 必须调用真实
`scripts/skill-knowledge/sync-host-surface.cjs#projectAndPublishHostSurface`，让 production 完成真实
projection/compile/current attestation，再只通过 production 已有的 `injectLateFault` /
`injectPostPublishFault` test seam 注入。harness 不得调用裸 publisher 代替 orchestration，不得手造
exit status。child 若未到指定 concrete checkpoint、baseline production 不能成功、或在非请求
failpoint 失败，scenario 本身 fail closed，不得生成“碰巧 RED”的 property witness。

为控制成本，同一显式 RED process 可以复用一份由真实 production 构建的 warm baseline，再复制到
transaction-private temp repo；每条 probe 仍各自调用一次真实 orchestration。四 host 全 compile
属于 integration gate，不在 TX0 fault matrix 冒充已覆盖。普通 GREEN 合同自测不调用慢 production。

## 8. 当前 production 的 RED 边界

本合同落地时，下列 probes 应对当前 production **RED**，且必须与普通 GREEN 合同自测分开运行：

1. current compile/attestation 后加入路径合法但未声明的 artifact，再走真实 post-publish fault；真实
   process nonzero 且 live 已变（P1/P4/P5）；
2. current attestation 后在既有合法路径改写 bytes，真实 orchestration 返回 success（P1/P4）；
3. current attestation 后在既有合法路径 flip executable mode，真实 orchestration 返回 success
   （P1/P4）；
4. current attestation 后用 hardlink 替换既有 artifact，真实 orchestration 返回 success（P2/P4）；
5. transaction 开始前准备一份合法 source 更新，publish 后走真实 production fault，得到真实
   nonzero + live changed（P5）；
6. current attestation 后修改 source，旧 candidate 仍由真实 orchestration 发布（P3/P4）。

这些是六个 operator，不是六个要逐文件 hard-code 的回归。实现节点要让同一性质对任意合法路径成立。

普通 CI 只运行合同/schema/oracle/harness 的 GREEN 自测。显式 RED 命令在 implementation 完成后转绿并
升入普通 suite。

## 9. 与现有测试的已知冲突

以下现有断言在本合同落地前是历史证据，后续实现时必须修改，不能两套语义同时保留：

- `tests/content/skill-knowledge-change-candidate-runtime.test.mjs` 的
  `SKG-TX-RUNTIME-13` 把 `nonzero + residual_live_dist:true` 当成可接受结果；它与 `P5` 冲突。
- `scripts/skill-knowledge/sync-host-surface.cjs` 的 `injectPostPublishFault` 明确在成功 publish 后抛
  nonzero，并声明 residual live；它是 `P5` 的 executable RED seam，不是目标合同。
- 只证明 `rename(staging, live)` 原子、却没有绑定 frozen source/plan/attestation 的
  `publishHostTree`/`publishSkillsTree` 测试，仅覆盖 commit primitive，不能声称满足 `P1–P8`。
- package shape tests 若只检查必需目录存在而不做 archive extraction exact equality，与 `P7` 不足；
  后续应保留 shape 检查，但不得把它当 release attestation。

本节点不修改这些 production/legacy tests；下一实现节点按本合同收口。

## 10. 下一实现节点接口

production 需要提供等价接口，模块名可调整，语义不可改：

```text
acquireProjectionLock(target) -> lock
captureSourceSnapshot(root, sourcePolicy) -> SourceSnapshot
freezeProjectionPlan(inputSnapshot, trustedPolicy, host, surface) -> ProjectionPlan
buildCandidate(sourceSnapshot, plan, privateRoot) -> ArtifactSnapshot
verifyAndSeal(sourceSnapshot, plan, artifactSnapshot) -> VerifiedSnapshotAttestation
prepareCommit(attestation, liveRoot) -> commitJournal
commitPrepared(journal) -> PublishReceipt(committed | recovery_required)
attestReleaseBundle(receipt, bundlePlan, archive) -> ReleaseBundleAttestation
recover(transaction_id) -> PublishReceipt | AbortedReceipt
```

publisher 的必要输入是 `VerifiedSnapshotAttestation`，不是裸 staging path。release bundler 的必要输入是
`PublishReceipt`，不是裸 dist path。

## 11. TX0 acceptance evidence

本节点只冻结合同与测试证据，不修改 production：

| 命令 | 结果 | 实测 |
|---|---|---|
| `node --test tests/content/trusted-projection-transaction-contract.test.mjs` | GREEN：13 pass / 0 fail | 0.16–0.53s |
| `node --test tests/content/trusted-projection-transaction-production.red.mjs` | 预期 production RED：0 pass / 6 fail；六条均到指定真实 checkpoint、forensic before/after、residue=[] | 554.03s（共享机负载；前一轮 261.03s） |
| `node --check …`（本节点所有 `*.mjs`）+ schema JSON parse + `git diff --check` | GREEN | <1s |

继承基线必须单独诚实记账：`bash run-tests.sh` 在 30 分钟硬停时仍未完成，结论是
**UNFINISHED**，不是 pass/fail。停止前已观察到两组既有 hook reds：
`tests/hooks/test_codex-reinject.sh` 为 46 pass / 2 fail，
`tests/hooks/test_reinject.sh` 为 85 pass / 3 fail。它们不是 TX0 引入的 verdict，本节点也没有用
targeted GREEN 覆盖这条 inherited baseline。
