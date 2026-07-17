---
title: 写 workflow
description: 工作清单又长又机械时，把它交给一段确定性脚本——并把上百个中间结果挡在 agent 的 context 之外。
section: guides
order: 3
deeper:
  - label: authoring-workflows SKILL.md —— 完整写作契约
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/authoring-workflows/canonical/SKILL.md
  - label: harness 兼容性矩阵 —— 哪里有 workflow
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/harnesses/compatibility-matrix.md
---

**dynamic workflow** 把「下一步跑什么」的决定权从 LLM 手里拿走，交给一段确定性的 JavaScript 脚本，由 harness runtime 在后台执行。每一步里仍是 LLM 在思考；脚本管控制流——fan-out、排序、重试、去重——只有最终综合回到 context。

## 你真的需要吗？

workflow 有实打实的开销。两个条件同时成立才用它：

- 你要在一份工作清单上协调**几十到几百个 agent 调用**，且
- 中间结果必须留在 context **之外**（五十份文件评审不该塞满 orchestrator 的窗口；摘要才该）。

否则用更简单的机制：一个独立实现任务用 **subagent**，零 token 的等待和轮询用 **background shell**。如果一个 prompt 装得下整件事，这些都不用考虑。

## 基本形状

每个 workflow 是一个 JS 文件。`meta` 必须是第一条语句、且是纯字面量。文件里 `agent(prompt, options)` 跑一步 LLM；控制流 primitive 把它们组合起来。runtime 硬性执行三条规则：不用 `Date.now()` / `Math.random()` / 无参 `new Date()`（它们破坏 resume）、不用 `require` / Node 内置模块 / `process.*`（sandbox）、`parallel()` 只收 **thunk** 不收裸 promise。上限：16 并发、总量 1,000 次 agent 调用、512 KB。

## 模式 1 —— fan-out（barrier）

任务互相独立，且你要**收齐全部**结果再往下走：

```js
export const meta = {
  name: 'locale-translate',
  description: 'Translate extracted strings into 6 locales concurrently.',
  phases: [{ title: 'Translate' }],
}
const locales = args ?? ['fr', 'de', 'es', 'ja', 'ko', 'zh']
const results = await parallel(locales.map((loc) => () =>
  agent(`Translate strings/en.json into ${loc}; write strings/${loc}.json`, { phase: 'Translate' })
))
return results.filter(Boolean)
```

## 模式 2 —— pipeline（默认首选）

多阶段工作，item A 可以到 stage 2 而 item B 还在 stage 1。**默认用它，而不是 barrier**——除非后面某个 stage 真的需要前一阶段的整批集合（去重、合并、跟其余全部比一遍）：

```js
export const meta = {
  name: 'review-then-verify',
  description: 'Review each changed file, then adversarially verify every finding.',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const files = args ?? ['src/a.ts', 'src/b.ts']
const out = await pipeline(files,
  (f) => agent(`Review ${f}; return findings as a list`, { phase: 'Review' }),
  (findings, f) => agent(`Try to refute each finding for ${f}: ${JSON.stringify(findings)}`, { phase: 'Verify' }),
)
return out.filter(Boolean)
```

## 模式 3 —— loop until dry

规模未知的发现——找出*所有*某类东西。计数器会漏掉尾巴；连续空轮不会：

```js
export const meta = {
  name: 'bug-hunt',
  description: 'Keep hunting until 2 consecutive rounds find nothing new.',
  phases: [{ title: 'Hunt' }],
}
const DRY_LIMIT = 2
const seen = new Set(), all = []
let dry = 0
while (dry < DRY_LIMIT) {
  const r = await agent('Find bug candidates not yet seen; return { items: [...] }', {
    phase: 'Hunt',
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
  })
  const fresh = (r?.items ?? []).filter((x) => !seen.has(x))
  if (fresh.length === 0) { dry++; continue }
  dry = 0
  fresh.forEach((x) => { seen.add(x); all.push(x) })
}
return all
```

真实 workflow 把这些形状叠起来：scout-then-fan-out、带对抗验收闸的 loop、有界重试的 self-repair。skill 自带 5 个模板和 12 个完整例子（bug 狩猎、PR 分诊、迁移清扫、锦标赛）——从最接近的那个起手，而不是从空白文件起手。另外：没有独立的 linter 要跑——harness 在 launch 时校验 `meta`、在 runtime 校验确定性，它的报错就是权威 checker。读报错、修好、重新 launch。

## harness 支持边界——先读这里

dynamic workflow 目前是 **Claude Code 独占**能力。Codex、Cursor、kimi-code 都没有经证实的 Workflow 工具等价物；在这些 host 上，该 skill 以显式的 unsupported stub 形态发布，orchestrator 会退回 subagent 和 background shell 来搭同样的形状。围绕 `parallel()` / `pipeline()` 设计跨 host 方案之前，先查兼容性矩阵。
