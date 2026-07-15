# 模型分配与容量动作

先从 `pacing-and-estimation` 的 `references/model-tiers.md` 读取当前 host 已证明可用的模型事实、相对成本、容量 provenance 与不确定性；然后在这里作编排决定。未被证明可用的模型不进入候选集。

## 先判任务，再分模型

同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自当前 host 的已证明候选集。

## Codex 分档

| 任务 | 配额充足：效果优先 | 配额紧张：性价比优先 |
|---|---|---|
| 读扫 / grep / 格式化 / 测试重跑 / 机械迁移 | Luna medium | Luna low/medium |
| 调研摘要 / 常规文档 / acceptance 清楚的常规实现 | Terra high | Luna high 或 Terra medium |
| 复杂多文件 / 有状态实现 / 含糊根因 | Sol high/xhigh | Terra high/xhigh；验收失败再升 Sol |
| 独立 review / 端点验收 / 架构裁决 / 不可逆决策 | Sol max | Sol high；最高风险仍保留 Sol max |

`ultra` 只给能拆成独立 workstreams、且不会与外层 fan-out 重叠的复合目标；不要把它记成 leaf effort。主线通常从 Sol medium 起步；配额紧张且目标边界清楚时可用 Terra medium/high。长会话建立后固定 family，省配额靠 leaf 的 family / effort 分档。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先降低能机械验收的非临界 leaf 档位，不降低高错误代价的裁决与端点验收档位。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

Cursor 与 Codex 自动换号永久禁止；任何模型选择都不得以 API、BYOK、on-demand 或未证明的容量作 fallback。
