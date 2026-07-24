# 配额信号 —— 全机 target 视角 + 信号源链 + 诚实天花板

> **何时读：** 要从任意 origin 看本机所有受支持 harness / surface 的配额窗口、判断信号从哪来、
> `available:false` / `state:"unknown"` 时怎么办，或理解为什么 pacing 只能做方向性走廊时。
> **ccm 出事实与 verdict、你（作为 orchestrator）决策**；本页不执行编排动作。

<a id="ccm-k-point-pacing-machine-wide-first"></a>
<!-- ccm:k:start point:pacing.machine-wide-first -->
## 先全局，再下钻

1. 先读 `ccm quota status --machine-wide --json`。这是 cached-only 的全机视图，不调用 provider；把
   `summary.decisions[]` 按 `target.harness_id + target.surface_id + target.window` 绑定到候选。只有同一 target
   上的 `state`、`freshness`、`reason_codes[]` 与 source 才能组成一份 posture；不要跨 surface 拼接。
2. 选中一个 target 后，再用 `ccm --harness <target> usage show --accounts current --json` 看原始 current
   window，或用 `ccm --harness <target> usage advise --json` 读单侧 verdict。`usage` 是下钻 advisory，
   不是 machine-wide inventory，也不授权 dispatch。
3. `state:"unknown"`、非 fresh、`available:false`、窗口缺失或过期都保持 unknown；不得从 binary 存在、
   已登录、进程 RC0、同品牌另一 surface 或历史 snapshot 推断为 healthy。

完整 flags 与 JSON schema 查 `using-ccm`；不要在这里复制 provider CLI 参数。

