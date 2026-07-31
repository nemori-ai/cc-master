---
point: workflow.api-agent
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-agent -->
## `agent(prompt, opts?) → Promise<string | object>`

派生一个 fresh-context 的 leaf subagent。

- **返回：** 不给 `schema` 时返回 leaf 的最终文本（一个 `string`）；给了 `schema` 时返回
  一个匹配 `schema` 的**已校验对象**（校验在 tool-call 层完成——不用 `JSON.parse`）。被用户
  跳过的 agent 返回 **`null`**（`.filter(Boolean)` 就是为它而设）。

### `opts`（全部可选）

| 选项 | 类型 | 含义 |
|---|---|---|
| `label` | string | 在 `/workflows` 里显示的名字。纯装饰——**绝不**进 cache。 |
| `phase` | string | 把 agent 归进一个命名的 progress group。必须匹配某个 `meta.phases[].title`。纯装饰——绝不进 cache。**在并发的 `parallel`/`pipeline` stage 内部，优先用 `opts.phase`、而非全局的 `phase()` 调用**（避免 group-attribution race）。 |
| `schema` | JSON Schema | 强制结构化输出，`agent()` 返回已校验对象。**改它会让 cache 失效。** |
| `model` | string | 覆盖 model。默认继承 main-loop 的 model——契约说这个默认「几乎总是对的」，所以拿不准就别传。**改它会让 cache 失效。** |
| `isolation` | `'worktree'` | 让这个 agent 在一个全新的 git worktree 里跑。**只**在并行 agent 会改到同一批文件、可能冲突时才用（每个 agent 约 200–500 ms + 占磁盘）。**改它会让 cache 失效。** |
| `agentType` | string | 改用一个自定义 subagent 类型，从与 Agent 工具同一个 registry 里解析。**改它会让 cache 失效。** |

<!-- ccm:k:end point:workflow.api-agent -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这个项目里 agent() API 的确切 opts 参数、返回值形状和 schema 对 cache 的影响

agent() 的返回语义与 opts 字段表是本框架的具体接口事实。
