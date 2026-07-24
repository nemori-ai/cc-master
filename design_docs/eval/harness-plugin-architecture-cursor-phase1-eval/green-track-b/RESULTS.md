# Phase 1C / Track B evaluation result

日期：2026-07-10。

本页是公开的 decision-grade aggregate。它对应当日工作树中的
`.claude/skills/harness-plugin-architecture/**` delta；原始运行未绑定可复现 commit，执行器
精确版本也未记录，因此这些数字只能解释该次实验，不能冒充当前 HEAD 的持续保证。逐轮
transcript、session metadata、stderr 和 trace 已按
[`design_docs/eval/README.md`](../../README.md) 的公开证据合同移除。

可复核输入保留在：

- [`track-b-case.md`](track-b-case.md)
- [`assertions.md`](assertions.md)
- [`track-b-with-skill-prompt.md`](track-b-with-skill-prompt.md)
- [`track-b-without-skill-prompt.md`](track-b-without-skill-prompt.md)

## 1. Consistency ceiling

同一个 RED scenario 的三个全新 with-skill Claude Sonnet high-effort session 均选择 A，并精确
引用新增的 N-host / Track A-B substrate：`3/3` 强 GREEN。

但 RED baseline 本身也是 `3/3` A，所以 pass-rate delta 为 `0`。这只能支持“repo-specific
一致性与精确 substrate 引用”，不能声称强模型从 fail 变 pass。

## 2. Track B：3×with 与 3×without

第四 host Lumen case 没有泄露 Track A/B、Capability Card、CONTRACT 或 equivalence fixture
等目标术语。两臂看到相同 case；with 额外加载当前 skill/references，without 禁止加载方法论文件。

Codex `gpt-5.6-sol` xhigh 的保守二评结果：

| Arm | Three-run scores | Mean ± sample SD |
| --- | --- | --- |
| with | `4/5, 4/5, 5/5` | `86.67% ± 11.55pp` |
| without | `2/5, 1/5, 2/5` | `33.33% ± 11.55pp` |

方向性 delta 为 `+53.33pp`，大于两臂 sample SD 之和 `23.10pp`。但必须同时记账：

- A5（拒绝 canonical fork）两臂均为 `3/3`，不具区分力；
- A3（Track B 同时要求 Card intent + testable acceptance 与相关 per-hook CONTRACT）with
  仅为 `1/3`；
- Claude split graders 较宽松：with `93.33% ± 11.55pp`，without
  `60.00% ± 20.00pp`；30 个 cell 有 6 个跨 judge 分歧，最终采用更保守的 Codex 判读。

逐项分歧与裁决原则见 [`judge-disagreement.md`](judge-disagreement.md)。

结论：Track B 有明显方向性 uplift，但未满足“五个断言在三个 with run 全稳定通过”的保留门。

## 3. Targeted remediation

第一次最小 prose 修正试图把 Card 与 affected CONTRACT 的合取关系写得更明确：

- post-fix：`3/5, 5/5, 4/5`，总计 `12/15`；
- pre-fix：`4/5, 4/5, 5/5`，总计 `13/15`；
- A3：`1/3 → 1/3`。

该修正没有改善承重断言，判为未通过。

第二次 remediation 替换了承重表格和唯一推进顺序里的 slash competition，而不是继续叠 prose：

- scores：`3/5, 4/5, 5/5`，总计 `12/15`；
- A3：`1/3 → 2/3`，达到预先写定的最低预测，但未达到 `3/3` 稳定门；
- 独立 Codex 二评未在有界窗口内产生可消费 verdict，按 silent-pass-through guard 记为不可用，
  不用自评冒充独立判决。

因此只声称 artifact owner / how-to 形状改善，不声称 Track B 行为门已经稳定全过。

## 4. Track A / description

Track A 测量通道处于已知 positive-recall floor：

- train：`5/10`，五个 near-miss 全部正确不触发，但正例几乎全零；
- sealed holdout：`2/4`，两个 near-miss 正确不触发，正例近乎全零；
- before/after aggregate 不变，没有可归因的 recall uplift。

所以这些数字不可用于宣称 description 准确率改善。完整的定性边界、改前预测和 pre/post 聚合见
[`../phase2-track-a.md`](../phase2-track-a.md)。

## 5. 当时的事实与机械验证

当日评测记录确认：

- 单 hook 业务规则归 `plugin/src/hooks/<hook>/CONTRACT.md`；coverage、stage 和 registration
  归 `_manifest/`；
- Cursor plugin cwd、launcher root、`sessionStart.additional_context` 等 host facts 有本仓
  harness probe / strategy 资料支撑；
- Cursor release 命令与当时的 sync/package 脚本参数一致；
- Cursor IDE plugin 与 Agent CLI/headless automation 是不同 surface，Phase 1 没有从 IDE
  plugin facts 反推 CLI transport。

当时执行并通过：

- `bash scripts/skill-lint.sh`
- `bash scripts/check-plugin-dist-sync.sh`
- Cursor capability / structure tests（`12/12`）
- target skill/reference dead-link scan
- `git diff --check`

这些是历史运行记录，不替代当前 PR 的 CI。

## Final verdict

- consistency ceiling：满足，但强模型 pass-rate delta 为 `0`；
- Track B：存在明显方向性 uplift，A3 最终只到 `2/3`，稳定门未通过；
- facts / scope / delta-only：当时通过；
- 可保留事实、reference 与 how-to 改善；不得把本实验表述为 Track B 全面验证完成。
