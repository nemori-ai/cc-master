# Cross-harness post-MVP roadmap

> 状态：**R0 仅随同一 runtime 集成 PR 晋升 `current`；R1–R10 默认是 `target`，不是 shipped claim**
> 基线日期：2026-07-16 UTC
> 适用范围：`ccm worker` 最小闭环之后的 ccm control plane、provider runtime、quota、plugin hooks/skills 与跨平台资格化
> 不改变的 SSOT：能力成熟度仍以 [`cross-harness-orchestration-capability-model.md`](cross-harness-orchestration-capability-model.md) 的 current / partial / target gap matrix 为准；本页只冻结 MVP 边界、后续切片顺序与晋升门。

## 1. 决策摘要

公共命令面固定为 **`ccm worker`**。不新增 `ccm dispatch` 作为同义 namespace，也不为了后续能力重命名已经存在的命令。自动选择、持久 run、quota admission 等能力将来仍从 `ccm worker` 的子命令或兼容扩展进入；内部可以有 router、supervisor、provider driver 等组件，但它们不是第二套用户命令面。

当前 board 的最小交付闭环只回答一个问题：运行在任意受支持 origin harness 中的 master orchestrator，能否通过全局 `ccm` 进程边界，先查看 resolver 选中的真实 agent-command help，再把 caller 组装的 raw argv/stdin 交给本机 Codex、Claude Code 或 Cursor Agent CLI，并由 ccm 管住这次**同步、session-bound** 的子进程生命周期。安全隔离、provider 语义适配、持久恢复和自动经济调度都重要，但它们是后续独立增量，不再作为这条最小闭环的前置条件。

## 2. MVP closure contract

### 2.1 本轮验收边界

两条公共形状是：

```text
ccm worker help --harness <codex|claude-code|cursor-agent|kimi-code> [--scope <agent|root>]
ccm worker run --harness <codex|claude-code|cursor-agent|kimi-code> [--cwd <path>] [--timeout-ms <n>] [--max-output-bytes <n>] -- <provider argv...>
```

本轮只有在以下条件全部成立时闭环：

1. 三个 harness 共用一个 resolver/process seam；`help` 与 `run` 选中同一真实 executable，fake CLI 可验证真实 help、raw argv 和 stdin 无条件原样转发。`help --scope agent`（默认）取 descriptor 的 agent-command help，`--scope root` 取 executable 的 root/global help。
2. 调用者显式选择 harness，并依据真实 help 自己组装 provider flags；ccm 不提供 model/effort 映射，不自动 route/fallback，也不切换账号。
3. `run` 在 `--` 后接收完整 provider argv，绝不自动拼 command prefix；例如 Codex 调用者自己包含 `exec`，并按 root help 放置 global flags。
4. ccm 同步等待 process terminal；timeout、外部 cancel、origin signal、输出越界和 provider 非零退出都只进入 generic process envelope，不解析 provider terminal。
5. ccm 只管理自己创建的 process tree，结束前完成 signal escalation、kill/reap、有界 stdout/stderr 和临时目录 cleanup。
6. worker terminal 不是 parent task 的 `done`；master orchestrator 仍独立验收 artifact、测试和 acceptance。
7. built CLI 的三条 hermetic E2E 全绿；本机真实 smoke 要么成功，要么诚实记录 provider/host 阻塞。raw wrapper 本身不声明 BYOK、账号、credential 或 provider side-effect 安全性。

### 2.2 当前证据与闭环目标不得混写

[`cross-harness-session-bound-worker` capability card](harnesses/capabilities/cross-harness-session-bound-worker.md) 与 plugin guidance 只有和三 harness raw-wrapper runtime、tests、promotion review 位于同一集成 PR 时才可晋升 `current`；拆开合并会让文档先于实现，因此不允许。

本页因此使用两个不同概念：

- **MVP closure contract**：当前 board 应该完成并据此结束的最小产品闭环；
- **current evidence**：已经进入 tracked source、生成产物并通过相应 gate 的事实。

前者不能替后者背书。后续 PR 必须在同一变更中回写 capability card、command reference 和 gap matrix，才可晋升 current。

### 2.3 明确不属于本轮的 claim

