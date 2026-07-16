# 配额信号 —— 全机 target 视角 + 信号源链 + 诚实天花板

> **何时读：** 要从任意 origin 看本机所有受支持 harness / surface 的配额窗口、判断信号从哪来、
> `available:false` / `state:"unknown"` 时怎么办，或理解为什么 pacing 只能做方向性走廊时。
> **ccm 出事实与 verdict、你（作为 orchestrator）决策**；本页不执行编排动作。

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

## 三路窗口合同

| target | 承重窗口 | 信号语义 |
|---|---|---|
| Claude Code `claude-cli` | `five_hour` + `seven_day` | 两个窗口各自绑定 statusline sidecar 的当前登录态；账号 registry snapshot 只是历史弱信号 |
| Codex `codex-cli` | **仅 `seven_day`** | app-server 的 7d 是唯一 hard pacing 窗口；任何 5h 字段只保留为 ignored provenance，不得触发 throttle / switch / stop / reset / wakeup |
| Cursor `cursor-ide-plugin` | `billing_period` | IDE 当前登录态的账期信号，只适用于 IDE surface |
| Cursor `cursor-agent-cli` | `billing_period` | Agent CLI 当前登录态的独立账期信号，只适用于 Agent surface |

Cursor 两条 surface 即使可能落到同一订阅池，也必须分别保留 target / source / freshness；一条可用不证明另一条可用。
Codex 的 rolling-24h（若另有足够样本导出）只能提示相对 7d 平均日预算的 burn risk，不能成为第二个 hard window。

## 信号源与诚实天花板

- machine-wide `readings[]` 暴露 target、`used_percentage`、reset / observation / validity 时间与 source；
  `summary.decisions[]` 是它的 agent-safe posture。它们不证明模型 entitlement，也不替代 quota preflight 的
  authority-bound spawn limit。
- `usage show` 的统一窗口都位于 `data.current.{five_hour,seven_day,billing_period}`；不适用或不可得为
  `null`。`accounts[]` 不把 current signal 的 `available` 点亮。
- 这些信号给百分比与 reset，不给绝对 token 分母；因此只能表达压力方向、强度与重判时间，不能承诺把
  used% 精确收敛到某点。
- 账户级 pacing 与 per-node observability 正交。task token / duration / tool uses 来自对应后台任务的真实
  telemetry；不要用并发期间的账户级 delta 反推单节点成本。