<!-- ccm:k:end point:pacing.machine-wide-first -->
<!-- ccm:k:nav:start point:pacing.machine-wide-first -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.signals](../../../knowledge/modules/pacing.signals.md#ccm-k-module-pacing-signals)
- [next: 六 estimate verb 消费映射](./estimation.md#ccm-k-point-pacing-estimate-verbs)
- [next: refresh_hint 恢复边界](./usage-signals.md#ccm-k-point-pacing-refresh-hint)
- [next: selected target 事实绑定](./cross-harness-target-facts.md#ccm-k-point-pacing-selected-target-facts)
- [deepens_to: 四类 harness 窗口合同](./usage-signals.md#ccm-k-point-pacing-window-contracts)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-pacing-refresh-hint"></a>
<!-- ccm:k:start point:pacing.refresh-hint -->
## `available:false` 且带 `refresh_hint`：短命 token 的恢复边界

`usage advise` / `usage show` 返回 `available:false` 且 `refresh_hint.recoverable:true` 时，不是配额真耗尽，
而是该 harness 的短命 token 过期、usage 信号暂时读不到。Kimi 是明确例外：collector 默认可在相邻锁内重读
并刷新 Kimi 自己存储的 OAuth，再原子发布旋转后的 token pair；只有自动刷新失败后才返回 harness-native hint。
其余 provider 仍是只读 / 提示式恢复。别把它当 `stop_*` 处理——照 `refresh_hint` 恢复：运行 `refresh_hint.command` 让该 harness 自行刷新
token（完整人读步骤在 `refresh_hint.remedy`），再重跑 `refresh_hint.recheck` 确认信号回来。`recoverable:false`
（网络 / 401 / API 变更）时 `command` / `remedy` 为 `null`，不是你能就地修的，按普通 unknown 处理、不推断为
healthy。无论哪条路径，ccm 都不输出 token；Kimi 以外不替 provider 刷新或写凭证。

<!-- ccm:k:end point:pacing.refresh-hint -->
<!-- ccm:k:nav:start point:pacing.refresh-hint -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.signals](../../../knowledge/modules/pacing.signals.md#ccm-k-module-pacing-signals)
- [routes_to: 先全局再下钻](./usage-signals.md#ccm-k-point-pacing-machine-wide-first)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-pacing-window-contracts"></a>
<!-- ccm:k:start point:pacing.window-contracts -->
## 四类 harness 的窗口与独立池合同

| target | 承重窗口 | 信号语义 |
|---|---|---|
| Claude Code `claude-cli` | `five_hour` + `seven_day` | 两个窗口各自绑定 statusline sidecar 的当前登录态；账号 registry snapshot 只是历史弱信号 |
| Claude Code `claude-fable-*-cli` | `seven_day` | Fable 的 7d 是独立 target / bucket；不可与 `claude-cli` 的通用 7d 相加或互补 |
| Codex `codex-cli` | **仅 `seven_day`** | app-server 的 7d 是唯一 hard pacing 窗口；任何 5h 字段只保留为 ignored provenance，不得触发 throttle / switch / stop / reset / wakeup |
| Cursor `cursor-ide-plugin` | `billing_period` + `billing_period_usage_based` | IDE 当前登录态内，first-party（total / Auto）与 usage-based（API / spend limit）是两个独立、不互补的池 |
| Cursor `cursor-agent-cli` | `billing_period` + `billing_period_usage_based` | Agent CLI 当前登录态内，同样分别保留 first-party 与 usage-based 两池；只适用于 Agent surface |
| Kimi Code `kimi-cli` | `five_hour` + `seven_day` | `kimi-usages-api` 读取当前登录态的两个独立滚动窗口；过期 stored OAuth 可先走带锁自动刷新 |

Cursor 两条 surface 即使可能观察到同一订阅，也必须分别保留 target / source / freshness；一条可用不证明另一条
可用。同一 surface 内 first-party 与 usage-based 也不是可相加或可互补的容量：machine-wide target 分开投影，
`usage show` 则在兼容的 `billing_period` 之外用 named pools 保留原始分池事实。
Codex 的 rolling-24h（若另有足够样本导出）只能提示相对 7d 平均日预算的 burn risk，不能成为第二个 hard window。

<!-- ccm:k:end point:pacing.window-contracts -->
<!-- ccm:k:nav:start point:pacing.window-contracts -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.signals](../../../knowledge/modules/pacing.signals.md#ccm-k-module-pacing-signals)
- [routes_to: 先全局再下钻](./usage-signals.md#ccm-k-point-pacing-machine-wide-first)
- [requires: 信号诚实天花板](./usage-signals.md#ccm-k-point-pacing-signal-ceiling)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-pacing-signal-ceiling"></a>
<!-- ccm:k:start point:pacing.signal-ceiling -->
## 信号源与诚实天花板

- machine-wide `readings[]` 暴露 target、`used_percentage`、reset / observation / validity 时间与 source；
  unavailable / expired reading 另带可选 `refresh_hint`，先读其中的 `agent_authorized` / `authorization` 再决定
  是否执行 `command`。`summary.decisions[]` 是它的 agent-safe posture。它们不证明模型 entitlement，也不替代
  quota preflight 的 authority-bound spawn limit。
- `usage show` 的统一窗口都位于 `data.current.{five_hour,seven_day,fable_seven_day,billing_period}`，named pools
  位于 `data.current.pools[]`；不适用或不可得为 `null` / 空数组。**不要读取不存在的 `data.five_hour` 等顶层
  窗口。**`data.agent_summary` 是一句 plain-language 状态 + 可执行动作，`data.refresh_hint` 是结构化恢复提示；
  两者都在 `current` 外的 `data` 顶层。`accounts[]` 不把 current signal 的 `available` 点亮。
- 这些信号给百分比与 reset，不给绝对 token 分母；因此只能表达压力方向、强度与重判时间，不能承诺把
  used% 精确收敛到某点。
- 账户级 pacing 与 per-node observability 正交。task token / duration / tool uses 来自对应后台任务的真实
  telemetry；不要用并发期间的账户级 delta 反推单节点成本。
<!-- ccm:k:end point:pacing.signal-ceiling -->
<!-- ccm:k:nav:start point:pacing.signal-ceiling -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.signals](../../../knowledge/modules/pacing.signals.md#ccm-k-module-pacing-signals)
- [routes_to: 先全局再下钻](./usage-signals.md#ccm-k-point-pacing-machine-wide-first)
- [next: 只在上界收紧](./pacing-levers.md#ccm-k-point-pacing-upper-bound-only)
<!-- ccm:k:nav:end -->