| 能力 | 本轮诚实声明 | 后续 slice |
| --- | --- | --- |
| 跨 origin 显式调用三种 CLI worker | MVP closure target | R0 |
| parent 退出后的继续运行、handoff attach/reconcile | 不支持；当前 run 是 session-bound | R1 |
| ccm 更新、重装、rollback 时 active run 存活 | 不支持 | R1 |
| sandbox、permission、worktree side-effect enforcement | 不作为 MVP 安全晋升；只保留显式 residual | R2 |
| 全机 quota live observation、admission、reservation | bounded local decision/store seam 已有 partial/current 证据；collector→spawn 闭环不存在 | R3–R4 |
| normalized provider adapter、自动 route/fallback、model admission | 不支持；调用者显式选 harness 并提供 provider argv | R5 |
| write-capable worker | 不支持；不宣称 repository/external side-effect containment | R6 |
| 三 provider 自动 fallback、三 origin same-run management | 不支持 | R7 |
| Cursor Linux/macOS sandbox safety canary | 未资格化 | R2/R8 |
| local outcome 学习、privacy/retention、rollout/kill | 不支持 | R9 |
| plugin 主动生产全机 quota truth | 不支持；现有 hooks 只消费 ccm-owned cached context/inbox | R3/R10 |
| skills 最终 cross-harness 模型/配额/worker guidance | 随已实现命令增量更新；全 portfolio 终审未完成 | R10 |

## 3. 后续能力切片

### R1. Durable run control plane

目标是让一个已启动 worker 不依赖 origin session 或启动它的 `ccm` 前台进程继续存在。最小组成是 per-run supervisor、immutable request、`run_ref`、append-only journal、heartbeat/lease、control endpoint，以及 `attach|poll|cancel|reconcile`。active-version reconciler 是 board projection 的唯一 writer；old supervisor 不直接写 board。

同一切片还要证明 update/reinstall/rollback 的 active-run 语义：新 run 使用新 current，旧 run 固定旧 runtime image 自然收敛；installer/GC 不热替换、不强杀、不删除仍有 lease 的 image。中央 always-on daemon 不成为 correctness 前提。

### R2. Safe execution envelope

把“进程能跑”升级为“明确的 effect profile 可被机械执行”。按能力拆为 read-only inspect 与 isolated writer 两级：

- sandbox/profile 必须绑定 Cursor/CLI version、OS、request mode 和 workspace；某一组合的 PASS 不外推到另一组合；
- worktree lease、canonical workspace identity、permission compiler、env allow/deny、network/MCP policy、redaction 和 process-tree cleanup 有机械证据；
- worker 不能 ARM/nested master、写 parent board、commit/push、改 credential/account，除非未来另有逐项显式 authority；
- sandbox 不可用时可以在用户明确授权下运行一个**不具备 safety claim** 的 session-bound smoke，但不能据此晋升 automatic/safe eligibility。

### R3. Machine-wide quota observation and notification

ccm 为每个 harness/surface/payer/pool/bucket 生产 versioned observation，保留 freshness、provenance、error/circuit 和不可比较边界；Codex 只以 7d bucket 作为 hard ceiling，rolling 24h burn 只作 advisory。collector single-flight 写入 owner-only、atomic home store。

plugin 不自行 probe provider，也不成为 quota truth writer。三个 origin 的 bootstrap hook 向 ccm 注册 subscription；ccm monitor/service 或显式 refresh 生产 decision delta，coordination inbox/hook 只做 cached、bounded、redacted delivery。daemon/monitor 可以提升及时性，但显式 `ccm` read/refresh 必须始终是可用底座。

### R4. Admission and reservation transaction

在一个 provider 上纵向接通：fresh observation → preflight → committed reservation → launch 前第二次 live recheck → same-run launch claim/spawn → hello/terminal → release 或 orphan audit。unknown、tight、stale、conflict、identity drift、uncommitted reservation 和 duplicate dispatch key 的 spawn 上限均为零。

这一步只证明“一个显式候选能被可靠准入”，不自动选择候选。

### R5. Automatic route, fallback and model admission

先交付 shadow advisory，再允许一个 narrow automatic path：

1. task profile 与 effect floor 先于品牌/模型；
2. production candidate 是 versioned model evidence、fresh live entitlement、quota、policy、permission 和 runtime health 的交集；
3. utility 比较质量、accepted-result 总成本、quota opportunity、wall time、context movement 和 integration overhead；
4. fallback 只处理 allowlisted mechanical failures。policy/security/workspace/task block、acceptance failure 或用户决定不得靠换候选绕过；
5. Codex/Cursor account mutation 和 automatic account switching 永久为零。

normalized provider adapter 属于这一 post-MVP 层：只有在 provider-specific 版本/flags/result contract 有独立证据后才可加入，不回写或扩张 R0 raw wrapper。

