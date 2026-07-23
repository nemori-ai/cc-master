# Phase 1C independent evaluation result

日期：2026-07-10。评测者未编辑任何 tracked 文件；本目录全部位于 gitignored
`design_docs/plans/`。被测 delta 是工作树当时最新的
`.claude/skills/harness-plugin-architecture/**`，含单 hook `CONTRACT.md` 与 `_manifest/`
路由矛盾修正。

## 1. Consistency-ceiling GREEN

同一个 `red-scenario.md`，三个全新 with-skill Claude Sonnet high-effort session；每轮都显式读取
当前 `SKILL.md` 与全部五个 references。

| Run | Choice | 精确引用新增 N-host/Track A-B | Card + CONTRACT 顺序 | Cursor IDE vs CLI scope | Green projection 不等于 parity |
| --- | --- | --- | --- | --- | --- |
| 1 | A | yes | yes | 通过当前 Cursor-specific reference substrate | yes |
| 2 | A | yes | yes | 通过当前 Cursor-specific reference substrate | yes |
| 3 | A | yes | yes | 通过当前 Cursor-specific reference substrate | yes |

结论：**3/3 强 GREEN，满足 consistency ceiling**。它不改变 RED 也是 3/3 A 的事实，因此
pass-rate delta 仍为 0；价值只可表述为 repo-specific 一致性与精确 substrate 引用，不能声称
强模型 fail→pass。完整 transcript：`green-run-{1,2,3}.md`。

## 2. Track B 3×with + 3×without

新 Lumen 第四 host case 没有 A/B/C 选项，也没有在题面泄露 Track A/B、Capability Card、CONTRACT、
equivalence fixture 等目标术语。两臂看到完全相同 case；with 额外明确提供当前 skill/references，
without 明确禁止读取任何方法论文件。

### Second-judge conservative result

Codex `gpt-5.6-sol` xhigh 对完全相同 assertions + transcripts 的严格结果：

- with: `4/5, 4/5, 5/5` → `86.67% ± 11.55pp`。
- without: `2/5, 1/5, 2/5` → `33.33% ± 11.55pp`。
- delta: `+53.33pp`，大于两臂 sample SD 之和 `23.10pp`，是方向清晰的行为信号。
- A5（拒绝 canonical fork）两臂均 `3/3`，是 **non-discriminating**，不得计入 skill 独有效果叙事。
- A3（Track B 同时要求 Card intent+acceptance 与相关 per-hook CONTRACT）with 仅 `1/3`，是当前唯一
  承重一致性缺口。

Claude split graders 更宽松：with `93.33% ± 11.55pp`，without `60.00% ± 20.00pp`，delta
`+33.33pp`，只略大于 SD 之和。30 个 cell 中有 6 个跨家族分歧；逐项调查后采用更保守的 Codex
判读。详情：`claude-first-grades.md`、`codex-second-grades.md`、`judge-disagreement.md`。

结论：**Track B 显示强方向 uplift，但未满足“五个断言在 3 个 with run 全稳定通过”的保留门。**

## 3. 需要的最小 prose 修正

不需要回退整段 N-host / Cursor scope 内容，也不需要新增 Rationalization Table / Red Flags。
需要把这一处二义性收紧：

- 现有 `n-host-capability-parity.md` 的顺序写作 `Capability intent / hook contract`，两次 with run
  分别漏掉 Card 的 `acceptance` 或漏掉相关 per-hook CONTRACT，说明 `/` 被读成可替代产物。
- 最小修正应明确：**Track B 触及 hook 时，Capability Card 与 affected hook CONTRACT 二者缺一不可；
  Card 必须含 host-neutral intent + testable acceptance；所有 affected hook CONTRACT 必须在接受
  host-native implementation 前同步更新；缺任一即阻塞。**
- 修正后只需重跑本 Track B case 的 3×with 与 Codex 二评；without 可保留当前 baseline，除非 case/
  assertions 被改动。

