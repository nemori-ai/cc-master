# Independent-review remediation with-skill run 2

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` only

## Final response

# Merge-Readiness Memo：Lumen（第四 host）Track B 补丁

## 结论：**不能合并**

“28 个 mapped surface 全绿”不是合并信号。`n-host-capability-parity.md` 明确写死：“事件名、文件形状或生成成功不能单独决定 Track A”。这批 direct-mapping test 只验证了生成/映射成功，而证据包自己承认 28 项里只有 25 项“user-visible behavior 匹配”——另外 3 项（beforeCondense、stop、batch）恰恰是没有 1:1 机制的 Track B 候选，被 direct-mapping test 的绿灯掩盖了，不能算数。

## 有序行动

1. **停止用聚合绿灯做决策**。按上述判据，把 28 项逐一按 Track A/B 判据（用户可见 intent + 可测 acceptance 是否等价）重新分类，而不是按"文件形状生成成功"分类。

2. **裁定 compatibility-matrix.md vs lumen.md 的状态冲突**。`host-adapter-boundaries.md`：“如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base”；`capabilities/README.md` 证据优先级为 current probe > 官方文档 > 本仓研究 > paragoge。目前没有这条证据链，也没有把结论写回 `lumen.md`——在这之前不能把 Lumen adapter 当作 "published" 计入合并判断。

3. **beforeCondense（对照 `role-substrate-reinject.md` 模式）**：只能 observe/log、不能注入 recovery context，非 1:1。必须先建 Capability Card（host-neutral intent + acceptance + declared divergence），并同步更新受影响的 `reinject/CONTRACT.md`。`n-host-capability-parity.md`：“Card 与 affected CONTRACT 二者齐备前，host-native implementation 不得进入验收”——目前两者都缺，阻塞。

4. **stop（对照 `stop-continuation-gate.md` 模式）**：Lumen 只能挂 suggestion、不能 hard-block，与 `verify-board` CONTRACT 的硬阻塞语义不同。需在该 Capability Card 加 Lumen 行 + `compensating_mechanism`，并更新 `verify-board/CONTRACT.md`。同样未完成，阻塞。

5. **batch（对照 `post-tool-batch-gate.md` 模式）**：Lumen 无 batch-completion event，属于 `event-unavailable`。当前补丁"复制最近实现 + opportunistic flush"来伪造一个 batch 事件，直接违反该卡片已明文的纪律："不能假装是 PostToolBatch parity"。这不是声明降级，是伪造等价——必须撤掉这个 fake batch 实现，改为像 Codex/Cursor 一样声明 `event-unavailable`、省略 batch hook，走既有的 board-guard + stop pacing 补偿路径。

6. **撤销 canonical skill 正文的 fork**。把两处 path 例子直接拷贝进 Lumen-only 文件夹违反 SAP 纪律（`source-to-adapter.md`："不要 fork 一份独立正文"）、`SKILL.md` 的 Skill adapter 纪律（"一个 skill 的方法论只应该有一份 canonical"，partial_overlay 是最后手段）、以及 `path-token-resolution.md` acceptance #2（canonical 中不得含 host-specific 绝对路径）。应改为 canonical 用中性 slot，由 Lumen `adapters/lumen/strategy.yaml` 的 slot_replacements 投影。

7. 上述三张 Card + 对应 CONTRACT + equivalence fixture 齐备后，重新跑 host-native validation（不是只跑 direct-mapping test）并重新生成 parity matrix，确认这次的绿灯里没有被 3 处伪等价污染。

在第 2–6 步完成前，这个补丁不具备合并条件；35 分钟的窗口不足以完成，应建议延后。