### R6. One-provider safe writer

只选一个 provider、一个 origin、一个 isolated worktree，跑一个可回滚的最小写任务。通过 worktree diff、tests 和 parent acceptance 后才可完成；provider success 仍不能直接把 task 标为 done。先证明 zero commit/push/nested/credential leak，再扩任务类型。

### R7. Three providers and three origins

把已经通过 R1/R4/R6 的 normalized/durable contract 扩到 Codex、Claude Code、Cursor Agent 三个 provider driver，并让 Claude Code、Codex、Cursor IDE 三个 origin 对同一 `run_ref` 拥有等价的 bind/attach/poll/cancel/reconcile 与 decision-attention 语义。Cursor IDE plugin 和 Cursor Agent CLI 始终是两个 surface；品牌相同不产生 auth、quota、role 或 lifecycle 推导。

### R8. Qualified Linux and macOS Cursor canaries

在满足 §4 prerequisite 的真实 Linux 与 macOS 主机上，分别对冻结 Cursor Agent version/profile 跑 explicit opt-in canary。两套 OS 证据互不继承；仅使用 fresh-proven Cursor first-party selector，API/BYOK/on-demand pool 和 automatic API fallback 为零。`Auto` 只能做普通 smoke，不能作 exact-model acceptance。

### R9. Rollout, kill and privacy

先有可演练 kill/rollback，再扩大 automatic 权限。至少覆盖 global/home/provider/collector/route/runtime activation disable，停止新 dispatch 与处置 active run 必须分开。local outcome corpus 只保存 task bucket、route/model/effort、acceptance/rework、wall/usage/quota delta 等最小统计；不保存 prompt/source/diff/transcript/credential/email，并提供 disable/export/purge。

### R10. Plugin and skill hardening

plugin 的最终形状是 harness-aware 的通知与行为指导层，不是 worker runtime：

- hooks 在 ARM 时注册 subscription，消费 ccm-owned machine/quota/run decision delta；保持 cached-only、bounded、redacted，不在 hook 内做 live provider I/O 或 route 推理；
- skills 教 master orchestrator 跨 origin 选 harness、先看 resolver 选中的真实 help、显式传 provider argv，并把 process terminal 交回 parent 验收；命令语法只由 `using-ccm` 拥有，配额/模型事实解释由 `pacing-and-estimation` 拥有，最终 route 决策由 `master-orchestrator-guide` 拥有；
- model catalog、price、benchmark 与 live entitlement 不复制成每个 host 的静态 slot。canonical evidence/CLI 是数据面，host adapter 只承载真实机制 divergence；
- 最终 portfolio review 清除 dev-agent 注释、重复 SSOT、过时 current claim，并用 projection、skill-lint、trigger/behavior eval 验收。

### R0 CLI help 与后续演进边界

真实 agent-command help 是 R0 的 current surface，也是 agent 的观测与操作入口；它由 `worker help`
通过与 `run` 相同的 resolver 取得。`help` 的 `scope=agent` 默认返回 agent-command help，`scope=root` 返回
executable 的 root/global help；两者共同帮助 caller 组装完整 argv。`worker run --help` 始终只说明 ccm
wrapper。真实 help 会随本机 provider CLI 演进，但它只帮助 caller 组装 raw argv，不提供 safe 或 automatic
eligibility，也不能替代未来 normalized provider adapter 的版本、effect、result 与 canary 合同。本轮不另造
`worker inspect` 或 per-run 探测层。

## 4. Canary host prerequisites

### 4.1 为什么当前开发机不是 Cursor safety canary

2026-07-16 在本机只读 probe 得到：

```text
OS: Ubuntu 20.04.6 LTS
kernel: Linux 5.15.0-1034-aws x86_64
cursor-agent: 2026.07.09-a3815c0
kernel.unprivileged_userns_clone: 1
bwrap: not found on PATH
```

`agent sandbox run --sb-debug -- /bin/sh -lc 'printf sandbox-ok'` 在 provider prompt 之前失败：Landlock backend 缺少 Cursor 当前 profile 所需的 Landlock V3 `Refer|Truncate` filesystem rights；bubblewrap fallback 又找不到 root-owned executable `bwrap`。因此这台机器可以验证 binary、argv、session-bound process lifecycle，以及用户明确接受 residual 后的 `--sandbox disabled` smoke；它**不能**为 Cursor sandbox enforcement、safe inspect、safe writer 或 automatic eligibility 背书。