若不做这条修正，按 `phase1-plan.md` §6–§8 的门，纪律 prose 不应以“Track B 已全过”合入；可以
保留事实/reference/how-to delta，但必须如实标注纪律一致性未完成。

## 4. Track A / description

已有日志显示测量通道仍处 documented floor：

- train：`5/10`，全部五个 near-miss 正确不触发，但 should-trigger 正例几乎全 0。
- sealed holdout：`2/4`，两个 near-miss 正确不触发；两个正例分别 `0/3`、`1/3`。
- pre-change 也为 `5/10`，且一次 runner 还出现 `claude` not found；没有可用数字支持 before/after
  uplift。

因此 Track A 数字 **不可用，不判 description 通过或退化**。独立定性 review 认为当前 description
的正向职责与四个 near-miss 边界清晰，尤其正确排除 projection-only、release-only、skill-body-only
和不改 plugin adapter 的 headless worker transport；可保留，但不得引用 5/10、2/4 声称准确率提升。

## 5. Facts / scope / delta-only review

### Facts

- 单 hook 业务规则 → `plugin/src/hooks/<hook>/CONTRACT.md`；coverage/stage/registration →
  `_manifest/`，与 ADR-031 和当前仓库形状一致。
- Cursor 3.10.20 plugin cwd、launcher `__dirname` + `CC_MASTER_PLUGIN_ROOT`、D4
  `sessionStart.additional_context` bug 均有 `cursor.md` probe 与 `_hosts/cursor/strategy.yaml` 支撑。
- Cursor release commands 与实际脚本参数一致：`sync-plugin-dist.sh --host cursor`、
  `package-plugin.sh --host cursor <tag>` 均支持；package allowlist 包含 manifest、commands、rules、
  skills、hooks/launcher。
- Cursor 官方资料把 IDE plugins 与 Agent CLI/headless automation 分成独立 surface；官方 CLI 文档
  明确 `-p`、JSON/stream-json 等 headless contract，因此 Phase 1 不从 IDE plugin facts 反推 CLI
  transport 是正确边界。
- 官方 plugin/change-log 说明 plugin 可打包 skills/subagents/hooks/rules；未发现与
  `claude plugin validate` 对等的 documented Cursor validator 命令。当前 reference 用本仓 sync、
  content tests、package 与真实 IDE probe 构成门，表述诚实。

官方核对入口：

- https://docs.cursor.com/en/cli/headless
- https://docs.cursor.com/en/cli/reference/output-format
- https://cursor.com/changelog/2-5
- https://forum.cursor.com/t/sessionstart-hook-additional-context-is-never-injected-into-agents-initial-system-context/158452

### Scope / delta-only

- delta 集中于 1 个新增 51-line reference、SKILL 路由少量增量、三个现有 reference 的 Cursor/N-host
  pointer/how-to；没有整篇重写，没有 Rationalization/Red Flags 伪造。
- 没把 Agent CLI invocation/model/quota/provider routing 提前塞进 Phase 1，只写 scope fence，符合两阶段拆分。
- Cursor facts 摘要保留了回指 `cursor.md` / Capability Cards，没有复制整张事实表成为第二 SSOT。
- release-specific 命令只进入已有 `plugin-release-system.md`，没有污染主 SKILL 工作流。

## 6. Mechanical verification

- `bash scripts/skill-lint.sh`：36 SKILL，0 violations；glossary 0 drift。
- `bash scripts/check-plugin-dist-sync.sh`：Claude Code / Codex / Cursor 全同步。
- Cursor capability/structure tests：12/12 pass。
- target skill/reference dead-link scan：0 dead links。
- `git diff --check`：pass。

## Final verdict

