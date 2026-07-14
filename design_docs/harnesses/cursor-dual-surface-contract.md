# Cursor IDE / Agent CLI 双 surface contract v1

> 状态：**spec-first；现有 discovery 部分实现；聚合 evaluator 与完整 transport qualification 尚未实现；fixtures intentionally RED**
>
> 日期：2026-07-14 UTC
>
> 合同：`ccm/cursor-dual-surface-contract/v1`
> 基座：`ccm/machine-surface/v1` + `ccm/cursor-agent-admission/v1`

## 1. Scope 与 bounded contexts

本合同把同一 Cursor 品牌下的两个产品面建成两个独立 bounded context，而不是一个带两种入口的
“Cursor harness”：

| Canonical surface | Bounded context | 允许的角色 | 不允许的代称 |
| --- | --- | --- | --- |
| `cursor-ide-plugin` | Cursor IDE Agent 的 plugin / hooks / commands / rules 生命周期 | `master-origin` | 不得因 `agent` / `cursor-agent` 可执行文件存在而判定 IDE 或 plugin 已安装 |
| `cursor-agent-cli` | `agent` / `cursor-agent` headless one-shot worker transport | `worker-target` | 不得把 `--plugin-dir` flag、同品牌、同账号或可 resume 当成 IDE plugin origin |

`cursor-agent` 是旧 `harnesses[].surfaces` projection 的兼容 alias；canonical routing identity 只有
`cursor-agent-cli`。alias 不能建立第三个 surface，也不能持有独立 quota、run 或 reservation。

本合同不覆盖 Cursor Cloud Agents、private cloud worker、SDK/API dispatch 或 Cursor Tab。它们若进入
ccm，必须有独立 descriptor、identity/payer/pool 与 transport contract，不能复用本合同的 eligibility。

## 2. Evidence basis（2026-07-14）

### 2.1 官方资料