这不是 Cursor Agent “技术上不可用”，而是当前 OS/kernel/helper 组合不满足 safety canary 的资格。安装一个名字叫 `bwrap` 的用户文件、看到 `--sandbox` flag、或让无 sandbox 请求成功，都不能把该结论翻绿。

同日的 R0 first-party live probe 进一步把 transport 与 provider compatibility 分开：Cursor 的 resolver、
binary、真实 help 与 launch 都 technically callable；但 provider launcher exit 0 后，本次新建、同 PGID 的
workspace helper / LSP 仍存活。ccm 因此把本次 run 判为 wrapper exit 1、`state:failed`、
`error.code:owned_tree_survived`，随后对 owned group 做 TERM/KILL cleanup；最终 `reaped:true`，整个 owned
process group 已消失。此次没有 OK output，也没有证明 exact model、payer 或 live task success。故三 harness
raw wrapper 的 hermetic contract 仍为 `current`，Codex 与 Claude Code 的 first-party live probe 为 pass；
Cursor 在**当前 host/version** 的 live canary 仅为 `partial`，阻塞项是 external provider compatibility，不能
写成 fully qualified success。这里的证据不外推到其他 OS、kernel 或 Cursor version。

`no-daemon` / await-helper 语义或一个短的 natural-drain grace 是否能兼容该 provider 生命周期，留作
post-MVP 独立调研；无论采用哪条路径，terminal 前 **whole owned group gone** 的不变量都不放宽。

### 4.2 Prerequisite matrix

| Gate | Linux host prerequisite | macOS host prerequisite | 必须保存的证据 | 不可替代的负例 |
| --- | --- | --- | --- | --- |
| Session-bound worker smoke | supported CLI version、手动 auth、显式 first-party model、可执行 workspace；sandbox 可按本轮诚实 residual 单独关闭 | 同左，且独立验证 argv/result | version/catalog snapshot、requested/resolved model、terminal、cleanup | ccm 不主动注入 API/BYOK env；R0 不声明 provider 自身 credential/account side-effect safety |
| Cursor sandbox inspect | Cursor 当前 profile 可用的 Landlock ABI，或 Cursor 支持的 root-owned bubblewrap backend；unprivileged user namespace 与 LSM/preflight 满足 | 对目标 Cursor version 的 macOS sandbox/profile 做独立 runtime qualification；不得继承 Linux 结论 | OS/kernel/CLI/profile identity，workspace/network/MCP 边界，pre-exec attribution | workspace escape、network/profile mismatch、sandbox unavailable 均 fail closed |
| Isolated writer | 上一 gate + isolated worktree/lease、permission/env compiler、process-tree cleanup | 同左，且由真实 macOS runner 重放 | diff、lease、effective deny set、cleanup、parent acceptance | commit/push/nested master/credential leak=0 |
| Durable run/update | Linux exact runtime assurance、detached process/control primitives、lease-aware GC | Darwin path-attested assurance及其 same-UID residual 明示；arm64/x64 当前 tree 各自资格化 | parent death、handoff、update/reinstall/rollback、same `run_ref` | duplicate worker=0；old supervisor board write=0；active image误 GC=0 |
| Quota/admission canary | current identity 的 fresh、pool-specific read-only collector；owner-only store；显式 canary permit/budget | 同左；OS credential store 只可只读，不复制或改写 | observation provenance/freshness、reservation/claim/terminal/release chain | unknown/tight/stale/conflict spawn=0；account/credential mutation=0 |
| Cursor cross-OS promotion | 合格 Linux sandbox host，不是本节所述 5.15 开发机 | 合格 macOS host；binary/auth/quota/sandbox/result 全轴独立证明 | 两套互不继承的 canary report 与 exact commit/tree | 任一 OS 缺证据时只保持该 OS target/partial |

相关平台合同由 [`cross-harness-runtime-supply-chain-spec.md`](cross-harness-runtime-supply-chain-spec.md)、[`cursor-agent-cli.md`](harnesses/cursor-agent-cli.md) 和 [`cursor-agent-admission-contract.md`](harnesses/cursor-agent-admission-contract.md) 持有；本表只定义进入后续 canary 的最低资格，不另造 runtime 机制。

## 5. 当前 blocked task → capability slice 映射

此表记录 2026-07-16 board 快照中的 blocked IDs，目的是保留追踪关系，而不是要求这些节点继续阻塞 R0。除标为 R0/本页交付者外，进入未来 cadence 前都应重切为 0.5–2 天、可独立验收的纵向节点；不要直接启动旧 rolling-wave placeholder。

