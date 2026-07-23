# Claude first-grader evidence

日期：2026-07-10。六份 transcript 均由全新 Claude Code 2.1.206 / Sonnet / high-effort
session 独立评分；每个 session 只读 `assertions.md` 与一份 transcript。先尝试单 session 读六份的
grader 在 290.108 秒后仍停在 tool-use，人工终止；该次按 unavailable 记，不当作 pass。随后按
transcript 拆成六个独立 grader，均正常返回非空结果。

| Transcript | A1 | A2 | A3 | A4 | A5 | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| with-1 | PASS | PASS | PASS | PASS | PASS | 5/5 |
| with-2 | PASS | PASS | FAIL | PASS | PASS | 4/5 |
| with-3 | PASS | PASS | PASS | PASS | PASS | 5/5 |
| without-1 | PASS | PASS | FAIL | FAIL | PASS | 3/5 |
| without-2 | PASS | FAIL | FAIL | PASS | FAIL | 2/5 |
| without-3 | PASS | PASS | FAIL | PASS | PASS | 4/5 |

统计（run-level pass rate，sample SD，n=3）：

- with: `(1.0, 0.8, 1.0)` → mean `93.33%`, sample SD `11.55pp`。
- without: `(0.6, 0.4, 0.8)` → mean `60.00%`, sample SD `20.00pp`。
- delta: `+33.33pp`；略大于两臂 SD 之和 `31.55pp`，但余量很小，只算方向性信号。

逐 assertion：

| Assertion | With | Without | 备注 |
| --- | ---: | ---: | --- |
| A1 fact status | 3/3 | 3/3 | Claude 将“裁定文档冲突”也视为按证据 reconcile；Codex 对此不同意。 |
| A2 Track A/B | 3/3 | 2/3 | without 常能自行区分语义等价与降级。 |
| A3 Card + CONTRACT | 2/3 | 0/3 | with-2 明确缺 per-hook CONTRACT；with-1 的 Card 未逐字写 acceptance，Claude 仍合并上下文判 PASS。 |
| A4 equivalence + host evidence | 3/3 | 2/3 | Claude 把一般“专项/边界测试”视为 equivalence evidence；Codex 更严格。 |
| A5 canonical + slot | 3/3 | 2/3 | largely non-discriminating；一般工程判断也会拒绝正文 fork。 |

## Direct grader evidence excerpts

- with-1 grader session `04ee47a2-5af8-411b-abee-25f96846f7c5`：A3 PASS，引用“未写卡片前不能标记 parity”与“先有该 hook 的 CONTRACT.md acceptance”。
- with-2 grader session `f4f88510-98e0-4322-bd83-56c927b10fff`：A3 FAIL，“通篇未提及任何 per-hook CONTRACT 文件的更新要求”。
- with-3 grader session `c3e33a74-11f6-409e-a79d-6c4758cf0b31`：5/5；A3 直接引用“Capability Card 的 intent、acceptance……；同步更新相关 hook 的 CONTRACT.md”。
- without-1 grader session `5bea9aa1-7366-4bd8-a96d-e5aeb13dec37`：3/5；A3/A4 FAIL。
- without-2 grader session `2bdd6494-a1f5-45fb-98b6-7e67a44b5bfa`：2/5；A2/A3/A5 FAIL，A4 PASS。
- without-3 grader session `8f2cd9d2-7714-4556-bea0-8fdd276283f8`：4/5；仅 A3 FAIL。

注意：这些 grader 给 A1/A4 的“泛化同义”判得偏宽，故按纪律继续交给完全相同断言与 transcript
的 Codex second judge，并把分歧逐项调查，而不是平均掉。
