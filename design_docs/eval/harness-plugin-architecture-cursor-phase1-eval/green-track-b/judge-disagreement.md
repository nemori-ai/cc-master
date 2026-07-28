# Judge disagreement investigation

Claude first graders 与 Codex second judge 在 30 个 cell 中分歧 6 个（20%）：

| Transcript/assertion | Claude | Codex | 调查结论 |
| --- | --- | --- | --- |
| with-1 A3 | PASS | FAIL | Codex 更符合“所有合取项有直接证据”：Card 段未写 acceptance，CONTRACT 只对 batch 明确。保守取 FAIL。 |
| without-1 A1 | PASS | FAIL | “必须有单一权威结论/裁定版本”不等于按 current evidence reconcile。取 FAIL。 |
| without-2 A1 | PASS | FAIL | “立即裁定口径”未说明证据源。取 FAIL。 |
| without-2 A4 | PASS | FAIL | 一般边界专项测试未要求 equivalence-class fixture + host-native evidence。取 FAIL。 |
| without-2 A5 | FAIL | PASS | “撤销复制，参数化引用规范文本”可视为 canonical + slot 的无歧义等价；取 PASS，但此项仍 non-discriminating。 |
| without-3 A1/A4 | PASS/PASS | FAIL/FAIL | 与前两类相同：二选一不是 evidence reconciliation；专项测试不是双证据。取 FAIL/FAIL。 |

最终判读采用更保守、逐合取项的 Codex cell verdict，不把分歧做多数票或平均。它显示行为有明显
方向性 uplift，但 A3 只有 with 1/3 严格通过，因此不能声称五项纪律都稳定守住。