| Task ID | 归属 | 处理方式 |
| --- | --- | --- |
| `xh_rw_three_provider_fallback` | R0 三 harness integration | 名称保留历史，但当前合同已经移除 automatic fallback；只完成三 adapter + lifecycle MVP。未来 fallback 另在 R5 重切。 |
| `xh_c2_inspect_promotion_gate` | R0 endpoint gate | 当前 MVP 唯一最终 promotion gate；只验三 harness session-bound 闭环。 |
| `deliver_xh_c2_supervisor_storage_authority_restart` | roadmap documentation | 当前已重定向为本页的 tracked doc delivery；不再把 durable supervisor 作为 R0 前置。 |
| `implement_cross_harness_orchestration_epic` | aggregate | R0 通过后不应用所有 post-MVP placeholder 阻塞“最小闭环已交付”的声明；未来按 R1–R10 分 cadence 追踪。 |
| `xh_rw_runtime_platform_hardening` | R1/R8 | 拆为 synthetic active-run update survival、Linux assurance、Darwin qualification 三个独立增量。 |
| `xh_rw_codex_safe_writer` | R2/R6 | 先拆 permission/worktree envelope，再拆 one-provider writer canary。 |
| `xh_c3_explicit_live_permit_contract` | R2/R4 | 作为显式 live authority 的窄合同；不阻塞 cached context 或 R0。 |
| `xh_contract_board_enable_gate` | R4/R5 | 只在 admission/route writer 真正接线后激活；不得为历史 task 伪造 selection/attempt。 |
| `xh_rw_three_origin_management` | R1/R7 | 先交 one-run attach/reconcile，再逐 origin 接入；不要把 subscription、native attempt 与 CLI run 一次性交付。 |
| `xh_cursor_plugin_dual_surface_integration` | R7/R10 | 在 ccm run summary/inbox 稳定后接 plugin attention；IDE/Agent provenance 保持分离。 |
| `xh_cursor_dual_surface_e2e` | R7/R8 | 四态 hermetic matrix 与真实 OS canary 分开；付费/真实 canary 单独授权。 |
| `xh_cursor_dual_surface_promotion_gate` | R8/R10 | 只对有证据的 OS/surface scoped promotion，不等待不存在的全局 parity。 |
| `xh_rw_outcome_rollout` | R9 | 拆 privacy shell、kill/rollback、shadow eval 三个纵切。 |
| `xh_rw_l3_l4_promotion_gate` | R9 | L3 与 L4 分开；durable writer 可晋升 L3，样本不足时 L4 继续 partial。 |
| `extend_harness_skill_phase2` | R10 | 各 slice 随实现同步 guidance；本节点只做最终 portfolio 终审。 |

当前 blocked 列表没有一个精确叶子独占“machine-wide quota producer → plugin decision delta”。进入 R3 时应新建一个最小纵切，而不是把它塞进 Cursor plugin 或最终 skill review 节点。

## 6. Future thin vertical order

R0 完成后不再按“先造齐所有基础设施，再一起验收”的横切方式推进。推荐三条可并行 lane，在明确 convergence gate 汇合：

```text
Lane A: R1 durable synthetic -> one-provider durable inspect
Lane B: R2 qualified read-only sandbox -> R6 one-provider writer
Lane C: R3 one real quota producer + plugin cached delta -> R4 one-provider admission

R1 + R2 + R4 -> R5 one-candidate automatic route -> narrow fallback
R5 + R6       -> R7 provider/origin expansion -> R8 cross-OS canary
R7 + R8       -> R9 rollout/privacy -> R10 final plugin/skill hardening
```

