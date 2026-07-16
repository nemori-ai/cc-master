# 2026-07-16 kimi-code 适配 PR #159 codex 第二验收

> 场景：K7（WS-K 收口 PR）在通过本仓四闸（`run-tests.sh` / `check-plugin-dist-sync.sh` /
> `skill-lint.sh` / `claude plugin validate`）后，按 AGENTS.md §7「codex 作为 reviewer 范式」
> 跑 `codex exec review`（`-s read-only`，`-c model_reasoning_effort=high`）对全量 PR diff
> 做独立第二意见验收。本文档记录 codex 的原始 verdict/findings，以及我对每条 finding
> **独立对源核实后**的处置——绝不盲转，真缺陷修、误报驳。

## codex 调用

```
codex exec review --base origin/main -m gpt-5.6-sol \
  -c model_reasoning_effort=high -c sandbox_mode='"read-only"' \
  --json -o <out>
```

`gpt-5.6-sol` 取自 `ccm provider facts codex --json` 的 frontier 档模型。sandbox 只读，
diff 范围为 rebase 后的完整 kimi-code 适配（15 commits，约 250 文件）。

## codex verdict

**`needs-attention`** — 5 条 finding，无 blocker 级（无 P0），2 条 P1、3 条 P2。

## Findings 与独立核实处置

### Finding 1（P1）—— kimi-code 缺失 role-substrate 重注入锚点

**codex 原话大意**：kimi-code 的 PostCompact hook（`reinject-core.js`）输出被 kimi 引擎丢弃
（K4 自己的探针 `plugin/src/hooks/_hosts/kimi-code/probes/README.md` 已证实这一点），而
`kimi.plugin.json` 又没有声明 `sessionStart` 字段——这意味着 kimi-code 的 orchestrator
身份 / 七镜头 / 红线 / 决策程序在 compaction 后**完全没有任何重注入通道**，是本适配里
最严重的功能性缺口。

**独立核实**：读 `plugin/src/.kimi-plugin/plugin.json`（rebase 后的源文件）确认 `sessionStart`
字段确实缺失；读 kimi-code 官方 manifest schema 文档确认 `sessionStart.skill` 是合法字段、
用于在会话开始时把指定 skill 全文注入 context。确认属实。

**处置：修复**。`plugin/src/.kimi-plugin/plugin.json` 新增：
```json
"sessionStart": { "skill": "master-orchestrator-guide" }
```
同步 `plugin/dist/kimi-code/kimi.plugin.json`。**注意口径**：`sessionStart` 是会话*开始*时
注入（一次性），不是 compaction 后重注入——严格说不能完全等价于 Claude Code 的 PostCompact
reinject。但因为 `master-orchestrator-guide` SKILL.md 本身就是那份「魂」的全文，在 session
start 时注入至少保证 kimi-code 编排者在**第一次**拿到完整身份substrate，比此前「PostCompact
输出被丢弃、sessionStart 也未接线」的双重真空要好得多。已在 `plugin/src/hooks/reinject/CONTRACT.md`
的降级行为一节把这个补偿机制的措辞更正为准确描述（见下一条）。

**遗留诚实缺口**（未修复，已如实记录）：kimi-code 仍不具备「每次 compaction 后」的重注入能力，
只有「session 开始时」一次。这是 kimi-code 平台能力边界（该 host 无 PostCompact 等价可用事件），
非本 PR 遗漏——已在 `reinject` CONTRACT.md 的 `降级行为` 一节按 `event-unavailable` 分类标注。

### Finding 2（P2，disputed）—— bootstrap resume 的 steal-refusal 无 liveness probe

**codex 原话大意**：`bootstrap-board-core.js` 的 `resumeBoard` 函数在检测到目标 board
已被另一个 active session 持有时无条件拒绝接管，没有 Claude Code 那样的存活探测
（liveness probe）+ `--force-takeover` 逃生舱——如果原 session 已经死掉（进程不在了），
kimi-code 上的用户会被硬卡住，没有恢复路径。

**独立核实**：
- 读 `plugin/src/hooks/bootstrap-board/implementations/kimi-code/bootstrap-board-core.js`
  约 369-380 行，确认 `resumeBoard` 确实无条件拒绝接管、无存活探测。
- 对照读 `implementations/codex/bootstrap-board-core.js`（约 369 行）与
  `implementations/cursor/bootstrap-board-core.js`（约 380 行）——**结构逐行一致**，
  三个已上线宿主（codex/cursor 都已合并进 main）共享同一份保守拒绝逻辑，无一具备
  liveness probe。
- 读 `plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh`
  约 264-483 行——只有 claude-code 实现了更复杂的存活探测 + `--force-takeover` 机制，
  这是 claude-code-only 的能力（该逃生舱依赖 claude-code 特有的进程探测手段）。
