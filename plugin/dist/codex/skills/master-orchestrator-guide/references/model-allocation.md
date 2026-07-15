# 模型分配与容量动作

先从 `pacing-and-estimation` 的 `references/model-tiers.md` 读取当前 host 已证明可用的模型事实、相对成本、容量 provenance 与不确定性；然后在这里作编排决定。未被证明可用的模型不进入候选集。

## 先判任务，再分模型

同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自当前 host 的已证明候选集。

## Codex 分档

先运行 `ccm provider facts codex --json`，只让 `freshness:"fresh"` 且 `catalog_eligible_for_admission_check:true` 的候选进入下一道检查。静态 snapshot 的 `eligible_for_automatic_selection` 应保持 `false`；只有当前账号 entitlement 与 exact-model admission 另有证据后，orchestrator 才能组合这些事实做分配。按 facts 返回的 tier 与相对成本做映射，不在 skill 中维护 model ID 清单：

| 任务 | 配额充足：效果优先 | 配额紧张：性价比优先 |
|---|---|---|
| 读扫 / grep / 格式化 / 测试重跑 / 机械迁移 | `economy` + medium | `economy` + low/medium |
| 调研摘要 / 常规文档 / acceptance 清楚的常规实现 | `balanced` + high | `economy` + high 或 `balanced` + medium |
| 复杂多文件 / 有状态实现 / 含糊根因 | `frontier` + high/xhigh | `balanced` + high/xhigh；验收失败再升档 |
| 独立 review / 端点验收 / 架构裁决 / 不可逆决策 | `frontier` + max | `frontier` + high；最高风险仍保留 max |

`ultra` 只给能拆成独立 workstreams、且不会与外层 fan-out 重叠的复合目标；不要把它记成 leaf effort。长会话建立后固定已准入 family，省配额靠 leaf 的 tier / effort 分档。Codex 只受 7d 硬边界约束，自动换号永久禁止。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先降低能机械验收的非临界 leaf 档位，不降低高错误代价的裁决与端点验收档位。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

Cursor 与 Codex 自动换号永久禁止；任何模型选择都不得以 API、BYOK、on-demand 或未证明的容量作 fallback。
