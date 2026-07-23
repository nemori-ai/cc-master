# Codex second-judge evidence

- endpoint: Codex CLI 0.144.1
- model: `gpt-5.6-sol`, `model_reasoning_effort=xhigh`
- sandbox: read-only, ephemeral, ignore user config/rules
- session: `019f4b11-390c-7771-b1ff-fed409af0c89`
- input: exactly the same `assertions.md` and six transcript files used by the Claude graders
- scope: did not read the skill or other repository files

| Transcript | A1 | A2 | A3 | A4 | A5 | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| with-1 | PASS | PASS | FAIL | PASS | PASS | 4/5 |
| with-2 | PASS | PASS | FAIL | PASS | PASS | 4/5 |
| with-3 | PASS | PASS | PASS | PASS | PASS | 5/5 |
| without-1 | FAIL | PASS | FAIL | FAIL | PASS | 2/5 |
| without-2 | FAIL | FAIL | FAIL | FAIL | PASS | 1/5 |
| without-3 | FAIL | PASS | FAIL | FAIL | PASS | 2/5 |

统计（Codex 原始输出）：

- with: `(0.8, 0.8, 1.0)` → mean `86.67%` (`13/15`), sample SD `11.55pp`。
- without: `(0.4, 0.2, 0.4)` → mean `33.33%` (`5/15`), sample SD `11.55pp`。
- with-minus-without: `+53.33pp`，大于 SD 之和 `23.10pp`。
- 唯一完全 non-discriminating assertion：A5（两臂均 3/3）。

逐 assertion：

| Assertion | With | Without | Delta |
| --- | ---: | ---: | ---: |
| A1 | 3/3 | 0/3 | +100pp |
| A2 | 3/3 | 2/3 | +33.33pp |
| A3 | 1/3 | 0/3 | +33.33pp |
| A4 | 3/3 | 0/3 | +100pp |
| A5 | 3/3 | 3/3 | 0pp |

## Direct verdict evidence

- with-1 A3 FAIL：Card 写了 host-neutral intent/divergence/compensation，且另处写 CONTRACT acceptance，
  但 Card 本身未明确 `acceptance`，不满足断言的全部合取项。
- with-2 A3 FAIL：Card 明确含 intent/acceptance/divergence/compensation，但未要求更新相关 per-hook CONTRACT。
- with-3 A3 PASS：逐字包含“Capability Card 的 intent、acceptance……；同步更新相关 hook 的 CONTRACT.md”。
- without A1 全 FAIL：都只说“裁定/二选一”文档口径，没有要求按 current evidence 先 reconcile。
- without A4 全 FAIL：一般专项测试不等于同时要求 equivalence-class fixture 与 host-native evidence。
- A5 全 PASS：六份都拒绝 canonical fork，并提出共享源/参数化/slot 类替代；因此此 fixture 上 A5 零 uplift。

Codex final output token count reported `35,642`。结果非空、确实逐份读取了 assertions/transcripts，
故 second-judge 端点有效。