- 读 `plugin/src/hooks/bootstrap-board/CONTRACT.md`——`rule-bootstrap-resume-arm` 的规则文本
  未提及 liveness/force-takeover，且该规则在 PARITY anchors 里**没有登记任何 required_hosts**
  （即 CONTRACT.md 本身从未把这一能力声明为跨宿主必须对齐的规则）。

**结论**：finding 内容准确，但这是一个 **codex/cursor 已合并进 main 的既有模式**，kimi-code
只是原样复用了同样的保守策略，不是本 PR 独有引入的缺陷。把它作为 K7（kimi-code 收口 PR）范围内
的 blocker 不合理——若要修，应该是一个跨三个宿主（codex/cursor/kimi-code）的独立 follow-up，
且很可能需要先在 CONTRACT.md 里补一条新规则 + PARITY anchor（因为它现在根本没被声明为
跨宿主规则），而不是在这个 PR 里单独给 kimi-code 加一个其他宿主都没有的能力（那样反而制造新的
N-host 不一致）。

**处置：驳回（out of scope，不在本 PR 修）**。已在本文档留痕；建议作为独立 issue 跟踪
（涵盖 codex/cursor/kimi-code 三宿主一起补 liveness probe，或至少在 CONTRACT.md 里显式声明
"无 liveness probe" 是三宿主共同的已知限制而非某一宿主的回归）。

### Finding 3（P2）—— kimi-code 未被 ccm coordination 的 origin 枚举接受

**codex 原话大意**：kimi-code 自己的 `bootstrap-board-core.js` 会调用
`ccm coordination subscription register --origin kimi-code`，但 `ccm` 侧的 origin 校验
（无论是 handler 级还是 CLI flag 级）都只认 `claude-code | codex | cursor`，这个调用
从一开始就注定失败。

**独立核实**：
- 读 `ccm/apps/cli/src/handlers/coordination.ts` 第 56 行：
  `const ORIGINS = new Set(['claude-code', 'codex', 'cursor']);`——确认缺 kimi-code。
- 读 `ccm/apps/cli/src/registry.ts` 第 1725、1746 行，`coordination.inbox` 与
  `coordination.subscription` 命令的 `origin` flag 声明 `enum: ['claude-code', 'codex', 'cursor']`
  ——**这是比 handler 级校验更早生效的一层**：`router.ts` 的通用 arg-parser 会在
  handler 代码跑之前就按这个 enum 拒绝非法值，所以即使只修 `coordination.ts` 也不够，
  必须两处同步改。
- 读 `plugin/src/hooks/bootstrap-board/implementations/kimi-code/bootstrap-board-core.js`
  确认它确实调用了 `ccm coordination subscription register --origin kimi-code`。
- 额外核查（超出 finding 原文但顺手查到）：`cursor-provider-driver.ts:209` 与
  `claude-provider-driver.ts:395` 也各有一份 `origin_harness: ['claude-code', 'codex', 'cursor']`
  枚举，但那是 native-attempt 请求/响应契约专用的独立枚举，与 coordination 的 origin 无关；
  kimi-code 的 native-attempt 本就在其 `strategy.yaml` 里声明 `unsupported`，故**这两处
  故意不改**——改了反而制造一个从未被使用、也不该被使用的 kimi-code native-attempt 假象。

**结论**：finding 准确，且是一个真实的运行时故障（kimi-code 的 bootstrap 会在 coordination
注册这一步失败）。

**处置：修复**。同一 commit（`b055d62f`）里两处同步改：
- `ccm/apps/cli/src/handlers/coordination.ts` 第 56 行 `ORIGINS` Set 加入 `'kimi-code'`，
  第 98 行的用法错误提示同步更新。
- `ccm/apps/cli/src/registry.ts` 两处 `enum: [...]`（`coordination.inbox` / `coordination.subscription`
  的 `origin` flag）都加入 `'kimi-code'`。

已用本地 dev-bin shim（`ccm/apps/cli/dev-bin/ccm`）实测验证：
```
$ ccm coordination inbox list --origin kimi-code --session-id test-sid \
    --board /tmp/nonexistent.board.json --json
{"ok":false,"exit":5,"error":"--board path is missing or not valid board JSON: ...","violations":[]}
```
失败原因是 `--board` 路径不存在（预期），**不再是 origin 枚举被拒**——确认两层校验都已放行
`kimi-code`。另跑 `pnpm -C ccm test`（1409 pass / 0 fail / 67 skip）全绿，含
`handler-coordination.test.ts` 等相关测试。

### Finding 4（P2）—— `handoff.md` 被排除导致悬空引用

**codex 原话大意**：kimi-code 的 `master-orchestrator-guide` 适配 `strategy.yaml` 把
`references/handoff.md` 排除在投影之外，但 `cc-master:handoff-to-new-session` 命令体和
SKILL.md 自己的 command-entry 表都指向这份 reference——排除后这两处引用在装机后是死链。

