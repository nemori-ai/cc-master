# Post-fix Codex second-judge result

- endpoint: Codex CLI 0.144.1, `gpt-5.6-sol`, xhigh, read-only, ephemeral
- session: `019f4b1c-1a5b-7570-b1a1-a7f26b6248ac`
- input: unchanged `assertions.md` + exactly three post-fix with-skill transcripts
- no skill/without transcript/other repo file read by judge

| Run | A1 | A2 | A3 | A4 | A5 | Score | Pre-fix |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| post-fix with-1 | PASS | PASS | FAIL | FAIL | PASS | 3/5 | 4/5 |
| post-fix with-2 | PASS | PASS | PASS | PASS | PASS | 5/5 | 4/5 |
| post-fix with-3 | PASS | PASS | FAIL | PASS | PASS | 4/5 | 5/5 |

Overall: `12/15`, versus pre-fix `13/15`。A3 仍为 `1/3`，没有改善；只有 run 2 为 5/5。

严格 A3 failure 原因：

- run 1 虽写 `intent + acceptance` 且同步 affected CONTRACT，但没有逐字表明 Card 的 intent 是
  **host-neutral**、acceptance 是 **testable**；Codex 按“所有合取项有直接证据”判 FAIL。
- run 3 写 Card 与 affected CONTRACT 缺一不可并列出 contract，但没有直接要求 Cards 含
  host-neutral intent + testable acceptance；FAIL。
- run 2 明确复述 `Capability Card 与所有 affected hook CONTRACT 缺一不可`，且要求
  `host-neutral intent、testable acceptance` 后“再谈实现验收”；PASS。

A4 的 run 1 新出现随机 omission：它要求 host-native validation 并拒绝 green projection，但没明确要求
equivalence-class fixture，故 FAIL。这个维度不是本次修复目标，但说明小样本存在真实方差。

## Verdict

本次最小新增段 **未通过其 targeted re-eval**；不能声称它把 A3 从 1/3 提升到 3/3。按既定门有
两条诚实路径：

1. 当前 PR 若要收口：回退这条新增 discipline paragraph，只保留已通过 facts/reference/how-to；或
2. 下一轮不再堆叠 prose，而是**消除原文仍存在的相互竞争形状**：把
   `Capability intent / hook contract` 的 slash 顺序直接替换为一条可执行 Track B gate，并在
   Track B 表格单元里写成 `Capability Card(host-neutral intent + testable acceptance) AND every
   affected hook CONTRACT; implementation blocked until both`。也就是改承重决策表/顺序本身，
   不是旁边再加说明。随后用相同 fixture 重跑。

在下一轮 3/3 前，不建议继续保留本次 paragraph 并宣称“已有评测支持”；它的内容事实正确，但
当前形状没有产生可测一致性提升。
