**查询结果摘要：**
- `harness list`：`cursor-agent-cli` 已安装且已认证，但 eligibility 明确标注 `automatic:false`，blockers 为 `model-unknown`、`quota-unknown`。
- `provider facts cursor`：catalog 快照 fresh，但 `eligible_for_automatic_selection:false`，blockers 为 `live-entitlement-unknown`、`exact-model-admission-unknown`——fresh 不等于 live entitlement 或 exact-model admission。
- `quota status`：仅 `available:true`，只证明 owner-only quota store 可读，**不等于 ample headroom**。
- 未提供任何 committed `quota preflight` 引用（`source_key`/`reservation_id`/`checked_at`），因此无法核验 `decision`、`automatic_spawn_limit`、`blocking_reasons`，缺 authority reference 即不可授权 spawn。

三项承重事实（model admission、quota headroom、authority-bound preflight）均为 unknown 或缺失，按 fail-closed 原则不得派发。

**DO_NOT_DISPATCH** — 目标 Cursor Agent CLI worker 缺少 committed quota preflight 引用及 exact-model admission 证据，model/quota 均处于 unknown 状态，付费调用未获得已核验的 authority 授权，故不可派发。

补充说明：
- 当前 origin harness（Codex）**不是** worker-selection 边界本身——真正的边界是 selected target 的 surface/model/quota 证据是否完整、可核验，而非发起请求所在的 harness 品牌或身份。
- 同源（same-origin）worker **不能**使用更弱的证据闸：无论目标 worker 与当前 origin 是否同品牌、同登录身份，只要涉及付费调用，都必须满足同一套 committed authority-bound preflight 要求；origin-local 信号不能替目标 worker 补证。