- consistency ceiling：**满足**（3/3 强 GREEN）。
- Track B uplift：**存在且明显**，但 A3 只 1/3 严格通过，当前纪律门 **未完全满足**。
- facts/scope/delta-only：**通过，无整段回退项**。
- 合入建议：先补“Card intent+acceptance AND all affected hook CONTRACTs”这一条最小硬规则并重跑
  3×with + Codex；若不补，则只保留 reference/facts/how-to，不能把当前 discipline delta 宣称已验证完成。

## 7. Targeted post-fix rerun

维护者随后按上述建议新增了最小 paragraph，明确 Track B 触及 hook 时 Card 与所有 affected hook
CONTRACT 缺一不可，并写出 host-neutral intent + testable acceptance。case、五断言、without baseline
均未改变，只重跑 3×with + Codex。

- post-fix scores：`3/5, 5/5, 4/5` = `12/15`。
- pre-fix scores：`4/5, 4/5, 5/5` = `13/15`。
- A3：pre `1/3` → post `1/3`，**无改善**。
- A4 另有一次随机 omission，显示此 3-run 小样本仍有方差。

因此 targeted fix **未通过**。最终建议更新为：当前轮回退这条新 discipline paragraph，保留
facts/reference/how-to；若下一轮继续迭代，先删除/替换原有 `Capability intent / hook contract` 的
slash 竞争形状，把 AND gate 直接写进 Track B 表格与唯一推进顺序，而不是继续在旁边叠加 prose。
完整证据见 `post-fix-with-run-{1,2,3}.md` 与 `post-fix-codex-grades.md`。

## 8. Independent-review remediation 改前预测

本轮不在旧 paragraph 旁边叠加解释，而是替换两个承重形状：Track B 表格的产物格，以及唯一推进顺序中的
`Capability intent / hook contract` slash 竞争。固定预测：

1. 相同 case / assertions 的 A3 应从当前 `1/3` 提升到至少 `2/3`，目标 `3/3`。
2. 新措辞必须同时保留四个合取项：Capability Card、host-neutral intent + testable acceptance、
   所有 affected hook CONTRACT、两者齐备前阻止 host-native implementation acceptance。
3. A1/A2/A4/A5 无意图变化；三轮小样本若偶发 omission，不解读为对其它维度的改善或退化。
4. 若 A3 仍为 `1/3`，不继续刷题/叠 prose；回退「已稳定验证」的行为承诺，只保留可人审的 artifact
   owner/how-to 边界，并在 DESIGN evidence anchor 明记 open consistency gap。

## 9. Independent-review remediation targeted result

保持 case / assertions 不变，重跑三个隔离的 Claude Sonnet high with-skill 会话。严格直接证据读取：

| Run | Score | A3 | 关键证据 / omission |
| --- | ---: | --- | --- |
| review-remediation with-1 | `3/5` | PASS | 明写 `host-neutral intent + testable acceptance`、同时更新所有 affected `CONTRACT.md`、齐备前不验收；A1/A2 对 fact / Track A 分类不够严格 |
| review-remediation with-2 | `4/5` | FAIL | Card 写 `host-neutral intent + acceptance`，但没有直接限定 acceptance 为 testable |
| review-remediation with-3 | `5/5` | PASS | 明写 host-neutral intent、可测 acceptance、所有 affected CONTRACT，且齐备前不验收 |

直接证据计分为 `12/15`，A3 从当前 baseline `1/3` 到 `2/3`；达到改前写死的最低预测，
但没有达到 `3/3` 稳定门。非 Claude Codex 二评连续三次未产生可消费 verdict：一次输出被 trace
预算截断，两次在有界窗口内只完成读取/声明而超时（最后一次 exit `124`）。按 silent-pass-through
guard，二评记为**未通过 / 不可用**，不用自评冒充独立判决。

结论：slash competition 已从承重表格/顺序中消失，A3 不再是 `1/3`；但本轮只声称 artifact owner/how-to
形状改善，不声称 Track-B 行为门已稳定全过。完整 transcript 见
`review-remediation-with-run-{1,2,3}.md`；二评 prompt 见 `review-remediation-codex-judge-prompt.md`。