**独立核实**：读 `plugin/src/skills/master-orchestrator-guide/adapters/kimi-code/strategy.yaml`
（rebase 前版本）确认 `exclude_canonical` 里确实有 `references/handoff.md`；读
`plugin/src/commands/handoff-to-new-session/adapters/kimi-code/body.md` 与
`plugin/dist/kimi-code/skills/master-orchestrator-guide/SKILL.md` 的 command-entry 表，
确认两处都提及 `handoff.md`；读 `handoff.md` 全文（134 行）确认零 Claude-specific token
（无 `${CLAUDE_*}`、无 Claude Code 专有命令名），host-neutral，可安全逐字投影。

**结论**：finding 准确，是一个真实的悬空引用。

**处置：修复**。`strategy.yaml` 的 `exclude_canonical` 移除 `references/handoff.md`（保留
`references/cost-decisions.md` 排除——它确实是 Claude Code 专有账号池切换指导，kimi-code
账号池切换 unsupported，排除合理）；`overlays/handoff-reference-row.md` 从此前「不投影、别
drill」的诚实规避文案改写为与 claude-code 一致的「drill」框架，但换成 kimi-code 实际的命令名
（`cc-master:handoff-to-new-session` + `cc-master:as-master-orchestrator --resume`）；
新增 `plugin/dist/kimi-code/skills/master-orchestrator-guide/references/handoff.md`（逐字投影）；
用**沙盒经批准的 `node scripts/update-provider-guidance-attestations.cjs`** 重新生成
`plugin/src/skills/provider-guidance-runtime.json` 的 attestation 哈希（新增 `handoff.md`
条目 + `SKILL.md` 哈希随行更新）——全程未绕过 attestation 闸，只用了 sanctioned 脚本。

### Finding 5（P2）—— kimi-code 命令体过度声称账号池/pacing 支持

**codex 原话大意**：`as-master-orchestrator` 的 kimi-code 命令体第 2 步的账号池段落是从
Claude Code 版本逐字复制来的，让 agent 去按 `usage-pacing` hook 和 `ccm account` 命令
估算「可序列消费配额份数」——但 kimi-code 既没有 `usage-pacing` hook，`ccm account`
的 add/delete/refresh/list/switch 对 kimi-code 也都是 unsupported，这段指导会让 agent
按一个不存在的机制去决策。

**独立核实**：读 `plugin/dist/kimi-code/commands/as-master-orchestrator.md`（rebase 后）
第 42 行，确认原文确实照抄了 claude-code 的账号池段落（提及 `usage-pacing` hook 与
`effective-N` 概念）；核对 `plugin/src/hooks/_manifest/hooks.yaml` 与 kimi-code 的 5 个
已实现 hook 列表（bootstrap-board / board-guard / board-lint / verify-board /
reinject-as-PostCompact-noop）——确认 `usage-pacing` 不在其中；核对
`ccm/apps/cli/src/harnesses/kimi-code.ts` 与 `registry.ts` 里 `account` 相关命令的
host gate——确认 kimi-code 确实不在 `account add/delete/refresh/list/switch` 的支持列表里。
另用 grep 核查全部 kimi-code 命令体，确认这个过度声称段落只出现在
`as-master-orchestrator` 这一处，没有扩散到其他命令。

**结论**：finding 准确，是一个真实的误导性文案，会让 orchestrator agent 浪费回合去尝试
不存在的机制。

**处置：修复**。重写该段落为诚实版本：明确「kimi-code 当前无 CLI 配额信号
（`ccm usage show/advise` 恒 `available:false`）、无 `usage-pacing` hook，本编排不按任何
窗口 pace；`ccm account add/delete/refresh/list/switch` 当前对 kimi-code unsupported……
自动换号永久禁止」，并指向 `pacing-and-estimation` skill 与 `using-ccm` 的 kimi-code
边界说明作为权威来源。同步 `plugin/src/commands/as-master-orchestrator/adapters/kimi-code/body.md`
（源）与 `plugin/dist/kimi-code/commands/as-master-orchestrator.md`（dist）。

## 汇总

| # | Severity | 结论 | 处置 |
|---|---|---|---|
| 1 | P1 | 属实 | 修复（`sessionStart` 接线 + CONTRACT.md 措辞更正） |
| 2 | P2 | 属实但 out-of-scope（codex/cursor 共享的既有模式） | 驳回，留痕建议独立 follow-up |
| 3 | P2 | 属实，双层 bug | 修复（`coordination.ts` + `registry.ts` 两层同步） |
| 4 | P2 | 属实 | 修复（停止排除 `handoff.md` + attestation 重生成） |
| 5 | P2 | 属实 | 修复（重写账号池/pacing 段落为诚实缺口声明） |

4 条修复、1 条有理有据地驳回（非盲目接受，也非无理拒绝）。修复后重跑完整四闸
（`run-tests.sh` 123/123 pass、`pnpm -C ccm test` 1409/1409 pass、`check-plugin-dist-sync.sh`
zero diff、`skill-lint.sh` 0 violation、`claude plugin validate` passed），确认无回归。
