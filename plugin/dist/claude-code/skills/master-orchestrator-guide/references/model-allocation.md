# 模型分配与容量动作

先从 `pacing-and-estimation` 的 `references/model-tiers.md` 读取当前 host 已证明可用的模型事实、相对成本、容量 provenance 与不确定性；然后在这里作编排决定。未被证明可用的模型不进入候选集。

## 先判任务，再分模型

同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自当前 host 的已证明候选集。

## Claude Code 分档

- 机械读扫、格式化与有强机械闸的窄叶子用 Haiku。
- 调研摘要与常规文档用 Sonnet。
- 难实现、correctness-critical、复杂并发根因与常规 review 用 Opus。
- 高杠杆独立 review、端点验收、架构仲裁与不可逆裁决用当前可用的最强裁决档；Fable 不可用时改投 Opus 4.8。

长会话主线固定一个模型以保 prompt cache；省配额靠 leaf 分档，不靠中途切主线 `/model`。subagent 有独立 cache，按每个 subagent 的任务分档。不同家族二审只用于高杠杆验收，并持续记录分歧率校准收益。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先降低能机械验收的非临界 leaf 档位，不降低高错误代价的裁决与端点验收档位。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

Cursor 与 Codex 自动换号永久禁止；任何模型选择都不得以 API、BYOK、on-demand 或未证明的容量作 fallback。
