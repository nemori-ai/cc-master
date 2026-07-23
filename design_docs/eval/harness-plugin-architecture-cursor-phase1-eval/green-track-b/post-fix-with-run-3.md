# Post-fix Track B with-skill run 3

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- session: `a813a2c5-49f8-48da-9dd7-0e2e08d93aee`

## Final response

## 判定

**当前 patch 不可合并。** “28 mapped surfaces green” 和 “25 surfaces matching” 只是 source/dist projection 同步与 direct-mapping 测试的信号（`plugin-release-system.md` Drift 防线 / `sync-plugin-dist.sh` + `check-plugin-dist-sync.sh`），不是能力等价验收。`n-host-capability-parity.md` 的 Artifact 表明确写着“实现是否兑现同一能力”要看 equivalence-class fixture + host-native probe/validator；`plugin-release-system.md` 也直白写明“能力等价…不能用 package shape 替代”。证据包里至少三处是被这个绿色信号掩盖的真实 Track B 缺口，外加一处文档冲突和一处 SAP 违规，逐条构成合并阻断项。

## 按序处理

1. **先冻结“published”结论**：`compatibility-matrix.md` 与 `lumen.md` 状态互相矛盾。按 `host-adapter-boundaries.md`：“文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base。”证据包里没有给出真实探测证据，我不能替 Lumen 编造一个 probe 结果；要求作者把实测证据补进 `lumen.md` 的机制事实/风险记录（`plugin-release-system.md` 规定每个 host 至少要有这一份），在此之前 `compatibility-matrix.md` 不得写“已发布”。

2. **beforeCondense 只能观测不能注入** → 归类 Track B，落点是 `role-substrate-reinject.md`（与 Cursor 的 `precompact-observe-core.js` 分层替代同形状）：新增 Lumen host row + `declared divergence`（`kind: protocol-capability-gap` + `compensating_mechanism`），并同步更新 `plugin/src/hooks/reinject/CONTRACT.md`。`n-host-capability-parity.md`：“Card 与所有 affected hook 的 CONTRACT.md 缺一不可”——两者现在都不存在，此项不能算绿。

3. **stop 只能给 suggestion 不能硬阻断** → 归类 Track B，落点 `stop-continuation-gate.md`（与 Cursor `followup_message` 分层替代同形状）：加 Lumen row + divergence block，并更新 `plugin/src/hooks/verify-board/CONTRACT.md`。同一条“缺一不可”规则同样卡住合并。

4. **无 batch-completion 事件、靠拷贝最近实现“opportunistic flush”凑批处理** → 归类 Track B，落点 `post-tool-batch-gate.md`（`event-unavailable`，与 Codex/Cursor 一致）。该卡片已有的 `compensating_mechanism` 明确写“必须不能假装是 PostToolBatch parity”——当前 patch 恰好在做这件被明令禁止的事，需回退到已定义的补偿路径（board-guard + stop-side pacing）而不是新造一个近似批处理。

5. **正文被直接 fork 到 Lumen-only 文件夹**：违反 `source-to-adapter.md` 的 SAP 规则——“如果 host 需要改正文，优先用 slot/placeholder 或明确 patch，不要 fork 一份独立正文”，以及 `SKILL.md` 的纪律“一个 skill 的方法论只应该有一份 canonical”、`partial_overlay` 是最后手段。两处路径示例这种差异正是 `path-token-resolution.md` 已经给出标准解法（`adapters/<host>/strategy.yaml` 的 `slot_replacements`），必须改用它并撤掉那份 fork 正文。

6. 完成 2–5 后，针对三张新增/更新的 Capability Card 跑 equivalence-class fixture + 真实 Lumen probe，再重跑 parity job，才允许重新提交合并请求。

时间不够时，建议先只合并已验证 1:1 的 Track A surfaces 解锁分支，Track B 部分单独走后续 PR，不用绿色 parity job 数字替代上述缺失的契约文档。
