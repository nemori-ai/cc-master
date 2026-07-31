---
point: workflow.primitive-model
---

## 权威陈述

<!-- ccm:k:start point:workflow.primitive-model -->
## 2. 7 个 primitive + 2 个注入对象（真实语义）

| Primitive / 对象 | 它做什么 | Barrier？ |
|---|---|---|
| `agent(prompt, opts?)` | 派生一个 fresh-context 的 leaf subagent；返回它的文本，给了 `schema` 时返回一个已校验对象。用户跳过 → `null`。 | n/a |
| `parallel(thunks)` | 并发跑一个 **thunk 数组**，等齐全部。 | **YES** |
| `pipeline(items, ...stages)` | 让每个 item 独立流过所有 stage。 | **NO** |
| `phase(title)` | 为接下来派生的 agent 开启一个命名的 progress group。 | n/a |
| `log(message)` | 在 progress tree 上方发一行叙述。 | n/a |
| `workflow(nameOrRef, args?)` | 内联跑另一个 workflow（只有一层）。 | n/a |
| `args` | 传给本次 run 的输入值，原样作为全局暴露。 | n/a |
| `budget` | `{total, spent(), remaining()}`——共享的 output-token 池。 | n/a |

`agent()` 细节：不给 `schema` 时返回 leaf 的最终文本（一个 string）；给了 JSON `schema`
时返回一个已校验的**对象**（不用 `JSON.parse`）——校验在 tool-call 层发生，不匹配就让
model 重试。被用户跳过的 agent 返回 `null`，这就是到处都见 `.filter(Boolean)` 的缘由。
（完整 opts 见 `api-reference.md`。）

<!-- ccm:k:end point:workflow.primitive-model -->

## 失效类型

`environment_fact`（主体：事实方法） —— 缺原始对象的准确语义（parallel 是 barrier、pipeline 非等齐、agent 返回类型、budget 共享），导致代码形式正确但行为与预期不符

主体是本引擎 7 个 primitive 与 2 个注入对象的接口事实：各自语义、是否 barrier、schema 与跳过时的返回值。
