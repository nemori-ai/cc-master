# N-host 能力对齐

## 先分 execution surface

`design_docs/harnesses/cursor.md` 当前记录的是 **Cursor IDE Agent plugin runtime**：manifest、skills、
commands、rules、hooks、安装与 IDE 内 dispatch。Cursor Agent CLI / headless one-shot worker 是另一条
execution surface；它的 invocation、structured result、cancel、permission、模型/配额与 provider routing
契约留给 cross-harness orchestration Phase 2。不要用 IDE hook/plugin 事实替代 CLI transport 事实。

若能力要进入运行 master 的 origin plugin——例如 cached machine context landing、host-native attempt
invoke/bind 或跨 session attention——读 [`cross-harness-origin-integration.md`](cross-harness-origin-integration.md)。
它只覆盖 origin adapter；same-harness 与 other-harness CLI/headless 都回到 tracked
`design_docs/cross-harness-orchestration-capability-model.md` 的 provider/runtime contract，实现按普通
engineering / dev loop 推进，不因品牌相同而回流本 skill。

## 两条适配轨道

ADR-031 把新增 host 的能力适配分为两轨：

| 轨道 | 判据 | 主要落点 | 验收 |
| --- | --- | --- | --- |
| Track A | 目标 host 有可表达同一规则的原生 surface | SAP/PHIP strategy、hook `CONTRACT.md`、host-native implementation | 同一 contract 的 equivalence-class fixture + host-native dist |
| Track B | 目标 host 没有 1:1 机制，或能力跨 hooks / commands / skills / ccm | Capability Card（host-neutral intent + testable acceptance）；若触及 hook，**同时**更新所有 affected hook `CONTRACT.md` | Card 与 affected CONTRACT 二者齐备前，host-native implementation 不得进入验收；齐备后按共享等价类 + per-surface strategy 验收 |

事件名、文件形状或生成成功不能单独决定 Track A。以用户可见 intent 和可测试 acceptance 是否等价
为准；`event-unavailable`、`protocol-capability-gap`、`host-convention-divergence` 的分类与字段以
`design_docs/harnesses/capabilities/README.md` 和 ADR-031 为准。

## Artifact 路径

| 要回答的问题 | SSOT / 证据 |
| --- | --- |
| 目标 host 当前到底支持什么 | `design_docs/harnesses/<host>.md` + compatibility matrix；冲突时按该页证据优先级 |
| 跨 surface 的用户可见能力是什么 | Capability Card 的 intent + acceptance |
| 单个 hook 必须遵守哪些业务规则 | `plugin/src/hooks/<hook>/CONTRACT.md` |
| 哪些 host 必须覆盖、当前是什么状态 | hook / command manifest 的 `host_coverage` + per-host strategy |
| Track B 用什么机制补偿 | Capability Card 的 declared divergence + `compensating_mechanism` |
| 实现是否兑现同一能力 | equivalence-class fixture、host-native probe / validator、生成后的 `plugin/dist/<host>` |

典型推进顺序是：权威 host fact → Track A / Track B 分类 → Track B 先写 Capability Card
（host-neutral intent + testable acceptance），若触及 hook 则同时更新所有 affected hook `CONTRACT.md`
→ equivalence fixture → host-native implementation / strategy → projection → host-native validation。Card 与
affected CONTRACT 是同一 Track B gate 的两份必需证据；缺任一就阻塞 implementation acceptance。

## N+1 host 的 touch set

新增 host 时至少逐项盘点：

- `plugin/src/skills/_hosts/<host>/` 与每个分发 skill 的 strategy；
- `plugin/src/hooks/_hosts/<host>/`、hook manifest coverage、相关 CONTRACT 与 implementation；
- command manifest coverage 与 per-command strategy；
- host-native manifest、rules / agents 等该 host 独有 surface；
- projection、dist、package 与 install / upgrade 路径；
- Capability Cards、generated parity matrices、equivalence fixtures 与真实 host probe。

Cursor 当前已是已发布第三 host，不再把它当“未来 sketch”。其真实剩余 IDE 验收缺口以
`design_docs/harnesses/cursor.md` 的 delivery record 为准；不要把待补 fixture / dogfood 写成整个 adapter
尚未实现，也不要把已生成的 adapter 误写成能力等价已经全部验证。
