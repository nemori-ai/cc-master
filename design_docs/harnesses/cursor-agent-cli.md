# Cursor Agent CLI Harness Facts

更新时间：2026-07-14。

## Scope 与 bounded context

本页只覆盖 Cursor 的 headless CLI bounded context，canonical surface id 是
`cursor-agent-cli`。当前官方材料同时使用 `agent` 与 `cursor-agent`，两者只作为 executable alias 在输入边界归一化；
alias 不产生第二个 surface，也不能把 Cursor IDE 的 `cursor` launcher
当成 headless CLI。

`cursor-agent-cli` 只能是 `worker-target`，不能是 `master-origin`。Cursor IDE Agent plugin 的
canonical surface id 是 `cursor-ide-plugin`，其 manifest、commands、skills、hooks、安装与 IDE 内
Task 事实只在 [Cursor IDE Agent facts](cursor.md) 维护。两页同属 Cursor 品牌，但不是一个事实对象：
同一 email、订阅或 binary vendor 都不足以合并它们。

安装、认证、模型、配额、sandbox、plugin-host、调用/结果、取消/恢复必须逐轴独立证明；任一轴的
positive fact 都不能补齐另一轴或 IDE surface 的 unknown。

## Source hierarchy 与目标版本

事实优先级：

1. Cursor 官方 CLI 文档：
   [overview](https://cursor.com/docs/cli/overview.md)、
   [parameters](https://cursor.com/docs/cli/reference/parameters.md)、
   [authentication](https://cursor.com/docs/cli/reference/authentication.md)、
   [permissions](https://cursor.com/docs/cli/reference/permissions.md)、
   [output](https://cursor.com/docs/cli/reference/output-format.md)、
   [models and pricing](https://cursor.com/docs/models-and-pricing.md)。
2. 本仓 Linux 只读 probe：`agent` 与 `cursor-agent` 均解析到
   `2026.07.09-a3815c0`；该版本是当前唯一冻结的 supported version。2026-07-14 的零推理
   `cursor-agent --list-models` catalog observation 只作为下文 selector 边界证据，不证明 entitlement、quota 或 plan topology。
3. [`cursor-agent-admission-contract.md`](cursor-agent-admission-contract.md) 的 fixture-only
   admission/result contract；它是 `partial`，不等于 production driver 已存在。
4. 研究或社区材料只能形成待验证 hypothesis，不能覆盖官方材料或目标版本实测。

当前版本之外一律 `unsupported`，直到维护 runbook 完成并显式扩 allowlist。版本字符串相似、较新或
help flag 存在都不能自动放行。

## 独立事实轴

| Axis | 当前可证明 | 不允许的推断 |
| --- | --- | --- |
| install | read-only binary discovery；precedence 为 `CCM_CURSOR_AGENT_BIN` → `CURSOR_AGENT_BIN` → `agent` → `cursor-agent` | IDE/plugin installed、authenticated 或可升级 |
| auth | `status --format json` 的有界布尔状态；手动认证由用户在 cc-master 外完成 | auth=true ⇒ model 可用、quota 宽裕或 IDE 已登录 |
| model/catalog | production entitlement collector 尚未落地；每次候选选择须重新读零请求 `--list-models` catalog 并与 first-party family 证据相交 | `--model`、旧 catalog 或 selector 名字 ⇒ 当前 identity 有 entitlement/family |
| plan/payer topology | 独立 live fact；当前官方只证明 individual 的 `first_party + api` | Cursor 品牌、登录或账期 ⇒ Team/Enterprise/legacy/BYOK/on-demand/shared 的池形状 |
| quota/pool | 当前 production 只有 aggregate `billing_period` 近邻信号；fixture collector contract 另要求闭集 `provider/payer/quota_pool/source` provenance 与 pool ref | 订阅文案、aggregate used% 或 selector 名 ⇒ Cursor first-party pool 有 headroom、spillover policy 或 fallback 合法 |
| sandbox | `--sandbox` parser presence 已知；OS/version runtime qualification 未完成 | flag 存在 ⇒ profile 强制生效或跨 OS 等价 |
| plugin-host | `--plugin-dir` 是 CLI loader flag | loader flag ⇒ IDE plugin host、hooks/session/ARM parity 或 master-origin |
| invoke/result | fixture-only schema 与 fail-closed evaluator 已存在 | exit 0、非空 stdout 或 provider success ⇒ task accepted |
| cancel/resume | production supervisor/driver 尚未落地 | process exit、session id 或 CLI 品牌 ⇒ durable cancel/resume |

## Models、quota 与手动认证

模型可用性是当前 surface + 当前 identity + 当前 plan/payer + 当前 policy 的 live fact。静态型号、价格、
benchmark 与 help 输出不能作为 entitlement；production candidate 必须取 fresh catalog、first-party family
证据、live entitlement、pool-specific quota provenance 与 policy 的交集。请求 selector 和实际解析模型必须分开记录。

自动候选的 payer/quota 承重合同是闭集：plan topology 必须 fresh `known` 且 `payer:subscription`；quota
必须 fresh，顶层 `source` 与 provenance source 都精确为 `cursor-agent:first-party-quota`，provenance 必须是
`provider:cursor` + `payer:cursor-subscription` + `quota_pool:cursor-first-party`，唯一 pool ref 必须是
`cursor:subscription:first-party`。BYOK、on-demand、API、external-key、shared、unknown、ambiguous 任一出现都
fail closed，reason 分别稳定为 `payer-provenance-not-cursor-subscription` 或
`quota-pool-provenance-not-cursor-first-party`。这些字段由 collector 直接提供，不能从 selector 或 pool ref 名猜。

2026-07-14 官方 Models & Pricing 只对 **individual** 明确 `first_party` 与 `api` 两个 usage pools；
Team、Enterprise、legacy、BYOK、on-demand、shared 的 topology 未证时一律 `unknown`。即使 individual
已知两池，spillover 仍是 `unknown`；不得写死“不可 spill”，也不得从 aggregate `billing_period`
推导任一 pool headroom。plan/payer、auth、model、quota、pool、account-switch 是正交 facts；任一 unknown
都在自己的承重边界 fail closed。pool routing 不是账号切换，Cursor 与 Codex 自动换号仍永久禁止。

官方当前 First-party pool 命名为 Auto、Composer 2.5、Grok 4.5；Composer 2.5 是 Cursor 自研模型，
Grok 4.5 由 Cursor 与 SpaceXAI 联合训练。本机零推理 catalog 的当前 first-party selector allowlist 是：
`auto`、`composer-2.5`、`composer-2.5-fast`、`cursor-grok-4.5-low`、
`cursor-grok-4.5-medium`、`cursor-grok-4.5-high` 及三者对应的 `-fast` 变体
（`cursor-grok-4.5-low-fast`、`cursor-grok-4.5-medium-fast`、`cursor-grok-4.5-high-fast`）。
每次真实 Cursor 模型测试前，`--list-models` 零请求 catalog 必须 fresh discovery，再用官方 family
证据验证 selector；不能只凭字符串猜 family。unknown/ambiguous 一律拒绝。`gpt-*`、`claude-*`、
`gemini-*`、`kimi-*`、`glm-*` 对真实测试全部 API-pool deny；API fallback 永久禁止。
`Auto` 会动态选模，只能用于普通 smoke，不得用于 exact-model benchmark 或 model-identity acceptance。

认证只允许只读观察。手动认证、重新认证或选择身份必须由用户在 cc-master 外显式完成；cc-master
不能调用 `login`、`logout`，不能导入、复制、写入 credential，也不能切 account/session。Cursor 与
Codex 的自动换号永久禁止；同品牌、同 email、同订阅或另一 surface 已认证都不构成例外。

## Sandbox 与 plugin-host 边界

`--sandbox` 只证明 parser surface 存在，不证明 runtime enforcement。Linux 与 macOS（以及未来 Windows）
必须按版本、操作系统分别 qualification：验证 actual mode/profile、workspace 边界、network/MCP、pre-exec
失败归因与结果 schema。某一 OS 的 PASS 不得跨用；unknown、过期或 profile 不匹配均拒绝 automatic dispatch。

`--plugin-dir` 只允许 CLI 加载它自己的扩展输入，不能证明 Cursor IDE plugin 已安装，不能获得 IDE
hooks、conversation/session、ARM、Task 或 marketplace 语义，也不能把 CLI 晋升为 `master-origin`。
origin plugin adapter 只消费 ccm 的有界 run summary/ref；provider driver、supervisor、quota 与 sandbox
qualification 留在 CLI worker runtime 边界。

## 组合模型

实现遵循组合优于继承：分别建模 surface descriptor、binary/auth/model/quota probe、plan/payer topology、fresh first-party catalog、collector、admission evaluator、permission compiler、driver 与 supervisor，通过窄 interface 组合。不要建立继承 IDE plugin
模型的 mega `Cursor` object，也不要让一个 facet import 另一 bounded context 的 domain model。executable
alias 只在 discovery 输入边界归一化，pure evaluator 只消费已归一化 facts。

最小组合形状：

```text
aliases -> BinaryProbe -> SurfaceDescriptor
                       + AuthCollector
                       + ModelCollector
                       + PlanPayerTopologyCollector
                       + FreshFirstPartyCatalogCollector
                       + QuotaCollector(observed pool only)
                       + SandboxQualification(version, os, profile)
                       -> pure AdmissionEvaluator -> driver/supervisor
```

collector 独立失败时只 circuit-open 对应 facet；不能拖垮其他 surface，也不能用邻近事实填 unknown。

## Read-only probe contract

| Fact | 固定 argv / source | TTL 上限 | 失败语义 |
| --- | --- | ---: | --- |
| binary/version | `--version` | 24h | 非冻结版本、空/异常输出、非零退出 ⇒ unsupported |
| headless shape | `--help`、`status --help` | 24h | 缺承重 flag/status JSON ⇒ unsupported |
| auth | `status --format json` | 15m | 未知字段、非法 JSON、命令失败 ⇒ unknown |
| plan/payer topology | 独立 collector（尚未 production） | positive 24h | Team/Enterprise/legacy/BYOK/on-demand/shared 未证 ⇒ topology/spillover unknown |
| selector catalog | 每次候选选择的零请求 `--list-models` collector（尚未 production） | 当次选择 | 不在官方 first-party family allowlist、stale 或 ambiguous ⇒ deny |
| model entitlement | 独立 collector（尚未 production） | positive 24h | 无 fresh live evidence ⇒ unknown |
| quota | per-observed-pool collector（尚未 production）；source-exact + typed payer/pool provenance | positive 5m | 非 Cursor subscription/first-party、source 不精确、stale、unknown 或 ambiguous ⇒ deny |

inventory 只能运行上述只读 probe，不转发 `CURSOR_API_KEY`，不执行 prompt、update/upgrade、login/logout
或任何 credential/account mutation。输出必须有界、脱敏；email、token、credential path 与 raw private response
不进入 public descriptor。截断、future timestamp、倒置 validity 或 stale evidence 必须 fail closed。

## 维护 runbook

每次 Cursor CLI 版本候选变更时按同一顺序执行：

1. 保存官方 changelog/parameters/auth/permissions/output 的 retrieved time 与内容 hash；列出变化假设。
2. 在隔离 PATH 上分别运行只读 `--version`、`--help`、`status --help` 与脱敏 status fixture；验证
   `agent`/`cursor-agent` alias precedence、symlink、非可执行文件、override 缺失和异常输出。
3. 用多版本 fixture 重放 auth schema、unknown future fields、RC0-empty/invalid、requested/resolved model mismatch；
   topology 至少覆盖 individual-two-pool、one-pool、Team/Enterprise/legacy unknown 与 spillover unknown；quota
   provenance mutation 覆盖 BYOK、on-demand、API、external-key、shared、unknown、ambiguous 与 source mismatch。
4. 每次模型测试重新采集零请求 `--list-models`，覆盖完整 first-party allowlist、API family deny、
   unknown/ambiguous deny，以及 Auto 只可 smoke、不可 exact-model acceptance。
5. sandbox 按版本、操作系统分别跑 inspect/workspace-write profile；确认 pre-exec failure 不污染 auth/result，
   plugin loader 也不获得 IDE host 权限。
6. 更新 allowlist、facts 的 `observed_at`/`valid_until` 和 supersedes；只在所有承重负例通过后晋升。
7. 普通 CI 只跑 hermetic fixtures。任何真实付费 paid canary 都必须获得用户新的显式、明确批准并隔离 worktree；
   使用独立预算、cleanup 与 rollback；只允许 fresh-proven first-party selector，绝不调用 API/BYOK/on-demand
   pool，也绝不自动 fallback。本轮真实 provider request 固定为 0。

出现官方材料与目标版本实测冲突时，记录冲突并停止晋升；不得猜测兼容性。真实 auth/quota collector、
production invoke/cancel/resume 或 reservation 未落地前，本页不把 `cursor-agent-cli` 宣称为 automatic eligible。

## Related

- Cursor IDE Agent facts：[`cursor.md`](cursor.md)
- compatibility matrix：[`compatibility-matrix.md`](compatibility-matrix.md)
- CLI admission/result partial contract：[`cursor-agent-admission-contract.md`](cursor-agent-admission-contract.md)
- cross-harness capability model：[`../cross-harness-orchestration-capability-model.md`](../cross-harness-orchestration-capability-model.md)
