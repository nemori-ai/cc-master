# Post-fix Track B with-skill run 1

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- session: `a80155bc-b1db-4849-9e96-9f81fd4002ca`

## Final response

## Merge-readiness 备忘录：Lumen host adapter

**决定：不可合并。** 28 项 mapped-surface green 只是 `sync-plugin-dist` 的 source/dist parity 信号，不是能力等价证据——`plugin-release-system.md` 明确要求 host-native validation，`n-host-capability-parity.md` 明确“生成成功不能单独决定 Track A”，“任一缺失都不能让实现或绿色 projection 代替契约”。当前 patch 至少有一处文档权威性冲突、三处未落 Capability Card 的 Track B 分叉、一处违反 SAP 纪律的正文 fork，均未满足合并门槛。

### 逐项依据

1. **compatibility-matrix.md 与 lumen.md 冲突**：`host-adapter-boundaries.md` 规定“如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base”；`n-host-capability-parity.md` 的 artifact 表也指定 host 支持状态以 `<host>.md` + matrix 联合判断、冲突时按该页证据优先级。当前无人写明冲突裁决，两份文档矛盾本身就是未完成状态，不能合并。

2. **`beforeCondense`（观察-only vs 注入）**：事件名相同、能力不同，正是 `n-host-capability-parity.md` 警告的“事件名…不能单独决定 Track A”。这属于 protocol-capability-gap，需要仿照 `role-substrate-reinject.md` 的既有模式，在对应 Capability Card 里补 Lumen 行 + `Declared divergence`（intent、acceptance、compensating_mechanism），而非直接复用“最接近的实现”。

3. **`stop`（可附加建议 vs 硬阻塞）**：这触及 `stop-continuation-gate.md` 的核心 safety 语义（“block until board state is safe”）。建议无法阻止 turn 结束，与 hard-block 不是同一等价类。必须比照 Cursor 在同一 Card 里的 `stop-hard-block-envelope` divergence 写法，为 Lumen 声明 compensating_mechanism（如 loop_limit / FUSE 替代），并同步锁定 `verify-board/CONTRACT.md`。在此之前不能视为等价通过。

4. **batch-completion 近似（“opportunistic flush”）**：Lumen 无 batch 事件，patch 靠拷贝最近实现凑近似。参照 `usage-pacing-midflight.md` 的 `event-unavailable` 分类先例，需要显式 Capability Card 条目声明该能力降级方式，而不是隐藏在“实现看起来差不多”里。

5. **Skill 正文 fork**：`SKILL.md` 与 `source-to-adapter.md` 都要求 host 需要改正文时用 slot/placeholder，“不要 fork 一份独立正文”；两处路径差异正是 `host-adapter-boundaries.md` 里 Path token 策略要解决的场景（中性 slot + adapter 投影），不构成 `partial_overlay` 的例外条件。当前 fork 违反 SAP 纪律，必须撤回。

### Ordered actions

1. 在 `lumen.md` 写明与 compatibility-matrix 的裁决（依据实测），并回填冲突记录。
2. 为 `beforeCondense`、`stop`、batch-completion 三处分别在对应/新建 Capability Card 补 Track B 条目（intent + acceptance + declared divergence + compensating_mechanism），同步更新 `verify-board` 等受影响 hook 的 CONTRACT.md。
3. 撤回 skill 正文 fork，改为 canonical + `adapters/lumen/strategy.yaml` 的路径 slot 投影。
4. 重跑 projection 与 host-native validation，仅对已补齐契约的等价类标记 green。
5. 若 25 项真等价 surface 与冲突裁决可在时限内独立完成，可考虑先合并这部分，其余三处及 fork 阻塞后续 PR。