| Increment | Entry gate | Exit gate | 本增量故意不做 |
| --- | --- | --- | --- |
| R0 三 harness session-bound | frozen `ccm worker` raw-wrapper grammar；三 resolver spec | 三 fake CLI help/run E2E + 真实 smoke/诚实阻塞；P0/P1=0 | normalized provider adapter、daemon、quota、sandbox promotion、auto route |
| R1a synthetic durable run | R0 result/lifecycle envelope稳定 | parent death/handoff 后 same `run_ref` attach/cancel/reconcile；board direct write=0 | live provider、update survival |
| R1b active-run update survival | R1a journal/lease；runtime supply-chain gate | update/reinstall/rollback/GC 不打断 synthetic active run | writer、auto route |
| R2a qualified read-only Cursor inspect | 合格 Linux host + frozen version/profile | workspace/network/profile 负例全绿；explicit canary terminal≠done | macOS、writer、fallback |
| R3a one quota producer + hook delta | 一个有官方/实测 schema 的 read-only collector；subscription spine可用 | owner-only observation、freshness/circuit、三 origin 同 revision cached delta；hooks live I/O=0 | reservation、automatic spawn |
| R4 one-provider admission | R1a + R3a；quota store/contract green | reserve→recheck→claim→spawn→terminal/release/orphan 完整；duplicate/unknown spawn=0 | candidate scoring、fallback |
| R5a shadow route | task profile、model evidence与 live facts 可解释 | advisory rationale 可重放；与 explicit run 对照，不自动 spawn | fallback、writer |
| R5b one automatic candidate | R4 + R5a；显式 policy opt-in/kill | 只对一个 read-only profile自动启动；deny/unknown spawn=0 | 第二候选 fallback |
| R5c narrow fallback | 两个候选各自通过 R4/R5b | allowlisted mechanical failure 才换候选；越权绕过=0 | writer fallback、学习 |
| R6 one-provider writer | R1 + R2a + R4；isolated worktree | 最小写任务、diff/tests/parent verify；commit/push/nested/secret=0 | 三 provider、macOS |
| R7 provider/origin expansion | 单 provider inspect/writer contract稳定 | 三 driver + 三 origin same-run management；Cursor 双 surface 四态正确 | 自动学习、全 OS claim |
| R8 cross-OS Cursor promotion | Linux/macOS prerequisite各自满足；explicit budget | exact tree 的两套独立 reports；scoped current/partial 回写 | 从一台机外推全平台 |
| R9 rollout/privacy | R7/R8；kill/rollback spec | kill 演练、retention/disable/export/purge、shadow baseline/区间 | 小样本自动翻 prior |
| R10 final plugin/skills | 对应 runtime 命令与事实已 current/partial | hooks/skills/adapter claim 锁步；lint/projection/eval/review全绿 | 在 prose 中预告未实现命令 |

每个增量只有两类阻塞问题可以阻止下一条独立 lane：会让上一层公开 claim 不诚实的 P0/P1，或破坏共享 narrow waist/authority 的缺陷。平台资格、边界负例和 rollout hardening 可以与不依赖它们的后续设计/实现并行，但不能提前提升相应安全或自动化 claim。

## 7. Promotion and maintenance rules

1. 每个 slice 在进入 cadence 前先写窄 spec/contract、fixture 和 rollback；通过后只晋升对应 provider/origin/OS/profile，不做全局泛化。
2. `current` claim 必须同时具备 tracked implementation、hermetic tests、真实 endpoint/canary（若 claim 涉及真实 provider/OS）和 capability/gap matrix 回写。
3. 普通 CI 不发付费请求。真实 canary 必须 explicit opt-in、first-party-only、有 budget、cleanup、kill 和可审计 artifact。
4. Cursor 与 Codex 的自动账号切换、login/logout、credential import/copy/write 保持 forbidden，不随任何 slice 解禁。
5. plugin hooks 永远不拥有 provider live I/O、quota writer 或 route authority；ccm 是 machine truth/control plane，运行在 harness 中的 master orchestrator 仍是最终行动与验收主体。
6. 发现新风险先判断它是否使当前公开 claim 不成立。若否，记入对应后续 slice 并继续交付当前最小闭环；不要把“未来工业化完整性”重新变成 R0 的无限前置条件。

## 8. Canonical references

- 能力分层与工业化目标：[`cross-harness-orchestration-capability-model.md`](cross-harness-orchestration-capability-model.md)
- 当前 session-bound worker 卡：[`cross-harness-session-bound-worker.md`](harnesses/capabilities/cross-harness-session-bound-worker.md)
- quota observation/reservation 合同：[`2026-07-13-cross-harness-quota-admission-contract.md`](2026-07-13-cross-harness-quota-admission-contract.md)
- runtime update/rollback/assurance：[`cross-harness-runtime-supply-chain-spec.md`](cross-harness-runtime-supply-chain-spec.md)
- Cursor CLI 易变事实：[`cursor-agent-cli.md`](harnesses/cursor-agent-cli.md)
- Cursor admission partial 合同：[`cursor-agent-admission-contract.md`](harnesses/cursor-agent-admission-contract.md)
- 三 origin cached context：[`cross-harness-cached-context.md`](harnesses/capabilities/cross-harness-cached-context.md)
- 三 origin subscription/inbox：[`cross-harness-notification-subscription.md`](harnesses/capabilities/cross-harness-notification-subscription.md)