- [Cursor plugins reference](https://cursor.com/docs/reference/plugins) 与
  [Hooks](https://cursor.com/docs/hooks)：IDE plugin 可打包 skills、subagents、MCP、hooks、rules、commands；
  host lifecycle 是 Cursor IDE Agent 的原生 surface。
- [CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)、
  [headless mode](https://docs.cursor.com/en/cli/headless) 与
  [output format](https://docs.cursor.com/en/cli/reference/output-format)：CLI 有 `--print`、结构化 result、
  `--model`、`--resume` 等 headless primitives；成功 JSON 的 terminal core 含 `type:"result"`、
  `subtype:"success"`、`is_error:false`、`result` 与非空 `session_id`。
- [CLI authentication](https://docs.cursor.com/en/cli/reference/authentication)：`status` 是 read-only auth
  查询；`login` / `logout` 会写认证状态，永不属于 ccm 自动 probe 或 route authority。

### 2.2 本机只读 probe

2026-07-14 UTC，在 Linux、Cursor Agent `2026.07.09-a3815c0` 上只执行固定无请求 argv：
`--version`、`--help`、`status --help`、`status --format json`。结果经过字段级脱敏后记录如下：

- `agent` 与 `cursor-agent` 都存在，且解析到同一个版本化 executable；它们是 binary aliases，不是两个
  account/pool/surface。
- `status --format json` RC0，顶层字段包含 `isAuthenticated`；当前状态为 authenticated。email、user id、
  access/refresh token 状态的原始值均未写入本文、fixture 或 read model。
- root help 声明 `--print`、`--output-format`、`--model`、`--workspace`、`--sandbox`、`--resume`、
  `--plugin-dir`；未发现 provider-native cancel command。
- 本机没有 `cursor` IDE launcher、Cursor IDE config dir 或 `~/.cursor/plugins/local/cc-master`，因此本次
  probe 只能给出 IDE surface negative presence；IDE plugin-host positive evidence 继续使用 2026-07-09
  Cursor 3.10.20 的本仓 D1/D5/D9 live probe 与官方 plugin/hook 文档。

probe 的边界比 binary help 更重要：flag presence 只证明 parser surface，不证明 entitlement、quota、
sandbox 实际可启动、plugin hook lifecycle parity、resume continuity 或 cancellation correctness。

## 3. Descriptor contract

聚合 evaluator 的目标输入是两个已经观测到的 surface facts；它本身是纯函数，不读 PATH、credential、
network 或 provider。composition root 继续由 `inspectCursorExecutionSurfaces` 负责只读 probe，再把 evidence
交给 evaluator。每个 descriptor 带自己的 canonical UTC `as_of`，每条观测轴在 `evidence[axis]` 中带
`source`、`observed_at`、`valid_until`；请求侧的 `route_kind` 与 `sandbox_required` 不冒充观测事实。正式
fixture API 是：

```ts
evaluateCursorDualSurfaceContract(input): {
  schema: "ccm/cursor-dual-surface-contract/v1";
  surfaces: [CursorIdeProfile, CursorAgentCliProfile];
  decision: {
    installed_surface_ids: string[];
    master_origin_eligible_surface_ids: string[];
    worker_eligible_surface_ids: string[];
    blockers: Record<string, string[]>;
    pool_relations: Array<{ left: string; right: string; join_allowed: false; reason: string }>;
  };
}
```

输出顺序固定为 `cursor-ide-plugin`、`cursor-agent-cli`。unknown 不删除字段、不变成 false positive；
任何可变字符串仍受 `surfaceInventory` 的 4096-byte bounded projection 约束。

同一 production opt-in seam 还冻结两个纯 lifecycle 函数：
`migrateCursorDualSurfaceLifecycle(input)` 负责 alias 边界归一与在飞 run pinning，
`rollbackCursorDualSurfaceLifecycle(input)` 负责 consumer-first rollback。两者与 evaluator 一样不得读写
PATH、账号、credential、network 或 provider；production export 缺失是唯一许可的 honest RED。

### 3.1 独立事实轴

两个 descriptor 都必须独立承载以下事实，且每条 positive fact 都带非空、surface/axis allowlist 内的
source、`observed_at`、`valid_until`。时间必须是 canonical UTC，并满足
`observed_at <= as_of < valid_until`；source 缺失、跨 surface、未来观测、过期、倒置或非规范时间都只让
对应轴 fail closed，不得借另一轴补真：

| Axis | `cursor-ide-plugin` | `cursor-agent-cli` |
| --- | --- | --- |
| install/binary | IDE launcher、config 或 local plugin；plugin presence 与 launcher presence仍分别留证 | `CCM_CURSOR_AGENT_BIN` → `agent` → `cursor-agent` 精确 precedence；explicit bad override fail closed |
| auth | live origin session 或 IDE 专属 collector；不得借 CLI status | 只读 `status --format json`；只投影 authenticated/unauthenticated/unknown |
| model | IDE 当前 session/model entitlement 独立事实 | `--model` 只证明 selection flag；live entitlement 需独立 collector |
| quota/pool | dashboard/billing-period 事实必须绑定 IDE surface + payer/pool | CLI login/API-key 的 payer/pool 单独绑定；auth 不证明 quota |
| sandbox | IDE-native policy；不用于证明 headless sandbox | `--sandbox` flag 是 declared support；required profile 必须有该版本/OS 的 runtime qualification |
| plugin-host | IDE plugin lifecycle + hooks/commands/rules 是已验证 positive | `--plugin-dir` 只是 loader flag；未证明 IDE hook/session/arming parity，故 master-origin 仍 unsupported |
| invoke/result | origin native task dispatch，不是 ccm headless provider result | `--print` + structured terminal envelope；RC0、非空 stdout、accepted 三者分开 |
| cancel | IDE UI/native lifecycle，不是 ccm worker control | 无 provider-native cancel 证明；有效 cancel 需 supervisor process-tree contract |
| resume | IDE conversation/session lifecycle | `--resume` flag present，但 continuity、result correlation、permission reuse 仍须 qualification；one-shot admission 不靠它 |

### 3.2 角色合同

`cursor-ide-plugin` 可以成为 master origin，但必须同时满足：IDE/plugin installed、plugin-host 已 qualification、
当前 origin session 有 attestation。它沿 Track A 使用可 1:1 投影的 SAP/PHIP 能力，沿 Track B 使用已登记的
Cursor lifecycle substitutes；Track B 不降低它作为 origin 的身份，只诚实降低个别能力 parity。

`cursor-agent-cli` **不能成为 master origin**。它没有本合同下可证明的 IDE lifecycle、fresh/resume ARM、
origin-native ledger 与 hook parity。即使 `--plugin-dir` 存在、与 IDE 登录同一个 Cursor identity、或 CLI
能 resume，结论也不改变。它的 Track B substitute 是：由一个受支持的 origin orchestrator 把它作为
headless worker 派发；worker 只收到最小任务上下文，不能自行 ARM 成嵌套 master。

### 3.3 Headless worker admission

`cursor-agent-cli` automatic worker admission 是以下条件的合取：

```text
surface installed
AND binary available + exact-version compatible
AND auth == authenticated
AND model entitlement == entitled
AND quota == ample + non-empty surface-bound pool_ref
AND requested sandbox profile qualified（仅 `sandbox_required:true`）
AND invoke qualified
AND terminal result contract qualified
AND effective cancel qualified
AND account/credential mutation floor == forbidden
```

`sandbox_required:false` 表示该 route 已在上层获得“不请求 sandbox”的独立授权，不要求
`sandbox_qualified`；evaluator 不能把所有 route 偷换成 required，也不能反向把 required 忽略掉。`resume`
不是 one-shot admission 的必要条件；若 `route_kind:"continuation"`，resume qualification 变成额外 hard
gate。provider-native cancel 不存在时可由 supervisor process-tree cancellation 提供 effective cancel，
但在那条接线和 crash/descendant tests 通过前必须保持 unknown。

## 4. Negative capabilities 与不可推导关系

以下约束对两个 surface 永久成立：

1. `automatic_login/logout/account_switch/session_switch = forbidden`；
2. `credential_import/copy/write/auth_store_write = forbidden`；
3. ccm 不转发 `CURSOR_API_KEY` 到 inventory/auth/model/quota probe；显式 worker execution 的 credential
   authority 由未来 driver 独立定义，不从 parent env 全量继承；
4. `installed(A) ⇏ installed(B)`、`auth(A) ⇏ auth(B)`、`model(A) ⇏ model(B)`、
   `quota(A) ⇏ quota(B)`、`plugin_host(A) ⇏ plugin_host(B)`；
5. 相同 email、opaque identity fingerprint、品牌或订阅文案都**不**允许 join pool；只有 provider-backed
   source key 明确证明相同 `surface/payer/pool/bucket/unit/window` 才可比较。本合同默认跨 surface
   `join_allowed:false`；
6. `binary RC0 ⇏ request accepted ⇏ parent task done`。parent true-done 仍需 artifact/test/review 独立验收。

## 5. Fixture matrix 与 RED gate

fixture catalog 位于
[`ccm/apps/cli/test/fixtures/cursor-dual-surface-contract-v1/`](../../ccm/apps/cli/test/fixtures/cursor-dual-surface-contract-v1/)，
由三份可执行输入组成：

- `scenarios.json`：18 个正反组合，除 only-IDE/only-Agent/both/neither 外，独立翻转 auth/quota 双向、
  IDE quota ample + Agent auth unknown、sandbox required/optional、invoke/result 双向、one-shot/continuation
  resume、plugin-host、model、cancel 与 Agent origin forbidden；
- `provenance-mutants.json`：只改 freshness/provenance，不改 positive fact value，以显式 target surface/role
  覆盖 IDE origin 与 Agent worker 的 stale、missing source、cross-surface source、future observation 与
  inverted window；
- `lifecycle.json`：alias 只在输入边界归一、journal/run/reservation 只写 canonical id、active run pinning、
  consumer-first rollback、空/缺失 strict facts 时 automatic eligibility 归零、完整 strict facts 可达，以及
  零账号/credential/pool/cancel 副作用。

默认 CI 校验 fixture schema、surface/profile 唯一性、required coverage、provenance、生命周期、所有
forbidden mutation floor，并用 test-local contract oracle 证明下列 counterfeit evaluator 均被杀死：
`Agent quota ample => Agent auth`、`IDE quota ample => Agent auth`、无视 sandbox required/optional、
`result => invoke`、continuation 无视 resume、任一 surface 的 provenance-blind 判定、`every([])` 式空事实
rollback。oracle 不是 production export，不改变 honest RED：

```bash
pnpm --dir ccm/apps/cli exec node --import tsx --test test/cursor-dual-surface-contract.test.ts
```

目标 evaluator 尚未实现时，以下命令必须 RED，且第一个失败点必须是
`evaluateCursorDualSurfaceContract` 缺失或行为不符合 fixture；该 export 完成后，同一 gate 再约束
`migrateCursorDualSurfaceLifecycle` / `rollbackCursorDualSurfaceLifecycle`。fixture parse/import 错误不是
许可的 RED：

```bash
CCM_CURSOR_DUAL_SURFACE_CONTRACT_RED=1 \
  pnpm --dir ccm/apps/cli exec node --import tsx --test test/cursor-dual-surface-contract.test.ts
```

fixture 只含合成 evidence，不启动真实 Cursor binary、不读取 credential、不发模型请求。

### 5.1 Track A/B evidence anchors

`manifest.json.track_claims` 不允许只写 `track:"A+B"` / `track:"B"` 标签。每项 claim 必须同时锚定：

1. Capability INTENT 与受影响 hook/transport CONTRACT；
2. `cursor-surfaces.ts` 的 machine-surface descriptor；
3. 实际 `plugin/src` Cursor strategy；
4. 对应 `plugin/dist/cursor` host-native artifact；
5. 已净化 probe/dogfood evidence。

每个被 profile 引用的 claim，其 `surface_id` 必须与该 profile 的 canonical surface 精确一致；每个
`machine-surface-descriptor` anchor 还必须显式重复并匹配该 `surface_id`。同仓中另一个 Cursor descriptor
存在，不能替代本 claim 的 surface binding。

默认 content gate 会逐 path 和关键 status fragment 验证这些 anchor，并用内存 drift mutant 证明任一 claim
与 Capability/CONTRACT/descriptor/strategy/dist/probe 漂移都会 RED。dist 仍只是生成验收面；语义变更只能从
Capability/CONTRACT/canonical/strategy source 发起，再经 projection 更新。

## 6. Migration 与 rollback

### 6.1 Migration

以下 M0–M3 不只由 prose 声称；`lifecycle.json` + focused test 冻结 before/after 与故意错误的 alias leak、
active-run rewrite、producer-first rollback、legacy installed/auth fallback、account switch/pool merge mutant。

1. **M0（current）**：保留 `harnesses[].surfaces` 的 presence-only 兼容视图；严格 routing 只消费
   `surfaceInventory` 的 canonical `cursor-ide-plugin` / `cursor-agent-cli`。
2. **M1（additive producer）**：在现有 `cursor-surfaces.ts` 增加纯 evaluator 和本合同的 profile/decision；
   不改顶层 Cursor harness `installed` 的 IDE/plugin-target 语义，不删除 legacy `cursor-agent` alias。
3. **M2（consumer cutover）**：shadow route、quota reservation、supervisor 分别按 canonical surface id
   消费独立 facts；alias 只在输入边界归一一次，journal/run/reservation 永远写 canonical id。
4. **M3（deprecation）**：至少跨一个 ccm minor version 且所有内置 consumer 已无 legacy reads 后，才可
   从人读 inventory 移除 `cursor-agent` alias；schema/version 与 release note 显式声明。

active run 固定 launch 时选择的 canonical surface、runtime、pool 与 evidence revision；migration 不改写在飞
run，也不把旧 alias reservation 搬到另一个 pool。

### 6.2 Rollback

rollback 顺序是 consumer-first：先停用新 profile consumer，再回退 producer。回退后 routing 必须回到
现有 `ccm/machine-surface/v1` 的 fail-closed strict inventory；缺少 plugin-host/sandbox/cancel 等新事实的
surface automatic eligibility 为 0，绝不回退到“任一 Cursor installed/authenticated 即可派发”。

rollback 不执行 login/logout/switch、credential migration、pool merge、active-run reparent 或 destructive
cancel。已启动 run 由其冻结 supervisor/runtime 继续管理；无法 attach 时标 uncertain 并 surface operator。

## 7. Remaining unknowns / implementation slices

- Cursor IDE auth/model/quota 的 surface-local collector 与 live origin attestation；
- `--plugin-dir` 在 headless CLI 对 hooks/commands/session lifecycle 的真实覆盖；该 unknown 不阻塞 worker，
  但禁止 master-origin promotion；
- Linux/macOS 各自的 sandbox runtime qualification；本机 AppArmor 失败不能外推到 macOS；
- Cursor Agent effective cancel 与 supervisor process-tree 接线；
- resume 的 structured correlation、permission/profile continuity 与跨版本兼容；
- CLI login、IDE dashboard、API key、team/shared/on-demand 各 payer/pool 的 provider-backed identity；
- model entitlement 与 quota collector 的稳定 read-only surface、TTL、error taxonomy。

这些 unknown 只能通过官方 schema 或无副作用/显式 canary 晋升；help 文本、同品牌或当前用户“看起来能用”
都不是 production admission evidence。
